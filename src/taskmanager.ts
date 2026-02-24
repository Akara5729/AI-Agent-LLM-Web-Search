import * as logger from "./logger";
import * as db from "./database";

const OLLAMA_BASE = "http://localhost:11434";
const MODEL = "llama3.1";

// ─── Types ────────────────────────────────────────────
export interface TaskChunk {
    content: string;
    index: number;
}

export interface GenerationTask {
    id: string;
    conversationId: string;
    status: "running" | "completed" | "error";
    chunks: TaskChunk[];
    fullResponse: string;
    error?: string;
    createdAt: number;
    completedAt?: number;
    subscribers: Set<ReadableStreamDefaultController>;
}

// ─── Active Tasks Map ─────────────────────────────────
const activeTasks = new Map<string, GenerationTask>();

/**
 * Start a background generation task.
 * This runs independently of the client connection.
 */
export function startTask(
    conversationId: string,
    messages: { role: string; content: string }[],
    useSearch: boolean = true,
    useCode: boolean = false
): string {
    const taskId = crypto.randomUUID();

    const task: GenerationTask = {
        id: taskId,
        conversationId,
        status: "running",
        chunks: [],
        fullResponse: "",
        createdAt: Date.now(),
        subscribers: new Set(),
    };

    activeTasks.set(taskId, task);

    const activeModes = [];
    if (useSearch) activeModes.push("Search");
    if (useCode) activeModes.push("Code");
    const modeStr = activeModes.length > 0 ? `🛠️ ${activeModes.join("+")}` : "⚡ Chat";

    logger.info(`📋 [Task ${taskId.slice(0, 8)}] Created for conversation ${conversationId.slice(0, 8)} (${modeStr})`);

    // Fire-and-forget: start Ollama fetch in background
    processTask(task, messages, useSearch, useCode).catch((err) => {
        logger.error(`📋 [Task ${taskId.slice(0, 8)}] Fatal error: ${err.message}`);
        task.status = "error";
        task.error = err.message;
        notifySubscribers(task, { type: "error", error: err.message });
        closeSubscribers(task);
    });

    return taskId;
}

import { availableTools, executeTool } from "./tools";

/**
 * Process the Ollama request in the background
 * Handles Tool Calling loop for autonomous agent behavior
 */
