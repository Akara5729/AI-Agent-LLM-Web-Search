import * as logger from "./logger";
import { searchWeb, formatResultsAsContext } from "./websearch";
import { executePythonCode } from "./python_executor";

export const availableTools = [
    {
        type: "function",
        function: {
            name: "web_search",
            description: "Search the internet for current information, news, or specific facts.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "The search query (e.g., 'current president of Indonesia', 'latest AI news').",
                    },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "execute_python",
            description: "Execute Python code to perform calculations, data analysis, or verify programming logic. Use this to run code and see the output.",
            parameters: {
                type: "object",
                properties: {
                    code: {
                        type: "string",
                        description: "The valid Python code to execute.",
                    },
                },
                required: ["code"],
            },
        },
    },
];

export async function executeTool(toolName: string, args: any): Promise<string> {
    try {
        if (toolName === "web_search") {
            const results = await searchWeb(args.query);
            return formatResultsAsContext(results);
        }

        if (toolName === "execute_python") {
            return await executePythonCode(args.code);
        }

        return `Error: Unknown tool '${toolName}'`;
    } catch (error: any) {
        logger.error(`Tool execution error (${toolName}): ${error.message}`);
        return `Error executing ${toolName}: ${error.message}`;
    }
}
