#!/usr/bin/env bash
# Fetch the CC BY-SA 4.0 HTML5 edition of SICP into book/src (gitignored).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -d src/.git ]; then
  git -C src pull --ff-only
else
  git clone --depth 1 https://github.com/sarabander/sicp.git src
fi
echo "Book source in book/src — license: CC BY-SA 4.0 (see src/LICENSE and ATTRIBUTION.md)"
