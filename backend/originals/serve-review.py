#!/usr/bin/env python3
"""Serve candidate Originals covers to the dev review page (?preview=originals).

    python3 backend/originals/serve-review.py <covers-dir>

Serves <covers-dir>/<slug>.png and a manifest built from briefs.json on
http://localhost:8093, with CORS open so the Expo web dev server can fetch the
manifest. Covers under review are never bundled or committed; this is how the
review page reaches them. The manifest is rebuilt on every request, so a cover
regenerated mid-review shows up on reload.
"""
import json
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
COVERS = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE / "covers"
PORT = 8093


def manifest():
    briefs = json.loads((HERE / "briefs.json").read_text())["stories"]
    entries = []
    for brief in briefs:
        cover = COVERS / f"{brief['slug']}.png"
        request = brief["request"]
        entries.append({
            "slug": brief["slug"],
            "title": brief["title"],
            "genre": request["primary_genre"],
            "logline": brief["logline"],
            "artStyle": request["image_style"],
            "chapters": request["planned_chapter_count"],
            # The mtime busts the browser cache when a cover is regenerated.
            "cover": f"http://localhost:{PORT}/{cover.name}?v={int(cover.stat().st_mtime)}"
            if cover.exists() else None,
        })
    return entries


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(COVERS), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/manifest.json":
            body = json.dumps(manifest()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


if __name__ == "__main__":
    print(f"Serving {COVERS} on http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
