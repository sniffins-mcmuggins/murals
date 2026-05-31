# Issue naming, labels, and milestones

When creating new GitHub issues, renaming issues, applying labels, or auditing issue hygiene in this repo, load: @.claude/rules/kanban.md

---

## Issue naming convention

All issues must follow `[EX]` or `[EX.Y]` format:

```
[E15]   Parent epic — one-liner description
[E15.1] Sub-task — specific deliverable
```

**Epic** (`type:epic`): a logical feature cluster, usually 3–6 sub-tasks. Has a checklist body linking sub-issues.
**Task** (`type:task`): a self-contained deliverable that can be built and merged independently.
**Planning** (`type:planning`): design spike or decision doc — no code. Closes when a decision is made.

### Current epic numbering

| Epic | Title | Status |
|------|-------|--------|
| E1–E10 | Phase 1 foundations | Done |
| E11 | Production infrastructure (Terraform, CI/CD) | Backlog/P0 |
| E12 | Auth upgrades (OAuth, MFA, password reset) | Done |
| E13 | Stripe payments | Done |
| E14 | E2E test suite (auth + billing) | Done |
| E15 | Private page sharing — prospect → claim → publish | In progress |
| E16 | Private beta portal — invite-gated access | Ready |
| E17 | Artists as moderators — flag queue, graded actions | Backlog |
| E18 | Artist & organiser endorsements | Backlog |
| E19 | AI onboarding backend — artist profile auto-build | Icebox |
| E20 | Refer-an-artist — referral attribution, comp rewards | Backlog |
| E21 | GPS-triggered artist audio + festival trail + save/seen | Backlog |
| E22 | Organiser review & selection (panellist, rubric, anon, multi-round) | Backlog (E22.4 open) |

**Next epic number: E23.** Before creating a new epic, check this table first.

---

## Labels

### Canonical label set (use only these)

**Type** — what kind of issue is it:
| Label | Meaning |
|-------|---------|
| `type:epic` | Parent epic tracking a feature cluster |
| `type:task` | Self-contained deliverable |
| `type:planning` | Design spike / decision — no code |

**Area** — which part of the stack:
| Label | Meaning |
|-------|---------|
| `area:api` | Go API (`api/`) |
| `area:web` | Next.js web platform (`web/`) |
| `area:mobile` | React Native app (`mobile/`) |
| `area:db` | Postgres schema, migrations, sqlc (`db/`) |
| `area:infra` | docker-compose, prometheus, minio (`infra/`) |
| `area:ci` | GitHub Actions, codegen pipeline |
| `area:openapi` | OpenAPI spec + TS codegen (`openapi/`) |
| `area:e2e` | End-to-end tests (`e2e/`) |

**Priority** — deadline urgency (mirrors board Priority field):
| Label | Meaning |
|-------|---------|
| `priority:p0` | Must ship before CPF Oct 2027 pilot |
| `priority:p1` | Launch nice-to-have / growth feature |
| `priority:p2` | Post-pilot, no deadline pressure |

**State** — cross-cutting signals:
| Label | Meaning |
|-------|---------|
| `blocked` | Waiting on another issue (link in body) |
| `security` | Security or business-logic gap |
| `good-first-subagent` | Well-scoped, low-context, good for parallel sub-agent |

**GitHub defaults** — keep as-is, don't rename:
`bug`, `documentation`, `duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`

### Labels that no longer exist (deleted)

Do not recreate these:
- `phase:1`, `phase:2` — replaced by milestones
- `ready`, `in-progress` — redundant with board Status column
- `e2e` — duplicate of `area:e2e`
- `future` — use the Icebox board column instead

---

## Milestones

| Milestone | Due | Description |
|-----------|-----|-------------|
| Phase 1 — Local E2E | — | Closed. E1–E9 complete. |
| Phase 2 — Deployment & Features | — | Legacy. Superseded by the two below. |
| **Beta Launch** | **Aug 2027** | Working platform live for founding members. |
| **CPF 2027 Pilot** | **Oct 2027** | CPF applications open through the platform. |

Every P0 issue should be assigned to one of the two active milestones. P1/P2 issues can be unassigned.

---

## Hygiene rules

### Creating a new issue
1. Title must start with `[EX]` or `[EX.Y]`. No `feat:`, `Epic:`, `Design:` prefixes.
2. Apply at least one `type:` label and at least one `area:` label.
3. Apply a `priority:` label immediately — don't leave it unset.
4. If P0, assign to the appropriate milestone (Beta Launch or CPF 2027 Pilot).
5. If the issue is blocked, add `blocked` label and link the blocking issue in the body.
6. Add it to the project board and set Status to match its actual state.

### Creating a new epic
1. Check the "Current epic numbering" table above — use the next E number.
2. Update the table in this file with the new epic.
3. Body must contain a checklist of sub-issues (add them as `[ ] [EX.Y] #NNN — …` lines).
4. Add it to the board and set Status + Priority via `gh api graphql` mutations (see `kanban.md`).
5. Label: `type:epic` + relevant `area:` labels.

### Periodic audit (run when asked to tidy the board)
1. Scan open issues for titles not matching `[EX]` / `[EX.Y]` → rename or close.
2. Scan open issues with no `priority:` label → apply one.
3. Scan open P0 issues with no milestone → assign to Beta Launch or CPF 2027 Pilot.
4. Scan for stale `blocked` labels (blocking issue is now closed) → remove.
5. Query the board via `gh api graphql` and mark freshly-closed items Done (see `kanban.md`).
