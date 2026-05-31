# Kanban board hygiene

When the user asks to triage the board, update issue statuses, organise the kanban, or keep the project board up to date.

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

## Board hygiene via gh CLI

Use `gh api graphql` mutations to update board items directly. Key IDs:

```
PROJECT_ID:       PVT_kwHOEQNUZM4BZPlW
STATUS_FIELD_ID:  PVTSSF_lAHOEQNUZM4BZPlWzhUPpIk
PRIORITY_FIELD_ID: PVTSSF_lAHOEQNUZM4BZPlWzhUPpMA
```

**Move a closed issue to Done on the board:**
1. Find the item ID: query `projectV2.items` filtering by issue number.
2. Mutate `updateProjectV2ItemFieldValue` with `singleSelectOptionId: "98236657"` (Done).

**Add a new issue to the board:**
Mutate `addProjectV2ItemById` with the issue's node ID, then set Status and Priority fields.

**Mark all freshly-closed issues Done in one pass:**
Use `gh api graphql` to query all board items, filter where `content.state == CLOSED` and `Status != Done`, then mutate each. Ask Claude to write and run this inline — no script file needed.

## Issue relationships

We use two GitHub native relationship types on all epics and tasks. Both are managed via GraphQL mutations — no web UI needed.

### Sub-issues (parent epic → child task)

Every `[EX.Y]` task must be a sub-issue of its `[EX]` parent epic.

```graphql
mutation {
  addSubIssue(input: { issueId: "<parent-node-id>", subIssueId: "<child-node-id>" }) {
    issue { number }
    subIssue { number }
  }
}
```

Get a node ID: `gh api graphql -f query='{ repository(owner: "sniffins-mcmuggins", name: "murals") { issue(number: NNN) { id } } }'`

To remove: `removeSubIssue(input: { issueId: ..., subIssueId: ... })`

To query sub-issues on an epic: `subIssues(first: 10) { nodes { number title } }` on the `Issue` type.

### Blocking dependencies (blocked-by)

Use `addBlockedBy` to record that issue A cannot start until issue B is done:

```graphql
mutation {
  addBlockedBy(input: { issueId: "<blocked-node-id>", blockingIssueId: "<blocking-node-id>" }) {
    clientMutationId
  }
}
```

- `issueId` = the issue that is blocked
- `blockingIssueId` = the issue that must be resolved first

To remove: `removeBlockedBy(input: { issueId: ..., blockingIssueId: ... })`

To query an issue's blockers: `blockedBy(first: 10) { nodes { number title } }` on the `Issue` type. The inverse is `blocking(first: 10) { nodes { number title } }`.

**When a blocking issue is merged/closed:** the `blocked` label on the dependent issue becomes stale. Remove the label and call `removeBlockedBy` to clean the relationship — then re-check if there are any remaining blockers before moving it to Ready.

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

1. Query board items via `gh api graphql`, find any closed/merged with Status != Done, update them.
2. Scan "In progress": anything stale (no commit activity in 3+ days)? Move back to Ready and note it.
3. Scan "Ready": more than 6 items? Move the lowest-priority ones to Backlog.
4. Check that the active branch issue is In progress (not Ready).
5. For any issue just closed/merged: check its `subIssues` list on GitHub — if all sub-issues are now Done, the parent epic can also move to Done. Remove stale `blocked` labels from issues whose blocking issue just closed, and call `removeBlockedBy` to clean the relationship.

## Adding a new epic to the board

1. Create the GitHub issue with the `[EX]` / `[EX.Y]` naming convention — see `issue-labels.md` for the next E number.
2. Add it to the board via `addProjectV2ItemById` and set Status + Priority immediately.
3. Apply `priority:` label and milestone on the issue itself.
4. If it's P0, add it to the "Current priority triage" section above and update the epic table in `issue-labels.md`.
5. Wire relationships immediately (see "Issue relationships" above):
   - Each `[EX.Y]` task: `addSubIssue` to its `[EX]` epic.
   - Each task with explicit cross-issue dependencies: `addBlockedBy` for each blocker.
   - Apply the `blocked` label on any issue with open blockers.
