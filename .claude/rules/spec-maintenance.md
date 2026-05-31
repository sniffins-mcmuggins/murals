# Spec Maintenance

This rule has no `paths` frontmatter — it loads every session.

## Before touching any package

If the package has a `*.spec.md` file (see the Living Specs table in CLAUDE.md), it is
already loaded in context via its path-scoped rule. Read it before making changes.

## After making any change that alters behaviour

If your change adds, removes, or modifies:
- An endpoint's request/response shape
- A function's contract or callers' guarantees
- A security invariant
- A design decision that affects future work

Then propose a spec update as part of the same work. Show the before/after for the
affected section(s) and get user approval before writing it.

Do NOT defer spec updates to a follow-up PR. Do NOT skip them because the change
"feels small". Invariants and AI Context sections go stale fastest — check those first.

## Creating a spec for a new package

Use this template:

```markdown
# <Package> Spec
**Path:** `path/to/package/`
**Last updated:** YYYY-MM-DD

## Contract
## Boundaries
## Key Decisions
## Invariants
## AI Context
## Changelog
YYYY-MM-DD — initial spec
```

After writing the spec, create `.claude/rules/spec-<package>.md`:

```markdown
---
paths:
  - "path/to/package/**"
---

@path/to/package/package.spec.md
```

Then add the package to the Living Specs table in CLAUDE.md.
