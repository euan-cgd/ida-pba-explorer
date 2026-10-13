"""Stamp a new cache-busting version on the page's own CSS, JS and data.

GitHub Pages lets browsers cache files for 10 minutes. Without a version
stamp, a visitor can get a new index.html with an old cached app.js, and
new controls then do nothing. Run this before committing any change to
the page's files:

    python scripts/bump-version.py

It sets ?v=<timestamp> on the local stylesheet and scripts in index.html.
app.js reads the same value from its own URL and adds it to the data fetch.
"""

import re
from datetime import datetime, timezone
from pathlib import Path

INDEX = Path(__file__).resolve().parent.parent / "index.html"
LOCAL = r'((?:href|src)="(?:css/styles\.css|tracking\.js|js/model\.js|js/app\.js))(?:\?v=[\w-]+)?"'

version = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
html = INDEX.read_text(encoding="utf-8")
html, n = re.subn(LOCAL, rf'\1?v={version}"', html)
INDEX.write_text(html, encoding="utf-8")
print(f"Set v={version} on {n} references in index.html")
