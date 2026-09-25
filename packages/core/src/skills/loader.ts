import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The five skills, one per asset guide. Order matters for
 * `buildSystemPrompt`'s Gemini concatenation - the Agent SDK doesn't care
 * (it discovers skills by name, not position), but a stable order makes
 * the built prompt reproducible for tests and fixtures.
 */
export const SKILL_NAMES = [
  "icp-refinement",
  "lead-qualification",
  "lead-list-quality",
  "outbound-copywriting",
  "outreach-safety",
] as const;

export type SkillName = (typeof SKILL_NAMES)[number];

export interface SkillFrontmatter {
  name: string;
  description: string;
}

export interface Skill {
  frontmatter: SkillFrontmatter;
  body: string;
  raw: string;
}

/**
 * Same workspace-root-walk fix as providers/replay/fixtures.ts (Task 9's
 * finding): resolve from this module's own location, not
 * `process.cwd()`, which differs between the test runner and the real
 * worker process.
 */
function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = findWorkspaceRoot(moduleDir);

function skillsRoot(): string {
  return path.join(workspaceRoot, "worker/.claude/skills");
}

function parseFrontmatter(raw: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error("skill file is missing YAML frontmatter (expected a leading --- block with name/description)");
  }
  const [, frontmatterBlock = "", body = ""] = match;
  const name = frontmatterBlock.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const description = frontmatterBlock.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
  return { frontmatter: { name, description }, body: body.trim() };
}

export function loadSkill(name: SkillName): Skill {
  const filePath = path.join(skillsRoot(), name, "SKILL.md");
  const raw = readFileSync(filePath, "utf-8");
  return { ...parseFrontmatter(raw), raw };
}

/** Extracts the key set of the skill body's first fenced ```json block, for contract-testing against a Zod schema's own key set. */
export function jsonKeysIn(skill: Skill): string[] {
  const match = skill.body.match(/```json\n([\s\S]*?)\n```/);
  if (!match) return [];
  const parsed = JSON.parse(match[1] ?? "{}") as Record<string, unknown>;
  return Object.keys(parsed);
}

export interface SystemPromptOptions {
  runner: "gemini" | "agent-sdk";
}

/**
 * Both runners get every skill body in the system prompt, the same text
 * from the first turn. The Agent SDK could discover skills natively and
 * open them on demand, but live it opened lead-qualification only after
 * three companies were already scraped - the two runners should start from
 * the same rules (SYSTEM-DESIGN-NEXTJS.md §13). `runner` is kept so a
 * runner-specific line can be added without changing callers.
 */
export function buildSystemPrompt(options: SystemPromptOptions): string {
  const safety = loadSkill("outreach-safety");
  const base = [
    "You are the Koya Lead Research and Outreach Agent. Follow the skills below for how to do each part of the job.",
    "",
    "## Safety rules (always in force)",
    "",
    safety.body,
  ].join("\n");

  const otherBodies = SKILL_NAMES.filter((name) => name !== "outreach-safety").map((name) => loadSkill(name).body);
  return [base, ...otherBodies].join("\n\n---\n\n");
}
