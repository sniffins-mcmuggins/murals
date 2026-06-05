# Application Form Builder (A+C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give organisers a visual application-form builder (add/edit/reorder questions, a curated question library, a starter template) and add a `embed` field type (YouTube/Vimeo/Sketchfab) that artists fill and organisers review.

**Architecture:** `embed` answers are plain URL strings in `answers[field.id]` — no DB migration; `application_forms.fields` stays opaque jsonb. A pure provider parser (`web/src/lib/embeds.ts`, mirrored in Go) drives applicant input, board thumbnails, the slide-over player, and server validation. A new `/organiser/festivals/[id]/form` route hosts the builder, persisting via the existing `PATCH /festivals/{festivalID}/form`.

**Tech Stack:** Go (chi, pgx, sqlc) API; Next.js App Router + React Query + Testing Library/Vitest web; Playwright + Vitest e2e against the Docker Compose stack.

**Spec:** `docs/superpowers/specs/2026-06-05-application-form-builder-design.md`

**Conventions reminder:**
- Web component tests: Vitest + `@testing-library/react`, `React.createElement` style (see `web/src/__tests__/components/dynamic-form.test.tsx`).
- Go handler tests: table/`httptest` style in `api/internal/festival/*_test.go`.
- Run web unit tests: `cd web && npx vitest run <path>`. Run Go tests: `task api:test` or `cd api && go test ./internal/festival/ -run <Name>`.
- E2E needs the stack up (`task up`); browser specs run via `npx playwright test <spec>`.
- Docker bind-mount caveat: API/web containers mount the **main repo** (`/Users/adampowis/workspace/murals`). If working in a worktree, also apply API/web edits to the main repo so the running container picks them up (see `.claude/rules/e2e-debugging.md`).

---

## File Structure

**Create:**
- `web/src/lib/embeds.ts` — provider parser (`parseEmbed`) + origin allowlist.
- `web/src/lib/embeds.test.ts` — unit tests for `parseEmbed`.
- `web/src/lib/questionLibrary.ts` — curated presets + starter template (static data).
- `web/src/app/organiser/festivals/[id]/form/page.tsx` — route shell.
- `web/src/app/organiser/festivals/[id]/form/FormBuilderClient.tsx` — builder UI.
- `web/src/__tests__/organiser/form-builder.test.tsx` — builder component test.
- `api/internal/festival/embed.go` — Go provider matcher.
- `api/internal/festival/embed_test.go` — Go matcher unit tests.

**Modify:**
- `web/src/components/DynamicForm.tsx` — add `embed` field branch.
- `web/src/__tests__/components/dynamic-form.test.tsx` — add embed test.
- `web/src/components/ApplicationCard.tsx` — embed thumbnail chip.
- `web/src/components/ApplicationSlideOver.tsx` — embed click-to-load player.
- `web/src/app/organiser/festivals/[id]/page.tsx` — link to the form builder.
- `api/internal/festival/form.go` — field-definition validation in `UpsertFormHandler`.
- `api/internal/festival/form_test.go` — validation tests.
- `api/internal/festival/application.go` — embed validation in `SubmitApplicationHandler`.
- `api/internal/festival/application_test.go` — embed validation test.
- `e2e/fixtures/helpers.ts` — extend form/application helpers.
- `e2e/browser/form-builder.spec.ts` (new) — full-flow browser test.
- `api/internal/festival/festival.spec.md` — document new invariants.

---

## Task 1: TS provider parser (`embeds.ts`)

**Files:**
- Create: `web/src/lib/embeds.ts`
- Test: `web/src/lib/embeds.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/embeds.test.ts
import { describe, it, expect } from 'vitest'
import { parseEmbed } from '@/lib/embeds'

describe('parseEmbed', () => {
  it('parses youtube watch / short / embed URLs', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    ]) {
      expect(parseEmbed(url)).toEqual({
        provider: 'youtube',
        embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
        thumbnailUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      })
    }
  })

  it('parses vimeo URLs', () => {
    expect(parseEmbed('https://vimeo.com/123456789')).toEqual({
      provider: 'vimeo',
      embedUrl: 'https://player.vimeo.com/video/123456789',
    })
  })

  it('parses sketchfab URLs', () => {
    expect(parseEmbed('https://sketchfab.com/3d-models/a-cool-model-abc123DEF')).toEqual({
      provider: 'sketchfab',
      embedUrl: 'https://sketchfab.com/models/abc123DEF/embed',
    })
  })

  it('returns null for empty, non-url, and unknown providers', () => {
    expect(parseEmbed('')).toBeNull()
    expect(parseEmbed('   ')).toBeNull()
    expect(parseEmbed('not a url')).toBeNull()
    expect(parseEmbed('https://example.com/video/1')).toBeNull()
    expect(parseEmbed('https://youtube.com')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/embeds.test.ts`
Expected: FAIL — cannot resolve `@/lib/embeds`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/embeds.ts
export type EmbedProvider = 'youtube' | 'vimeo' | 'sketchfab'

