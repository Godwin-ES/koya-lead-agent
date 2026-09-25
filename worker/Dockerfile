# Node 22 slim, no browser: crawl4ai is a self-hosted dev-only sidecar
# (docker-compose.dev.yml), never part of this image. The deployed
# default scraper is Firecrawl, a hosted API (SYSTEM-DESIGN-NEXTJS.md
# §4.4) - nothing here needs Chromium/Playwright.
FROM node:22-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate

# Manifests first, for layer caching - only worker/ and its one workspace
# dependency (@core/lead-agent) matter for this image; web/'s manifest is
# still needed so pnpm can resolve the workspace graph at install time.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY worker/package.json worker/package.json
COPY web/package.json web/package.json

# Default (non-omitted) optional dependencies are required: the Agent
# SDK bundles its Claude Code binary via an npm optional dependency
# (docs/provider-findings.md finding #9). `--omit=optional` here would
# silently ship a worker that can run Gemini fine and fail every
# agent-sdk run with a missing-binary error only discovered at runtime.
RUN pnpm install --frozen-lockfile --filter worker...

COPY packages/core packages/core
COPY worker worker

WORKDIR /app/worker

# Build-time verification that the bundled binary actually resolves
# (docs/provider-findings.md finding #9's own suggested check) - catches
# a missing binary at image-build time, not at first deploy.
RUN node -e "require('@anthropic-ai/claude-agent-sdk')"

ENV NODE_ENV=production
# Production rules: Claude + Firecrawl only, live unless REPLAY_MODE=true, no recordings (domain/environment.ts).
ENV APP_ENV=production
EXPOSE 8080

# No separate compile step: the worker runs its TypeScript source
# directly via tsx at container start (worker/package.json's "start"
# script) rather than through a bundler. The cross-workspace @core/*
# path-aliased imports (tsconfig "paths", not real package resolution)
# make a conventional tsc/esbuild bundle noticeably more work to set up
# correctly than this project's size currently justifies; tsx handles
# them natively at runtime with no extra config. Worth revisiting if
# container cold-start time becomes a real constraint.
CMD ["pnpm", "start"]
