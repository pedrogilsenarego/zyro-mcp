import type { ToolDeps } from "./deps.js";

/** MCP tool return shape (text content, optional error flag). */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  // Structural compatibility with the SDK's CallToolResult (index signature).
  [key: string]: unknown;
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

/**
 * Wraps a tool handler with the auth guard every tool shares: resolves the
 * caller's token/userId from deps and short-circuits with "Not authenticated."
 * when the token is absent. The wrapped handler runs only with a valid context.
 */
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
