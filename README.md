# README Roulette

A developer workspace for turning neglected repositories into well-documented projects. Built with Next.js, React, TypeScript, and SQLite, with a charcoal interface, warm orange accents, and a fully usable demo.

## Run locally

Requires Node.js 22 and npm.

```bash
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000). No credentials are needed for the demo. Demo repositories and initial dashboard scores are explicitly illustrative; health scans evaluate their fixture contents against the real scoring rules.

## Connect GitHub

1. Register a [GitHub OAuth app](https://github.com/settings/developers).
2. Set the homepage URL to `http://localhost:3000` and callback to `http://localhost:3000/api/auth/callback`.
3. Copy `.env.example` to `.env.local` and set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `APP_URL`, and `SESSION_SECRET`.
4. Generate a session secret with `openssl rand -hex 32` and restart the server.
5. Open **Settings → Connect GitHub**.

The initial connection requests `read:user`. Choose **Include private repositories** to request `repo`, or **Enable publishing to public repositories** to request `public_repo`. GitHub OAuth scopes for private repositories include broader read/write access than GitHub App permissions; see [GitHub’s scope documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps). Access tokens are encrypted with AES-256-GCM in the server database. The browser receives only an opaque, HttpOnly session cookie.

`APP_URL` must match the origin used in your browser. In production, use HTTPS and a stable session secret. Back up both the database and encryption secret; rotating the secret requires reconnecting accounts.

## Deploy

