# Repo Health

Continuous structural health scoring for codebases. Driven by the same
indexer + context-agents + synthesizer architecture as LGTM, but with the
PR review pipeline stripped out — this project does one thing only: score
a repo's structural health on every push and surface trends over time.

## Architecture

```
client (React + Vite)     ←→     server (Express + BullMQ + MongoDB + Redis)
                                    │
                                    ├─ Indexer agent      (tree-sitter, 13 langs)
                                    ├─ Pattern agent      (LLM extracts conventions)
                                    ├─ History agent      (LLM summarizes recent PRs)
                                    ├─ HealthScore service (Gini, churn × centrality)
                                    │
                                    └─ GitHub App webhook → push → re-index → score
```

The health score combines two structural signals (the schema reserves
slots for two more — debt and confidence — which currently default to
neutral; they're populated when integrated with a PR review system):

| Signal     | Source                                              | Weight |
| ---------- | --------------------------------------------------- | ------ |
| Coupling   | Gini coefficient of PageRank scores across files    | 45     |
| Churn risk | Top-decile-PageRank files touched in >30% of pushes | 45     |
| Confidence | Neutral default                                     | 10     |

## What you need to provide

Before you can run this, you need the following tokens / credentials. Drop
them into `server/.env` (copy from `server/.env.example`).

### 1. MongoDB

Either a local Mongo or a free Atlas cluster. The connection string
goes into `MONGODB_URI`.

### 2. Redis

Either local Redis (`brew install redis` / `apt install redis`) or a
hosted instance (Upstash has a free tier that works great). The URL
goes into `REDIS_URL`. Redis is required for BullMQ queues, socket.io
cross-instance fan-out, and rate limiting.

### 3. JWT secrets

Two long random strings. Generate with:

```
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Set both `JWT_SECRET` and `JWT_REFRESH_SECRET`. The same `JWT_SECRET` also
seeds the AES-GCM key used to encrypt user API keys at rest, so don't
rotate it without re-encrypting.

### 4. GitHub OAuth App (for user sign-in)

Create one at https://github.com/settings/developers → "OAuth Apps" → "New OAuth App".

| Field                      | Value                                          |
| -------------------------- | ---------------------------------------------- |
| Application name           | Repo Health (dev) or whatever                  |
| Homepage URL               | http://localhost:5173                          |
| Authorization callback URL | http://localhost:3000/auth/github/callback     |

Copy the **Client ID** → `GITHUB_CLIENT_ID`.
Generate a **Client Secret** → `GITHUB_CLIENT_SECRET`.

### 5. GitHub App (for repo access + webhook delivery)

This is separate from the OAuth App. Create at
https://github.com/settings/apps → "New GitHub App".

| Setting                  | Value                                                                            |
| ------------------------ | -------------------------------------------------------------------------------- |
| GitHub App name          | Repo Health (or any unique name)                                                 |
| Homepage URL             | http://localhost:5173                                                            |
| Callback URL             | http://localhost:5173/dashboard/repos                                            |
| Webhook URL              | `https://<your-public-tunnel>/webhooks/github` (use ngrok or similar in dev)     |
| Webhook secret           | A long random string — put the same value in `GITHUB_WEBHOOK_SECRET`             |

**Permissions:**
- Repository → Contents → **Read-only**
- Repository → Metadata → **Read-only**
- Repository → Pull requests → **Read-only**

**Subscribe to events:**
- Push
- Pull request

After creating, on the App's settings page:
- Copy the **App ID** → `GITHUB_APP_ID`
- Note the **public slug** from the URL (e.g. `github.com/apps/repo-health`)
  → `GITHUB_APP_SLUG` (default: `repo-health`)
- Scroll to "Private keys" → "Generate a private key". A `.pem` file
  downloads. Paste its contents into `GITHUB_APP_PRIVATE_KEY` —
  literal newlines or `\n`-escaped both work.

Finally, install the GitHub App on the repos you want to track (a
button appears on the App's public page once configured).

### 6. AI provider key (one of)

Repo Health uses an LLM for the pattern + history agents during
indexing. You only need to add this **inside the app's Settings page**
(not in `.env`) — the platform stores it encrypted per-user.

Supported:
- **OpenAI** (https://platform.openai.com/api-keys)
- **Google Gemini** (https://aistudio.google.com/apikey)

Anthropic support is stubbed but not active.

If you don't add a key, the indexer still runs (tree-sitter +
PageRank), but the pattern and history agents are skipped. The health
score will still compute since it's driven by structural data, not LLM
output.

## Running locally

### One-time setup

```
# server
cd repo-health/server
cp .env.example .env
# ... fill in MONGODB_URI, REDIS_URL, JWT_SECRET, JWT_REFRESH_SECRET,
# ... GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_APP_ID,
# ... GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET
npm ci    # use `ci` not `install` — see "About tree-sitter pinning" below

# client
cd ../client
cp .env.example .env
# default VITE_API_URL=http://localhost:3000 is fine
npm install
```

### About tree-sitter pinning

The server's `package.json` pins all `tree-sitter-*` packages to exact
versions (no `^` prefix). This is intentional: several tree-sitter
language packages have shipped new minor versions converted to ESM
(`"type": "module"` in their package.json), which breaks `require()`
from our CommonJS server. The pinned versions are the latest CJS-only
ones — `npm install` without these pins would auto-upgrade to ESM
versions and the server would fail to boot with `ERR_REQUIRE_ESM`.

**Always use `npm ci` instead of `npm install`** for the server.
`npm ci` installs exactly what's in `package-lock.json` without
resolving versions, guaranteeing reproducibility. The lockfile is
committed to the repo for this reason — do not delete it.

If a friend clones this repo and runs `npm ci`, they will get exactly
the same dependency tree you have, and everything will work.

### Start everything

In two terminals:

```
# Terminal 1 — API + workers (single-process mode)
cd repo-health/server
npm run dev

# Terminal 2 — client
cd repo-health/client
npm run dev
```

Open http://localhost:5173, sign in with GitHub, install the App on a
repo, add an API key in Settings, then connect a repo on the Repos page
and click "Index Codebase". The health score appears on `/dashboard`
once indexing completes.

### Scaling (optional, for production)

The API and BullMQ workers can run in separate processes:

```
# API only
WORKER_MODE=separate npm run dev

# Worker only (separate terminal / container)
WORKER_TYPE=all npm run dev:worker
```

Valid `WORKER_TYPE`: `all`, `index`, `index-incremental`, `index-backfill`, `none`.

## Webhooks in development

The GitHub App webhook needs a public URL. In dev, tunnel localhost:3000
with ngrok / cloudflared / smee:

```
ngrok http 3000
# copy the https URL into the App's "Webhook URL" field
# (e.g. https://abc123.ngrok.io/webhooks/github)
```

Without this, pushes won't trigger auto-reindexing. You can still index
manually from the Repos page.

## What's intentionally missing

This codebase deliberately does NOT include (compared to the full LGTM):

- PR review pipeline (6 review agents + synthesizer)
- Per-PR auto-review, GitHub comment posting
- PR chat (`@bot explain` / `fix` / `improve` / `test`)
- Notifications, billing (Dodo), security scanning (LGTM Security)
- Sentry, Vercel Analytics, Helmet meta tags
- CLI

The indexer, pattern extractor, history summarizer, dependency graph,
PageRank, repo connect/disconnect, BYOK settings, GitHub App auth, and
the health score dashboard are all present and functional.
