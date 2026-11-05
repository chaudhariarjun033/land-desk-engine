#!/usr/bin/env python3
"""Build the ccinvgroup.com pages from the site artifact source (/home/claude/site/index.html).
Output: engine/src/pages/*.html (imported by the Worker as text modules)."""
import re, pathlib

ROOT = pathlib.Path(__file__).parent
SRC = (pathlib.Path(__file__).parent / "site" / "index.html").read_text()
OUT = ROOT / "src" / "pages"; OUT.mkdir(parents=True, exist_ok=True)

head_end = SRC.index("</style>") + len("</style>")
head, body = SRC[:head_end], SRC[head_end:]
head = re.sub(r'<meta name="claude:viewport-fit-sides"[^>]*>\n?', "", head)
title = re.search(r"<title>(.*?)</title>", head).group(1)
head_wo_title = head.replace(f"<title>{title}</title>", "")

FAVICON = ('<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E'
           '%3Crect width=%2232%22 height=%2232%22 rx=%226%22 fill=%22%231d4b3c%22/%3E%3Cpath d=%22M7 22 L13 10 L19 18 L22 14 L26 22 Z%22 fill=%22white%22/%3E%3C/svg%3E">')

def doc(page_title, head_extra, body_html):
    return ("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
            f"<title>{page_title}</title>\n{FAVICON}\n{head_extra}\n</head>\n<body>\n{body_html}\n</body>\n</html>\n")

# Home page
home_title = "Sell Your Land Directly | Chaudhari Investments LLC"
(OUT / "index.html").write_text(doc(home_title, head_wo_title, body))

# Shared header/footer for secondary pages (links point back to the home page)
header = re.search(r"<header>.*?</header>", body, re.S).group(0)
header = header.replace('href="#top"', 'href="/"').replace('href="#', 'href="/#')
footer = re.search(r"<footer>.*?</footer>", body, re.S).group(0).replace('href="#', 'href="/#')
style = head[head.index("<style>"):]
fonts = "\n".join(l for l in head.splitlines() if "fonts.g" in l)
legal_css = """<style>
.legal{max-width:760px;padding-block:56px 72px}
.legal h1{font-size:clamp(34px,4.4vw,48px);margin-bottom:6px}
.legal h2{font-size:26px;margin:36px 0 10px}
.legal ul{padding-left:22px}.legal li{margin-bottom:8px}
.muted{color:var(--muted)}
</style>"""

def secondary(name, page_title, desc, inner, canonical):
    extra = (f'<meta name="description" content="{desc}">\n<link rel="canonical" href="https://ccinvgroup.com{canonical}">\n'
             f"{fonts}\n{style}\n{legal_css}")
    html = f"{header}\n<main id=\"top\"><div class=\"wrap legal\">\n{inner}\n</div></main>\n{footer}"
    (OUT / f"{name}.html").write_text(doc(page_title, extra, html))

for name, t, d in [("privacy", "Privacy Policy | Chaudhari Investments LLC", "How Chaudhari Investments LLC collects, uses, and protects information from property owners."),
                   ("terms", "Terms of Use | Chaudhari Investments LLC", "Terms of use for ccinvgroup.com, operated by Chaudhari Investments LLC.")]:
    secondary(name, t, d, (ROOT / "pages" / f"{name}.body.html").read_text(), f"/{name}")

secondary("404", "Page not found | Chaudhari Investments LLC", "Page not found.",
          '<h1>Page not found</h1><p class="muted">That page doesn\'t exist. <a href="/">Go to the home page</a> or <a href="/#offer">request an offer</a>.</p>', "/")

for p in sorted(OUT.iterdir()):
    print(p.name, p.stat().st_size)
