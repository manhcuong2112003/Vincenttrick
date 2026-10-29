#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Web Server phục vụ trang cài đặt Shadowrocket (v2.2.92)
tích hợp sẵn tiến trình ngầm tự động kiểm tra & gia hạn chứng chỉ (Auto-Sign Daemon).
"""

import http.server
import importlib
import json
import os
import socket
import socketserver
import threading
import time
import urllib.parse

import auto_sign_manager

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = 8080


def get_lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def background_monitor_loop() -> None:
    cfg = auto_sign_manager.load_config()
    interval = int(cfg.get("monitor", {}).get("check_interval_seconds", 900))
    auto_sign_manager.log(f"🔄 Đã bật luồng giám sát tự động ngầm (Chu kỳ kiểm tra: {interval}s)")
    while True:
        try:
            importlib.reload(auto_sign_manager)
            auto_sign_manager.run_sync(force_resign=False)
        except Exception as e:
            auto_sign_manager.log(f"Lỗi trong luồng giám sát: {e}")
        time.sleep(interval)


class ShadowrocketHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)

        if path in ("/", "/index.html"):
            self.path = "/" + urllib.parse.quote("Shadowrocket – Cài đặt.html")
            return super().do_GET()

        if path == "/api/status":
            cfg = auto_sign_manager.load_config()
            cache_path = os.path.join(BASE_DIR, cfg["app"]["cache_file"])
            cache = auto_sign_manager.load_cache(cache_path)
            payload = json.dumps(cache, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        return super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    lan_ip = get_lan_ip()
    monitor_thread = threading.Thread(target=background_monitor_loop, daemon=True)
    monitor_thread.start()

    with ThreadedHTTPServer(("0.0.0.0", PORT), ShadowrocketHTTPRequestHandler) as httpd:
        auto_sign_manager.log("==========================================================")
        auto_sign_manager.log(f"🌐 WEB SERVER ĐÃ BẬT THÀNH CÔNG TẠI CỔNG {PORT}!")
        auto_sign_manager.log(f"👉 Truy cập trên máy tính: http://localhost:{PORT}")
        auto_sign_manager.log(f"📱 Truy cập trên iPhone (cùng Wi-Fi): http://{lan_ip}:{PORT}")
        auto_sign_manager.log("==========================================================")
        httpd.serve_forever()

