#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本地预览服务器 —— 模拟 GitHub Pages 的「无扩展名 URL」行为。

背景：
    GitHub Pages 会自动把 /about 解析成 about.html（线上已实测通过），
    但 Python 自带的 `http.server` **不会**。
    站内链接现在已经全部去掉了 .html 后缀，所以本地预览必须用这个脚本，
    否则点任何导航都会 404。

用法：
    python tools/serve.py          # 默认 http://127.0.0.1:8765
    python tools/serve.py 8000     # 指定端口

与线上一致的两条规则：
    /about      ->  about.html
    /           ->  index.html
"""

import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# tools/ 的上一级就是站点根目录
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class PrettyHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        kwargs["directory"] = ROOT
        super().__init__(*args, **kwargs)

    def translate_path(self, path):
        p = super().translate_path(path)
        # /about  ->  about.html
        if not os.path.exists(p) and os.path.isfile(p + ".html"):
            return p + ".html"
        # /sub/    ->  sub/index.html
        if os.path.isdir(p):
            idx = os.path.join(p, "index.html")
            if os.path.isfile(idx):
                return idx
        return p

    def end_headers(self):
        # 本地调试关掉缓存，改了立刻能看到
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 安静运行，不刷屏


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    srv = ThreadingHTTPServer(("127.0.0.1", port), PrettyHandler)
    print("本地预览（支持无 .html 后缀）: http://127.0.0.1:%d/" % port)
    print("按 Ctrl+C 停止")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
