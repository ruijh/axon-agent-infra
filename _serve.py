import argparse
import http.server
import json
from pathlib import Path
import re
import socketserver
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
PUBLIC_ASSETS = set(json.loads((ROOT / "server/public-assets.json").read_text(encoding="utf-8")))

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_head(self):
        try:
            if not self.path.startswith("/") or self.path.startswith("//") or "\\" in self.path:
                raise ValueError("invalid path")
            path = urlsplit(self.path).path
            if re.search(r"%(?![0-9a-fA-F]{2})", path):
                raise ValueError("invalid encoding")
            path = unquote(path, errors="strict")
            if re.search(r"[\\\x00-\x1f\x7f]", path):
                raise ValueError("invalid characters")
            rel = "index.html" if path == "/" else path[1:]
            if rel not in PUBLIC_ASSETS:
                self.send_error(404)
                return None
            target = ROOT / rel
            if target.resolve(strict=True) != target:
                self.send_error(404)
                return None
        except (ValueError, UnicodeError):
            self.send_error(400)
            return None
        except OSError:
            self.send_error(404)
            return None
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, *a):
        pass

class Srv(socketserver.ThreadingTCPServer):
    """线程化 + 容错：浏览器中断连接（WinError 10053 / BrokenPipe）不打崩服务"""
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
            return  # 客户端断开，忽略
        super().handle_error(request, client_address)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AXON 静态演示服务（仅公开资源白名单）")
    parser.add_argument("--port", type=int, default=8437)
    args = parser.parse_args()
    with Srv(("127.0.0.1", args.port), H) as httpd:
        print(f"AXON demo serving at http://127.0.0.1:{httpd.server_address[1]}/ (Ctrl+C 停止)", flush=True)
        httpd.serve_forever()
