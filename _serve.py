import http.server, socketserver, os, sys

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
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

os.chdir(os.path.dirname(os.path.abspath(__file__)))
with Srv(("127.0.0.1", 8437), H) as httpd:
    print("AXON demo serving at http://127.0.0.1:8437/ (Ctrl+C 停止)")
    httpd.serve_forever()
