"""Local server for the CMS: like `python -m http.server`, but every response carries
`Cache-Control: no-cache`, so the browser re-checks each file on every load (unchanged files are answered
with a quick 304). This prevents an updated CMS from running with a mix of new and older cached ES
modules, which makes the modules fail to load. JavaScript is always served as text/javascript, whatever the
Windows registry says about .js files.

Usage, from D:\\CMS\\vion-cms:   python tools/serve.py [port]      (default http://127.0.0.1:5173)
"""
import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    handler = functools.partial(Handler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(('127.0.0.1', port), handler) as server:
        print(f'Serving {ROOT} at http://127.0.0.1:{port}/ (no-cache). Press Ctrl+C to stop.')
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
