---
name: ui-health-sweep
description: >
  Run an automated browser health check across every route of the running app — console
  errors, hydration warnings, failed network requests, broken links, slow loads. Use when the
  user asks to "run a UI health check", "sweep the site", "check for console errors", "find
  broken links", "lighthouse the pages", "any browser warnings", or wants a predictable
  diagnostic pass before a PR. Use proactively after shipping a visible UI feature.
---

# UI Health Sweep

Predictable, scriptable diagnosis of the running app. A committed Playwright script
(`scripts/ui-health/sweep.ts`) drives a real Chrome across every route in
`scripts/ui-health/routes.json`, captures console/network/broken-link issues, and diffs them
against a committed baseline so only **new** problems surface. Then you (the LLM) interpret
the report and, optionally, drill into the *why* with chrome-devtools-mcp.

**Design:** the script owns the repeatable pass (deterministic, diffable, CI-able).
chrome-devtools-mcp is for follow-up only (perf-trace insights, heap) — never run the sweep
through MCP tool-calls; that's what makes it unpredictable. One browser driver per job.

## Steps

### 1. Verify the stack is up (and mirror worktree → main repo)

The web container bind-mounts the **main repo**, not your worktree. Reuse the
`take-screenshots` skill's Step 1–2 verbatim: confirm `docker compose ps` is healthy, and if
you're in a worktree with changed `web/` files, copy them to
`/Users/adampowis/workspace/murals/...` and restart web. A 500 from `curl localhost:3000`
means fix that first.

### 2. Route-drift check (REQUIRED — do this every run)

Routes get added to `web/src/app` and forgotten in the manifest. List the app's real routes
and compare against `routes.json`:

```bash
cd /Users/adampowis/workspace/murals
find web/src/app -name page.tsx | sed -E 's#web/src/app##; s#/page.tsx##; s#\([^)]*\)/##g; s#^$#/#'
```

That prints filesystem routes as URL paths (route groups like `(public)` stripped, `[id]` →
`[id]`). Compare each against the `routes` and `skipped` arrays in `scripts/ui-health/routes.json`.

For **every app route not already in the manifest**, tell the user it's missing and propose a
manifest entry — this needs your judgment, not a script:
- Pick `auth`: `public`, `artist`, or `organiser` (infer from the path group / page contents).
- For a `[param]` route, map it to a `{placeholder}` and say which fixture feeds it. If an
  existing fixture fits (e.g. `{collectionId}`), reuse it. If it needs a **new** fixture,
  say so and point at `buildFixtures()` in `sweep.ts` as the place to add it.
- If the route can't be visited in steady state (needs a one-time token, etc.), propose a
  `skipped` entry with a reason.

Offer to add the entries. Don't silently proceed — a missing route is a coverage hole.

### 3. Run the sweep

```bash
task ui-health          # builds fixtures, logs in, visits every route, writes the report
```

(First run on a machine fetches `tsx` via npx — that's fine. `task ui-health:baseline`
re-records the baseline; see step 5.)

### 4. Report the results

Read `docs/ui-health/report.md`. Lead with the **Regressions vs baseline** table — those are
the new problems. Summarise: which routes regressed, what kind (console error / failed
request / broken link / nav error), and the likely cause. Cross-reference known footguns from
the `e2e-debugging` rules (SSR fetching `localhost:8080`, hydration warnings, host-mismatch
on MinIO). A clean run = "0 regressions"; say so plainly.

### 5. Baseline management

`docs/ui-health/baseline.json` is the accepted set of known issues. The sweep exits non-zero
when anything new appears. After the user fixes a flagged issue (or accepts existing noise on
a fresh checkout), run `task ui-health:baseline` to re-record, and commit it so future runs
diff against the agreed state. Never edit baseline.json by hand.

### 6. Optional drill-down (chrome-devtools-mcp)

When a route is flagged slow or you suspect a leak/jank the script can't explain, *now* reach
for chrome-devtools-mcp on that single route: `performance_start_trace` →
`performance_analyze_insight` for Core Web Vitals culprits, or a heap snapshot for the map
pages. This is exploratory and agent-driven — keep it to the one route the sweep flagged.

## Common mistakes

- **Skipping the drift check** because "the list looks current." Run the `find` every time —
  that's the whole point of the LLM step.
- **Running the sweep through MCP tool-calls** instead of the script. The script is the
  predictable artefact; MCP is for the follow-up *why*, one route at a time.
- **Editing baseline.json by hand.** Use `task ui-health:baseline`.
- **Forgetting the worktree mirror.** If the app doesn't reflect your changes, you swept the
  wrong code (see step 1).
