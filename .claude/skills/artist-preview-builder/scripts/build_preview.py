#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
Build an artist preview page + seed-ready JSON from a single intake data file.

Two outputs, written next to --out:
  preview.html  — unlisted, noindex, brand-styled page you send to the artist
  seed.json     — DB-shaped data (artist_profiles / collections / collection_images)
                  so a "yes" converts into a real account in one step.

Images are downloaded into <out>/images/ by default so the bundle is portable
(you can host or zip it and nothing breaks if the source goes down). Use
--no-download to keep remote URLs instead.

Usage:
  uv run build_preview.py --data artist.json --out ./previews/lady-gabe
  uv run build_preview.py --data artist.json --out ./previews/lady-gabe --no-download

The data file shape is documented in references/intake-checklist.md and there is
a filled example in assets/example-data.json.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import mimetypes
import sys
import urllib.request
from pathlib import Path

# --- Brand tokens (mirrors the design system in CLAUDE.md) ---------------------
TOKENS = {
    "ink": "#1A1A2E",
    "amber": "#E8A838",
    "clay": "#C45C3A",
    "offwhite": "#FAF7F2",
    "warm": "#F0EAE0",
    "mid": "#8A8896",
    "light": "#E2DDD6",
}

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"


def esc(s: str | None) -> str:
    return html.escape(s or "", quote=True)


def download_image(url: str, dest_dir: Path) -> str | None:
    """Download url into dest_dir, return a relative path, or None on failure."""
    if not url or url.startswith(("images/", "./images/")):
        return url  # already local
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = resp.read()
            ctype = resp.headers.get("Content-Type", "")
        ext = mimetypes.guess_extension((ctype or "").split(";")[0].strip()) or Path(url.split("?")[0]).suffix or ".jpg"
        if ext == ".jpe":
            ext = ".jpg"
        name = hashlib.sha1(url.encode()).hexdigest()[:16] + ext
        dest_dir.mkdir(parents=True, exist_ok=True)
        (dest_dir / name).write_bytes(data)
        return f"images/{name}"
    except Exception as e:  # noqa: BLE001 - best effort, fall back to remote URL
        print(f"  ! could not download {url} ({e}); keeping remote URL", file=sys.stderr)
        return url


def resolve_image(url: str | None, out: Path, download: bool) -> str | None:
    if not url:
        return None
    if download:
        return download_image(url, out / "images")
    return url


def render_html(d: dict, out: Path, download: bool) -> str:
    a = d.get("artist", {})
    name = a.get("name", "Untitled Artist")
    tagline = a.get("tagline", "")
    location = a.get("location", "")
    bio = a.get("bio", "")
    socials = a.get("socials", {}) or {}
    tags = a.get("medium_tags", []) or []
    stats = a.get("stats", []) or []

    hero = resolve_image(a.get("hero_image"), out, download)
    avatar = resolve_image(a.get("avatar"), out, download)

    # Collections + their images
    collection_html = []
    for c in d.get("collections", []) or []:
        imgs = []
        for img in c.get("images", []) or []:
            src = resolve_image(img if isinstance(img, str) else img.get("url"), out, download)
            if src:
                imgs.append(f'<figure class="tile"><img loading="lazy" src="{esc(src)}" alt="{esc(name)} — {esc(c.get("name",""))}"></figure>')
        if not imgs:
            continue
        collection_html.append(
            f"""    <section class="collection">
      <div class="collection-head">
        <h2>{esc(c.get('name',''))}</h2>
        {f'<p>{esc(c.get("description",""))}</p>' if c.get('description') else ''}
      </div>
      <div class="grid">
{chr(10).join('        ' + i for i in imgs)}
      </div>
    </section>"""
        )

    social_links = []
    label_map = {"instagram": "Instagram", "website": "Website", "behance": "Behance",
                 "tiktok": "TikTok", "twitter": "X", "facebook": "Facebook", "email": "Email"}
    for key, url in socials.items():
        if not url:
            continue
        href = f"mailto:{url}" if key == "email" and "@" in url and not url.startswith("http") else url
        social_links.append(f'<a href="{esc(href)}" target="_blank" rel="noopener">{esc(label_map.get(key, key.title()))}</a>')

    stat_html = "".join(
        f'<div class="stat"><span class="num">{esc(str(s.get("value","")))}</span><span class="lbl">{esc(s.get("label",""))}</span></div>'
        for s in stats
    )
    tag_html = "".join(f'<span class="chip">{esc(t)}</span>' for t in tags)

    hero_style = f'style="background-image:linear-gradient(180deg, rgba(26,26,46,.15), rgba(26,26,46,.78)), url(\'{esc(hero)}\')"' if hero else ""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>{esc(name)} · a preview from Render</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=DM+Sans:wght@400;500;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {{
  --ink:{TOKENS['ink']}; --amber:{TOKENS['amber']}; --clay:{TOKENS['clay']};
  --offwhite:{TOKENS['offwhite']}; --warm:{TOKENS['warm']}; --mid:{TOKENS['mid']}; --light:{TOKENS['light']};
}}
* {{ box-sizing:border-box; margin:0; padding:0; }}
body {{ font-family:'DM Sans',system-ui,sans-serif; color:var(--ink); background:var(--offwhite); line-height:1.6; }}
img {{ display:block; width:100%; height:100%; object-fit:cover; }}
a {{ color:inherit; }}
.banner {{ background:var(--ink); color:var(--offwhite); text-align:center; font-family:'DM Mono',monospace;
  font-size:12px; letter-spacing:.12em; text-transform:uppercase; padding:10px 16px; }}
