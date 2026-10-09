"""Static dev server for OrbiT: like `python3 -m http.server`, but never cached,
so edits show up on a normal reload. Opens the app in your default browser."""
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
server = ThreadingHTTPServer(("", port), NoCache)
threading.Timer(0.5, webbrowser.open, [f"http://localhost:{port}"]).start()
print(f"OrbiT at http://localhost:{port}  (Ctrl+C to stop)")
server.serve_forever()
