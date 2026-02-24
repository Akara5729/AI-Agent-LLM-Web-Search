// ─── State ──────────────────────────────────────────
let currentConversationId = null;
let isStreaming = false;
let currentTaskId = null;
let currentAbortController = null; // AbortController to cancel active streams

// ─── DOM Elements ───────────────────────────────────
const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");
const messagesContainer = document.getElementById("messages-container");
const messagesDiv = document.getElementById("messages");
const welcomeMessage = document.getElementById("welcome-message");
const chatTitle = document.getElementById("chat-title");
const btnNewChat = document.getElementById("btn-new-chat");
const conversationsList = document.getElementById("conversations-list");
const btnSend = document.getElementById("btn-send");

// ─── Configure Marked.js ────────────────────────────
marked.setOptions({
    breaks: true,
    gfm: true,
    highlight: function (code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
    },
});

// Custom renderer for code blocks with copy button
const renderer = new marked.Renderer();
renderer.code = function (code, language) {
    let codeText, lang;
    if (typeof code === 'object') {
        codeText = code.text || '';
        lang = code.lang || '';
    } else {
        codeText = code;
        lang = language || '';
    }

    const highlighted = lang && hljs.getLanguage(lang)
        ? hljs.highlight(codeText, { language: lang }).value
        : hljs.highlightAuto(codeText).value;

    return `<div class="code-block-wrapper">
    <div class="code-block-header">
      <span>${lang || "code"}</span>
      <button class="btn-copy" onclick="copyCode(this)">
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
        Copy
      </button>
    </div>
    <pre><code class="hljs">${highlighted}</code></pre>
  </div>`;
};
marked.setOptions({ renderer });

// ─── Copy Code ──────────────────────────────────────
window.copyCode = function (btn) {
    const wrapper = btn.closest(".code-block-wrapper");
    const code = wrapper.querySelector("code").innerText;
    navigator.clipboard.writeText(code).then(() => {
        btn.classList.add("copied");
        btn.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Copied!`;
        setTimeout(() => {
            btn.classList.remove("copied");
            btn.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg> Copy`;
        }, 2000);
    });
};

// ─── Textarea Auto-Resize ───────────────────────────
messageInput.addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, 160) + "px";
});

messageInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        chatForm.dispatchEvent(new Event("submit"));
    }
});

// ─── Cancel Active Stream ───────────────────────────
function cancelActiveStream() {
    if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
    }
    isStreaming = false;
    btnSend.disabled = false;
    currentTaskId = null;
}

// ─── Chat Form Submit ───────────────────────────────
chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = messageInput.value.trim();
    if (!message || isStreaming) return;

    // Create new conversation if needed
    if (!currentConversationId) {
        await createNewConversation();
    }

    // Hide welcome message
    if (welcomeMessage) welcomeMessage.remove();

    // Add user message to UI
    appendMessage("user", message);
    messageInput.value = "";
    messageInput.style.height = "auto";

    // Stream AI response via background task
    await streamResponse(message);
});

// ─── Create New Conversation ────────────────────────
btnNewChat.addEventListener("click", () => {
    cancelActiveStream(); // Stop any active stream
    createNewConversation();
});

async function createNewConversation() {
    const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Chat" }),
    });
    const conv = await res.json();
    currentConversationId = conv.id;
    chatTitle.textContent = "New Chat";

    // Clear messages
    messagesDiv.innerHTML = "";
    loadConversations();
}

// ─── Load Conversations ─────────────────────────────
async function loadConversations() {
    const res = await fetch("/api/conversations");
    const conversations = await res.json();

    conversationsList.innerHTML = "";
    conversations.forEach((conv) => {
        const div = document.createElement("div");
        div.className = `conv-item ${conv.id === currentConversationId ? "active" : ""}`;
        div.innerHTML = `
      <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
      <span class="conv-title">${escapeHtml(conv.title)}</span>
      <button class="btn-delete" onclick="event.stopPropagation(); deleteConversation('${conv.id}')">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
      </button>
    `;
        div.addEventListener("click", () => switchConversation(conv.id, conv.title));
        conversationsList.appendChild(div);
    });
}

