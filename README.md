# Akara AI Agent 🤖

A sophisticated, entirely local AI Web Chatbot powered by **Ollama (Llama 3.1)** and the **Bun** runtime. This project goes beyond a simple chat interface by implementing **Agentic capabilities**—allowing the AI to autonomously search the web for current information and write/execute Python code to verify its own logic.

![Akara AI Interface](https://img.shields.io/badge/UI-TailwindCSS-38B2AC)
![Runtime](https://img.shields.io/badge/Runtime-Bun-black)
![LLM](https://img.shields.io/badge/AI-Llama_3.1-blue)

## ✨ Key Features

- **🌐 Autonomous Web Search:** When asked about current events, the AI automatically searches Bing & Wikipedia, reading the results to provide accurate, up-to-date answers.
- **🐍 Python Code Verification:** When asked to calculate math or write code, the AI writes a Python script, executes it locally in a sandbox, reads the output/errors, and fixes its code before giving the final answer (Self-Healing).
- **⚡ True Token Streaming:** Responses stream to the UI in real-time instantly without waiting for the full generation to finish.
- **🎛️ Granular Tool Controls:** UI toggles to enable/disable Web Search and Code Verification modes on the fly. Turn both off for an ultra-fast offline chat.
- **💾 Persistent Memory:** Chat histories are saved automatically using `bun:sqlite`.
- **📡 Developer Log Viewer:** A dedicated secondary window (`/logs.html`) that uses WebSockets to show you exactly what the Agent is "thinking" and executing in the background.

## 🛠️ Technology Stack

- **Backend:** TypeScript + Bun Native HTTP Server
- **Frontend:** Vanilla JS/HTML + TailwindCSS (via CDN)
- **Database:** SQLite (`bun:sqlite`)
- **AI Engine:** [Ollama](https://ollama.com/) (Local Inference)

## 🚀 Getting Started

### Prerequisites
1. Install [Bun](https://bun.sh/)
2. Install [Ollama](https://ollama.com/) and run `ollama run llama3.1`
3. Install [Python 3](https://www.python.org/) (Ensure it's in your system PATH for the code executor)

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/Akara5729/AI-Agent-LLM-Web-Search.git
   cd AI-Agent-LLM-Web-Search
   ```
2. Start the application:
   ```bash
   # On Windows
   .\start.bat
   
   # Or manually via Bun
   bun run src/server.ts
   ```
3. Open your browser and go to `http://localhost:3000`

## 🧠 How the Agent Works
Unlike standard LLM wrappers, Akara AI parses its own output to detect intent. If tools are requested (and enabled in the UI), it enters an execution loop:
1. **Plan:** AI recognizes a knowledge gap (requires search) or logic task (requires python).
2. **Execute:** The backend pauses the stream, executes the requested tool (e.g., `Bun.spawn` for Python, or web scraping for search).
3. **Verify:** The raw output or error message is fed back to the AI.
4. **Answer:** The AI reads the feedback and then streams the final, verified answer to the user.

---
*Created as part of a PKL (Praktik Kerja Lapangan) Project integrating Agentic AI workflows with Local LLMs.*