export type EmbedInfo = {
  provider: EmbedProvider
  embedUrl: string
  thumbnailUrl?: string
}

// Allowlist of origins we ever set as an iframe src. Never inject a raw user URL.
export const EMBED_ORIGINS = [
  'https://www.youtube.com',
  'https://player.vimeo.com',
  'https://sketchfab.com',
] as const

const RE_YOUTUBE = /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
const RE_VIMEO = /vimeo\.com\/(?:video\/)?(\d+)/
const RE_SKETCHFAB = /sketchfab\.com\/(?:3d-models\/[A-Za-z0-9-]*-|models\/)([A-Za-z0-9]+)/

export function parseEmbed(raw: string): EmbedInfo | null {
  const url = (raw ?? '').trim()
  if (!url) return null

  const yt = url.match(RE_YOUTUBE)
  if (yt) {
    const id = yt[1]
    return {
      provider: 'youtube',
      embedUrl: `https://www.youtube.com/embed/${id}`,
      thumbnailUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    }
  }

  const vimeo = url.match(RE_VIMEO)
  if (vimeo) {
    return { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${vimeo[1]}` }
  }

  const sk = url.match(RE_SKETCHFAB)
  if (sk) {
    return { provider: 'sketchfab', embedUrl: `https://sketchfab.com/models/${sk[1]}/embed` }
  }

  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/embeds.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/embeds.ts web/src/lib/embeds.test.ts
git commit -m "feat(web): embed provider parser (youtube/vimeo/sketchfab)"
```

---

## Task 2: Go provider matcher (`embed.go`)

**Files:**
- Create: `api/internal/festival/embed.go`
- Test: `api/internal/festival/embed_test.go`

- [ ] **Step 1: Write the failing test**

```go
// api/internal/festival/embed_test.go
package festival

import "testing"

func TestEmbedProvider(t *testing.T) {
	cases := map[string]string{
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ":              "youtube",
		"https://youtu.be/dQw4w9WgXcQ":                            "youtube",
		"https://www.youtube.com/embed/dQw4w9WgXcQ":               "youtube",
		"https://vimeo.com/123456789":                             "vimeo",
		"https://sketchfab.com/3d-models/a-cool-model-abc123DEF":  "sketchfab",
		"":                                                        "",
		"not a url":                                               "",
		"https://example.com/video/1":                            "",
		"https://youtube.com":                                     "",
	}
	for in, want := range cases {
		if got := embedProvider(in); got != want {
			t.Errorf("embedProvider(%q) = %q, want %q", in, got, want)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && go test ./internal/festival/ -run TestEmbedProvider`
Expected: FAIL — `undefined: embedProvider`.

- [ ] **Step 3: Write the implementation**

```go
// api/internal/festival/embed.go
package festival

import "regexp"

// Mirror of web/src/lib/embeds.ts parseEmbed provider rules. Keep in sync.
var (
	reYouTube   = regexp.MustCompile(`(?:youtube\.com/(?:watch\?v=|embed/)|youtu\.be/)([A-Za-z0-9_-]{11})`)
	reVimeo     = regexp.MustCompile(`vimeo\.com/(?:video/)?(\d+)`)
	reSketchfab = regexp.MustCompile(`sketchfab\.com/(?:3d-models/[A-Za-z0-9-]*-|models/)([A-Za-z0-9]+)`)
)

// embedProvider returns "youtube", "vimeo", or "sketchfab" for a recognised
// embed URL, or "" if the URL is not a supported provider.
func embedProvider(raw string) string {
	switch {
	case reYouTube.MatchString(raw):
		return "youtube"
	case reVimeo.MatchString(raw):
		return "vimeo"
	case reSketchfab.MatchString(raw):
		return "sketchfab"
	default:
		return ""
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && go test ./internal/festival/ -run TestEmbedProvider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/internal/festival/embed.go api/internal/festival/embed_test.go
git commit -m "feat(api): embed provider matcher (mirror of web parser)"
```

---

## Task 3: DynamicForm `embed` field branch

**Files:**
- Modify: `web/src/components/DynamicForm.tsx`
- Test: `web/src/__tests__/components/dynamic-form.test.tsx`

- [ ] **Step 1: Write the failing test (append to the existing describe block)**

```ts
// add inside describe('DynamicForm', ...) in dynamic-form.test.tsx
import { parseEmbed } from '@/lib/embeds' // add to imports at top if not present

it('renders an embed field, validates the URL, and previews when valid', () => {
  const fields = [{ id: 'walkthrough', type: 'embed' as const, label: 'Walkthrough video' }]
  render(React.createElement(DynamicForm, { fields, onSubmit: vi.fn() }))
  const input = screen.getByLabelText('Walkthrough video')
  fireEvent.change(input, { target: { value: 'not a video' } })
  expect(screen.getByText(/paste a youtube, vimeo or sketchfab/i)).toBeInTheDocument()
  fireEvent.change(input, { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } })
  expect(screen.getByText(/youtube/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/__tests__/components/dynamic-form.test.tsx`
Expected: FAIL — the embed input renders as a plain text box, no validation message.

- [ ] **Step 3: Implement the embed branch**

In `web/src/components/DynamicForm.tsx`:

3a. Update the `FormField` type union (line ~5) to document `embed`:
```ts
export type FormField = {
  id?: string
  type: 'text' | 'textarea' | 'select' | 'embed' | string
  label: string
  required?: boolean
  options?: string[]
}
```

3b. Add the import at the top:
```ts
import { parseEmbed } from '@/lib/embeds'
```

3c. In the field render conditional, add an `embed` branch **before** the final `else` (the plain text input). Insert after the `select` branch closes (after its `)` and before the final `: (`):
```tsx
            ) : field.type === 'embed' ? (
              <div className="flex flex-col gap-1">
                <input
                  id={htmlId}
                  type="url"
                  name={key}
                  required={field.required}
                  value={values[key] ?? ''}
                  onChange={(e) => handleChange(key, e.target.value)}
                  placeholder="https://youtube.com/… or vimeo.com/… or sketchfab.com/…"
                  className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
                />
                {values[key]
                  ? parseEmbed(values[key])
                    ? <span className="font-mono text-xs text-mid uppercase tracking-widest">{parseEmbed(values[key])!.provider} link ✓</span>
                    : <span role="alert" className="font-sans text-xs text-clay">Paste a YouTube, Vimeo or Sketchfab link.</span>
                  : null}
              </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/__tests__/components/dynamic-form.test.tsx`
Expected: PASS (all DynamicForm tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/DynamicForm.tsx web/src/__tests__/components/dynamic-form.test.tsx
git commit -m "feat(web): embed field type in DynamicForm with inline validation"
```

---

## Task 4: Server-side embed validation on submit

**Files:**
- Modify: `api/internal/festival/application.go` (after the required-fields loop, ~line 282)
- Test: `api/internal/festival/application_test.go`

- [ ] **Step 1: Write the failing test**

Add a test that mirrors the existing submit tests in `application_test.go`. (Check the file for the existing helper that creates a festival + form + submits; reuse it. The assertion below is the new behaviour.)

```go
// api/internal/festival/application_test.go — new test
func TestSubmitApplication_RejectsUnknownEmbed(t *testing.T) {
	env := newFestivalTestEnv(t) // existing helper; if named differently, use the file's setup
	fields := `[{"id":"walkthrough","type":"embed","label":"Walkthrough","required":false}]`
	env.upsertForm(t, fields)

	body := `{"answers":{"walkthrough":"https://example.com/not-a-provider"}}`
	res := env.submitApply(t, body) // existing helper performing POST /festivals/{id}/apply
	if res.Code != http.StatusUnprocessableEntity {
		t.Fatalf("got %d, want 422", res.Code)
	}
}
```

> If the test file's helpers differ, adapt names to the existing ones in `application_test.go` (look for how other tests build the form + submit). The behaviour under test is: an `embed` answer that isn't a recognised provider → 422.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && go test ./internal/festival/ -run TestSubmitApplication_RejectsUnknownEmbed`
Expected: FAIL — currently returns 200/whatever the success path is (no embed validation).

- [ ] **Step 3: Implement the validation**

In `api/internal/festival/application.go`, immediately **after** the required-fields `for` loop (after line ~282, before "Get artist profile"):

```go
		// Validate embed fields: a non-empty answer must be a recognised provider URL.
		for _, f := range fields {
			if f.Type == "embed" {
				if v, ok := req.Answers[f.ID]; ok && v != "" && embedProvider(v) == "" {
					httperr.UnprocessableEntity(w, "invalid embed URL for field: "+f.ID)
					return
				}
			}
		}
```

> The `formField` struct (top of `application.go`) already has `ID`, `Type`, `Required`. No struct change needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && go test ./internal/festival/ -run TestSubmitApplication`
Expected: PASS (new test + existing submit tests).

- [ ] **Step 5: Commit**

```bash
git add api/internal/festival/application.go api/internal/festival/application_test.go
git commit -m "feat(api): reject unrecognised embed URLs on application submit"
```

---

## Task 5: Field-definition validation on `UpsertFormHandler`

**Files:**
- Modify: `api/internal/festival/form.go` (`UpsertFormHandler`, after decode ~line 217)
- Test: `api/internal/festival/form_test.go`

- [ ] **Step 1: Write the failing test**

```go
// api/internal/festival/form_test.go — new tests (adapt helper names to the file)
func TestUpsertForm_RejectsMalformedFields(t *testing.T) {
	env := newFestivalTestEnv(t) // existing setup helper in form_test.go

	// missing label
	if code := env.upsertFormRaw(t, `[{"id":"a","type":"text"}]`); code != http.StatusUnprocessableEntity {
		t.Errorf("missing label: got %d want 422", code)
	}
	// unknown type
	if code := env.upsertFormRaw(t, `[{"id":"a","type":"slider","label":"x"}]`); code != http.StatusUnprocessableEntity {
		t.Errorf("unknown type: got %d want 422", code)
	}
	// select with no options
	if code := env.upsertFormRaw(t, `[{"id":"a","type":"select","label":"x"}]`); code != http.StatusUnprocessableEntity {
		t.Errorf("select no options: got %d want 422", code)
	}
	// valid embed field
	if code := env.upsertFormRaw(t, `[{"id":"a","type":"embed","label":"Video"}]`); code != http.StatusOK {
		t.Errorf("valid embed: got %d want 200", code)
	}
}
```

> `upsertFormRaw` = a helper that PATCHes `/festivals/{id}/form` with the given fields JSON and returns the status code. Add it next to the existing form-test helpers if not present, following their pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && go test ./internal/festival/ -run TestUpsertForm_RejectsMalformedFields`
Expected: FAIL — the handler accepts any opaque fields (all return 200).

- [ ] **Step 3: Implement the validation**

In `api/internal/festival/form.go` `UpsertFormHandler`, after the `if req.Fields == nil { req.Fields = json.RawMessage("[]") }` block (~line 217) and before the `UpsertApplicationForm` call:

```go
		// Validate field definitions before persisting.
		var defs []struct {
			ID      string   `json:"id"`
			Type    string   `json:"type"`
			Label   string   `json:"label"`
			Options []string `json:"options"`
		}
		if err := json.Unmarshal(req.Fields, &defs); err != nil {
			httperr.BadRequest(w, "invalid fields")
			return
		}
		validType := map[string]bool{"text": true, "textarea": true, "select": true, "embed": true}
		for _, d := range defs {
			if d.ID == "" || d.Label == "" || !validType[d.Type] {
				httperr.UnprocessableEntity(w, "invalid field definition")
				return
			}
			if d.Type == "select" && len(d.Options) == 0 {
				httperr.UnprocessableEntity(w, "select field needs at least one option")
				return
			}
		}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && go test ./internal/festival/ -run TestUpsertForm`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/internal/festival/form.go api/internal/festival/form_test.go
git commit -m "feat(api): validate form field definitions on upsert"
```

---

## Task 6: Question library + starter template data

**Files:**
- Create: `web/src/lib/questionLibrary.ts`
- Test: `web/src/lib/questionLibrary.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/questionLibrary.test.ts
import { describe, it, expect } from 'vitest'
import { QUESTION_LIBRARY, STARTER_TEMPLATE } from '@/lib/questionLibrary'

describe('questionLibrary', () => {
  it('every preset has a group, type, and label', () => {
    for (const p of QUESTION_LIBRARY) {
      expect(p.group).toBeTruthy()
      expect(['text', 'textarea', 'select', 'embed']).toContain(p.type)
      expect(p.label).toBeTruthy()
      if (p.type === 'select') expect((p.options ?? []).length).toBeGreaterThan(0)
    }
  })

  it('starter template is non-empty and select fields have options', () => {
    expect(STARTER_TEMPLATE.length).toBeGreaterThan(0)
    for (const f of STARTER_TEMPLATE) {
      if (f.type === 'select') expect((f.options ?? []).length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/questionLibrary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/questionLibrary.ts
import type { FormField } from '@/components/DynamicForm'

export type LibraryPreset = Omit<FormField, 'id'> & { group: string }

const WALL_SIZES = ['Small (< 10m²)', 'Medium (10–30m²)', 'Large (> 30m²)']
const YES_NO = ['Yes', 'No']

export const QUESTION_LIBRARY: LibraryPreset[] = [
  { group: 'Logistics', type: 'select', label: 'Preferred wall size', required: false, options: WALL_SIZES },
  { group: 'Logistics', type: 'textarea', label: 'Access or equipment needs', required: false },
  { group: 'Eligibility', type: 'select', label: 'Do you have public liability insurance?', required: true, options: YES_NO },
  { group: 'Eligibility', type: 'text', label: 'Availability (dates you can paint)', required: true },
  { group: 'Portfolio', type: 'text', label: 'Portfolio link', required: true },
  { group: 'Portfolio', type: 'embed', label: 'Video walkthrough or 3D model (optional)', required: false },
]

export const STARTER_TEMPLATE: Omit<FormField, 'id'>[] = [
  { type: 'textarea', label: 'Artist statement', required: true },
  { type: 'text', label: 'Portfolio link', required: true },
  { type: 'select', label: 'Preferred wall size', required: false, options: WALL_SIZES },
  { type: 'select', label: 'Do you have public liability insurance?', required: true, options: YES_NO },
  { type: 'text', label: 'Availability (dates you can paint)', required: true },
  { type: 'embed', label: 'Video walkthrough or 3D model (optional)', required: false },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/questionLibrary.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/questionLibrary.ts web/src/lib/questionLibrary.test.ts
git commit -m "feat(web): curated question library + starter template data"
```

---

## Task 7: Form builder UI + route

**Files:**
- Create: `web/src/app/organiser/festivals/[id]/form/page.tsx`
- Create: `web/src/app/organiser/festivals/[id]/form/FormBuilderClient.tsx`
- Test: `web/src/__tests__/organiser/form-builder.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/__tests__/organiser/form-builder.test.tsx
import { vi, describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import FormBuilderClient from '@/app/organiser/festivals/[id]/form/FormBuilderClient'

// Mock the API client: GET returns an empty form, PATCH captures the body.
const patchBody: { current: unknown } = { current: null }
vi.mock('@/lib/api', () => ({
  apiClient: {
    GET: vi.fn().mockResolvedValue({ data: { fields: [] }, error: null }),
    PATCH: vi.fn().mockImplementation((_path: string, opts: { body: unknown }) => {
      patchBody.current = opts.body
      return Promise.resolve({ data: {}, error: null })
    }),
  },
}))

function renderBuilder() {
  const qc = new QueryClient()
  return render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(FormBuilderClient, { festivalId: 'fest-1' })),
  )
}

describe('FormBuilderClient', () => {
  beforeEach(() => { patchBody.current = null })

  it('shows the starter-template option when the form is empty', async () => {
    renderBuilder()
    expect(await screen.findByText(/start from a template/i)).toBeInTheDocument()
  })

  it('adds a field, edits its label, and saves it via PATCH', async () => {
    renderBuilder()
    fireEvent.click(await screen.findByRole('button', { name: /add field/i }))
    const labelInput = await screen.findByLabelText(/field label/i)
    fireEvent.change(labelInput, { target: { value: 'Why this festival?' } })
    fireEvent.click(screen.getByRole('button', { name: /save form/i }))
    await waitFor(() => expect(patchBody.current).not.toBeNull())
    const fields = (patchBody.current as { fields: Array<{ label: string; id: string }> }).fields
    expect(fields[0].label).toBe('Why this festival?')
    expect(fields[0].id).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/__tests__/organiser/form-builder.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the route shell**

```tsx
// web/src/app/organiser/festivals/[id]/form/page.tsx
import FormBuilderClient from './FormBuilderClient'

export default async function FormBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <FormBuilderClient festivalId={id} />
}
```

- [ ] **Step 4: Write the builder client**

```tsx
// web/src/app/organiser/festivals/[id]/form/FormBuilderClient.tsx
'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import type { FormField } from '@/components/DynamicForm'
import { QUESTION_LIBRARY, STARTER_TEMPLATE } from '@/lib/questionLibrary'

type BuilderField = FormField & { id: string }

const FIELD_TYPES: { value: BuilderField['type']; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Paragraph' },
  { value: 'select', label: 'Dropdown' },
  { value: 'embed', label: 'Media embed' },
]

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `f-${Date.now()}-${Math.random()}`
}

function withId(f: Omit<FormField, 'id'>): BuilderField {
  return { ...f, id: newId() }
}

export default function FormBuilderClient({ festivalId }: { festivalId: string }) {
  const [fields, setFields] = useState<BuilderField[]>([])
  const [showLibrary, setShowLibrary] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const formQuery = useQuery({
    queryKey: ['festival-form', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/form', {
        params: { path: { festivalID: festivalId } },
      })
      return res.data ?? { fields: [] }
    },
  })

  useEffect(() => {
    if (!formQuery.data) return
    const loaded = ((formQuery.data as { fields?: FormField[] }).fields ?? []).map(f => ({
      ...f,
      id: f.id ?? newId(),
    })) as BuilderField[]
    setFields(loaded)
  }, [formQuery.data])

  function update(id: string, patch: Partial<BuilderField>) {
    setFields(prev => prev.map(f => (f.id === id ? { ...f, ...patch } : f)))
  }
  function remove(id: string) {
    setFields(prev => prev.filter(f => f.id !== id))
  }
  function move(id: string, dir: -1 | 1) {
    setFields(prev => {
      const i = prev.findIndex(f => f.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    // Client-side guard mirrors the server: labels required, selects need options.
    for (const f of fields) {
      if (!f.label.trim()) { setSaveError('Every field needs a label.'); setSaving(false); return }
      if (f.type === 'select' && (f.options ?? []).filter(o => o.trim()).length === 0) {
        setSaveError(`"${f.label}" is a dropdown but has no options.`); setSaving(false); return
      }
    }
    const res = await apiClient.PATCH('/festivals/{festivalID}/form', {
      params: { path: { festivalID: festivalId } },
      body: { fields },
    })
    setSaving(false)
    if (res.error) { setSaveError('Could not save the form.'); return }
    setSaved(true)
  }

  return (
    <div>
      <div className="mb-6">
        <Link href={`/organiser/festivals/${festivalId}`}
          className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink transition-colors">
          ← Festival
        </Link>
      </div>

      <h1 className="font-serif text-4xl text-ink mb-2">Application form</h1>
      <p className="font-sans text-sm text-mid mb-6">Build the questions artists answer when they apply.</p>

      {fields.length === 0 && (
        <button
          onClick={() => setFields(STARTER_TEMPLATE.map(withId))}
          className="font-sans text-sm bg-amber text-ink font-medium px-4 py-2 rounded-lg hover:opacity-90 mb-6"
        >
          Start from a template
        </button>
      )}

      <ul className="space-y-3 max-w-2xl" data-testid="builder-fields">
        {fields.map((f, idx) => (
          <li key={f.id} className="p-4 bg-warm border border-light rounded-lg space-y-2">
            <div className="flex gap-2 items-center">
              <select
                aria-label="Field type"
                value={f.type}
                onChange={e => update(f.id, { type: e.target.value as BuilderField['type'] })}
                className="border border-light rounded-lg px-2 py-1.5 font-sans text-sm bg-offwhite"
              >
                {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <input
                aria-label="Field label"
                value={f.label}
                onChange={e => update(f.id, { label: e.target.value })}
                placeholder="Question label"
                className="flex-1 border border-light rounded-lg px-3 py-1.5 font-sans text-sm bg-offwhite"
              />
              <label className="font-sans text-xs text-mid flex items-center gap-1">
                <input type="checkbox" className="accent-amber" checked={f.required ?? false}
                  onChange={e => update(f.id, { required: e.target.checked })} />
                Required
              </label>
              <button aria-label="Move up" onClick={() => move(f.id, -1)} disabled={idx === 0}
                className="text-mid hover:text-ink disabled:opacity-30">▲</button>
              <button aria-label="Move down" onClick={() => move(f.id, 1)} disabled={idx === fields.length - 1}
                className="text-mid hover:text-ink disabled:opacity-30">▼</button>
              <button aria-label="Delete field" onClick={() => remove(f.id)}
                className="text-clay hover:opacity-80">✕</button>
            </div>

            {f.type === 'select' && (
              <input
                aria-label="Dropdown options"
                value={(f.options ?? []).join(', ')}
                onChange={e => update(f.id, { options: e.target.value.split(',').map(o => o.trim()).filter(Boolean) })}
                placeholder="Comma-separated options (e.g. Small, Medium, Large)"
                className="w-full border border-light rounded-lg px-3 py-1.5 font-sans text-sm bg-offwhite"
              />
            )}
          </li>
        ))}
      </ul>

      <div className="flex gap-3 items-center mt-4 max-w-2xl">
        <button onClick={() => setFields(prev => [...prev, withId({ type: 'text', label: '' })])}
          className="font-sans text-sm border border-light rounded-lg px-4 py-2 hover:border-amber">
          + Add field
        </button>
        <button onClick={() => setShowLibrary(v => !v)}
          className="font-sans text-sm border border-light rounded-lg px-4 py-2 hover:border-amber">
          Add from library
        </button>
        <div className="flex-1" />
        <button onClick={handleSave} disabled={saving}
          className="font-sans text-sm bg-amber text-ink font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save form'}
        </button>
      </div>
      {saveError && <p role="alert" className="font-sans text-sm text-clay mt-2">{saveError}</p>}
      {saved && <p className="font-sans text-sm text-mid mt-2">Saved ✓</p>}

      {showLibrary && (
        <div className="mt-6 p-4 bg-offwhite border border-light rounded-lg max-w-2xl" data-testid="library-panel">
          <h2 className="font-mono text-xs text-mid uppercase tracking-widest mb-3">Question library</h2>
          {Array.from(new Set(QUESTION_LIBRARY.map(p => p.group))).map(group => (
            <div key={group} className="mb-3">
              <p className="font-sans text-xs text-mid mb-1">{group}</p>
              <div className="flex flex-wrap gap-2">
                {QUESTION_LIBRARY.filter(p => p.group === group).map(p => (
                  <button key={p.label}
                    onClick={() => setFields(prev => [...prev, withId({ type: p.type, label: p.label, required: p.required, options: p.options })])}
                    className="font-sans text-xs border border-light rounded-full px-3 py-1 hover:border-amber">
                    + {p.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/__tests__/organiser/form-builder.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Lint check (App Router + hooks)**

Run: `cd web && npx eslint src/app/organiser/festivals/\[id\]/form/ src/lib/embeds.ts src/lib/questionLibrary.ts`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add "web/src/app/organiser/festivals/[id]/form" web/src/__tests__/organiser/form-builder.test.tsx
git commit -m "feat(web): application form builder with question library + starter template"
```

---

## Task 8: Link to the builder from the festival page

**Files:**
- Modify: `web/src/app/organiser/festivals/[id]/page.tsx`

- [ ] **Step 1: Locate the festival actions/links area**

Read `web/src/app/organiser/festivals/[id]/page.tsx` and find where the festival links to its map editor (search for `/map`). Add an adjacent link to the form builder.

- [ ] **Step 2: Add the link**

Near the existing map-editor link, add:
```tsx
<Link
  href={`/organiser/festivals/${festivalId}/form`}
  className="font-sans text-sm border border-light rounded-lg px-4 py-2 hover:border-amber inline-block"
>
  Edit application form
</Link>
```
(Match the exact className/markup style of the neighbouring link you find.)

- [ ] **Step 3: Verify it renders**

Run: `cd web && npx vitest run src/__tests__/organiser/festival-detail-reviewers.test.tsx`
Expected: PASS (existing detail-page test still green). If the test asserts specific link counts, update it to include the new link.

- [ ] **Step 4: Commit**

```bash
git add "web/src/app/organiser/festivals/[id]/page.tsx"
git commit -m "feat(web): link festival page to application form builder"
```

---

## Task 9: Embed thumbnail on the review board card

**Files:**
- Modify: `web/src/components/ApplicationCard.tsx`

- [ ] **Step 1: Read the card + identify the answers area**

Read `web/src/components/ApplicationCard.tsx`. It receives `application` (with `answers`) and `formFields`. Confirm whether it currently renders answers; if it does not, we add a compact "has media" indicator derived from embed answers. (The full player lives in the slide-over — Task 10.)

- [ ] **Step 2: Add a media indicator**

Add the import:
```ts
import { parseEmbed } from '@/lib/embeds'
```

Compute, inside the component (after `application` is in scope):
```ts
const answers = (application.answers ?? {}) as Record<string, string>
const embedFieldIds = (formFields ?? []).filter(f => f.type === 'embed').map(f => f.id)
const firstEmbed = embedFieldIds.map(id => answers[id]).map(v => v && parseEmbed(v)).find(Boolean) || null
```

Render a chip near the card footer (match existing chip styling in the file):
```tsx
{firstEmbed && (
  <span data-testid="embed-chip" className="font-mono text-[10px] uppercase tracking-widest bg-warm border border-light rounded px-1.5 py-0.5 text-mid">
    {firstEmbed.provider === 'sketchfab' ? '◆ 3D' : '▶ Video'}
  </span>
)}
```

> If `formFields` is not currently a prop of `ApplicationCard`, check the call site in `applications/page.tsx`; the board already loads the form (`formQuery`). Pass `formFields={formFields}` to the card. Keep this minimal — if threading the prop is large, render the chip purely from `answers` by attempting `parseEmbed` on every answer value instead.

- [ ] **Step 3: Verify**

Run: `cd web && npx vitest run src/__tests__/organiser/applications-page.test.tsx`
Expected: PASS (existing board test still green).

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ApplicationCard.tsx web/src/app/organiser/festivals/\[id\]/applications/page.tsx
git commit -m "feat(web): media indicator chip on application board cards"
```

---

## Task 10: Embed player in the application slide-over

**Files:**
- Modify: `web/src/components/ApplicationSlideOver.tsx` (answers loop ~line 249)

- [ ] **Step 1: Add the import + a click-to-load sub-component**

Add to imports:
```ts
import { useState } from 'react' // if not already imported
import { parseEmbed } from '@/lib/embeds'
```

Add a small component at module scope (above the default export):
```tsx
function EmbedPlayer({ url }: { url: string }) {
  const [loaded, setLoaded] = useState(false)
  const info = parseEmbed(url)
  if (!info) {
    return <a href={url} target="_blank" rel="noreferrer" className="font-sans text-sm text-clay underline">{url}</a>
  }
  if (!loaded) {
    return (
      <button onClick={() => setLoaded(true)}
        className="font-sans text-sm bg-warm border border-light rounded-lg px-3 py-2 hover:border-amber">
        ▶ Load {info.provider} {info.provider === 'sketchfab' ? '3D model' : 'video'}
      </button>
    )
  }
  return (
    <div className="aspect-video w-full">
      <iframe
        src={info.embedUrl}
        title={`${info.provider} embed`}
        className="w-full h-full rounded-lg border border-light"
        sandbox="allow-scripts allow-same-origin allow-presentation"
        allow="fullscreen"
      />
    </div>
  )
}
```

- [ ] **Step 2: Render embeds in the answers loop**

In the answers map (~line 249), change the value rendering to special-case embed fields. Replace:
```tsx
{Object.entries(answers).map(([fieldId, value]) => (
  <div key={fieldId}>
    <p className="font-sans text-xs text-mid mb-1">{labelFor(fieldId)}</p>
    <p className="font-sans text-sm text-ink">{value}</p>
  </div>
))}
```
with:
```tsx
{Object.entries(answers).map(([fieldId, value]) => {
  const field = formFields.find(f => f.id === fieldId)
  return (
    <div key={fieldId}>
      <p className="font-sans text-xs text-mid mb-1">{labelFor(fieldId)}</p>
      {field?.type === 'embed' && value
        ? <EmbedPlayer url={value} />
        : <p className="font-sans text-sm text-ink">{value}</p>}
    </div>
  )
})}
```

> Confirm `formFields` is in scope in the slide-over (it has `labelFor` which uses `formFields`, so it is).

- [ ] **Step 3: Verify**

Run: `cd web && npx vitest run src/__tests__/organiser/applications-page.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ApplicationSlideOver.tsx
git commit -m "feat(web): click-to-load sandboxed embed player in application slide-over"
```

---

## Task 11: E2E browser flow + helper updates

**Files:**
- Modify: `e2e/fixtures/helpers.ts`
- Create: `e2e/browser/form-builder.spec.ts`

- [ ] **Step 1: Extend the form helper to accept custom fields**

In `e2e/fixtures/helpers.ts`, generalise `upsertForm` (currently hardcodes one text field) to accept fields:
```ts
export async function upsertForm(
  token: string,
  festivalId: string,
  fields: Array<Record<string, unknown>> = [{ id: 'artist-statement', type: 'text', label: 'Artist statement', required: true }],
): Promise<void> {
  const res = await fetch(`${API}/festivals/${festivalId}/form`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) throw new Error(`Upsert form failed: ${res.status}`)
}
```
> Existing callers pass no third arg, so the default keeps them working.

- [ ] **Step 2: Write the browser spec**

```ts
// e2e/browser/form-builder.spec.ts
import { test, expect } from '@playwright/test'
import { createOrganiser, createFestival, loginAs } from '../fixtures/helpers'

test('organiser builds a form with an embed question; artist submits a YouTube link', async ({ browser }) => {
  const suffix = Date.now()
  const org = await createOrganiser(suffix)
  const { festivalId } = await createFestival(org.token, suffix)

  const page = await loginAs(browser, org.email, org.password, 'http://localhost:3000')
  await page.goto(`http://localhost:3000/organiser/festivals/${festivalId}/form`)

  // Load starter template, then add a library embed question, then save.
  await page.getByRole('button', { name: /start from a template/i }).click()
  await page.getByRole('button', { name: /add from library/i }).click()
  await page.getByTestId('library-panel').getByRole('button', { name: /walkthrough or 3D/i }).first().click()
  await page.getByRole('button', { name: /save form/i }).click()
  await expect(page.getByText('Saved ✓')).toBeVisible()

  // Reload — fields persisted.
  await page.reload()
  await expect(page.getByTestId('builder-fields').getByText(/Artist statement/i)).toBeVisible()
})
```
> Use whatever `createFestival` / `createOrganiser` / `loginAs` signatures exist in `helpers.ts`; adjust the calls to match. If `createFestival` requires the festival to be in a particular status to expose the form route, set it via the existing helper.

- [ ] **Step 3: Run the spec (stack must be up)**

Run: `task up` (if not running), then `npx playwright test e2e/browser/form-builder.spec.ts`
Expected: PASS. If a selector is ambiguous, read `test-results/*/error-context.md` (ARIA snapshot) before adjusting.

- [ ] **Step 4: Run the API gate to confirm no regressions**

Run: `npx vitest run e2e/api/golden-path.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add e2e/fixtures/helpers.ts e2e/browser/form-builder.spec.ts
git commit -m "test(e2e): form builder flow + embed field; generalise upsertForm helper"
```

---

## Task 12: Update the festival spec

**Files:**
- Modify: `api/internal/festival/festival.spec.md`

- [ ] **Step 1: Add the new invariants**

In `festival.spec.md`, under **Invariants** (and **Contract** where form/submit are described), add:
- `UpsertFormHandler` rejects (`422`) any field definition missing `id` or `label`, with an unknown `type` (not one of text/textarea/select/embed), or a `select` with no `options`.
- `SubmitApplicationHandler` rejects (`422`) an `embed` field whose non-empty answer is not a recognised provider URL (YouTube/Vimeo/Sketchfab). Provider rules live in `embed.go`, mirrored by `web/src/lib/embeds.ts`.

- [ ] **Step 2: Add a Changelog line**

```
YYYY-MM-DD — embed field type + form-field-definition validation (form builder A+C)
```
(Use today's date.)

- [ ] **Step 3: Commit**

```bash
git add api/internal/festival/festival.spec.md
git commit -m "docs(festival): spec embed validation + form field-definition rules"
```

---

## Final verification

- [ ] `cd web && npx vitest run` — all web unit tests pass.
- [ ] `task api:test` — all Go tests pass.
- [ ] `task lint` — clean.
- [ ] Stack up; `npx playwright test e2e/browser/form-builder.spec.ts` and `npx vitest run e2e/api/golden-path.test.ts` — pass.
- [ ] Manual smoke: as organiser, open `/organiser/festivals/<id>/form`, load template, add an embed question, save; as artist, apply with a YouTube URL; as organiser, see the chip on the board and the click-to-load player in the slide-over.

---

## Self-Review notes (author)

- **Spec coverage:** embed field (Tasks 1–4, 9, 10), builder UI + reorder + options (7), library + template (6, 7), server validation both sides (4, 5), no-migration (confirmed — opaque jsonb), security/sandbox (10), stable ids (7 `newId`/`withId`), boundaries respected (no file-upload, no oEmbed). ✓
- **Cross-task type consistency:** `EmbedInfo`/`parseEmbed` (Task 1) used identically in 3, 9, 10; `embedProvider` (Task 2) used in 4; `FormField` union extended in Task 3 and consumed by 6/7; `BuilderField = FormField & { id: string }` consistent in Task 7. ✓
- **Known adaptation points (call out during execution):** exact helper names in `application_test.go` / `form_test.go`; whether `ApplicationCard` already receives `formFields`; exact `createFestival`/`loginAs` signatures in `helpers.ts`. Each task flags the fallback.
