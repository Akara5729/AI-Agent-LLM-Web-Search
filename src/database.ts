import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { join } from "path";

// Ensure data directory exists
const DATA_DIR = join(import.meta.dir, "..", "data");
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, "chatbot.db"), { create: true });

// Enable WAL mode for better concurrent performance
db.exec("PRAGMA journal_mode = WAL;");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New Chat',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );
`);

// Prepared statements for performance
const stmts = {
  createConversation: db.prepare(
    "INSERT INTO conversations (id, title) VALUES (?, ?)"
  ),
  getConversations: db.prepare(
    "SELECT * FROM conversations ORDER BY updated_at DESC"
  ),
  getConversation: db.prepare("SELECT * FROM conversations WHERE id = ?"),
  updateConversationTitle: db.prepare(
    "UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?"
  ),
  touchConversation: db.prepare(
    "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?"
  ),
  deleteConversation: db.prepare("DELETE FROM conversations WHERE id = ?"),
  addMessage: db.prepare(
    "INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)"
  ),
  getMessages: db.prepare(
    "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
  ),
  deleteMessages: db.prepare(
    "DELETE FROM messages WHERE conversation_id = ?"
  ),
};

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export function createConversation(
  id: string,
  title: string = "New Chat"
): Conversation {
  stmts.createConversation.run(id, title);
  return stmts.getConversation.get(id) as Conversation;
}

export function getConversations(): Conversation[] {
  return stmts.getConversations.all() as Conversation[];
}

export function getConversation(id: string): Conversation | null {
  return (stmts.getConversation.get(id) as Conversation) || null;
}

export function updateConversationTitle(id: string, title: string): void {
  stmts.updateConversationTitle.run(title, id);
}

export function touchConversation(id: string): void {
  stmts.touchConversation.run(id);
}

export function deleteConversation(id: string): void {
  stmts.deleteMessages.run(id);
  stmts.deleteConversation.run(id);
}

export function addMessage(
  conversationId: string,
  role: string,
  content: string
): Message {
  stmts.addMessage.run(conversationId, role, content);
  const messages = stmts.getMessages.all(conversationId) as Message[];
  return messages[messages.length - 1];
}

export function getMessages(conversationId: string): Message[] {
  return stmts.getMessages.all(conversationId) as Message[];
}
