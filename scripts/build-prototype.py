"""Build a shareable prototype copy of the tool in prototype/.

The embed version (index.html) is built for an iframe on cgdev.org: transparent
background, no outer spacing, Sofia Pro from Adobe Fonts. The prototype copy is
for sharing a review link (e.g. as a Claude artifact), so it:
  - drops the document skeleton tags (the host adds its own)
  - swaps Sofia Pro (Adobe Fonts) for Inter (Google Fonts)
  - adds a white background and side gutters
  - hides the CSV download, which sandboxed hosts block
  - adds a "draft prototype" banner

Run from the repo root:  python scripts/build-prototype.py
"""

import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "prototype"

html = (ROOT / "index.html").read_text(encoding="utf-8")

# Keep <title> and stylesheet links from <head>, then everything inside <body>
head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)
title = re.search(r"<title>.*?</title>", head, re.S).group(0)

fonts = ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
         'family=Inter:wght@300;400;500;600;700&display=swap">')

overrides = """<style>
  :root { --font: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; color-scheme: light; }
  body { background: #ffffff; }
  .wrap { padding-inline: 16px; padding-block: 0.75rem 1.5rem; max-width: 1200px; margin-inline: auto; }
  #download { display: none; }
  .proto-banner {
    font-size: 0.85rem; color: var(--cgd-teal-black); background: var(--cgd-light-gold);
    border-left: 4px solid var(--cgd-gold); padding: 0.5rem 0.75rem; margin-bottom: 1rem;
  }
</style>"""

banner = ('<p class="proto-banner"><strong>Draft prototype for feedback.</strong> '
          'Not for circulation. Figures are modelled from IDA FY25 inputs, in SDR million.</p>')

body = body.replace('<div class="wrap">', '<div class="wrap">\n  ' + banner, 1)

# The prototype host serves files by path and republishes them together,
# so drop the cache-busting version stamps
body = re.sub(r'\?v=[\w-]+"', '"', body)

page = "\n".join([title, fonts, '<link rel="stylesheet" href="css/styles.css">', overrides, body.strip()]) + "\n"

if OUT.exists():
    shutil.rmtree(OUT)
OUT.mkdir()
(OUT / "index.html").write_text(page, encoding="utf-8")
for rel in ["css/styles.css", "js/model.js", "js/app.js", "tracking.js", "data/pba.json"]:
    dest = OUT / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / rel, dest)

print(f"Wrote {OUT}")
