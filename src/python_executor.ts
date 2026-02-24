import { spawn } from "bun";
import * as logger from "./logger";

const PYTHON_TIMEOUT_MS = 10000; // 10 seconds max execution time

export async function executePythonCode(code: string): Promise<string> {
    logger.info(`🐍 Executing Python code (${code.length} chars)...`);

    try {
        // Create a temporary file
        const tempFile = `temp_${crypto.randomUUID()}.py`;
        await Bun.write(tempFile, code);

        // Spawn Python process
        const proc = spawn(["python", tempFile], {
            stdout: "pipe",
            stderr: "pipe",
        });

        // Timeout promise
        const timeout = new Promise<string>((_, reject) =>
            setTimeout(() => {
                proc.kill();
                reject(new Error("⏱️ Execution timed out (max 10s)"));
            }, PYTHON_TIMEOUT_MS)
        );

        // Execution promise
        const execution = new Promise<string>(async (resolve) => {
            const stdout = await new Response(proc.stdout).text();
            const stderr = await new Response(proc.stderr).text();

            // Clean up temp file
            try { await fs.unlink(tempFile); } catch { }

            if (stderr.trim()) {
                resolve(`❌ Error:\n${stderr.trim()}`);
            } else {
                resolve(stdout.trim() || "✅ Code executed successfully (no output)");
            }
        });

        // Race timeout vs execution
        const result = await Promise.race([execution, timeout]);

        // Cleanup temp file if still exists (in case of race condition)
        if (await Bun.file(tempFile).exists()) {
            await fs.unlink(tempFile);
        }

        return result;

    } catch (error: any) {
        return `❌ System Error: ${error.message}`;
    }
}

// Helper to access fs module for unlink since Bun.write is used but we need unlink
import * as fs from "node:fs/promises";
