# Task 1: Provider Findings

Confirmed API shapes for the Claude Agent SDK, plus the status of the three
credential-gated checks (Gemini, Apify, Crawl4AI). This file is the source of
truth for Tasks 10, 11, 14, 15 — where this differs from what the plan
assumed, the plan is wrong and this file wins.

Sources read: https://code.claude.com/docs/en/agent-sdk/overview,
/quickstart, /custom-tools, /skills, /cost-tracking, /permissions,
/hooks, /user-input.

---

## Step 1: Claude Agent SDK surface

### 1. Package and entry signature

- Package: `@anthropic-ai/claude-agent-sdk` (TypeScript).
- Entry point: `query({ prompt, options })`, returns an async iterator of
  messages. `prompt` can be a string (single-shot) or an async generator
  (streaming input mode, needed for multi-turn / mid-session control).
- Auth: `ANTHROPIC_API_KEY` env var, read by the process that runs the
  agent. **The SDK does not load `.env` files itself** — the worker must
  call `dotenv.config()` (or equivalent) before importing the SDK.

### 2. Custom tools: `createSdkMcpServer` + `tool()`

Confirmed exactly as the plan's Task 15 sketch assumed:

```ts
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";

const myTool = tool(name, description, zodShapeObject, async (args) => ({
  content: [{ type: "text", text: "..." }],
  structuredContent: { ... },   // optional, machine-readable
  isError: false,               // optional
}));

const server = createSdkMcpServer({ name: "lead-agent", version: "1.0.0", tools: [myTool] });
// registered via options.mcpServers: { "lead-agent": server }
```

**Correction to Task 15's pseudocode:** `tool()` takes a **plain Zod shape
object** (`{ latitude: z.number() }`), not `z.object({...})` — same as our
existing schemas.

**Fully-qualified tool name:** each tool becomes
`mcp__{server_name}__{tool_name}` in `allowedTools`. Our server key is
`lead-agent`, so `allowedTools` must list `mcp__lead-agent__save_icp`, etc.,
or the wildcard `mcp__lead-agent__*`.

**Tool search is on by default** and defers our MCP tools (name only in the
initial prompt, full schema loaded on demand). This is a minor cost win we
didn't plan for. To keep a tool always fully loaded (rarely needed for us),
pass `alwaysLoad: true` in the fifth `tool()` argument.

**Error handling:** a handler throw does **not** end the query. The SDK
catches it, converts it to an error result, and Claude sees the message and
continues. This means our `gate()` denial can simply `throw` or return
`isError: true` — either reaches the agent. We'll use `isError: true` with a
composed message, per the docs' recommendation, so the denial reason is
worded for the agent rather than a raw stack trace.

### 3. Skills: `settingSources` + `skills` option — CORRECTION

- Skills are discovered from `.claude/skills/<name>/SKILL.md` under `cwd`
  and every parent directory up to the repo root, gated by
  `settingSources` including `'project'`.
- **Correction to Task 15's assumption:** we do **not** need to add
  `"Skill"` to `allowedTools` manually. Setting the `skills` option (e.g.
  `skills: "all"` or an explicit array of our 5 skill names) makes the SDK
  add the Skill tool to `allowedTools` automatically.
- Confirm skills loaded by reading the `system` message with
  `subtype: "init"` — its `skills` array lists discovered user-invocable
  skills. We should assert this array contains all 5 of ours in the
  Task 15 parity test, as a load-time sanity check.
- `cwd` must point at or below the directory holding `.claude/skills/`. Our
  worker's `cwd` is `worker/`, which holds `.claude/skills/` directly — no
  issue.

### 4. Permission callback and enforcement — MAJOR CORRECTION

This is the most important finding in this document and changes how Task 12
and Task 15 must enforce the gate.

**`canUseTool` does NOT fire for every tool call.** The permission
evaluation order is: **hooks → deny rules → ask rules → permission mode →
allow rules → `canUseTool`**. Critically:

> "Auto-approved tools never reach `canUseTool`. A tool call approved at any
> earlier step — an allow rule or a mode like `acceptEdits` /
> `bypassPermissions` — skips your `canUseTool` callback."

