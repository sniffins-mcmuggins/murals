# Automated Browser Debugging: UI Health Sweep + chrome-devtools-mcp

**Status:** Implemented (sweep + skill) / chrome-devtools-mcp drill-down optional
**Date:** 2026-06-11
**Author:** Claude (research spike → scaffold)

## TL;DR

We want predictable, repeatable browser debugging across the whole site: catch console
errors/hydration warnings, failed network requests, broken links, slow loads, and (later)
Core Web Vitals — without hand-clicking 30 routes every time we ship.

The answer is **two layers, deliberately split by who's in control**:

1. **A committed script does the repeatable sweep** — `scripts/ui-health/sweep.ts`, a Playwright
   pass over every route in `scripts/ui-health/routes.json`. Deterministic, diffable against a
   baseline, CI-able. This is the predictability the project asked for: same routes, same
   checks, same report shape, every run.
2. **chrome-devtools-mcp does agent-driven drill-down** — only when the sweep flags a route and
   we want the *why* (performance-trace insights, Core Web Vitals culprits, heap snapshots).
   Non-determinism is fine there because it's investigation, not regression-gating.

A project skill, **`ui-health-sweep`**, orchestrates both and adds an **LLM route-drift check**:
on every run it lists the real routes under `web/src/app` and flags any missing from the
manifest, so coverage can't silently rot.

**Why script-first, not pure-MCP:** when an agent drives chrome-devtools-mcp tool-by-tool,
every run is an improvisation — you can't diff it or gate CI on it. Moving the repeatable part
into code is what makes it a *check* rather than an exploration. We already have Playwright in
the repo (the e2e suite), so the sweep needed **no new browser dependency** and reuses the
existing fetch-based fixture helpers.

## What was built

| Artefact | Purpose |
|----------|---------|
| `scripts/ui-health/sweep.ts` | Deterministic Playwright sweep. Builds its own fixtures (2 artists + organiser w/ open festival), logs in, visits every route, captures console/network/broken-links/load-time, diffs vs baseline, writes report. Exits non-zero on regressions. |
| `scripts/ui-health/routes.json` | Route manifest — 28 routes + 2 documented skips. `{placeholders}` resolved from runtime fixtures, so **no hardcoded DB UUIDs**. |
| `.claude/skills/ui-health-sweep/` | The skill: stack check → **LLM route-drift check** → run sweep → interpret report → optional MCP drill-down → baseline management. |
| `task ui-health` / `task ui-health:baseline` | Run the sweep / re-record the baseline. |
| `docs/ui-health/` | Output dir (gitignored except `baseline.json`): `report.md`, `report.json`, committed `baseline.json`. |

The sweep does **not** depend on the demo seed — it creates fixtures via the e2e helpers, so it
works on any fresh stack.

## What chrome-devtools-mcp adds (and why it's layer 2, not layer 1)

[`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp) is Google's
official MCP server: it drives a real Chrome via Puppeteer and exposes the full DevTools
surface — performance traces with Core Web Vitals **insights**, console, network, Lighthouse
audits, CPU/network throttling, heap snapshots.

Most of what a *regression sweep* needs (console, network, broken links) is native Playwright,
which is why the script doesn't need the MCP. The MCP's **unique** value is the exploratory
drill-down the script can't easily produce:

| Capability | Tools | When to reach for it |
|------------|-------|----------------------|
| Perf-trace insights | `performance_start_trace`, `performance_analyze_insight` | A route is flagged slow — find the long task / layout-shift culprit. |
| Core Web Vitals | (from the trace) | Measure LCP/INP/CLS on the landing page or a map page. |
| Lighthouse | `lighthouse_audit` | One-shot a11y/SEO/perf score for a public page. |
| Throttling | `emulate` | Reproduce a perf issue a fast dev machine hides (Slow 4G + 4× CPU). |
| Heap snapshots | `take_heapsnapshot` + retainers | Diagnose a leak in a long-lived page (Leaflet map editor, live applications board). |

### It is NOT a replacement for our Playwright MCP

We already have Playwright MCP wired in (`mcp__plugin_playwright_playwright__*`) and the
`take-screenshots` / `add-demo-video` skills depend on it. **Don't migrate those off Playwright.**
One browser driver per job: Playwright MCP for functional verification + captures,
chrome-devtools-mcp for non-functional drill-down, the sweep script for the regression pass.
Never run two browser drivers in one flow — they launch separate Chromes and can't share a
login session.

## Our debugging surface

30 `page.tsx` routes (public / auth / artist / organiser); the manifest covers 28 and documents
why 2 are skipped (one-time-token pages). The high-risk routes — most likely to surface
issues — are:

- **Leaflet map pages** (`/festivals/[id]/map`, `/organiser/.../map`) — perf/jank/memory; prime
  chrome-devtools-mcp drill-down targets.
- **Image-heavy artist & collection pages** — render-blocking / oversized MinIO/CDN images.
- **SSR host mismatch** — a server component fetching `localhost:8080` instead of `api:8080`
  shows up as a failed request in the sweep (documented footgun in the `e2e-debugging` rules).
- **Hydration / console warnings** — never fail an e2e test, accumulate silently; exactly what
  the console-capture pass catches.

## Roadmap (deferred, by design)

The sweep ships with console/network/broken-link checks — highest value, lowest complexity,
runs on every branch. Deferred until the basics prove out:

- **Lighthouse scores per public route** — needs a baseline-management workflow first.
- **Performance budgets** (assert LCP/CLS under throttling) — needs agreed budgets. Wire via
  chrome-devtools-mcp drill-down first, promote to the script once budgets are settled.
- **CI gate** — the sweep already exits non-zero on regressions; turning it into a GitHub Action
  needs the Compose stack + headless Chrome in CI.

## Setup for the optional MCP drill-down

```bash
claude mcp add chrome-devtools --scope user -- npx -y chrome-devtools-mcp@latest
```

Use `--isolated` (throwaway profile) and `--headless` for unattended runs. Allowlist
`mcp__chrome-devtools__*` in `.claude/settings.local.json` to skip per-call prompts. **Security:**
the README warns MCP clients can read/modify browser data — keep it on the local stack with
throwaway accounts, never point it at a real PII session.

## Risks & caveats

- **Not a CI gate yet** — needs the stack + a real Chrome; treat as a pre-PR local check for now.
- **Manifest drift** — mitigated by the skill's mandatory route-drift check, but the LLM must
  actually run it each time (the skill makes this a required step).
- **Baseline discipline** — `baseline.json` must be committed and updated via
  `task ui-health:baseline`, never hand-edited, or the signal/noise ratio degrades.
- **Fixture coupling** — dynamic routes need fixtures; new `[param]` routes require a mapping in
  `buildFixtures()`. The drift check surfaces this.