.banner b {{ color:var(--amber); font-weight:500; }}
.hero {{ position:relative; min-height:62vh; display:flex; align-items:flex-end; background:var(--ink);
  background-size:cover; background-position:center; color:var(--offwhite); padding:48px 32px; }}
.hero-inner {{ max-width:1100px; margin:0 auto; width:100%; }}
.hero .eyebrow {{ font-family:'DM Mono',monospace; font-size:12px; letter-spacing:.16em; text-transform:uppercase;
  color:var(--amber); margin-bottom:12px; }}
.hero h1 {{ font-family:'Cormorant Garamond',serif; font-weight:600; font-size:clamp(48px,8vw,92px); line-height:1; }}
.hero .tagline {{ font-size:clamp(16px,2.2vw,22px); margin-top:14px; max-width:640px; color:rgba(250,247,242,.9); }}
.hero .meta {{ display:flex; gap:20px; flex-wrap:wrap; margin-top:22px; font-size:14px; align-items:center; }}
.hero .meta .loc {{ font-family:'DM Mono',monospace; letter-spacing:.06em; text-transform:uppercase; font-size:12px;
  color:rgba(250,247,242,.75); }}
.hero .socials {{ display:flex; gap:16px; }}
.hero .socials a {{ color:var(--offwhite); text-decoration:none; border-bottom:1px solid var(--amber); padding-bottom:1px; }}
.stats {{ display:flex; gap:48px; flex-wrap:wrap; max-width:1100px; margin:0 auto; padding:40px 32px 8px; }}
.stat {{ display:flex; flex-direction:column; }}
.stat .num {{ font-family:'Cormorant Garamond',serif; font-size:48px; font-weight:600; line-height:1; color:var(--clay); }}
.stat .lbl {{ font-family:'DM Mono',monospace; font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--mid); margin-top:6px; }}
.bio {{ max-width:760px; margin:0 auto; padding:40px 32px; }}
.bio .chips {{ display:flex; gap:8px; flex-wrap:wrap; margin-bottom:24px; }}
.chip {{ font-family:'DM Mono',monospace; font-size:11px; letter-spacing:.08em; text-transform:uppercase;
  background:var(--warm); color:var(--ink); padding:6px 12px; border-radius:999px; }}
.bio p {{ font-family:'Cormorant Garamond',serif; font-size:22px; line-height:1.55; color:var(--ink); }}
.collection {{ max-width:1100px; margin:0 auto; padding:32px; }}
.collection-head h2 {{ font-family:'Cormorant Garamond',serif; font-weight:600; font-size:34px; }}
.collection-head p {{ color:var(--mid); max-width:560px; margin-top:6px; }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fill, minmax(260px,1fr)); gap:14px; margin-top:20px; }}
.tile {{ aspect-ratio:4/5; overflow:hidden; border-radius:4px; background:var(--warm); }}
.tile img {{ transition:transform .5s ease; }}
.tile:hover img {{ transform:scale(1.04); }}
.cta {{ background:var(--ink); color:var(--offwhite); text-align:center; padding:72px 32px; margin-top:24px; }}
.cta .eyebrow {{ font-family:'DM Mono',monospace; font-size:12px; letter-spacing:.16em; text-transform:uppercase; color:var(--amber); }}
.cta h2 {{ font-family:'Cormorant Garamond',serif; font-weight:600; font-size:clamp(32px,5vw,52px); margin:14px auto; max-width:720px; }}
.cta p {{ color:rgba(250,247,242,.8); max-width:540px; margin:0 auto 28px; }}
.cta .btn {{ display:inline-block; background:var(--amber); color:var(--ink); font-weight:700; text-decoration:none;
  padding:16px 34px; border-radius:6px; font-size:15px; }}
