# Shopify AI Product Content Toolkit

This app is a public Shopify admin extension that bulk-generates product, collection, and image alt-text content with OpenAI. It tracks credit usage per shop, queues long-running jobs, and surfaces the history of every generation request directly inside the merchant admin.

## Requirements

- Node.js 18+
- npm 9+
- [Shopify CLI 4+](https://shopify.dev/docs/apps/tools/cli/getting-started)
- PostgreSQL (any managed instance or local container)
- OpenAI API access (responses must support JSON schema output)

## Environment variables

Set these values in your Shopify CLI `.env` file or shell environment before running the app:

| Variable | Purpose |
| --- | --- |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | Shopify app credentials from Partners Dashboard |
| `SHOPIFY_APP_URL` | Public URL the Shopify CLI should use when tunnelling |
| `SCOPES` | Comma separated list of Shopify API scopes |
| `DATABASE_URL` | PostgreSQL connection string for Prisma |
| `OPENAI_API_KEY` | Server-side key for OpenAI chat completions |
| `OPENAI_MODEL` | (Optional) model name, defaults to `gpt-4.1-mini` |
| `OPENAI_TEMPERATURE` | (Optional) float 0–1 used for all completions (default `0.25`) |
| `INITIAL_SHOP_CREDITS` | (Optional) starting credit balance for new shops |

## Local development

1. Install dependencies: `npm install`
2. Apply database migrations: `npx prisma migrate deploy` (or `npx prisma db push` for dev)
3. Start the Shopify dev server: `shopify app dev`
   - The CLI injects the required environment variables, starts the Remix/React Router app, and opens the embedded admin experience.

## Key application flows

- **Job creation** (`app/routes/app.jobs.create.jsx`): Validates selected products/collections, enforces credit limits, and writes a durable `BulkJob` record before enqueueing work.
- **Background worker** (`app/server/bulkJobWorker.js`): Polls queued jobs, dispatches to the correct processor, and handles retries/refunds on failure.
- **Processors** (`app/server/processProductsJob.js`, `processCollectionsJob.js`, `processAltTextJob.js`): Fetch Shopify resources, call OpenAI via `app/utils/openai.server.js`, and persist changes with per-item error handling.
- **Credit system** (`app/server/shopCredit.server.js`): Centralizes balance reads, reservations, and refunds for every shop.
- **Admin UI** (`app/routes/app.bulk-generation.jsx`, `app.routes/app.collections-bulk-generation.jsx`, `app/routes/app.alt-text-generator.jsx`, `app/routes/app._index.jsx`): Provides consistent selection, validation, and order-history views across product, collection, and alt-text tools.

All OpenAI interactions flow through `app/utils/openai.server.js`, which enforces the model, response format, and temperature configuration. Shopify admin API access is created via `app/server/shopifyAdmin.server.js` using stored offline sessions.

## Running queued work manually

The worker starts automatically when the app server boots. For scripted checks you can run `node check-jobs.mjs` to inspect the latest job states.

## Tests & linting

This project currently relies on manual QA and Shopify's embedded app tooling. Before deploying, run `npm run lint` (if configured) and trigger a few sample generations in a development store to verify credits, job progress, and order history entries.