async function processTask(
    task: GenerationTask,
    messages: { role: string; content: string }[],
    useSearch: boolean,
    useCode: boolean
): Promise<void> {
    logger.info(`📋 [Task ${task.id.slice(0, 8)}] Starting processing... (Search: ${useSearch}, Code: ${useCode})`);

    // Keep-alive heartbeat (every 30s) to prevent browser/server timeout
    const keepAliveInterval = setInterval(() => {
        const encoder = new TextEncoder();
        const msg = encoder.encode(": keep-alive\n\n");
        for (const controller of task.subscribers) {
            try {
                controller.enqueue(msg);
            } catch {
                // If controller is closed, it will be removed by the stream logic or next notify
            }
        }
    }, 30000);

    try {
        let iteration = 0;
        const MAX_ITERATIONS = 5; // Prevent infinite loops

        while (iteration < MAX_ITERATIONS) {
            iteration++;
            logger.info(`📋 [Task ${task.id.slice(0, 8)}] Iteration ${iteration}`);

            // Filter active tools based on toggles
            const activeTools = [];
            if (useSearch) {
                const t = availableTools.find(t => t.function.name === "web_search");
                if (t) activeTools.push(t);
            }
            if (useCode) {
                const t = availableTools.find(t => t.function.name === "execute_python");
                if (t) activeTools.push(t);
            }
            const hasTools = activeTools.length > 0;

            // ─── Decide: stream or non-stream? ───
            // If NO tools active: always stream
            // If tools active, iteration 1: non-stream (detect tool_calls)
            // If tools active, iteration 2+: stream (final answer)
            const shouldStream = !hasTools || iteration > 1;

            // Prepare request body
            const requestBody: any = {
                model: MODEL,
                messages,
                stream: shouldStream,
            };

            // Only add tools on first iteration if tools are enabled
            if (hasTools && iteration === 1) {
                requestBody.tools = activeTools;
            }

            const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Ollama error (${response.status}): ${errText}`);
            }

            // ─── TRUE STREAMING PATH ───
            if (shouldStream) {
                logger.info(`📋 [Task ${task.id.slice(0, 8)}] 🚀 True streaming active`);
                const content = await streamFromOllama(response, task);
                task.fullResponse += content;
                break; // Streaming is always the final step
            }

            // ─── NON-STREAMING PATH (Tool detection only) ───
            const data = await response.json();
            const message = data.message;

            // Check for Tool Calls
            if (message.tool_calls && message.tool_calls.length > 0) {
                logger.info(`📋 [Task ${task.id.slice(0, 8)}] 🛠️ Model requested ${message.tool_calls.length} tool(s)`);

                // Add assistant's message (with tool calls) to history
                messages.push(message);

                // Execute all requested tools
                for (const tool of message.tool_calls) {
                    const funcName = tool.function.name;
                    const funcArgs = tool.function.arguments;

                    logger.info(`📋 [Task ${task.id.slice(0, 8)}] Executing tool: ${funcName}`);

                    // Notify client that we are executing a tool
                    notifySubscribers(task, {
                        type: "chunk",
                        content: `\n\n*> 🛠️ Executing ${funcName}...*\n\n`,
                        index: -1
                    });

                    const result = await executeTool(funcName, funcArgs);

                    // Add tool result to history
                    messages.push({
                        role: "tool",
                        content: JSON.stringify(result),
                    });
                }

                // Loop back → next iteration will use stream: true
                continue;
            }

            // No tool calls in non-stream mode → output the text directly
            const content = message.content;
            logger.info(`📋 [Task ${task.id.slice(0, 8)}] Final response received (non-streamed)`);
            task.fullResponse += content;

            // Send as one chunk (rare path — usually streaming is used)
            const chunk: TaskChunk = { content, index: task.chunks.length };
            task.chunks.push(chunk);
            notifySubscribers(task, { type: "chunk", content, index: chunk.index });

            break;
        }

        if (iteration >= MAX_ITERATIONS) {
            logger.warn(`📋 [Task ${task.id.slice(0, 8)}] Reached max iterations`);
        }

        // ─── Task completed ───
        task.status = "completed";
        task.completedAt = Date.now();

        // Save to database
        if (task.fullResponse) {
            db.addMessage(task.conversationId, "assistant", task.fullResponse);
            const duration = ((task.completedAt - task.createdAt) / 1000).toFixed(1);
            const wordCount = task.fullResponse.split(/\s+/).length;
            logger.info(
                `📋 [Task ${task.id.slice(0, 8)}] ✅ Completed in ${duration}s (${wordCount} words)`
            );
        }

        // Notify subscribers that we're done
        notifySubscribers(task, { type: "done" });
        closeSubscribers(task);

        // Clean up old tasks after 5 minutes
        setTimeout(() => {
            activeTasks.delete(task.id);
            logger.info(`📋 [Task ${task.id.slice(0, 8)}] Cleaned up from memory`);
        }, 5 * 60 * 1000);
    } finally {
        clearInterval(keepAliveInterval);
    }
}

/**
 * Read Ollama's NDJSON streaming response and forward each token to subscribers in real-time.
 * Returns the full concatenated response text.
 */
async function streamFromOllama(response: Response, task: GenerationTask): Promise<string> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let chunkIndex = task.chunks.length;
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete NDJSON lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
            if (!line.trim()) continue;

            try {
                const json = JSON.parse(line);
                const token = json.message?.content;

                if (token) {
                    fullText += token;

                    const chunk: TaskChunk = { content: token, index: chunkIndex++ };
                    task.chunks.push(chunk);

                    notifySubscribers(task, {
                        type: "chunk",
                        content: token,
                        index: chunk.index,
                    });
                }
            } catch {
                // Skip malformed JSON lines
            }
        }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
        try {
            const json = JSON.parse(buffer);
            const token = json.message?.content;
            if (token) {
                fullText += token;
                const chunk: TaskChunk = { content: token, index: chunkIndex++ };
                task.chunks.push(chunk);
                notifySubscribers(task, { type: "chunk", content: token, index: chunk.index });
            }
        } catch { }
    }

    const wordCount = fullText.split(/\s+/).length;
    logger.info(`📋 [Task ${task.id.slice(0, 8)}] 🚀 Streamed ${wordCount} words`);

    return fullText;
}

/**
 * Subscribe to a task's SSE stream.
 * If the task already has partial results, send them immediately (replay).
 */
export function subscribe(
    taskId: string,
    fromChunkIndex = 0
): ReadableStream | null {
    const task = activeTasks.get(taskId);
    if (!task) return null;

    logger.info(
        `📋 [Task ${taskId.slice(0, 8)}] New subscriber (from chunk ${fromChunkIndex})`
    );

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        start(controller) {
            // Replay missed chunks
            const missedChunks = task.chunks.filter((c) => c.index >= fromChunkIndex);
            if (missedChunks.length > 0) {
                logger.info(
                    `📋 [Task ${taskId.slice(0, 8)}] Replaying ${missedChunks.length} missed chunks`
                );
                for (const chunk of missedChunks) {
                    controller.enqueue(
                        encoder.encode(
                            `data: ${JSON.stringify({ type: "chunk", content: chunk.content, index: chunk.index })}\n\n`
                        )
                    );
                }
            }

            // If already completed, send done signal
            if (task.status === "completed") {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
                controller.close();
                return;
            }

            // If errored, send error signal
            if (task.status === "error") {
                controller.enqueue(
                    encoder.encode(
                        `data: ${JSON.stringify({ type: "error", error: task.error })}\n\n`
                    )
                );
                controller.close();
                return;
            }

            // Still running: subscribe for future chunks
            task.subscribers.add(controller);
        },
        cancel() {
            task.subscribers.delete(
                // Need to find the controller - handled by the Set reference
                // This relies on the controller being the same object
                undefined as any
            );
            logger.info(`📋 [Task ${taskId.slice(0, 8)}] Subscriber disconnected`);
        },
    });

    return stream;
}

/**
 * Get the status of a task (or the latest task for a conversation)
 */
export function getTaskStatus(taskId: string): Omit<GenerationTask, "subscribers"> | null {
    const task = activeTasks.get(taskId);
    if (!task) return null;

    const { subscribers, ...rest } = task;
    return rest;
}

/**
 * Find the active (running) task for a conversation, if any
 */
export function getActiveTaskForConversation(conversationId: string): string | null {
    for (const [taskId, task] of activeTasks) {
        if (task.conversationId === conversationId && task.status === "running") {
            return taskId;
        }
    }
    return null;
}

// ─── Internal helpers ─────────────────────────────────

function notifySubscribers(task: GenerationTask, data: unknown) {
    const encoder = new TextEncoder();
    const msg = encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

    for (const controller of task.subscribers) {
        try {
            controller.enqueue(msg);
        } catch {
            task.subscribers.delete(controller);
        }
    }
}

function closeSubscribers(task: GenerationTask) {
    for (const controller of task.subscribers) {
        try {
            controller.close();
        } catch { }
    }
    task.subscribers.clear();
}
