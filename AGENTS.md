# Brand Visibility Tester — Setup Guide for AI Agents

## What is this?

A Worker that tests whether AI models (GPT-5.4, Claude Sonnet 4, Gemini 3 Flash, Llama 4, Mistral) mention your brand when answering relevant queries. All models run through Cloudflare AI Gateway — no external API keys needed.

Forked from Cloudflare's template and re-worked for GreenBrahma. The changes are in the measurement, not the plumbing.

## How scoring works

All scoring lives in `src/measure.ts` as pure functions, so it can be tested without a Worker. The upstream template scored a hit with `text.toLowerCase().includes(domain)`. This version measures:

| Signal              | Method                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------- |
| **Mentioned**       | Brand name + aliases + domain forms, matched on alphanumeric boundaries. "Brahma" does not match "Brahmaputra". |
| **Count**           | Distinct mentions, with overlapping alias hits merged so `greenbrahma` inside `greenbrahma.com` counts once. |
| **Rank**            | 1-based position among every tracked entity that appeared, ordered by first mention.       |
| **Share of voice**  | Brand mentions over all tracked-entity mentions.                                           |
| **Reproducibility** | Each model×prompt pair runs `RUNS_PER_PROMPT` times; the summary reports mean plus range.  |

Two deliberate changes to measurement validity:

- **The system prompt is neutral.** Upstream instructed the model to "mention specific companies, products, and websites by name" — which inflates the very number being measured. We ask nothing and record what the model volunteers.
- **`maxTokens` is 800, not 512.** A brand named late in a truncated answer was being scored as absent.

Aliases shorter than three characters are dropped unless supplied explicitly in `site.aliases`, because short tokens generate false positives in prose.

## Prerequisites

1. Cloudflare account with Workers AI access
2. **Unified Billing credits loaded** for third-party models (OpenAI, Anthropic, Google). Load at: https://dash.cloudflare.com → AI Gateway → Billing
3. Node.js >= 22

## Quick Setup

```bash
npm install
npx wrangler login
npx wrangler kv namespace create AEO_KV   # Replace the example ID in wrangler.jsonc
npx wrangler queues create brand-visibility-jobs
npm run deploy
```

## Setup Flow

1. **Enter site** — domain to monitor
2. **Brand & competitors** — confirm brand name, optionally add competitors
3. **Prompts** — generate AI suggestions or add custom prompts
4. **Models** — select which of the 5 models to test
5. **Run** — queues fan out jobs in parallel, results stream in

## API

| Endpoint                     | Method          | Description                |
| ---------------------------- | --------------- | -------------------------- |
| `/api/sites`                 | GET/POST/DELETE | Site CRUD                  |
| `/api/sites/:domain/prompts` | GET/POST/DELETE | Prompt CRUD                |
| `/api/sites/:domain/models`  | GET/PUT         | Model selection            |
| `/api/sites/:domain/test`    | POST            | Start test (enqueues jobs) |
| `/api/tests/:id/status`      | GET             | Poll test progress         |
| `/api/setup?domain=X`        | GET             | AI prompt generation       |
| `/api/models`                | GET             | List available models      |
| `/api/results/:id`           | GET             | Get test result            |
| `/api/results/:id/csv`       | GET             | Download CSV               |

## Files

| File               | Purpose                             |
| ------------------ | ----------------------------------- |
| `src/config.ts`    | Model definitions, run count, system prompt |
| `src/measure.ts`   | Scoring engine — matching, rank, share of voice, aggregation (pure, testable) |
| `workers/app.ts`   | Hono entry + SSR + Queue consumer   |
| `workers/api.ts`   | All API endpoints                   |
| `workers/queue.ts` | Queue consumer (parallel inference) |
| `app/routes/`      | React Router pages                  |
| `app/components/`  | UI components                       |
| `app/components/scorecard.tsx` | Measured summary — rate with range, rank, share of voice |
| `app/app.css`      | GreenBrahma theme — inverted neutral ramp, monospace throughout |
