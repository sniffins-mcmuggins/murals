#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
Harvest candidate image URLs from an artist's own public website.

WebFetch is great for *reading* a page (bio, voice) but unreliable for pulling every image — it
summarises rather than listing raw <img> URLs, and misses lazy-loaded / CSS-background images. This
script parses the raw HTML instead and returns absolute, de-duplicated, ranked image URLs you can pick
from into the intake data file.

Sources parsed: <img src/srcset/data-src/data-srcset>, <source srcset>, <link rel=preload as=image>,
<meta og:image / twitter:image>, inline style="background-image:url(...)", and <style> blocks.
Logos, icons, sprites, favicons and obvious thumbnails are filtered out. SVGs and data: URIs dropped.

Only use this on a site the operator has provided (the artist's own portfolio). It is not a social
scraper — it just reads a public web page the way a browser would.

Usage:
  uv run fetch_site_images.py https://ladygabe.com
  uv run fetch_site_images.py https://ladygabe.com --crawl --max-pages 8
  uv run fetch_site_images.py https://ladygabe.com --probe          # fetch real sizes, rank by bytes
  uv run fetch_site_images.py https://ladygabe.com --json out.json   # machine-readable output

Output: a ranked list to stdout (and JSON to --json if given). Hand the best URLs to build_preview.py
via the intake data file.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urldefrag, urljoin, urlparse

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

IMG_EXT = (".jpg", ".jpeg", ".png", ".webp", ".avif")
# Substrings that mark an asset as site chrome rather than artwork.
JUNK = re.compile(r"(favicon|sprite|icon|logo|avatar|placeholder|loading|spinner|pixel|tracking|"
                  r"thumb|thumbnail|-150x|-300x|/icons?/|/logos?/|emoji|badge|button)", re.I)
BG_URL = re.compile(r"background(?:-image)?\s*:\s*[^;]*url\((['\"]?)(.*?)\1\)", re.I)
SIZE_HINT = re.compile(r"(\d{3,4})x(\d{3,4})")
WIDTH_QUERY = re.compile(r"[?&](?:w|width)=(\d{2,5})", re.I)
GALLERY_HINT = re.compile(r"(work|portfolio|galler|mural|project|art|paint|commission|shop|print)", re.I)


def fetch(url: str) -> tuple[str, str]:
    """Return (html_text, final_url). Raises on failure."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*"})
    with urllib.request.urlopen(req, timeout=25) as resp:
        final = resp.geturl()
        raw = resp.read()
        charset = resp.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace"), final


def guess_width(url: str) -> int:
    """Cheap width estimate from the URL itself (e.g. '-1920x1080' or '?w=1600')."""
    m = SIZE_HINT.search(url)
    if m:
        return int(m.group(1))
    m = WIDTH_QUERY.search(url)
    if m:
        return int(m.group(1))
    return 0


def same_domain(a: str, b: str) -> bool:
    return urlparse(a).netloc.replace("www.", "") == urlparse(b).netloc.replace("www.", "")


class Harvester(HTMLParser):
    def __init__(self, base: str):
        super().__init__(convert_charrefs=True)
        self.base = base
        self.images: dict[str, int] = {}   # absolute url -> width hint
        self.links: set[str] = set()       # same-domain gallery page links (for crawl)
        self._in_style = False

    def _add(self, raw: str | None, width: int = 0) -> None:
        if not raw:
            return
        raw = raw.strip()
        if not raw or raw.startswith("data:"):
            return
        absu = urldefrag(urljoin(self.base, raw))[0]
        low = absu.lower()
        if low.endswith(".svg") or JUNK.search(absu):
            return
        path = urlparse(low).path
        has_ext = path.endswith(IMG_EXT)
        # Keep extension-less URLs only if they carry a width hint or look like a CDN image path.
        if not has_ext and width == 0 and not any(k in low for k in ("image", "/img", "media", "photo")):
            return
        self.images[absu] = max(self.images.get(absu, 0), width or guess_width(absu))

    def _add_srcset(self, srcset: str) -> None:
        best_url, best_w = None, 0
        for part in srcset.split(","):
            bits = part.strip().split()
            if not bits:
                continue
            w = 0
            if len(bits) > 1 and bits[1].endswith("w") and bits[1][:-1].isdigit():
                w = int(bits[1][:-1])
            if w >= best_w:
                best_url, best_w = bits[0], w
        if best_url:
            self._add(best_url, best_w)

    def handle_starttag(self, tag, attrs_list):
        if tag == "style":
            self._in_style = True
        attrs = {k: (v or "") for k, v in attrs_list}
        if tag == "img":
            self._add(attrs.get("src"))
            self._add(attrs.get("data-src"))
            self._add(attrs.get("data-lazy-src"))
            for ss in (attrs.get("srcset"), attrs.get("data-srcset")):
                if ss:
                    self._add_srcset(ss)
        elif tag == "source" and attrs.get("srcset"):
            self._add_srcset(attrs["srcset"])
        elif tag == "link" and "image" in attrs.get("as", "") and attrs.get("href"):
            self._add(attrs["href"])
        elif tag == "meta":
            prop = (attrs.get("property") or attrs.get("name") or "").lower()
            if prop in ("og:image", "og:image:url", "twitter:image", "twitter:image:src"):
                self._add(attrs.get("content"), width=1200)  # social card images are usually large
        elif tag == "a" and attrs.get("href"):
            href = urldefrag(urljoin(self.base, attrs["href"]))[0]
            if href.lower().endswith(IMG_EXT):
                self._add(href)
            elif same_domain(href, self.base) and GALLERY_HINT.search(href):
                self.links.add(href)
        if "style" in attrs:
            for m in BG_URL.finditer(attrs["style"]):
                self._add(m.group(2))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag == "style":
            self._in_style = False

    def handle_data(self, data):
        if self._in_style:
            for m in BG_URL.finditer(data):
                self._add(m.group(2))


def probe_size(url: str) -> int:
    """Best-effort byte size via HEAD, then a 1-byte range GET."""
    for method in ("HEAD", "GET"):
        try:
            req = urllib.request.Request(url, method=method, headers={"User-Agent": UA})
            if method == "GET":
                req.add_header("Range", "bytes=0-0")
            with urllib.request.urlopen(req, timeout=15) as resp:
                cr = resp.headers.get("Content-Range")
                if cr and "/" in cr:
                    return int(cr.split("/")[-1])
                cl = resp.headers.get("Content-Length")
                if cl and cl.isdigit():
                    return int(cl)
        except Exception:  # noqa: BLE001
            continue
    return 0


def harvest(start_url: str, crawl: bool, max_pages: int) -> dict[str, int]:
    seen_pages: set[str] = set()
    queue = [start_url]
    images: dict[str, int] = {}
    while queue and len(seen_pages) < max_pages:
        url = queue.pop(0)
        if url in seen_pages:
            continue
        seen_pages.add(url)
        try:
            html, final = fetch(url)
        except Exception as e:  # noqa: BLE001
            print(f"  ! could not fetch {url} ({e})", file=sys.stderr)
            continue
        h = Harvester(final)
        h.feed(html)
        for u, w in h.images.items():
            images[u] = max(images.get(u, 0), w)
        print(f"  · {url} → {len(h.images)} images", file=sys.stderr)
        if crawl:
            for link in sorted(h.links):
                if link not in seen_pages and len(seen_pages) + len(queue) < max_pages:
                    queue.append(link)
    return images


def main() -> int:
    ap = argparse.ArgumentParser(description="Harvest candidate image URLs from an artist's website.")
    ap.add_argument("url", help="The artist's site (their own public portfolio).")
    ap.add_argument("--crawl", action="store_true", help="Follow same-domain gallery/work links.")
    ap.add_argument("--max-pages", type=int, default=8, help="Max pages to visit when crawling.")
    ap.add_argument("--probe", action="store_true", help="Fetch real byte sizes and rank by them (slower).")
    ap.add_argument("--limit", type=int, default=40, help="Max candidates to print.")
    ap.add_argument("--json", dest="json_out", help="Also write the ranked URL list to this JSON file.")
    args = ap.parse_args()

    print(f"Harvesting images from {args.url} ...", file=sys.stderr)
    images = harvest(args.url, args.crawl, args.max_pages if args.crawl else 1)
    if not images:
        print("No candidate images found. The site may render images via JS — fall back to manual paste.",
              file=sys.stderr)
        return 1

    ranked = sorted(images.items(), key=lambda kv: kv[1], reverse=True)
    if args.probe:
        print(f"Probing sizes for {len(ranked)} candidates ...", file=sys.stderr)
        ranked = sorted(((u, probe_size(u) or w) for u, w in ranked), key=lambda kv: kv[1], reverse=True)

    ranked = ranked[: args.limit]
    print(f"\n✓ {len(ranked)} candidate images (best first):\n", file=sys.stderr)
    for u, score in ranked:
        tag = f"{score}B" if args.probe else (f"~{score}px" if score else "?")
        print(f"  [{tag:>9}] {u}")

    if args.json_out:
        Path(args.json_out).write_text(json.dumps([u for u, _ in ranked], indent=2))
        print(f"\nWrote {len(ranked)} URLs to {args.json_out}", file=sys.stderr)
    print("\nPick the strongest as hero_image + collection images in the intake data file.",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
