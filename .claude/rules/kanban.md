# Kanban board hygiene

When the user asks to triage the board, update issue statuses, organise the kanban, or keep the project board up to date, load: @scripts/sync-done-to-board.py @scripts/organise-board.py

Board: https://github.com/users/sniffins-mcmuggins/projects/1/views/1
Project ID: `PVT_kwHOEQNUZM4BZPlW` (project number 1, owner `sniffins-mcmuggins`)

## Auth prerequisite

GitHub Projects v2 requires scopes beyond the default `repo` token:

```bash
gh auth refresh -s read:project   # read-only queries
gh auth refresh -s project        # read + write (needed for any mutation)
```

Check current scopes: `gh auth status`. If the `project` scope is missing, ask the user to run the refresh before attempting any board write.

## Column structure

| Status | Option ID | Intent |
|--------|-----------|--------|
| Icebox | `6bc73e78` | Far-future / no timeline — not actively planned |
| Backlog | `f75ad846` | Planned but not starting soon (weeks/months away) |
| Ready | `61e4505c` | Fully specced, can be started in the next 1–2 sprints |
| In progress | `47fc9ee4` | Actively being worked on — max 2–3 items at once |
| In review | `df73e18b` | PR open, awaiting review or CI |
| Done | `98236657` | Merged/closed |

**Icebox** (far-future work, no timeline): Added manually via the board UI. Option ID `6bc73e78`. Use for work with no active timeline — E19 (AI onboarding) lives here.

## Priority field

| Priority | Option ID | Meaning |
|----------|-----------|---------|
| P0 | `79628723` | Must ship before CPF Oct 2027 pilot |
| P1 | `0a877460` | Launch nice-to-have / growth feature |
| P2 | `da944a9c` | Post-pilot, no deadline pressure |

## Field IDs (stable — don't need to re-query)

```
Status field:   PVTSSF_lAHOEQNUZM4BZPlWzhUPpIk
Priority field: PVTSSF_lAHOEQNUZM4BZPlWzhUPpMA
```

## Scripts

### `scripts/sync-done-to-board.py`

Marks closed issues/merged PRs that are already on the board as Done. Run after a sprint or batch of merges.

```bash
uv run scripts/sync-done-to-board.py           # dry run
uv run scripts/sync-done-to-board.py --apply   # apply
```

### `scripts/organise-board.py`

One-shot triage script. Encodes explicit status + priority decisions per issue number, backfills all closed repo issues as Done, and syncs anything still open-but-closed.

```bash
uv run scripts/organise-board.py           # dry run
uv run scripts/organise-board.py --apply   # apply
```

When adding new issues, add an entry to the `DECISIONS` dict at the top of this script with the issue number and the target `(status, priority)`.

## WIP rules

- **In progress**: max 2–3 issues. If a new issue needs starting, move something out first.
- **In review**: should be empty or near-empty at end of sprint. Merge or move back to In progress.
- **Ready**: max ~6 items. Anything beyond that is really Backlog — don't use Ready as a holding pen.
- **Backlog**: ordered by priority field. P0 items at the top should be pulled into Ready when capacity opens.

## Current priority triage (as of 2026-05-30)

```
P0 (CPF 2027 must-have):
  E15 series   #175–180   Profile publish flow
  E16 series   #185–188   Beta access portal
  E11          #98        Production infra / Terraform
  #159                    Multi-round selection (organiser workflow)

P1 (launch nice-to-have / growth):
  E17 series   #189–193   Content moderation
  E20 series   #204–208   Refer-an-artist

P2 (post-pilot):
  E18 series   #194–197   Endorsements
  #123                    Bubbletea admin TUI
  #168                    GPS audio tour
  #169                    Festival trail
  #170                    Save / seen-it public feature
```

## Periodic hygiene (run at the start of each session or after a PR merge)

1. `uv run scripts/sync-done-to-board.py --apply` — move any freshly-closed items to Done.
2. Scan "In progress": anything stale (no commit activity in 3+ days)? Move back to Ready and note it.
3. Scan "Ready": more than 6 items? Move the lowest-priority ones to Backlog.
4. Check that the active branch issue is In progress (not Ready).

## Adding a new epic to the board

1. Create the GitHub issue with the `[EX]` / `[EX.Y]` naming convention.
2. Add an entry to `DECISIONS` in `scripts/organise-board.py`.
3. Assign Priority immediately — don't leave it unset.
4. If it's P0, add it to the "Current priority triage" section above.
