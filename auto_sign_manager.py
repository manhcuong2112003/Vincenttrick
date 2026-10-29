#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Hệ thống Tự động Quản lý Kho App & Game iOS (Shadowrocket, Asphalt 8 & Mở rộng):
- Tự động quét bản cập nhật IPA mới từ trang nguồn (ipaomtk.com) cho từng App/Game
- Tự động quét chứng chỉ mới nhất (updatedAt) & kiểm tra thu hồi Apple OCSP (ocsp.apple.com)
- Tự động ký lại khi link hết hạn hoặc có bản mới, lưu vào links_cache.json + HTML
- Hỗ trợ thêm Game mới chỉ bằng 1 lệnh: python -X utf8 auto_sign_manager.py --add-game <url>
- Tự động gửi Email cảnh báo khi có sự cố
"""

import argparse
import base64
import datetime
import email.message
import io
import json
import os
import re
import shutil
import smtplib
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
OPENSSL_PATH = shutil.which("openssl") or r"C:\Program Files\Git\usr\bin\openssl.exe"


def log(msg: str) -> None:
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {msg}", flush=True)


def load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_config(cfg: dict) -> None:
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def load_cache(cache_path: str) -> dict:
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            log(f"Cảnh báo: Không đọc được file cache ({e}), khởi tạo mới.")
    return {
        "updated_at": None,
        "last_error": None,
        "last_alert_sent_at": 0,
        "in_error_state": False,
        "apps": {},
        "servers": []
    }


def save_cache(cache_path: str, data: dict) -> None:
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_signtools_headers() -> dict:
    return {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Origin": "https://signtools.ipaomtk.com",
        "Referer": "https://signtools.ipaomtk.com/"
    }


def fetch_available_certificates(cfg: dict) -> list:
    url = cfg["signtools_api"]["certificates_endpoint"]
    req = urllib.request.Request(url, headers=get_signtools_headers())
    with urllib.request.urlopen(req, timeout=15) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if not payload.get("ok") or "certificates" not in payload:
        raise RuntimeError("API server-certificates.php trả về dữ liệu không hợp lệ.")
    return payload["certificates"]


def check_item_upstream_update(item: dict, app_cache: dict, cfg: dict) -> bool:
    """
    Tự động quét trang nguồn của từng App/Game và kiểm tra ETag/Last-Modified của file IPA.
    Trả về True nếu phát hiện có phiên bản mới hoặc file IPA mới trên nguồn.
    """
    changed = False
    page_url = item.get("source_page_url", "").strip()
    try:
        if page_url:
            req = urllib.request.Request(page_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                html = resp.read().decode("utf-8", errors="ignore")

            ipa_matches = re.findall(r'data-ipa-url=["\']([^"\']+\.ipa)["\']', html)
            if ipa_matches and ipa_matches[0] != item.get("remote_ipa_url"):
                new_url = ipa_matches[0]
                log(f"🆕 [{item['name']}] Phát hiện đường dẫn IPA mới: {new_url}")
                item["remote_ipa_url"] = new_url
                changed = True

            title_matches = re.findall(r"<title>([^<]+)</title>", html, flags=re.IGNORECASE)
            if title_matches:
                ver_m = re.search(r"\bv?(\d+\.\d+(?:\.\d+)?)\b", title_matches[0], flags=re.IGNORECASE)
                if ver_m:
                    latest_ver = ver_m.group(1)
                    if latest_ver != item.get("version"):
                        log(f"🎉 [{item['name']}] Phát hiện phiên bản mới trên nguồn: v{latest_ver} (cũ: v{item.get('version')})")
                        item["version"] = latest_ver
                        if item["id"] == "shadowrocket":
                            cfg["app"]["version"] = latest_ver
                        changed = True

        remote_url = item.get("remote_ipa_url", "").strip()
        if remote_url:
            head_req = urllib.request.Request(
                remote_url,
                method="HEAD",
                headers={"User-Agent": "Mozilla/5.0"}
            )
            with urllib.request.urlopen(head_req, timeout=12) as head_resp:
                etag = head_resp.headers.get("ETag", "").strip()
                last_mod = head_resp.headers.get("Last-Modified", "").strip()
                size = head_resp.headers.get("Content-Length", "").strip()
                remote_sig = f"{etag}|{last_mod}|{size}"

            old_sig = app_cache.get("remote_ipa_signature")
            if old_sig and remote_sig and old_sig != remote_sig:
                log(f"🆕 [{item['name']}] File IPA trên server nguồn vừa được cập nhật ({remote_sig})!")
                changed = True
            if remote_sig:
                app_cache["remote_ipa_signature"] = remote_sig

        if changed:
            save_config(cfg)
            local_rel = item.get("local_ipa_path", "").strip()
            if local_rel and item.get("remote_ipa_url"):
                try:
                    local_ipa = os.path.join(BASE_DIR, local_rel)
                    log(f"⬇️ [{item['name']}] Đang tải bản IPA mới về lưu dự phòng ({local_ipa})...")
                    dl_req = urllib.request.Request(item["remote_ipa_url"], headers={"User-Agent": "Mozilla/5.0"})
                    with urllib.request.urlopen(dl_req, timeout=180) as dl_resp, open(local_ipa + ".tmp", "wb") as out_f:
                        out_f.write(dl_resp.read())
                    os.replace(local_ipa + ".tmp", local_ipa)
                    log(f"✅ [{item['name']}] Đã cập nhật file IPA dự phòng trên ổ cứng!")
                except Exception as dl_err:
                    log(f"⚠️ [{item['name']}] Không thể tải bản lưu trữ cục bộ: {dl_err}")
    except Exception as e:
        log(f"Lưu ý: Không kiểm tra được bản cập nhật của [{item['name']}] ({e})")

    return changed


def check_cert_ocsp_status(cert_id: str, ocsp_memo: dict) -> str:
    if cert_id in ocsp_memo:
        return ocsp_memo[cert_id]
    if not os.path.exists(OPENSSL_PATH):
        return "UNKNOWN"
    try:
        ca_der = urllib.request.urlopen("http://certs.apple.com/wwdrg3.der", timeout=10).read()
        ca_pem = tempfile.mktemp(suffix=".pem")
        subprocess.run([OPENSSL_PATH, "x509", "-inform", "DER", "-out", ca_pem], input=ca_der, check=True)

        dl_url = "https://signtools.ipaomtk.com/server-certificate-download.php?certificate=" + urllib.parse.quote(cert_id)
        req = urllib.request.Request(dl_url, headers=get_signtools_headers())
        zip_bytes = urllib.request.urlopen(req, timeout=12).read()
        z = zipfile.ZipFile(io.BytesIO(zip_bytes))
        mps = [f for f in z.namelist() if f.endswith(".mobileprovision")]
        if not mps:
            return "UNKNOWN"
        raw = z.read(mps[0])
        idx = raw.find(b"<key>DeveloperCertificates</key>")
        s = raw.find(b"<data>", idx) + 6
        e = raw.find(b"</data>", s)
        c_pem = tempfile.mktemp(suffix=".pem")
        subprocess.run([OPENSSL_PATH, "x509", "-inform", "DER", "-out", c_pem], input=base64.b64decode(raw[s:e]), check=True)
        ocsp_uri = subprocess.check_output([OPENSSL_PATH, "x509", "-in", c_pem, "-noout", "-ocsp_uri"]).decode().strip()
        res = subprocess.run([OPENSSL_PATH, "ocsp", "-issuer", ca_pem, "-cert", c_pem, "-url", ocsp_uri, "-noverify"], capture_output=True, text=True)
        os.remove(ca_pem)
        os.remove(c_pem)
        status = "UNKNOWN"
        for line in res.stdout.splitlines():
            if ": good" in line.lower():
                status = "GOOD"
                break
            if ": revoked" in line.lower():
                status = "REVOKED"
                break
        ocsp_memo[cert_id] = status
        return status
    except Exception:
        return "UNKNOWN"


def check_manifest_alive(manifest_url: str) -> bool:
    if not manifest_url:
        return False
    try:
        headers = {
            "User-Agent": "itunesstored/1.0 iOS/17.0 model/iPhone14,5"
        }
        req = urllib.request.Request(manifest_url, headers=headers)
        with urllib.request.urlopen(req, timeout=12) as resp:
            if resp.status != 200:
                return False
            body = resp.read().decode("utf-8", errors="ignore")
            if "<plist" not in body or "software-package" not in body:
                return False
            m = re.search(r"<string>(https?://[^<]+\.ipa)</string>", body)
            if m:
                ipa_url = m.group(1)
                ipa_req = urllib.request.Request(
                    ipa_url,
                    headers={"User-Agent": "itunesstored/1.0 iOS/17.0", "Range": "bytes=0-63"}
                )
                with urllib.request.urlopen(ipa_req, timeout=12) as ipa_resp:
                    return ipa_resp.status in (200, 206)
            return True
    except Exception as e:
        log(f"Link hết hạn hoặc lỗi ({manifest_url}): {e}")
        return False


def sign_remote_ipa(cfg: dict, item: dict, cert_id: str) -> dict:
    start_url = cfg["signtools_api"]["remote_sign_start"]
    status_url = cfg["signtools_api"]["remote_sign_status"]
    headers = get_signtools_headers()

    post_data = urllib.parse.urlencode({
        "certificate_mode": "server",
        "server_certificate": cert_id,
        "bundle": cfg["signtools_api"].get("bundle_mode", "com.ipaomtk.auto"),
        "ipa_url": item["remote_ipa_url"],
        "app_name": item["name"]
    }).encode("utf-8")

    req = urllib.request.Request(start_url, data=post_data, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as resp:
        start_payload = json.loads(resp.read().decode("utf-8"))

    if not start_payload.get("ok") or not start_payload.get("jobId"):
        raise RuntimeError(start_payload.get("error") or start_payload.get("message") or "Không tạo được job ký.")

    job_id = start_payload["jobId"]
    # Các game nặng có thể mất 15-90s để server họ tải & ký
    for _ in range(90):
        time.sleep(3)
        poll_url = f"{status_url}?job={urllib.parse.quote(job_id)}&t={int(time.time() * 1000)}"
        try:
            poll_req = urllib.request.Request(poll_url, headers=headers)
            with urllib.request.urlopen(poll_req, timeout=20) as poll_resp:
                status_payload = json.loads(poll_resp.read().decode("utf-8"))
        except Exception as poll_err:
            log(f"Đang chờ server ký (kết nối lại): {poll_err}")
            continue

        if not status_payload.get("ok"):
            raise RuntimeError(status_payload.get("error") or "Lỗi khi kiểm tra trạng thái ký.")

        st = status_payload.get("status")
        if st == "error":
            raise RuntimeError(status_payload.get("error") or status_payload.get("debug") or "Server báo lỗi ký.")
        if st == "done":
            app = status_payload.get("app") or {}
            manifest_url = app.get("manifestUrl") or ""
            install_url = app.get("installUrl") or status_payload.get("link") or ""
            ipa_url = app.get("ipaUrl") or ""
            if not manifest_url or not install_url:
                raise RuntimeError("Server ký xong nhưng không trả về manifestUrl/installUrl.")
            return {
                "manifest_url": manifest_url,
                "install_url": install_url,
                "ipa_url": ipa_url
            }

    raise TimeoutError(f"Quá thời gian chờ ký cho [{item['name']}] với chứng chỉ {cert_id}.")


def sign_local_ipa(cfg: dict, item: dict, cert_id: str) -> dict:
    local_rel = item.get("local_ipa_path", "").strip()
    if not local_rel:
        raise FileNotFoundError(f"[{item['name']}] Không có cấu hình local_ipa_path dự phòng.")
    local_ipa = os.path.join(BASE_DIR, local_rel)
    if not os.path.exists(local_ipa):
        raise FileNotFoundError(f"Không tìm thấy file IPA cục bộ: {local_ipa}")

    merge_url = cfg["signtools_api"]["local_sign_merge"]
    boundary = f"----WebKitFormBoundary{int(time.time() * 1000)}"
    fields = {
        "certificate_mode": "server",
        "server_certificate": cert_id,
        "bundle": cfg["signtools_api"].get("bundle_mode", "com.ipaomtk.auto"),
        "custom_name": item["name"],
        "mode": "custom_ipa"
    }

    body = io.BytesIO()
    for k, v in fields.items():
        body.write(f"--{boundary}\r\n".encode("utf-8"))
        body.write(f'Content-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode("utf-8"))

    filename = os.path.basename(local_ipa)
    body.write(f"--{boundary}\r\n".encode("utf-8"))
    body.write(f'Content-Disposition: form-data; name="custom_ipa"; filename="{filename}"\r\n'.encode("utf-8"))
    body.write(b"Content-Type: application/octet-stream\r\n\r\n")
    with open(local_ipa, "rb") as f:
        body.write(f.read())
    body.write(f"\r\n--{boundary}--\r\n".encode("utf-8"))

    headers = get_signtools_headers()
    headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    req = urllib.request.Request(merge_url, data=body.getvalue(), headers=headers)
    with urllib.request.urlopen(req, timeout=180) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    if not payload.get("ok"):
        raise RuntimeError(payload.get("error") or payload.get("message") or "Lỗi upload qua sign-merge.php")

    app = payload.get("app") or payload.get("customApp") or (payload.get("apps")[0] if payload.get("apps") else {})
    manifest_url = app.get("manifestUrl") or ""
    install_url = app.get("installUrl") or ""
    ipa_url = app.get("ipaUrl") or ""
    if not manifest_url or not install_url:
        raise RuntimeError("sign-merge.php không trả về link cài đặt.")
    return {
        "manifest_url": manifest_url,
        "install_url": install_url,
        "ipa_url": ipa_url
    }


def sign_item_auto(cfg: dict, item: dict, cert_id: str) -> dict:
    try:
        return sign_remote_ipa(cfg, item, cert_id)
    except Exception as remote_err:
        if item.get("local_ipa_path"):
            log(f"⚠️ [{item['name']}] Ký từ xa thất bại ({remote_err}), chuyển sang upload file IPA cục bộ...")
            return sign_local_ipa(cfg, item, cert_id)
        raise


def send_email_alert(cfg: dict, subject: str, html_body: str, force: bool = False) -> bool:
    email_cfg = cfg.get("email_alert", {})
    if not email_cfg.get("enabled") and not force:
        return False

    smtp_user = (os.environ.get("SMTP_USER") or email_cfg.get("smtp_user", "")).strip()
    smtp_pass = (os.environ.get("SMTP_APP_PASSWORD") or email_cfg.get("smtp_app_password", "")).replace(" ", "").strip()
    recipient = (os.environ.get("RECIPIENT_EMAIL") or email_cfg.get("recipient_email", "") or smtp_user).strip()

    if not smtp_user or "dien_gmail" in smtp_user or not smtp_pass or "xxxx" in smtp_pass:
        log("⚠️ Chưa cấu hình Gmail & App Password trong config.json (mục email_alert). Bỏ qua gửi mail.")
        return False

    msg = email.message.EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"iOS Portal Auto-Signer <{smtp_user}>"
    msg["To"] = recipient
    msg.set_content("Vui lòng mở email ở chế độ HTML để xem chi tiết trạng thái hệ thống.")
    msg.add_alternative(html_body, subtype="html")

    try:
        context = ssl.create_default_context()
        with smtplib.SMTP(email_cfg.get("smtp_host", "smtp.gmail.com"), int(email_cfg.get("smtp_port", 587)), timeout=20) as server:
            server.starttls(context=context)
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)
        log(f"📧 Đã gửi email thông báo tới {recipient}: {subject}")
        return True
    except Exception as e:
        log(f"❌ Lỗi khi gửi email qua SMTP: {e}")
        return False


def update_html_file(cfg: dict, cache_data: dict) -> None:
    html_path = os.path.join(BASE_DIR, cfg["app"]["html_file"])
    if not os.path.exists(html_path):
        log(f"Không tìm thấy file HTML tại {html_path}")
        return

    with open(html_path, "r", encoding="utf-8") as f:
        html_content = f.read()

    embedded_json = json.dumps({
        "updated_at": cache_data.get("updated_at"),
        "dns_url": cfg["app"]["dns_profile_url"],
        "fallback_3u_url": f"itms-services://?action=download-manifest&url={urllib.parse.quote(cfg['app']['fallback_3utools_plist'], safe='')}",
        "apps": cache_data.get("apps", {}),
        "servers": cache_data.get("servers", [])
    }, ensure_ascii=False)

    if "/*__SERVERS_DATA_START__*/" in html_content and "/*__SERVERS_DATA_END__*/" in html_content:
        html_content = re.sub(
            r"/\*__SERVERS_DATA_START__\*/.*?/\*__SERVERS_DATA_END__\*/",
            f"/*__SERVERS_DATA_START__*/const SIGN_DATA = {embedded_json};/*__SERVERS_DATA_END__*/",
            html_content,
            flags=re.DOTALL
        )

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    index_path = os.path.join(BASE_DIR, "index.html")
    with open(index_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    log(f"✅ Đã đồng bộ dữ liệu Kho App & Game mới nhất vào {cfg['app']['html_file']} và index.html")


def add_game_from_ipaomtk_url(url: str) -> None:
    """
    Tự động lấy thông tin Game/App từ 1 đường link bài viết trên ipaomtk.com
    và thêm vào danh mục catalog trong config.json.
    """
    cfg = load_config()
    clean_url = url.strip().rstrip("/")
    dl_url = clean_url if clean_url.endswith("/download") else clean_url + "/download/"
    main_url = clean_url[:-9] + "/" if clean_url.endswith("/download") else clean_url + "/"

    log(f"🔍 Đang quét thông tin Game/App từ: {dl_url}")
    req = urllib.request.Request(dl_url, headers={"User-Agent": "Mozilla/5.0"})
    html_dl = urllib.request.urlopen(req, timeout=15).read().decode("utf-8", errors="ignore")

    ipa_matches = re.findall(r'data-ipa-url=["\']([^"\']+\.ipa)["\']', html_dl)
    if not ipa_matches:
        raise RuntimeError(f"Không tìm thấy data-ipa-url trên trang {dl_url}")
    remote_ipa_url = ipa_matches[0]

    title_m = re.findall(r"<title>([^<]+)</title>", html_dl, flags=re.IGNORECASE)
    raw_title = title_m[0].strip() if title_m else "New Game"
    ver_m = re.search(r"\bv?(\d+\.\d+(?:\.\d+)?)\b", raw_title, flags=re.IGNORECASE)
    version = ver_m.group(1) if ver_m else "1.0"
    app_name = re.sub(r"\s+IPA.*$", "", raw_title, flags=re.IGNORECASE).strip()

    # Tìm icon từ trang chính
    req_main = urllib.request.Request(main_url, headers={"User-Agent": "Mozilla/5.0"})
    html_main = urllib.request.urlopen(req_main, timeout=15).read().decode("utf-8", errors="ignore")
    imgs = re.findall(r'https?://ipaomtk\.com/wp-content/uploads/[^\s"\'<>]+300x300\.(?:jpg|jpeg|png|webp)', html_main, flags=re.IGNORECASE)
    if not imgs:
        imgs = re.findall(r'https?://ipaomtk\.com/wp-content/uploads/[^\s"\'<>]+150x150\.(?:jpg|jpeg|png|webp)', html_main, flags=re.IGNORECASE)
    icon_url = imgs[0] if imgs else "https://ipaomtk.com/ipaomtk-icon.png"

    slug = urllib.parse.urlparse(main_url).path.strip("/").replace("-ipa", "")
    new_entry = {
        "id": slug,
        "name": app_name,
        "category": "game",
        "version": version,
        "subtitle_vi": f"Bản v{version} • Đã ký sẵn cho iOS",
        "subtitle_en": f"v{version} • Pre-signed for iOS",
        "icon": icon_url,
        "source_page_url": dl_url,
        "remote_ipa_url": remote_ipa_url,
        "local_ipa_path": "",
        "fallback_3utools_plist": ""
    }

    catalog = cfg.get("catalog", [])
    existing_idx = next((i for i, x in enumerate(catalog) if x["id"] == slug), None)
    if existing_idx is not None:
        catalog[existing_idx] = new_entry
    else:
        catalog.append(new_entry)
    cfg["catalog"] = catalog
    save_config(cfg)
    log(f"✅ Đã thêm [{app_name} v{version}] ({remote_ipa_url}) vào config.json! Bắt đầu ký...")
    run_sync(force_resign=False)


def run_sync(force_resign: bool = False) -> bool:
    cfg = load_config()
    cache_path = os.path.join(BASE_DIR, cfg["app"]["cache_file"])
    cache = load_cache(cache_path)
    if "apps" not in cache or not isinstance(cache["apps"], dict):
        cache["apps"] = {}

    errors = []
    renewed_items = []
    ocsp_memo = {}

    try:
        online_certs = fetch_available_certificates(cfg)
        online_cert_ids = {c["id"]: c for c in online_certs}
    except Exception as e:
        err_msg = f"Không thể kết nối API danh sách chứng chỉ signtools.ipaomtk.com: {e}"
        log(f"❌ {err_msg}")
        errors.append(err_msg)
        online_certs = []
        online_cert_ids = {}

    # 1. Tự động tổng hợp danh sách chứng chỉ tốt nhất + mới nhất (theo updatedAt)
    target_certs = []
    seen_ids = set()
    if online_certs:
        sorted_online = sorted(online_certs, key=lambda c: c.get("updatedAt", 0), reverse=True)
        for c in sorted_online[:2]:
            cid = c["id"]
            if cid not in seen_ids:
                seen_ids.add(cid)
                target_certs.append({
                    "id": cid,
                    "label": c.get("name", cid),
                    "badge": "Mới nhất • Cần DNS",
                    "updated_at_ts": c.get("updatedAt", 0)
                })

    for pref in cfg.get("preferred_certificates", []):
        cid = pref["id"]
        if cid not in seen_ids and (not online_cert_ids or cid in online_cert_ids):
            seen_ids.add(cid)
            clean_name = re.sub(r"^Server\s+\d+\s+—\s+", "", pref["label"])
            target_certs.append({
                "id": cid,
                "label": clean_name,
                "badge": pref.get("badge", "Enterprise • Cần DNS"),
                "updated_at_ts": online_cert_ids.get(cid, {}).get("updatedAt", 0)
            })

    target_certs = target_certs[:3]

    # 2. Duyệt qua từng App & Game trong catalog
    catalog = cfg.get("catalog", [])
    for item in catalog:
        app_id = item["id"]
        app_cache = cache["apps"].get(app_id, {})
        existing_servers = app_cache.get("servers", [])
        if not existing_servers and app_id == "shadowrocket" and cache.get("servers"):
            existing_servers = cache.get("servers", [])
        existing_by_id = {s["cert_id"]: s for s in existing_servers}

        item_force = force_resign
        if check_item_upstream_update(item, app_cache, cfg):
            log(f"🔄 [{item['name']}] Có bản cập nhật IPA mới -> Tự động ký lại toàn bộ Server!")
            item_force = True
            send_email_alert(
                cfg,
                subject=f"🎉 [CẬP NHẬT MỚI] Phát hiện {item['name']} v{item.get('version')} mới!",
                html_body=f"""
                <div style="font-family: sans-serif; padding: 20px; border: 1px solid #c6f6d5; border-radius: 12px; background: #f0fff4;">
                    <h2 style="color: #2f855a; margin-top: 0;">🎉 Đã tự động cập nhật {item['name']} v{item.get('version')}</h2>
                    <p>Hệ thống vừa phát hiện file IPA mới trên nguồn (<code>{item.get('remote_ipa_url')}</code>) và đang tự động ký lại các Server cài đặt.</p>
                </div>
                """
            )

        unrevoked_servers = []
        enterprise_servers = []
        apple_server = None

        # Kiểm tra link Apple Chính Hãng / 3uTools nếu có (như Shadowrocket)
        fallback_plist = item.get("fallback_3utools_plist", "").strip()
        if fallback_plist and check_manifest_alive(fallback_plist):
            log(f"✔ [{item['name']}] Bản Chính Hãng Apple (v{item['version']}) hoạt động tốt")
            apple_server = {
                "cert_id": "apple_official_3u",
                "label": f"Bản Chính Hãng Apple (v{item['version']})",
                "badge": "Khuyên dùng • Không lỗi xác minh",
                "manifest_url": fallback_plist,
                "install_url": f"itms-services://?action=download-manifest&url={urllib.parse.quote(fallback_plist, safe='')}",
                "ipa_url": "https://dl.3u.com/soft/2026/09/07/z_932747118_890167352_1.ipa",
                "signed_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "ocsp_status": "APPLE_OFFICIAL",
                "status": "active"
            }

        for pref in target_certs:
            cert_id = pref["id"]
            base_name = pref["label"]
            existing = existing_by_id.get(cert_id)

            cert_updated_on_server = (
                existing and pref.get("updated_at_ts")
                and existing.get("cert_updated_at_ts")
                and existing.get("cert_updated_at_ts") != pref.get("updated_at_ts")
            )
            if not item_force and not cert_updated_on_server and existing and check_manifest_alive(existing.get("manifest_url", "")):
                log(f"✔ [{item['name']} | {base_name}] Link hoạt động tốt")
                if existing.get("ocsp_status") == "GOOD":
                    unrevoked_servers.append(existing)
                else:
                    enterprise_servers.append(existing)
                continue

            try:
                log(f"⏳ Đang ký [{item['name']}] với chứng chỉ [{base_name}]...")
                signed = sign_item_auto(cfg, item, cert_id)
                ocsp_st = check_cert_ocsp_status(cert_id, ocsp_memo)
                badge_txt = "🟢 Chứng chỉ Sống 100%" if ocsp_st == "GOOD" else "Enterprise • Cần DNS"
                server_entry = {
                    "cert_id": cert_id,
                    "label": base_name,
                    "badge": badge_txt,
                    "manifest_url": signed["manifest_url"],
                    "install_url": signed["install_url"],
                    "ipa_url": signed["ipa_url"],
                    "signed_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "cert_updated_at_ts": pref.get("updated_at_ts", 0),
                    "ocsp_status": ocsp_st,
                    "status": "active"
                }
                if ocsp_st == "GOOD":
                    unrevoked_servers.append(server_entry)
                else:
                    enterprise_servers.append(server_entry)
                renewed_items.append(f"{item['name']} ({base_name})")
                log(f"✅ Ký xong [{item['name']} | {base_name}] -> {signed['manifest_url']}")
                # Nghỉ nhẹ 1.5s giữa các lần gọi API ký để tránh bị rate-limit
                time.sleep(1.5)
            except Exception as e:
                err_detail = f"Lỗi ký [{item['name']} | {base_name}]: {e}"
                log(f"❌ {err_detail}")
                errors.append(err_detail)
                if existing and check_manifest_alive(existing.get("manifest_url", "")):
                    enterprise_servers.append(existing)

        item_servers = []
        item_servers.extend(unrevoked_servers)
        if apple_server:
            item_servers.append(apple_server)
        item_servers.extend(enterprise_servers)

        for idx, srv in enumerate(item_servers, start=1):
            clean_title = re.sub(r"^Server\s+\d+\s+—\s+", "", srv["label"])
            srv["label"] = f"Server {idx} — {clean_title}"

        cache["apps"][app_id] = {
            "id": app_id,
            "name": item["name"],
            "category": item.get("category", "app"),
            "version": item.get("version", "1.0"),
            "subtitle_vi": item.get("subtitle_vi", ""),
            "subtitle_en": item.get("subtitle_en", ""),
            "icon": item.get("icon", ""),
            "remote_ipa_signature": app_cache.get("remote_ipa_signature"),
            "updated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "servers": item_servers
        }

        if app_id == "shadowrocket":
            cache["servers"] = item_servers

    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cache["updated_at"] = now_str

    # Cảnh báo Email nếu có lỗi nghiêm trọng
    cooldown_sec = int(cfg["email_alert"].get("cooldown_minutes", 60)) * 60
    now_ts = time.time()
    total_active = sum(len(a.get("servers", [])) for a in cache["apps"].values())

    if total_active == 0:
        cache["last_error"] = "; ".join(errors) if errors else "Tất cả các Server đều lỗi."
        if not cache.get("in_error_state") or (now_ts - cache.get("last_alert_sent_at", 0) > cooldown_sec):
            subject = "🚨 [CẢNH BÁO KHẨN] Hệ thống ký App & Game iOS gặp sự cố!"
            body = f"""
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #f2d1cd; border-radius: 12px; background: #fff9f8;">
                <h2 style="color: #c62f35; margin-top: 0;">🚨 Cảnh báo lỗi hệ thống ký IPA</h2>
                <p>Thời gian: <b>{now_str}</b></p>
                <ul>{''.join(f'<li>{err}</li>' for err in errors)}</ul>
            </div>
            """
            if send_email_alert(cfg, subject, body):
                cache["last_alert_sent_at"] = now_ts
        cache["in_error_state"] = True
    else:
        cache["in_error_state"] = False
        cache["last_error"] = None

    save_cache(cache_path, cache)
    update_html_file(cfg, cache)
    return total_active > 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Quản lý tự động ký Kho App & Game iOS")
    parser.add_argument("--force", action="store_true", help="Bắt buộc ký mới lại tất cả App/Game")
    parser.add_argument("--daemon", action="store_true", help="Chạy ngầm liên tục để tự động kiểm tra và gia hạn")
    parser.add_argument("--test-email", action="store_true", help="Gửi thử 1 email kiểm tra cấu hình SMTP")
    parser.add_argument("--add-game", type=str, help="Thêm nhanh 1 Game/App mới từ URL bài viết ipaomtk.com")
    args = parser.parse_args()

    if args.add_game:
        add_game_from_ipaomtk_url(args.add_game)
        return

    if args.test_email:
        cfg = load_config()
        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        ok = send_email_alert(
            cfg,
            subject="🔔 [TEST] Kiểm tra kết nối Email Cảnh báo Kho App & Game iOS",
            html_body=f"""
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #d0e2ff; border-radius: 12px; background: #f5f9ff;">
                <h2 style="color: #0055ff; margin-top: 0;">🔔 Kết nối Email thành công!</h2>
                <p>Thời gian gửi: <b>{now_str}</b></p>
                <p>Hệ thống giám sát <b>Kho App & Game iOS Auto-Signer</b> đã sẵn sàng gửi cảnh báo tới hộp thư này.</p>
            </div>
            """,
            force=True
        )
        sys.exit(0 if ok else 1)

    if args.daemon:
        cfg = load_config()
        interval = int(cfg.get("monitor", {}).get("check_interval_seconds", 900))
        log(f"🚀 Khởi chạy chế độ Giám sát tự động (Kiểm tra mỗi {interval} giây)...")
        while True:
            try:
                run_sync(force_resign=False)
            except Exception as e:
                log(f"Lỗi ngoại lệ trong vòng lặp daemon: {e}")
            time.sleep(interval)
    else:
        run_sync(force_resign=args.force)


if __name__ == "__main__":
    main()
