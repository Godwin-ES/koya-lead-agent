import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import { TOOL_DEFINITIONS } from "@core/tools/definitions";
import { buildTools } from "../../../worker/src/runners/agent-sdk";

// Neither package is a root dependency - resolve the worker's Agent SDK and the MCP client it uses.
const sdkRequire = createRequire(path.resolve(__dirname, "../../../worker/package.json"));
const mcpRoot = path.dirname(createRequire(sdkRequire.resolve("@anthropic-ai/claude-agent-sdk")).resolve("@modelcontextprotocol/sdk/client/index.js"));

// A live Sonnet 5 run found this: one tool schema the SDK can't convert
// (a z.record field) makes the server's tools/list fail, the server still
// reports "connected", and the model gets none of our tools.
describe("the Agent SDK tool server", () => {
  it("lists every tool definition", async () => {
    const { createSdkMcpServer } = await import(sdkRequire.resolve("@anthropic-ai/claude-agent-sdk"));
    const { Client } = await import(path.join(mcpRoot, "index.js"));
    const { InMemoryTransport } = await import(path.join(mcpRoot, "../inMemory.js"));
    const tools = buildTools({ current: {} as never }, {} as never, {} as never);
    const server = createSdkMcpServer({ name: "lead-agent", version: "1.0.0", tools, alwaysLoad: true }) as unknown as {
      instance: { connect(t: unknown): Promise<void> };
    };
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await server.instance.connect(serverSide);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientSide);

    const listed = await client.listTools();
    expect(listed.tools.map((t: { name: string }) => t.name).sort()).toEqual(TOOL_DEFINITIONS.map((d) => d.name).sort());
  });
});
