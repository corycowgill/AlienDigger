"""Static server for development, with caching turned off.

`python -m http.server` sends no cache headers, so a browser is free to reuse a
module it already has. With ES modules that is a sharp edge: the page loads a
*new* main.js against a *stale* audio.js and throws "X is not a function", or
silently runs an old renderer against a new atlas. It looks exactly like a bug
in the code you just wrote, and it has cost this project an afternoon more than
once.

This is the same server with Cache-Control: no-store on everything, so every
reload gets every file fresh.

    python tools/serve.py            # http://localhost:8765
    python tools/serve.py 9000       # another port

Use `python -m http.server` to check the shipping behaviour, where caching is
what you actually want.
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        # The default logs every asset request, which buries anything useful
        # behind four hundred PNG fetches on each reload.
        if "404" in (fmt % args):
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = partial(NoCacheHandler, directory=str(ROOT))
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Alien Digger on http://localhost:{port}/  (no-store; 404s only)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