// ─── Switch Conversation ────────────────────────────
async function switchConversation(id, title) {
    // Cancel any active stream before switching
    cancelActiveStream();

    currentConversationId = id;
    chatTitle.textContent = title;

    // Load messages from DB
    const res = await fetch(`/api/conversations/${id}`);
    const data = await res.json();

    messagesDiv.innerHTML = "";
    if (data.messages && data.messages.length > 0) {
        data.messages.forEach((msg) => {
            appendMessage(msg.role, msg.content, false);
        });
    }
    scrollToBottom();
    loadConversations();

    // Check if there's an active background task for this conversation
    try {
        const activeRes = await fetch(`/api/chat/active/${id}`);
        const activeData = await activeRes.json();
        if (activeData.taskId) {
            console.log(`Reconnecting to active task: ${activeData.taskId}`);
            currentTaskId = activeData.taskId;
            reconnectToTask(activeData.taskId);
        }
    } catch { }
}

// ─── Delete Conversation ────────────────────────────
window.deleteConversation = async function (id) {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (currentConversationId === id) {
        cancelActiveStream();
        currentConversationId = null;
        chatTitle.textContent = "New Chat";
        messagesDiv.innerHTML = `
      <div id="welcome-message" class="flex flex-col items-center justify-center h-full min-h-[50vh] text-center">
        <div class="w-20 h-20 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-indigo-500/30">
          <svg class="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        </div>
        <h2 class="text-3xl font-bold text-dark-100 mb-2">Akara AI</h2>
        <p class="text-dark-300 max-w-md">Asisten AI serbaguna — tanya apa saja!</p>
      </div>
    `;
    }
    loadConversations();
};

// ─── Stream Response (Task-Based) ───────────────────
async function streamResponse(message) {
    isStreaming = true;
    btnSend.disabled = true;

    // Add assistant bubble with typing indicator
    const msgDiv = appendMessage("assistant", "", true);
    const contentDiv = msgDiv.querySelector(".msg-content");
    contentDiv.innerHTML =
        '<div class="typing-indicator"><span></span><span></span><span></span></div>';

    try {
        // Step 1: Send message → get taskId (task runs in background on server)
        const useSearch = document.getElementById("search-toggle").checked;
        const useCode = document.getElementById("code-toggle").checked;
        const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                conversation_id: currentConversationId,
                message: message,
                useSearch: useSearch,
                useCode: useCode
            }),
        });

        if (!res.ok) {
            throw new Error(`Server error: ${res.status}`);
        }

        const { taskId } = await res.json();
        currentTaskId = taskId;

        // Step 2: Subscribe to the task's SSE stream
        await consumeTaskStream(taskId, contentDiv, message);

    } catch (err) {
        if (err.name !== "AbortError") {
            contentDiv.innerHTML = `<span class="text-red-400">⚠️ Error: ${escapeHtml(err.message)}</span>`;
        }
    }

    isStreaming = false;
    btnSend.disabled = false;
    currentTaskId = null;
    scrollToBottom();
}