footer {{ text-align:center; padding:36px; color:var(--mid); font-family:'DM Mono',monospace; font-size:12px; letter-spacing:.1em; text-transform:uppercase; }}
@media (max-width:640px) {{ .hero {{ padding:32px 20px; }} .stats,.bio,.collection {{ padding-left:20px; padding-right:20px; }} .stats {{ gap:28px; }} }}
</style>
</head>
<body>
  <div class="banner">A private preview built for <b>{esc(name)}</b> · not yet public</div>
  <header class="hero" {hero_style}>
    <div class="hero-inner">
      <div class="eyebrow">Render · Artist Profile</div>
      <h1>{esc(name)}</h1>
      {f'<p class="tagline">{esc(tagline)}</p>' if tagline else ''}
      <div class="meta">
        {f'<span class="loc">{esc(location)}</span>' if location else ''}
        {f'<span class="socials">{"".join(social_links)}</span>' if social_links else ''}
      </div>
    </div>
  </header>
  {f'<section class="stats">{stat_html}</section>' if stat_html else ''}
  {f'''<section class="bio">
    {f'<div class="chips">{tag_html}</div>' if tag_html else ''}
    {''.join(f'<p>{esc(par)}</p>' for par in bio.split(chr(10)) if par.strip())}
  </section>''' if bio or tag_html else ''}
{chr(10).join(collection_html)}
  <section class="cta">
    <div class="eyebrow">This is a preview — your page isn't live yet</div>
    <h2>This is what your Render profile could look like.</h2>
    <p>We built this for you from your existing work. Claim it to make it public, get your branded QR code, and start appearing in festival maps.</p>
    <a class="btn" href="{esc(d.get('claim_url','#'))}">Claim my page</a>
  </section>
  <footer>Render · the home for mural artists</footer>
</body>
</html>
"""


def build_seed(d: dict) -> dict:
    """DB-shaped JSON mirroring artist_profiles / collections / collection_images.

    Image URLs are kept as source_url — conversion to a real account must
    download each and run them through the /images/presign upload flow to get
    an s3_key + cdn_url. This file is the bridge, not the final DB rows.
    """
    a = d.get("artist", {})
    socials = {k: v for k, v in (a.get("socials", {}) or {}).items() if v}
    collections = []
    for i, c in enumerate(d.get("collections", []) or []):
        images = []
        for j, img in enumerate(c.get("images", []) or []):
            url = img if isinstance(img, str) else img.get("url")
            if url:
                images.append({"source_url": url, "display_order": j})
        collections.append({
            "name": c.get("name", ""),
            "description": c.get("description", ""),
            "status": "active",
            "display_order": i,
            "images": images,
        })
    return {
        "_note": "Prospect preview data. source_url images must be re-uploaded via /images/presign on claim.",
        "artist_profile": {
            "display_name": a.get("name", ""),
            "bio": a.get("bio", ""),
            "location_label": a.get("location") or None,
            "show_location": bool(a.get("location")),
            "medium_tags": a.get("medium_tags", []) or [],
            "social_links": socials,
            "avatar_source_url": a.get("avatar"),
        },
        "collections": collections,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Build an artist preview page + seed JSON.")
    ap.add_argument("--data", required=True, help="Path to the intake data JSON.")
    ap.add_argument("--out", required=True, help="Output directory (created if missing).")
    ap.add_argument("--no-download", action="store_true", help="Keep remote image URLs instead of downloading.")
    args = ap.parse_args()

    data = json.loads(Path(args.data).read_text())
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    download = not args.no_download

    if download:
        print("Downloading images into", out / "images", "...", file=sys.stderr)
    html_doc = render_html(data, out, download)
    (out / "preview.html").write_text(html_doc)
    (out / "seed.json").write_text(json.dumps(build_seed(data), indent=2))

    name = data.get("artist", {}).get("name", "artist")
    ncoll = len(data.get("collections", []) or [])
    nimg = sum(len(c.get("images", []) or []) for c in data.get("collections", []) or [])
    print(f"\n✓ Built preview for {name}: {ncoll} collections, {nimg} images")
    print(f"  page : {out / 'preview.html'}")
    print(f"  seed : {out / 'seed.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
