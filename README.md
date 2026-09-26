# Koya Lead Agent

Koya Lead Agent is an AI lead research and outreach-drafting application built for the Koya AI Automation Academy Week 5 project.

A user enters a lead qualification objective, the system turns it into an explicit ideal customer profile, discovers candidate companies, researches public company websites, qualifies each lead from evidence, and prepares a review-ready three-step email sequence plus a LinkedIn message for every qualified company.

The application is deliberately a research and drafting system. It does not search for personal email addresses, verify deliverability, or send outreach on any channel.

## Product flow

1. **Objective validation**: checks the request before a run starts and identifies vague, invalid, or unsafe objectives.
2. **ICP refinement**: converts the objective into explicit company criteria, hard filters, preferences, and disqualifiers.
3. **Company discovery**: searches for candidate companies through Apify with server-enforced limits.
4. **Website research**: uses Firecrawl in production and Crawl4AI for local development to gather public evidence from company websites.
5. **Lead qualification**: records each company as qualified, not qualified, or needs review, together with confidence, fit reasons, concerns, source URLs, and a source summary.
6. **Outreach drafting**: creates three email steps and one LinkedIn message for each qualified lead. Drafts are checked for formatting, placeholders, unsupported claims, and grounding before they are accepted.
7. **Human review**: lets the reviewer inspect evidence, change a lead decision with a reason, edit or revert drafts, and approve the final copy.
8. **Quality and export**: produces a quality report, qualified lead export, outreach sample pack, and tool-call evidence for review.

## Architecture

The application is split into two processes so the user interface remains responsive while agent runs can continue for several minutes.

- **Web application**: Next.js application deployed on Vercel. It handles authentication, run creation, live progress, lead review, outreach review, quality reporting, and exports.
- **Agent worker**: long-running Node.js worker that executes the Claude Agent SDK, claims queued runs, calls the approved tools, records progress, and handles pause, resume, cancellation, and recovery.
- **Supabase**: the source of truth for runs, leads, outreach drafts, tool calls, agent events, costs, quality reports, caches, authentication, and worker coordination.
- **External providers**: Apify for company discovery and Firecrawl for production website scraping. Crawl4AI is available for local development.

The agent decides the sequence of research and qualification work, but application code controls the limits. Candidate counts, scrape limits, tool-call limits, turn limits, and spend limits are enforced outside the model so the agent cannot increase them by itself.

## Safety and reliability

Several safeguards are enforced by code rather than relying only on prompts:

- No email, SMTP, LinkedIn sending, or generic messaging tool exists in the agent tool surface.
- The system never attempts to find, infer, or validate personal email addresses.
- Scraped website content is treated as untrusted data and cannot change the objective, limits, or available tools.
- Failed or incomplete research is surfaced as `needs_review` instead of being replaced with invented evidence.
- Low-confidence qualification is moved to review rather than accepted automatically.
- Drafts that contain placeholders, unsupported claims, missing subjects, invalid structure, or other writing-rule violations are sent back to the agent for correction.
- Pause and cancel requests are checked at safe points during execution so a stopped run does not continue making model or provider calls.
- Saved run state is used to resume work without repeating completed research unnecessarily.
- Production and replay workers are isolated so automated tests cannot accidentally consume live provider credits.

## Tech stack

- **Next.js 16**, React 19, and TypeScript
- **Tailwind CSS** and shadcn/ui
- **Supabase** for PostgreSQL, Auth, Realtime, RLS, and worker coordination
- **Claude Agent SDK** for the production agent runtime
- **Claude Sonnet 5** for production research and drafting
- **Claude Haiku 4.5** for the lightweight objective-validation task
- **Apify** for company discovery
- **Firecrawl** for deployed website research
- **Crawl4AI** for local scraping and development
- **Vitest** and Testing Library for unit, contract, and integration testing
- **Playwright** for end-to-end testing
- **Docker** for the worker and local Crawl4AI sidecar

## Repository structure

```text
packages/core/     Shared domain rules, schemas, database access, providers, safety checks and tools
web/               Next.js user interface and server actions
worker/            Agent worker, orchestration, runners, notifications and run control
supabase/           Database migrations and RPCs
tests/              Unit, contract, integration, replay and end-to-end tests
scripts/             Migration and project utility scripts
docs/                Provider findings and supporting technical notes
```

## Local setup

Requires Node.js 22+ and pnpm.

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Copy the environment template:

   ```bash
   cp .env.example .env.local
   ```

3. Add the required Supabase and provider credentials to `.env.local`. The application uses Anthropic, Apify and Firecrawl credentials for live runs. Crawl4AI can be used locally through Docker.

4. Apply the database migrations:

   ```bash
   pnpm db:migrate
   ```

5. Start the local Crawl4AI sidecar when using it:

   ```bash
   pnpm dev:sidecar
   ```

6. Start the web application and worker in separate terminals:

   ```bash
   pnpm dev:web
   pnpm dev:worker
   ```

7. Open `http://localhost:3000`.

## Tests

```bash
pnpm test          # unit, contract and integration tests
pnpm test:e2e      # Playwright end-to-end tests
pnpm check         # workspace checks, lint, typecheck and test suite
pnpm build         # production web build
```

Automated tests use recorded provider fixtures where external calls are involved. This keeps routine testing deterministic and prevents repeated test runs from spending provider credits.

## Production behavior

Production runs use the Claude Agent SDK with Claude Sonnet 5 and Firecrawl. The worker runs separately from the Vercel web application and uses Supabase as its shared queue and durable state. Operational failures are recorded visibly, temporary provider failures can be retried safely, and Discord notifications are used for run and system alerts.

## Outreach boundary

Koya Lead Agent ends at researched, evidence-backed leads and reviewed outreach drafts. It does not send email or LinkedIn messages. A human remains responsible for reviewing the evidence, approving the copy, and deciding whether or how to contact a company.