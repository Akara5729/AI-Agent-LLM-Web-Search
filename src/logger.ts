import type { ServerWebSocket } from "bun";

export type LogLevel = "INFO" | "WARN" | "ERROR";

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
}

// Connected WebSocket clients for log broadcasting
const logClients = new Set<ServerWebSocket<unknown>>();

export function addLogClient(ws: ServerWebSocket<unknown>) {
    logClients.add(ws);
}

export function removeLogClient(ws: ServerWebSocket<unknown>) {
    logClients.delete(ws);
}

function broadcast(entry: LogEntry) {
    const json = JSON.stringify(entry);
    for (const client of logClients) {
        try {
            client.send(json);
        } catch {
            logClients.delete(client);
        }
    }
}

// Color codes for terminal output
const colors: Record<LogLevel, string> = {
    INFO: "\x1b[36m",   // Cyan
    WARN: "\x1b[33m",   // Yellow
    ERROR: "\x1b[31m",  // Red
};
const reset = "\x1b[0m";

function createEntry(level: LogLevel, message: string): LogEntry {
    return {
        timestamp: new Date().toISOString(),
        level,
        message,
    };
}

export function log(level: LogLevel, message: string) {
    const entry = createEntry(level, message);
    // Print to terminal
    const color = colors[level];
    console.log(
        `${color}[${entry.timestamp}] [${level}]${reset} ${message}`
    );
    // Broadcast to WebSocket clients
    broadcast(entry);
}

export function info(message: string) {
    log("INFO", message);
}

export function warn(message: string) {
    log("WARN", message);
}

export function error(message: string) {
    log("ERROR", message);
}
