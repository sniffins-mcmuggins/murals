# Intake checklist — what to gather and where to find it

Use this to drive the conversation with the operator. For each field: what it is, where it usually
lives, and how much it matters. Gather the **minimum** first (marked ★), build a draft, then enrich.

## Artist-level fields

| Field | ★ | Where to find it | Notes |
|---|---|---|---|
| `name` | ★ | Obvious | Display name as they brand themselves (often a handle, e.g. "Lady Gabe"). |
| `tagline` | ★ | Their bio's first line / how they describe themselves | One line: what they make + where. "Muralist & illustrator, Cheltenham." |
| `bio` | ★ | Portfolio "About" page, Instagram bio, interviews | Raw material — you will rewrite in Render's voice. Grab a paragraph or two. |
| `location` |  | Bio, "based in…", studio address | City/region. Drives `show_location` in the seed. |
| `hero_image` | ★ | Their single best mural/piece, ideally high-res | Full-bleed background. Pick the most striking, landscape if possible. Portfolio > Instagram for resolution. |
| `avatar` |  | Headshot or logo | Optional; can be skipped. |
| `medium_tags` |  | Inferred from the work | e.g. `["mural", "illustration", "spray paint"]`. 3–6 short tags. |
| `socials` | ★ | Linktree / link-in-bio / site footer | At least the one you'll point them at. Keys: `instagram`, `website`, `behance`, `tiktok`, `twitter`, `facebook`, `email`. |
| `stats` |  | Counted from their work / press | Optional punchy numbers: `[{"label":"Murals","value":"40+"},{"label":"Festivals","value":"6"}]`. Only include if true. |

## Collections

Group their work the way they would — by series, medium, or location. Each collection needs a name and
3+ image URLs; a one-line description is a bonus.

| Field | Where | Notes |
|---|---|---|
| `name` | You decide from the work | "Street Murals", "Studio Work", "Commissions", "[Festival] 2025". |
| `description` | Optional | One line of context. |
| `images` | Portfolio galleries, Behance projects, press | **High-res URLs.** Order strongest-first. Portfolio/Behance beat Instagram for quality. |

## Where to look, in priority order

1. **Personal portfolio / website** — best image quality, real bio, often a press list. WebFetch it.
2. **Behance / ArtStation** — clean project galleries, high-res, fetch well.
3. **Linktree / link-in-bio** — the index of everywhere else they are.
4. **Press / festival pages** — for stats, notable walls, context.
5. **Instagram** — last resort for *images* (compressed, login-walled). Fine for reading their bio/voice
   and confirming the handle.

## The data file shape

```json
{
  "artist": {
    "name": "Lady Gabe",
    "tagline": "Muralist & illustrator, Cheltenham",
    "location": "Cheltenham, UK",
    "bio": "Two or three short paragraphs.\nNewlines separate paragraphs.",
    "medium_tags": ["mural", "illustration", "spray paint"],
    "socials": { "instagram": "https://instagram.com/...", "website": "https://..." },
    "hero_image": "https://.../best-piece.jpg",
    "avatar": "https://.../headshot.jpg",
    "stats": [
      { "label": "Murals", "value": "40+" },
      { "label": "Festivals", "value": "6" }
    ]
  },
  "collections": [
    {
      "name": "Street Murals",
      "description": "Large-scale exterior work across the South West.",
      "images": ["https://.../mural-1.jpg", "https://.../mural-2.jpg", "https://.../mural-3.jpg"]
    }
  ],
  "claim_url": "https://render.app/claim?ref=ladygabe"
}
```

- `bio` paragraphs are split on newlines (`\n`).
- `images` entries can be a plain URL string, or `{"url": "...", }`.
- `claim_url` is where "Claim my page" points. Leave as `#` and flag if unknown.
- Everything except `name` is optional to the script, but see the ★ rows for what makes a page land.
