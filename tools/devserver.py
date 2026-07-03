"""開発用の静的サーバー。ブラウザキャッシュを無効化する(no-cache)。

ES module 開発時に古い main.js 等がキャッシュから使われるのを防ぐ。
ポートは環境変数 PORT > 引数 > 8000 の順で決定。

使い方: python tools/devserver.py [port]
"""
import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # コンソールを汚さない


def main():
    os.chdir(Path(__file__).resolve().parent.parent)  # プロジェクトルートを配信
    port = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else 8000))
    print(f"serving on http://localhost:{port} (no-cache)")
    ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()


if __name__ == "__main__":
    main()
