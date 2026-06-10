#!/usr/bin/env bash
# Downloads each social platform's favicon (64px) into web/public/favicons/.
# Single source of truth for the domains is web/src/lib/favicon.ts (PLATFORM_DOMAINS);
# keep this list in sync. Run via `task web:favicons` or the refresh-favicons workflow.
set -euo pipefail
cd "$(dirname "$0")/.."   # -> web/
mkdir -p public/favicons

fetch() {
  # $1 = platform key, $2 = domain
  curl -fsSL "https://www.google.com/s2/favicons?domain=$2&sz=64" -o "public/favicons/$1.png"
  echo "fetched $1 ($2)"
}

fetch instagram instagram.com
fetch twitter   x.com
fetch facebook  facebook.com
fetch youtube   youtube.com
fetch tiktok    tiktok.com
fetch linkedin  linkedin.com
fetch pinterest pinterest.com
