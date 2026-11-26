import json
import os
import plistlib
import subprocess
import sys
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
CACHE_PATH = os.path.join(BASE_DIR, "links_cache.json")
PLIST_PATH = os.path.join(BASE_DIR, "shadowrocket-3u.plist")

RELEASE_TAG = "shadowrocket-3u"
ASSET_NAME = "Shadowrocket-3uTools.ipa"
DEFAULT_3U_PLIST = "https://dl.3u.com/plist/2026/09/08/1788829540721_622855.plist"
DEFAULT_3U_IPA = "https://dl.3u.com/soft/2026/09/07/z_932747118_890167352_1.ipa"
GITHUB_ASSET_URL = f"https://github.com/manhcuong2112003/Vincenttrick/releases/download/{RELEASE_TAG}/{ASSET_NAME}"


def load_json(path: str) -> dict:
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_json(path: str, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def fetch_3u_metadata(plist_url: str):
    req = urllib.request.Request(
        plist_url,
        headers={"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)"},
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        plist_bytes = resp.read()
    pl = plistlib.loads(plist_bytes)
    item = pl["items"][0]
    ipa_url = item["assets"][0]["url"]
    version = item["metadata"].get("bundle-version", "2.2.92")
    return ipa_url, version


def release_asset_exists() -> bool:
    proc = subprocess.run(
        ["gh", "release", "view", RELEASE_TAG, "--json", "assets", "-q", f'.assets[].name | select(. == "{ASSET_NAME}")'],
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0 and ASSET_NAME in proc.stdout


def update_local_plist(version: str) -> None:
    with open(PLIST_PATH, "rb") as f:
        pl = plistlib.load(f)
    pl["items"][0]["assets"][0]["url"] = GITHUB_ASSET_URL
    pl["items"][0]["metadata"]["bundle-version"] = version
    with open(PLIST_PATH, "wb") as f:
        plistlib.dump(pl, f)


def main() -> int:
    cfg = load_json(CONFIG_PATH)
    cache = load_json(CACHE_PATH)

    plist_url = DEFAULT_3U_PLIST
    apps = cfg.get("apps") or []
    if apps and apps[0].get("fallback_3utools_plist"):
        plist_url = apps[0]["fallback_3utools_plist"]

    try:
        ipa_url, version = fetch_3u_metadata(plist_url)
        print(f"[3uSync] Plist 3uTools OK: version={version}, ipa_url={ipa_url}")
    except Exception as e:
        print(f"[3uSync] Khong doc duoc plist 3uTools ({e}), thu link IPA mac dinh.")
        ipa_url = DEFAULT_3U_IPA
        version = cache.get("3u_synced_version") or "2.2.92"

    # Kiem tra header IPA (ETag / Last-Modified)
    remote_sig = ""
    try:
        head_req = urllib.request.Request(
            ipa_url,
            method="HEAD",
            headers={"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)"},
        )
        with urllib.request.urlopen(head_req, timeout=25) as hr:
            remote_sig = hr.headers.get("ETag") or hr.headers.get("Last-Modified") or hr.headers.get("Content-Length") or ""
    except Exception as e:
        print(f"[3uSync] Khong ket noi duoc toi dl.3u.com ({e}).")
        if release_asset_exists():
            print("[3uSync] Van giu nguyen ban du phong da luu tren GitHub Releases.")
            return 0
        print("[3uSync] Chua co asset tren GitHub Releases va khong tai duoc tu 3uTools.", file=sys.stderr)
        return 1

    has_asset = release_asset_exists()
    if has_asset and cache.get("3u_synced_ipa_url") == ipa_url and cache.get("3u_synced_sig") == remote_sig:
        print(f"[3uSync] Ban Shadowrocket 3uTools ({version}) tren GitHub Releases da la moi nhat.")
        return 0

    tmp_ipa = os.path.join(BASE_DIR, ASSET_NAME)
    print(f"[3uSync] Dang tai IPA tu {ipa_url}...")
    dl_req = urllib.request.Request(
        ipa_url,
        headers={"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)"},
    )
    with urllib.request.urlopen(dl_req, timeout=180) as r, open(tmp_ipa, "wb") as out_f:
        while True:
            chunk = r.read(1024 * 256)
            if not chunk:
                break
            out_f.write(chunk)

    size_mb = os.path.getsize(tmp_ipa) / (1024 * 1024)
    print(f"[3uSync] Da tai xong {ASSET_NAME} ({size_mb:.2f} MB). Dang day len GitHub Release...")

    chk = subprocess.run(["gh", "release", "view", RELEASE_TAG], capture_output=True)
    if chk.returncode != 0:
        subprocess.run(
            ["gh", "release", "create", RELEASE_TAG, "--title", "Shadowrocket 3uTools Mirror", "--notes", "Ban du phong Shadowrocket tai truc tiep tu may chu 3uTools."],
            check=True,
        )
    subprocess.run(["gh", "release", "upload", RELEASE_TAG, tmp_ipa, "--clobber"], check=True)
    os.remove(tmp_ipa)

    update_local_plist(version)
    cache["3u_synced_ipa_url"] = ipa_url
    cache["3u_synced_sig"] = remote_sig
    cache["3u_synced_version"] = version
    save_json(CACHE_PATH, cache)
    print(f"[3uSync] Hoan tat dong bo Shadowrocket v{version} len Release {RELEASE_TAG}!")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
