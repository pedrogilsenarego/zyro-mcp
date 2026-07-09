/**
 * zyro-mcp — POC.
 *
 * A local (stdio) MCP server that lets Claude create a listing in imocerto.
 * No OAuth, no hosting: it uses an access token from the env and forwards the
 * call to the existing backend. Identity comes from that token — never a
 * tool argument. Swap in real OAuth later (see the plan doc).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE_URL = (
  process.env.IMOCERTO_API_BASE_URL || "http://localhost:3000/api"
).replace(/\/+$/, "");
const ACCESS_TOKEN = process.env.IMOCERTO_ACCESS_TOKEN || "";

const server = new McpServer({ name: "zyro-mcp", version: "0.0.1" });

server.tool(
  "create_listing",
  "Create a real-estate listing in imocerto as the authenticated user.",
  {
    title: z.string().min(1),
    rentPrice: z.number().positive().describe("Monthly rent / price in EUR."),
    propertyType: z.string().describe("e.g. 'apartment', 'house', 'room'."),
    businessType: z.string().describe("e.g. 'roomRent' or 'buy'."),
    listingType: z.enum(["supply", "demand"]).optional(),
  },
  async (args) => {
    if (!ACCESS_TOKEN) {
      return errorResult("IMOCERTO_ACCESS_TOKEN is not set.");
    }

    const form = new FormData();
    for (const [key, value] of Object.entries(args)) {
      if (value !== undefined) form.append(key, String(value));
    }

    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}/listing/add`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
        body: form,
      });
    } catch (err) {
      return errorResult(
        `Could not reach backend: ${err instanceof Error ? err.message : err}`,
      );
    }

    const body = await res.text();
    if (!res.ok) {
      return errorResult(`Backend returned ${res.status}: ${body}`);
    }
    return { content: [{ type: "text", text: `Listing created.\n${body}` }] };
  },
);

function errorResult(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

await server.connect(new StdioServerTransport());