Our own tools **must** be listed in `allowedTools` (`mcp__lead-agent__*`) so
they run without an interactive permission prompt in a headless worker.
**That listing is itself an allow rule, so every call to our own tools is
resolved at the "allow rules" step and `canUseTool` is never invoked for
them.** A `canUseTool` callback written as our primary budget gate (as
Task 15's original sketch did) would silently never run.

The docs say so directly: *"For checks that must run on every tool call, use
a `PreToolUse` hook: hooks run before every other step, and a hook deny
applies even in `bypassPermissions` mode."*

**Resolution — no change needed to the design's actual enforcement
guarantee, a change to which mechanism carries it:**

- Our design (`SYSTEM-DESIGN-NEXTJS.md` §8) already states the gate is
  called **twice** — once at the permission layer, once inside the tool
  handler — and that *"the handler is the boundary"* even if the permission
  layer's shape changes. That principle holds exactly as written. Only the
  permission-layer half changes mechanism:
  - Register a **`PreToolUse` hook** (matcher: our tool names) that calls
    `gate()` and returns `{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason } }`
    on deny, nothing (continue) on allow. This is the layer that gives a
    clean denial *before* the handler runs, for cheap calls we want to stop
    early (e.g. a scrape budget already exhausted).
  - The **handler itself still calls `gate()` again** and returns
    `isError: true` with the same reason if reached. This is what actually
    holds if the hook registration is ever misconfigured, mismatched by
    matcher, or bypassed by a future SDK version's evaluation order.
  - **`canUseTool` is not used for our own tools.** We still pass one, but
    scoped to its real job per the docs: the `AskUserQuestion` flow for
    `request_clarification`'s human-input round trip (§6 of the design),
    which is exactly the case the docs describe `canUseTool` for. Our own
    MCP tools stay off `canUseTool`'s path entirely because they're
    allow-listed.
- **Action for Task 12:** `gate.ts` is called from three places, not two —
  a `PreToolUse` hook, the tool handler, and (only for
  `request_clarification`) `canUseTool`. Add a hook test alongside the
  existing handler tests: "the PreToolUse hook denies a call the handler
  would also deny, without the handler running."
- **Action for Task 15:** replace the `canUseTool`-as-primary-gate sketch
  with a `hooks: { PreToolUse: [{ matcher: "mcp__lead-agent__.*", hooks: [gateHook] }] }`
  registration, and keep a minimal `canUseTool` for `AskUserQuestion` only.

### 5. Hooks — full picture

`PreToolUse` hook signature (TypeScript):

```ts
const gateHook: HookCallback = async (input, toolUseId, { signal }) => {
  const preInput = input as PreToolUseHookInput; // .tool_name, .tool_input
  const decision = gate(currentRun, preInput.tool_name, preInput.tool_input);
  if (decision.kind === "deny") {
    return { hookSpecificOutput: {
      hookEventName: preInput.hook_event_name,
      permissionDecision: "deny",
      permissionDecisionReason: decision.agentMessage,
    }};
  }
  return { continue: true };
};
```

Other relevant hook events exist (`PostToolUse`, `PostToolUseFailure`,
`UserPromptSubmit`) but only `PreToolUse` is needed for our gate.
`PostToolUse` is a candidate for writing the `tool_calls` completion row
instead of doing it inline in the handler — worth considering in Task 12,
not required.

### 6. `maxTurns` behavior

Confirmed: hitting the turn limit ends the query with an **error result**
(not `success`), same contract as any other failure. Task 14/15's "stops at
the turn limit and finalizes with what it has" test must therefore catch
the error result and explicitly call `finalize_run` afterward — the SDK
does not auto-finalize anything for us. This matches the design's `partial`
status path, but the *trigger* is our own error handling around the
`query()` loop, not an SDK-provided graceful stop.

### 7. Cost and usage fields — CORRECTION (estimate, not billing)

- **`total_cost_usd` and `modelUsage`/`costUSD` are client-side estimates**,
  computed locally from a bundled price table. The docs explicitly warn:
  *"Do not bill end users or trigger financial decisions from these
  fields... for authoritative billing, use the Usage and Cost API."*
- **Action:** `cost_ledger.estimated_cost_usd` for Anthropic rows is
  correctly named (already "estimated" in our schema) — no schema change
  needed, but `BUILD-NOTES` must record this caveat once, and the live
  acceptance pass (Task 23) should cross-check one run's `total_cost_usd`
  against the Console's actual usage page, not just log the SDK number
  as ground truth.
- Read cost from the final `result` message: `message.total_cost_usd`
  (whole-call cumulative) and `message.modelUsage` (per-model breakdown:
  `costUSD`, `inputTokens`, `outputTokens`, `cacheReadInputTokens`,
  `cacheCreationInputTokens`, `costBasis`).
- Per-step `usage.output_tokens` on assistant messages is a **placeholder**
  — always read output tokens from the final `result` message, never
  accumulate them per-step.
- Deduplicate per-step input tokens by `message.message.id` — parallel tool
  calls in one turn share an id and would otherwise double-count.

### 8. Writable working directory

- `cwd` is used for: file-based built-in tools (unused by us — Read/Write/
  Edit/Bash are all disallowed per our design), and skill discovery.
- We do not grant any tool that writes to disk, so the worker's `cwd` only
  needs to be **readable** (to find `.claude/skills/`), not writable. No
  change to the Dockerfile's filesystem permissions needed beyond that.

### 9. Model selection and CLI binary

- Model is set via `options.model` (a plain string, e.g.
  `"claude-haiku-4-5"`).
- **Both the npm and pip packages bundle a native Claude Code binary** via
  npm optional dependencies — no separate Claude Code install needed in the
  worker image, **provided the Docker build does not run `npm ci --omit=optional`
  or set `npm config set omit optional`.** This is a real risk for a
  production Dockerfile that often strips dev/optional deps to shrink the
  image.
  - **Action for Task 16:** the worker's `Dockerfile` must install with
    default (non-omitted) optional dependencies, and a build-verification
    step (`node -e "require('@anthropic-ai/claude-agent-sdk')"` plus one
    real `query()` call against a trivial prompt) must run in CI/the image
    build to catch a missing binary before deploy, not after.

---

## Step 2: Gemini model id — BLOCKED, needs `GOOGLE_AI_API_KEY`

No Google AI Studio / Gemini API key is present in this environment
(checked `env | grep -i GOOGLE`, nothing set). The plan's model-listing
command cannot run:

```bash
node -e "const {GoogleGenAI}=require('@google/genai');new GoogleGenAI({apiKey:process.env.GOOGLE_AI_API_KEY}).models.list().then(r=>console.log(JSON.stringify(r,null,2)))"
```

**What I need from you:** a `GOOGLE_AI_API_KEY` (free tier is fine for
this), either exported in the shell I'm working in or dropped into
`app/.env.local` (git-ignored). Once present I'll run the listing command
myself and pin the exact Flash model id here — no placeholder id is
recorded in the meantime, per the plan's explicit instruction not to
hardcode a remembered name.

**Not currently blocking:** the Gemini runner is Task 14, several tasks
away. This only needs to be resolved before Task 14 starts.

---

## Step 3: Apify actor and pricing — BLOCKED, needs your action in the console

This step needs three things only you can do, and it **spends real shared
cohort money**, so I will not attempt it even if I somehow had a token:

1. Accept the Apify team account invite (per the PRD).
2. In the Apify Console, switch the active account to the team account
   (top-left account switcher) — a run started from a personal account is
   not covered by the $5/person budget.
3. Provide the team account's API token (`APIFY_TOKEN`), plus your choice
   of company-search actor if you already have one in mind, or tell me to
   propose candidates for you to review pricing on in the console yourself.

**What I need from you:** confirm the invite is accepted and the team
account is active, then either (a) paste the `APIFY_TOKEN` into
`app/.env.local` and tell me which actor to use, or (b) tell me to shortlist
2-3 pay-per-result company-search actors by name for you to check pricing
on in the console, and you'll pick one and hand me the token.

**Not currently blocking:** Apify discovery is Task 10. This needs to be
resolved before Task 10 starts, and the plan explicitly forbids any live
Apify run — even the 2-result pricing-proof run — happening before this
step is done deliberately and observed in the console, never automated
blind.

---

## Step 4: Crawl4AI container — IN PROGRESS

```bash
docker pull unclecode/crawl4ai:latest
docker run -d -p 11235:11235 --name crawl4ai-dev unclecode/crawl4ai:latest
curl -s http://localhost:11235/health
```

Docker and network access are both available in this environment. The image
pull was started and is running in the background (large image). Findings
will be appended to this section once the pull completes and the container
responds to a health check — health path, scrape endpoint path, request
body shape, and the response field holding markdown, exactly as the plan
requires. No application code depends on this until Task 11.

---

## Summary of corrections to the implementation plan

| # | Where | Correction |
|---|---|---|
| 1 | Task 15 | `canUseTool` is not called for our own allow-listed MCP tools. Primary enforcement moves to a `PreToolUse` hook; `canUseTool` is scoped to `AskUserQuestion` only (the clarification flow). |
| 2 | Task 12 | `gate()` is invoked from three call sites (hook, handler, `canUseTool` for clarification), not two. Add a hook-level denial test. |
| 3 | Task 15 | Don't add `"Skill"` to `allowedTools` manually — setting `skills` does it automatically. |
| 4 | Task 15 | `tool()`'s third argument is a plain Zod shape object, not `z.object(...)`. |
| 5 | Task 12 | Tool names in `allowedTools` must be fully qualified: `mcp__lead-agent__<tool_name>`. |
| 6 | Task 5 / cost ledger | `total_cost_usd` / `modelUsage` are client-side estimates, not billing truth. Cross-check against the Console's Usage page during the Task 23 live pass; don't treat the SDK number as authoritative in `BUILD-NOTES`. |
| 7 | Task 15 | Read output tokens only from the final `result` message; per-step `output_tokens` is a placeholder. Dedupe input tokens by assistant message id. |
| 8 | Task 15 | On hitting `maxTurns`, the SDK ends the query with an error result — the worker's own catch block must call `finalize_run` to reach `partial`, the SDK does not do this automatically. |
| 9 | Task 16 (Dockerfile) | Must not strip optional npm dependencies, or the bundled Claude Code binary is missing. Add a build-time smoke check that imports the SDK and runs one trivial `query()`. |
| 10 | Task 1, Steps 2-3 | Both credential-gated and require the user's direct action before Tasks 10 and 14 can start. Not blocking Tasks 2-9. |
