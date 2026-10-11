#!/usr/bin/env python3
"""Dev server lokal: menyajikan index.html + memakai ulang function Vercel di /api/pred.

Dipakai untuk mengetes jalur proxy secara nyata sebelum deploy.

    python3 dev_server.py 8765
"""

import os
import sys
from http.server import ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "api"))

from pred import handler as PredHandler  # noqa: E402


class Dev(PredHandler):
    def do_GET(self):
        if self.path.startswith("/api/pred"):
            return super().do_GET()

        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            with open(os.path.join(HERE, "index.html"), "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print("dev server di http://127.0.0.1:%d" % port, flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Dev).serve_forever()
