# HD Southern Development — build standard

The rules every HD Southern website and demo is held to, plus the tooling that enforces them
automatically, regardless of which tool built the site.

## Why this repo exists

A standard that lives only in one AI assistant's memory applies only when that assistant is
used. This repo makes it apply to everything: the rules travel with the project, and the checks
run in CI where nothing can skip them.

## Files

| File | What it does |
|---|---|
| `AGENTS.md` | The rules, written for any AI assistant or developer. Copy into every project, plus a copy named `CLAUDE.md`. |
| `audit.mjs` | Automated compliance audit of a running site. Zero dependencies. Exits 1 on any blocking failure. |
| `form-health.mjs` | Synthetic form submission and enquiry-freshness checks across live client sites. |
| `sites.json` | Registry of live sites to monitor. A site not listed here is not monitored. |
| `.github/workflows/standards-audit.yml` | Runs the audit on every push and pull request. |
| `.github/workflows/site-health.yml` | Daily form health check. Opens a GitHub issue on failure. |

## Using it in a new project

1. Copy `AGENTS.md` into the repo root. Copy it again as `CLAUDE.md`.
2. Copy `.github/workflows/standards-audit.yml`. Set the mode flag on the audit step:
   `--demo` for a cold-outreach demo, `--live` for a launched client site, or omit it pre-launch.
3. When the site goes live, add it to `sites.json` here so the daily health check covers it.

## Running the audit locally

```bash
npm run build
npm run start &
node audit.mjs --url http://127.0.0.1:3000 --demo
```

Modes: `--demo` expects noindex and `Disallow: /` and fails if the site is indexable.
`--live` enforces the opposite plus security headers. No flag means pre-launch.

## Running the health check

```bash
export SUPABASE_URL=https://xooshhismfcvogujlkib.supabase.co
export SUPABASE_SERVICE_KEY=...      # service role key, never commit this
node form-health.mjs                 # all sites
node form-health.mjs --no-submit     # freshness only, sends nothing
```

Test submissions are marked `hd-health-check` and deleted afterwards, so they never appear in a
client's real leads.

## What the tooling does not check

Deliberately honest about its limits. A green run does **not** cover:

- Colour contrast, keyboard operation, screen reader behaviour
- Console errors, Core Web Vitals
- Image rights and licensing
- Whether the content is actually true

See `AGENTS.md`: Accessibility (contrast, keyboard, screen reader), Build quality (console errors, Core Web Vitals) and Never do these (truthful content). Image rights are not covered there yet, so check them by hand.
