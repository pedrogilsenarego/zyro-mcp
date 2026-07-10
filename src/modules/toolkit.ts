import type { ToolDeps } from "./deps.js";

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown; // structural compat with the SDK's CallToolResult
}

export function text(message: string): ToolResult {
  return { content: [{ type: "text", text: message }] };
}

export function errorText(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export interface AuthedContext {
  token: string;
  userId: string | undefined;
}

// Resolves the caller's token/userId and blocks the handler if unauthenticated.
export function authedHandler<Args>(
  deps: ToolDeps,
  handler: (args: Args, ctx: AuthedContext) => Promise<ToolResult>,
): (args: Args) => Promise<ToolResult> {
  return async (args: Args) => {
    const token = deps.getAccessToken();
    if (!token) return errorText("Not authenticated.");
    return handler(args, { token, userId: deps.getUserId() });
  };
}
