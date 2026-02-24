import { readFileSync, existsSync, statSync } from "fs";
import { join, extname } from "path";
import * as db from "./database";
import * as logger from "./logger";

import * as taskManager from "./taskmanager";

const PORT = 3000;
const OLLAMA_BASE = "http://localhost:11434";
const MODEL = "llama3.1";
const PUBLIC_DIR = join(import.meta.dir, "..", "public");

// MIME type map
const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
};

function serveStatic(path: string): Response | null {
    const filePath = join(PUBLIC_DIR, path === "/" ? "index.html" : path);
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) return null;
    const ext = extname(filePath);
    const mime = mimeTypes[ext] || "application/octet-stream";
    return new Response(readFileSync(filePath), {
        headers: { "Content-Type": mime },
    });
}

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
}

function jsonResponse(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
}

// ─── Server ───────────────────────────────────────────────
const server = Bun.serve({
    port: PORT,
    idleTimeout: 255, // Max allowed by Bun on Windows. Keep-alive handles longer tasks.
    async fetch(req, server) {
        const url = new URL(req.url);
        const path = url.pathname;

        // CORS preflight
        if (req.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders() });
        }

        // ─── WebSocket upgrade for logs ───
        if (path === "/ws/logs") {
            const upgraded = server.upgrade(req);
            if (!upgraded) {
                return new Response("WebSocket upgrade failed", { status: 400 });
            }
            return undefined as unknown as Response;
        }

        // ─── API Routes ───
        try {
            // Chat: start background task
            if (path === "/api/chat" && req.method === "POST") {
                return handleChat(req);
            }

            // Subscribe to task stream
            const streamMatch = path.match(/^\/api\/chat\/stream\/(.+)$/);
            if (streamMatch && req.method === "GET") {
                return handleTaskStream(streamMatch[1], url);
            }

            // Check task status
            const statusMatch = path.match(/^\/api\/chat\/status\/(.+)$/);
            if (statusMatch && req.method === "GET") {
                return handleTaskStatus(statusMatch[1]);
            }

            // Check if conversation has active task
            const activeMatch = path.match(/^\/api\/chat\/active\/(.+)$/);
            if (activeMatch && req.method === "GET") {
                const activeTaskId = taskManager.getActiveTaskForConversation(activeMatch[1]);
                return jsonResponse({ taskId: activeTaskId });
            }

            // Auto-title generation
            if (path === "/api/chat/title" && req.method === "POST") {
                return handleAutoTitle(req);
            }

            // Conversations CRUD
            if (path === "/api/conversations" && req.method === "GET") {
                return jsonResponse(db.getConversations());
            }
            if (path === "/api/conversations" && req.method === "POST") {
                const body = await req.json();
                const id = crypto.randomUUID();
                const conv = db.createConversation(id, body.title || "New Chat");
                logger.info(`New conversation created: ${id}`);
                return jsonResponse(conv, 201);
            }

            // Conversation by ID
            const convMatch = path.match(/^\/api\/conversations\/(.+)$/);
            if (convMatch) {
                const id = convMatch[1];
                if (req.method === "GET") {
                    const conv = db.getConversation(id);
                    if (!conv) return jsonResponse({ error: "Not found" }, 404);
                    const messages = db.getMessages(id);
                    return jsonResponse({ ...conv, messages });
                }
                if (req.method === "DELETE") {
                    db.deleteConversation(id);
                    logger.info(`Conversation deleted: ${id}`);
                    return jsonResponse({ ok: true });
                }
            }

            // File read
            if (path === "/api/files/read" && req.method === "POST") {
                return handleFileRead(req);
            }

            // ─── Static files ───
            if (path === "/logs") {
                const file = readFileSync(join(PUBLIC_DIR, "logs.html"));
                return new Response(file, {
                    headers: { "Content-Type": "text/html" },
                });
            }

            const staticRes = serveStatic(path);
            if (staticRes) return staticRes;

            return new Response("Not Found", { status: 404 });
        } catch (err: any) {
            logger.error(`Request error: ${err.message}`);
            return jsonResponse({ error: err.message }, 500);
        }
    },

    websocket: {
        open(ws) {
            logger.addLogClient(ws);
            logger.info("Log viewer connected");
        },
        close(ws) {
            logger.removeLogClient(ws);
            logger.info("Log viewer disconnected");
        },
        message() {
            // Log viewer is read-only, no incoming messages expected
        },
    },
});

// ─── Handlers ─────────────────────────────────────────────