The public site is [readmeroulette.oddware.dev](https://readmeroulette.oddware.dev). Cloudflare proxies to the Next.js server on Azure F1; hosted data lives in Azure SQL's free offer with overage billing disabled.

```bash
npm run deploy -- --dry-run  # Preview without changing anything
npm run deploy              # Test, build, deploy Azure + Cloudflare, verify
npm run deploy:status       # Inspect the live setup
```

For code changes that only need Azure, use `npm run deploy -- --app-only`. For credentials or public-URL fixes, use `npm run deploy:configure`.

See **[the deployment guide](docs/deployment.md)** for prerequisites, first setup, login, OAuth callback values, secret handling, and recovery. The default deploy updates existing resources; `npm run deploy:setup` is only for a new installation.

## What works

- Search, visibility/language/README filters, sorting, list/grid views, and repository selection.
- Individual and batch repository analysis with source-file evidence.
- Product-aware README generation, four writing tones (Personality by default), six documentation profiles, and badge/section controls.
- Optional “Why this copy?” inspection with source-backed claims and provenance.
- Dynamic sections, real screenshot detection, and internal editorial checks before display.
- Markdown source highlighting, live GitHub-style preview, editing toolbar, selection rewrites, copy, and download.
- Existing-versus-generated line diff and per-section reversion.
- SQLite version history and restore, plus local browser draft recovery.
- Screenshot checklist, persistent completion state, and Markdown image placeholders.
- Six portfolio-copy formats with individual copy actions.
- Explicit scoring criteria and draft scores that update as documentation changes.
- GitHub publishing to a new branch and pull request (default), a new branch only, or the default branch after diff approval.
- Optimistic concurrency checks prevent replacing a README that changed since analysis.
- Responsive layouts, keyboard command search, and reduced-motion support.

## Evidence and generation

Generation follows safe file discovery → product understanding → a section plan → grounded writing → an internal quality pass. The product model combines UI actions, handler implementations, CLI commands, API operations, library documentation, and existing project writing. Dependencies alone never become features.

The analyzer reads up to 65 text files of at most 100 KB, prioritizing manifests, documentation, entry points, components, and handlers. It excludes build artifacts, dependencies, credential filenames, keys, and real `.env` files. Templates contribute variable names only. Known credential patterns are redacted before evidence is retained.

Tone defaults to **Personality**, with Professional, Developer, and Unhinged alternatives. Documentation profiles control depth separately. Unsupported sections are omitted; existing screenshots are embedded, and missing screenshots produce hidden recommendations. Source references appear in an optional inspector rather than in the README’s product copy.

Analysis is cached for five minutes and blobs are cached by content SHA. Older cached analyses are automatically upgraded to the new product model. Saved README versions are preserved.

### Optional AI provider

Sign in with GitHub, then open **Settings → Bring your own AI key** to connect **OpenAI or Anthropic**, load available models, and save your selection. Your encrypted, account-specific key powers README generation and selected-text rewrites. Keys can be replaced or removed; API usage is billed to your provider account. See [BYOK setup, privacy, and troubleshooting](docs/byok.md).

Local generation works without a key. Administrators can also set `AI_ENDPOINT` and optionally `AI_API_KEY` for a provider-neutral HTTP adapter; a user's personal key takes priority. The provider receives tone instructions, the product model, supported claims, and a baseline draft. Structured `{ "draft": ... }` responses are preferred; existing `{ "text": "Markdown" }` adapters remain supported.

Provider copy crosses the same editorial gate and additional checks for unsupported claims and changed technical instructions. A failed candidate gets one repair attempt, then falls back to the grounded local draft. No arbitrary AI quality score is shown. Bounded source excerpts can be sent; complete source files and environment values are not.

See [the generation pipeline and adapter contract](docs/generation.md) for supported signals, limitations, tone behavior, and validation details.

## Storage

SQLite lives in `.data/roulette.sqlite` (override with `DATA_DIR`). Tables cover users, encrypted GitHub connections and personal AI credentials, sessions, repositories, analyses, READMEs, README versions, screenshot tasks, portfolio descriptions, and score breakdowns. Per-user keys isolate records; demo sessions also have distinct identities.

Use a persistent disk and a single application instance, or replace the SQLite persistence layer for horizontally scaled hosting. Do not deploy the SQLite configuration onto ephemeral serverless storage or Azure network shares. The Azure deployment selects the Azure SQL adapter and persists data independently of the web app.

## Validation

```bash
npm run typecheck
npm test
npm run build
# With the dev server running, and Playwright Chromium installed:
npm run test:browser
```

Unit tests cover secret exclusion/redaction, environment-name extraction, evidence-backed commands, absent-command behavior, profiles, score totals, and publish concurrency. The browser check covers filtering, analysis, generation, saving/restoring versions, diff review, source evidence, selected-repository scans, and mobile overflow. Screenshots are saved to `artifacts/`.

## Project structure

```text
src/app/                  Next.js entry points and global styles
src/app/api/[...path]/     OAuth, analysis, generation, persistence, publishing
src/components/           Workspace and Markdown syntax layer
src/lib/analyzer.ts        File selection and evidence extraction
src/lib/github.ts         GitHub and demo repository providers
src/lib/product-model.ts  Product interpretation and claim provenance
src/lib/generator.ts      Product-aware README and portfolio composition
src/lib/generation-service.ts  Optional model writing, repair, and safe fallback
src/lib/readme-quality.ts  Internal editorial and factual validation
src/lib/ai-provider.ts    Optional provider-neutral HTTP adapter
src/lib/db.ts             SQLite schema and encrypted sessions
src/lib/score.ts           Eleven weighted documentation criteria
src/lib/types.ts           Shared metadata model and provider interfaces
tests/                    Unit tests and browser workflow verification
```

The score measures documentation coverage, not code quality. Screenshot uploads and image hosting are future work; currently the checklist inserts repository-relative image paths. The architecture explorer visualizes verified directory containment and does not invent runtime relationships. Activity is scoped to the current browser session. Live OAuth and GitHub writes require your own credentials and were not exercised against a real account during development.

## License

[MIT NON-AI License](LICENSE). This custom, source-available license permits use, modification, and redistribution subject to its terms, but **prohibits all AI/ML use of the code**, including training, inference, AI integrations, and supplying the code to AI coding tools, unless separately authorized in writing by the applicable copyright holder(s). It is not the standard MIT License or an OSI-approved open-source license.

Third-party components and assets retain their own licenses. Previously granted licenses are not retroactively revoked. See the license file for the full terms.