// ─── Consume Task SSE Stream ────────────────────────
async function consumeTaskStream(taskId, contentDiv, originalMessage, fromChunk = 0) {
    // Create AbortController for this stream
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    const streamUrl = `/api/chat/stream/${taskId}?from=${fromChunk}`;
    const res = await fetch(streamUrl, { signal });

    if (!res.ok) {
        throw new Error(`Stream error: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = contentDiv.dataset.fullText || "";

    try {
        while (true) {
            // Check if aborted
            if (signal.aborted) {
                reader.cancel();
                return;
            }

            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");

            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const data = line.slice(6).trim();
                    try {
                        const json = JSON.parse(data);

                        if (json.type === "chunk" && json.content) {
                            fullText += json.content;
                            contentDiv.dataset.fullText = fullText;
                            contentDiv.innerHTML = marked.parse(fullText);
                            scrollToBottom();
                        }

                        if (json.type === "done") {
                            if (fullText) {
                                contentDiv.innerHTML = marked.parse(fullText);
                            }
                            tryAutoTitle(originalMessage);
                            return;
                        }

                        if (json.type === "error") {
                            contentDiv.innerHTML = `
                                <div style="background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.4); border-radius: 12px; padding: 16px; margin: 8px 0;">
                                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                        <span style="font-size: 1.2em;">⚠️</span>
                                        <strong style="color: #f87171;">Error</strong>
                                    </div>
                                    <p style="color: #fca5a5; margin: 0; font-size: 0.9em;">${escapeHtml(json.error)}</p>
                                </div>`;
                            return;
                        }
                    } catch { }
                }
            }
        }
    } catch (err) {
        if (err.name === "AbortError") return; // Clean cancellation
        throw err;
    }

    // Stream ended without explicit done
    if (fullText) {
        contentDiv.innerHTML = marked.parse(fullText);
    }
}

// ─── Reconnect to Active Background Task ────────────
async function reconnectToTask(taskId) {
    isStreaming = true;
    btnSend.disabled = true;

    const msgDiv = appendMessage("assistant", "", true);
    const contentDiv = msgDiv.querySelector(".msg-content");
    contentDiv.innerHTML =
        '<div class="typing-indicator"><span></span><span></span><span></span></div>';

    try {
        await consumeTaskStream(taskId, contentDiv, "", 0);
    } catch (err) {
        if (err.name !== "AbortError") {
            contentDiv.innerHTML = `<span class="text-red-400">⚠️ Reconnection error: ${escapeHtml(err.message)}</span>`;
        }
    }

    isStreaming = false;
    btnSend.disabled = false;
    currentTaskId = null;
    scrollToBottom();
}

// ─── Auto Title Helper ──────────────────────────────
function tryAutoTitle(message) {
    if (!message) return;
    const convItems = conversationsList.querySelectorAll(".conv-item");
    const activeItem = [...convItems].find((item) =>
        item.classList.contains("active")
    );
    if (activeItem) {
        const title = activeItem.querySelector(".conv-title").textContent;
        if (title === "New Chat") {
            generateAutoTitle(message);
        }
    }
}

// ─── Auto Title ─────────────────────────────────────
async function generateAutoTitle(message) {
    try {
        const res = await fetch("/api/chat/title", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                conversation_id: currentConversationId,
                message: message,
            }),
        });
        const data = await res.json();
        if (data.title) {
            chatTitle.textContent = data.title;
            loadConversations();
        }
    } catch { }
}

// ─── Append Message ─────────────────────────────────
function appendMessage(role, content, animate = true) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `flex ${role === "user" ? "justify-end" : "justify-start"} ${animate ? "fade-in" : ""}`;

    const isUser = role === "user";
    const bubbleClass = isUser ? "msg-user" : "msg-assistant";
    const maxW = isUser ? "max-w-[75%]" : "max-w-[85%]";

    const avatar = isUser
        ? `<div class="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shrink-0 text-white text-sm font-bold">U</div>`
        : `<div class="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0 text-white text-sm font-bold">AI</div>`;

    const renderedContent =
        role === "user" ? escapeHtml(content) : content ? marked.parse(content) : "";

    msgDiv.innerHTML = `
    <div class="flex gap-3 ${maxW} ${isUser ? "flex-row-reverse" : ""}">
      ${avatar}
      <div class="${bubbleClass} px-4 py-3 shadow-md">
        <div class="msg-content">${renderedContent}</div>
      </div>
    </div>
  `;

    messagesDiv.appendChild(msgDiv);
    scrollToBottom();
    return msgDiv;
}

// ─── Utilities ──────────────────────────────────────
function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

// ─── Init ───────────────────────────────────────────
loadConversations();