async function handleChat(req: Request): Promise<Response> {
    const body = await req.json();
    const { conversation_id, message, useSearch, useCode } = body;

    if (!conversation_id || !message) {
        return jsonResponse({ error: "conversation_id and message required" }, 400);
    }

    logger.info(`💬 Chat request [${conversation_id.slice(0, 8)}]: ${message.substring(0, 80)}... (Search: ${useSearch}, Code: ${useCode})`);

    // Save user message
    db.addMessage(conversation_id, "user", message);
    db.touchConversation(conversation_id);

    // Build message history (limit to last 10 messages to reduce context size)
    const MAX_HISTORY = 10;
    const history = db.getMessages(conversation_id);
    const recentHistory = history.slice(-MAX_HISTORY);

    // Dynamic System Prompt
    let toolInstructions = "";
    if (useSearch) {
        toolInstructions += `1. 'web_search': Get up-to-date information from the internet.\n   - Use for current events, news, or specific facts you don't know.\n`;
    }
    if (useCode) {
        toolInstructions += `2. 'execute_python': Execute Python code to calculate math, analyze data, or VERIFY code logic.\n   - When asked to "write code" or "make a calculator", ALWAYS write the code and then RUN it using 'execute_python' to ensure it works.\n   - Report the output of the execution to the user.\n   - If 'execute_python' returns an error, apologize and try to fix the code in the next turn (Self-Correction).\n`;
    }

    const systemPrompt = `You are Akara AI, a helpful and knowledgeable AI assistant. 
You have access to REAL-TIME tools:
${toolInstructions}

CRITICAL INSTRUCTIONS:
1. If you use a tool, base your answer on the tool's output.
2. When sharing code, always specify the programming language in code blocks.
3. Respond in the same language the user uses (Indonesian/English).
4. Today's date is ${new Date().toISOString().split("T")[0]}.
5. Provide comprehensive and detailed answers.
6. STEALTH: Do not say "I used the tool". Just provide the answer/result directly.`;

    const ollamaMessages = [
        { role: "system", content: systemPrompt },
        ...recentHistory.map((m) => ({ role: m.role, content: m.content })),
    ];

    // Start background task (runs even if client disconnects)
    const taskId = taskManager.startTask(conversation_id, ollamaMessages, body.useSearch ?? true, body.useCode ?? false);
    logger.info(`💬 Task ${taskId.slice(0, 8)} assigned to conversation ${conversation_id.slice(0, 8)}`);

    return jsonResponse({ taskId });
}

function handleTaskStream(taskId: string, url: URL): Response {
    const fromChunk = parseInt(url.searchParams.get("from") || "0");
    const stream = taskManager.subscribe(taskId, fromChunk);

    if (!stream) {
        logger.warn(`📋 Task ${taskId.slice(0, 8)} not found for streaming`);
        return jsonResponse({ error: "Task not found" }, 404);
    }

    logger.info(`📋 [Task ${taskId.slice(0, 8)}] Client subscribed to stream (from chunk ${fromChunk})`);

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            ...corsHeaders(),
        },
    });
}

function handleTaskStatus(taskId: string): Response {
    const status = taskManager.getTaskStatus(taskId);
    if (!status) {
        return jsonResponse({ error: "Task not found" }, 404);
    }
    return jsonResponse({
        id: status.id,
        conversationId: status.conversationId,
        status: status.status,
        chunkCount: status.chunks.length,
        fullResponse: status.status === "completed" ? status.fullResponse : undefined,
        error: status.error,
    });
}

async function handleAutoTitle(req: Request): Promise<Response> {
    const body = await req.json();
    const { conversation_id, message } = body;

    logger.info(`Generating auto-title for [${conversation_id}]`);

    try {
        const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    {
                        role: "system",
                        content:
                            "Generate a very short title (max 6 words) for this chat based on the user's message. Reply with ONLY the title, nothing else. No quotes, no punctuation at the end.",
                    },
                    { role: "user", content: message },
                ],
                stream: false,
            }),
        });

        const data = await res.json();
        const title = data.message?.content?.trim() || "New Chat";
        db.updateConversationTitle(conversation_id, title);
        logger.info(`Auto-title set: "${title}" for [${conversation_id}]`);
        return jsonResponse({ title });
    } catch (err: any) {
        logger.error(`Auto-title error: ${err.message}`);
        return jsonResponse({ title: "New Chat" });
    }
}

async function handleFileRead(req: Request): Promise<Response> {
    const body = await req.json();
    const { path: filePath } = body;

    if (!filePath) {
        return jsonResponse({ error: "path is required" }, 400);
    }

    logger.info(`File read request: ${filePath}`);

    try {
        if (!existsSync(filePath)) {
            logger.warn(`File not found: ${filePath}`);
            return jsonResponse({ error: "File not found" }, 404);
        }

        const stat = statSync(filePath);
        if (stat.isDirectory()) {
            return jsonResponse({ error: "Path is a directory" }, 400);
        }

        // Limit file size to 1MB
        if (stat.size > 1_000_000) {
            logger.warn(`File too large: ${filePath} (${stat.size} bytes)`);
            return jsonResponse({ error: "File too large (max 1MB)" }, 400);
        }

        const content = readFileSync(filePath, "utf-8");
        logger.info(`File read success: ${filePath} (${stat.size} bytes)`);
        return jsonResponse({ path: filePath, content, size: stat.size });
    } catch (err: any) {
        logger.error(`File read error: ${err.message}`);
        return jsonResponse({ error: err.message }, 500);
    }
}

// ─── Startup ──────────────────────────────────────────────
logger.info(`🚀 AI Agent Chatbot server running at http://localhost:${PORT}`);
logger.info(`📋 Log viewer available at http://localhost:${PORT}/logs`);
logger.info(`🤖 Using Ollama model: ${MODEL}`);
