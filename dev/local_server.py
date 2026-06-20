#!/usr/bin/env python3

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from pathlib import Path
import argparse
import io
import json
import os
import sys
import webbrowser

REMOTE_BASE = "https://test.uyc.boats"
LOCAL_WORKER_TARGETS = {}

# Local paths that should be fetched from the test site instead of disk.
# Adjust these if your frontend uses different paths.
PROXY_PREFIXES = (
    "/var/",
)


def latest_mtime(root: Path) -> float:
    latest = 0.0

    for path in root.rglob("*"):
        if path.is_file():
            try:
                latest = max(latest, path.stat().st_mtime)
            except OSError:
                pass

    return latest

class DevHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Useful while developing locally.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_HEAD(self):
        if self.should_proxy():
            self.proxy_request(head_only=True)
        else:
            super().do_HEAD()

    def do_GET(self):
        if self.path.startswith("/__dev_reload_version"):
            self.send_reload_version()
        elif self.should_proxy():
            self.proxy_request(head_only=False)
        else:
            super().do_GET()

    def send_head(self):
        path = self.translate_path(self.path)

        if os.path.isdir(path):
            if not self.path.endswith("/"):
                self.send_response(301)
                self.send_header("Location", self.path + "/")
                self.end_headers()
                return None

            index_path = os.path.join(path, "index.html")
            if os.path.exists(index_path):
                path = index_path
            else:
                return self.list_directory(path)

        content_type = self.guess_type(path)

        if content_type != "text/html":
            return super().send_head()

        try:
            with open(path, "rb") as html_file:
                html = html_file.read().decode("utf-8")
        except OSError:
            self.send_error(404, "File not found")
            return None
        except UnicodeDecodeError:
            return super().send_head()

        body = self.inject_reload_script(html).encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Last-Modified", self.date_time_string(os.path.getmtime(path)))
        self.end_headers()

        return io.BytesIO(body)

    def inject_reload_script(self, html: str) -> str:
        reload_script = """
<script>
(() => {
    let lastVersion = null;

    async function checkForReload() {
        try {
            const response = await fetch("/__dev_reload_version", {
                cache: "no-store"
            });

            const data = await response.json();

            if (lastVersion === null) {
                lastVersion = data.version;
                return;
            }

            if (data.version !== lastVersion) {
                location.reload();
            }
        } catch (error) {
            // Ignore reload check failures during local development.
        }
    }

    setInterval(checkForReload, 1000);
    checkForReload();
})();
</script>
"""

        if "</body>" in html:
            return html.replace("</body>", reload_script + "\n</body>")

        return html + reload_script

    def send_reload_version(self):
        version = latest_mtime(Path(self.directory))

        body = json.dumps({
            "version": version
        }).encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def should_proxy(self):
        path = self.path.split("?", 1)[0]
        return any(path.startswith(prefix) for prefix in PROXY_PREFIXES)

    def proxy_request(self, head_only=False):
        path = self.path.split("?", 1)[0]
        local_worker_url = LOCAL_WORKER_TARGETS.get(path)

        if local_worker_url and self.try_local_worker_proxy(local_worker_url, head_only):
            return

        remote_url = REMOTE_BASE + self.path

        try:
            request = Request(
                remote_url,
                method="HEAD" if head_only else "GET",
                headers={
                    "User-Agent": "uyc-local-dev-server",
                },
            )

            with urlopen(request, timeout=15) as response:
                body = b"" if head_only else response.read()

                self.send_response(response.status)

                for header in [
                    "Content-Type",
                    "Content-Length",
                    "Last-Modified",
                    "ETag",
                ]:
                    value = response.headers.get(header)
                    if value:
                        self.send_header(header, value)

                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()

                if not head_only:
                    self.wfile.write(body)

        except HTTPError as exc:
            self.send_error(exc.code, f"Proxy error fetching {remote_url}")
        except URLError as exc:
            self.send_error(502, f"Proxy error fetching {remote_url}: {exc.reason}")
        except TimeoutError:
            self.send_error(504, f"Proxy timeout fetching {remote_url}")

    def try_local_worker_proxy(self, local_worker_url, head_only=False):
        local_url = local_worker_url + self.path

        try:
            status, headers, body = self.fetch_proxy_response(local_url, head_only=head_only, timeout=3)

            if 200 <= status < 300:
                self.send_proxy_response(status, headers, body, head_only=head_only)
                return True

            print(f"Local worker returned {status} for {self.path}; falling back to {REMOTE_BASE}")
            return False
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            print(f"Local worker unavailable for {self.path}: {exc}; falling back to {REMOTE_BASE}")
            return False

    def fetch_proxy_response(self, url, method="GET", head_only=False, timeout=15):
        request = Request(
            url,
            method="HEAD" if head_only else method,
            headers={
                "User-Agent": "uyc-local-dev-server",
            },
        )

        try:
            with urlopen(request, timeout=timeout) as response:
                body = b"" if head_only else response.read()
                return response.status, response.headers, body
        except HTTPError as exc:
            body = b"" if head_only else exc.read()
            return exc.code, exc.headers, body

    def send_proxy_response(self, status, headers, body, head_only=False):
        self.send_response(status)

        for header in [
            "Content-Type",
            "Content-Length",
            "Last-Modified",
            "ETag",
        ]:
            value = headers.get(header)
            if value:
                self.send_header(header, value)

        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        if not head_only:
            self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="Local dev server for UYC Webcam")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--root", default="site", help="Directory to serve")
    parser.add_argument("--weather-worker-url", help="Local weather worker base URL")
    parser.add_argument("--events-worker-url", help="Local events worker base URL")
    parser.add_argument("--no-open", action="store_true", help="Do not open a browser")
    args = parser.parse_args()

    root = Path(args.root).resolve()

    if not root.exists():
        print(f"Root directory does not exist: {root}", file=sys.stderr)
        sys.exit(1)

    if args.weather_worker_url:
        LOCAL_WORKER_TARGETS["/var/weather.json"] = args.weather_worker_url.rstrip("/")

    if args.events_worker_url:
        LOCAL_WORKER_TARGETS["/var/events7day.json"] = args.events_worker_url.rstrip("/")

    server = ThreadingHTTPServer(
        ("127.0.0.1", args.port),
        lambda *handler_args: DevHandler(
            *handler_args,
            directory=str(root),
        ),
    )

    print(f"Serving {root}")
    print(f"Local site: http://127.0.0.1:{args.port}/")
    if LOCAL_WORKER_TARGETS:
        print("Local worker JSON sources:")
        for path, worker_url in LOCAL_WORKER_TARGETS.items():
            print(f"  {path} -> {worker_url}{path} (falls back to {REMOTE_BASE}{path})")
    else:
        print(f"Proxying /var/* to {REMOTE_BASE}/var/*")
    print("Live reload enabled for files under the served root")
    print("Press Ctrl+C to stop")

    try:
        if not args.no_open:
            webbrowser.open(f"http://127.0.0.1:{args.port}/")
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping")

if __name__ == "__main__":
    main()
