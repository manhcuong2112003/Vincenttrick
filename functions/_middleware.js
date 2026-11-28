// Cloudflare Pages Middleware: One-Time Link Gate (@cuonghym)
// Yêu cầu bind KV Namespace "ONE_TIME_LINKS" (cùng KV với Worker Telegram Bot)
// và biến bí mật (Secret) "LINK_SECRET" trên Cloudflare Pages Settings.

const SESSION_COOKIE = "vt_sess";
const SESSION_TTL_SEC = 900; // 15 phút để hoàn tất cài Shadowrocket + DNS trên đúng Safari đó
const LINK_PREVIEW_BOTS = /TelegramBot|facebookexternalhit|Facebot|WhatsApp|Zalo|Twitterbot|Discordbot|Slackbot|LinkedInBot/i;

function toHex(buf) {
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSign(secret, message) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
    return toHex(sig);
}

function getCookie(request, name) {
    const raw = request.headers.get("cookie") || "";
    const parts = raw.split(";");
    for (const p of parts) {
        const idx = p.indexOf("=");
        if (idx === -1) continue;
        if (p.slice(0, idx).trim() === name) return p.slice(idx + 1).trim();
    }
    return "";
}

async function verifySignedToken(secret, rawValue, expectedPrefix) {
    if (!rawValue || !rawValue.includes(".")) return false;
    const [expStr, sig] = rawValue.split(".");
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || Date.now() > exp) return false;
    const expected = await hmacSign(secret, `${expectedPrefix}:${expStr}`);
    return sig === expected;
}

function renderBlockedHtml(title, message) {
    return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Vincenttrick</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0f19;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:20px}
  .box{max-width:380px;width:100%;background:#131a2a;border:1px solid #24304a;border-radius:18px;padding:26px 22px;text-align:center;box-shadow:0 16px 40px rgba(0,0,0,.45)}
  .ico{font-size:40px;margin-bottom:10px}
  h1{margin:0 0 10px;font-size:20px}
  p{margin:0 0 20px;color:#94a3b8;font-size:14px;line-height:1.55}
  a.btn{display:inline-block;padding:12px 20px;border-radius:12px;background:linear-gradient(135deg,#2563eb,#38bdf8);color:#fff;font-weight:700;text-decoration:none;font-size:14px}
</style>
</head>
<body>
  <div class="box">
    <div class="ico">🔒</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a class="btn" href="https://t.me/cuonghym" target="_blank" rel="noopener">Liên hệ Telegram @cuonghym</a>
  </div>
</body>
</html>`;
}

function renderRedeemHtml(token) {
    return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mở khóa phiên cài đặt Shadowrocket</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0f19;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:20px}
  .box{max-width:380px;width:100%;background:#131a2a;border:1px solid #24304a;border-radius:18px;padding:26px 22px;text-align:center;box-shadow:0 16px 40px rgba(0,0,0,.45)}
  .ico{font-size:40px;margin-bottom:10px}
  h1{margin:0 0 10px;font-size:20px}
  p{margin:0 0 20px;color:#94a3b8;font-size:14px;line-height:1.55}
  button{width:100%;padding:13px 18px;border:0;border-radius:12px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;font-weight:700;font-size:15px;cursor:pointer}
</style>
</head>
<body>
  <div class="box">
    <div class="ico">📱</div>
    <h1>Link cài đặt Shadowrocket</h1>
    <p>Link này chỉ dùng <b>1 lần duy nhất</b> và có hiệu lực trong phiên tải 15 phút trên trình duyệt Safari hiện tại.</p>
    <form method="POST" action="/api/redeem">
      <input type="hidden" name="token" value="${token}">
      <button type="submit">🔓 Bắt đầu cài đặt Shadowrocket</button>
    </form>
  </div>
</body>
</html>`;
}

export async function onRequest(context) {
    const { request, env, next } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. Luôn mở các endpoint chạy nền của Shadowrocket/DNS & assets tĩnh (không chứa API key)
    if (
        path === "/dns-query" ||
        path.startsWith("/assets/") ||
        path === "/revenuecat_gold.js" ||
        path === "/locket_gold_30s.js" ||
        path === "/deleteHeader.js" ||
        path === "/youtube.request.js" ||
        path === "/youtube.response.js"
    ) {
        return next();
    }

    // Nếu chưa gắn KV ONE_TIME_LINKS trên Cloudflare Pages, tạm cho qua để không làm sập trang trước khi cấu hình xong
    if (!env.ONE_TIME_LINKS) {
        const resp = await next();
        const hdrs = new Headers(resp.headers);
        hdrs.set("X-Auth-Mode", "kv-unbound");
        return new Response(resp.body, { status: resp.status, headers: hdrs });
    }

    const secret = (env.LINK_SECRET || "vincenttrick-ephemeral-gate").trim();
    const ua = request.headers.get("user-agent") || "";

    // 2. Tải Module 1-lần: /m/<token>/(locket|combo|youtube).module
    const modMatch = path.match(/^\/m\/([a-f0-9]{24,64})\/(locket|combo|youtube)\.module$/i);
    if (modMatch) {
        const token = modMatch[1];
        const modName = modMatch[2].toLowerCase();
        // Không để bot preview (Telegram/Zalo) làm cháy link 1-lần
        if (LINK_PREVIEW_BOTS.test(ua)) {
            return new Response("Vincenttrick One-Time Module Link", {
                status: 200,
                headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
            });
        }
        const raw = await env.ONE_TIME_LINKS.get(`tok:${token}`);
        if (!raw) {
            return new Response(
                renderBlockedHtml("Link Module đã hết hạn", "Link tải module này đã quá 1 tiếng hoặc đã được sử dụng. Vui lòng liên hệ <b>@cuonghym</b> để xin link mới."),
                { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
            );
        }
        let meta = {};
        try { meta = JSON.parse(raw); } catch {}
        if (meta.scope !== `module:${modName}`) {
            return new Response(
                renderBlockedHtml("Sai loại Module", "Token này không áp dụng cho module bạn vừa mở. Vui lòng liên hệ <b>@cuonghym</b>."),
                { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
            );
        }
        // Xóa ngay token sau lần tải đầu tiên (không thể tái sử dụng)
        await env.ONE_TIME_LINKS.delete(`tok:${token}`);
        const assetResp = await env.ASSETS.fetch(new Request(new URL(`/${modName}.module`, url.origin)));
        return new Response(assetResp.body, {
            status: assetResp.status,
            headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-store, no-cache, must-revalidate",
                "Content-Disposition": `inline; filename="${modName}.module"`
            }
        });
    }

    // Chặn truy cập trực tiếp file .module không có token
    if (path === "/locket.module" || path === "/combo.module" || path === "/youtube.module") {
        return new Response(
            renderBlockedHtml("Truy cập bị giới hạn", "Vui lòng liên hệ <b>@cuonghym</b> trên Telegram để nhận link tải Module dùng 1 lần."),
            { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
        );
    }

    // 3. Xác nhận tiêu hủy token Shadowrocket Portal (POST /api/redeem) -> cấp cookie tạm 15 phút
    if (path === "/api/redeem" && request.method === "POST") {
        const form = await request.formData();
        const token = String(form.get("token") || "").trim();
        if (!/^[a-f0-9]{24,64}$/i.test(token)) {
            return new Response(
                renderBlockedHtml("Link không hợp lệ", "Vui lòng liên hệ <b>@cuonghym</b> để nhận link mới."),
                { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } }
            );
        }
        const raw = await env.ONE_TIME_LINKS.get(`tok:${token}`);
        if (!raw) {
            return new Response(
                renderBlockedHtml("Link đã hết hạn hoặc đã dùng", "Mỗi link chỉ mở được 1 lần trong vòng 1 tiếng. Vui lòng liên hệ <b>@cuonghym</b> để xin link mới."),
                { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } }
            );
        }
        let meta = {};
        try { meta = JSON.parse(raw); } catch {}
        if (meta.scope !== "sdrk") {
            return new Response(
                renderBlockedHtml("Sai loại link", "Link này không dùng cho trang Shadowrocket. Vui lòng liên hệ <b>@cuonghym</b>."),
                { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } }
            );
        }
        // Tiêu hủy token ngay lập tức
        await env.ONE_TIME_LINKS.delete(`tok:${token}`);
        const exp = String(Date.now() + SESSION_TTL_SEC * 1000);
        const sig = await hmacSign(secret, `sdrk:${exp}`);
        return new Response(null, {
            status: 302,
            headers: {
                "Location": "/",
                "Cache-Control": "no-store",
                "Set-Cookie": `${SESSION_COOKIE}=${exp}.${sig}; Max-Age=${SESSION_TTL_SEC}; Path=/; HttpOnly; Secure; SameSite=Lax`
            }
        });
    }

    // 4. Kiểm tra link /?t=<token> (hiển thị trang nút xác nhận, tránh bot preview làm cháy token)
    if ((path === "/" || path === "/index.html") && url.searchParams.has("t")) {
        const token = (url.searchParams.get("t") || "").trim();
        if (LINK_PREVIEW_BOTS.test(ua)) {
            return new Response("Vincenttrick Shadowrocket Portal — Liên hệ @cuonghym", {
                status: 200,
                headers: { "Content-Type": "text/plain; charset=utf-8" }
            });
        }
        if (/^[a-f0-9]{24,64}$/i.test(token)) {
            const raw = await env.ONE_TIME_LINKS.get(`tok:${token}`);
            if (raw) {
                let meta = {};
                try { meta = JSON.parse(raw); } catch {}
                if (meta.scope === "sdrk") {
                    return new Response(renderRedeemHtml(token), {
                        status: 200,
                        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
                    });
                }
            }
        }
        return new Response(
            renderBlockedHtml("Link đã hết hạn hoặc đã dùng", "Mỗi link chỉ sử dụng được 1 lần trong vòng 1 tiếng. Vui lòng liên hệ <b>@cuonghym</b> để nhận link mới."),
            { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
        );
    }

    // 5. Cho phép iOS installd tải shadowrocket-3u.plist bằng chữ ký ngắn hạn ?p=<exp>.<sig> (không cần cookie Safari)
    if (path === "/shadowrocket-3u.plist") {
        const pTok = url.searchParams.get("p") || "";
        const okPlist = await verifySignedToken(secret, pTok, "plist");
        const sessCookie = getCookie(request, SESSION_COOKIE);
        const okSess = await verifySignedToken(secret, sessCookie, "sdrk");
        if (!okPlist && !okSess) {
            return new Response("Forbidden — Contact @cuonghym", { status: 403 });
        }
        return next();
    }

    // 6. Các trang/file Portal còn lại (/, /index.html, .mobileconfig, links_cache.json, frames.html)
    const sessCookie = getCookie(request, SESSION_COOKIE);
    const hasSession = await verifySignedToken(secret, sessCookie, "sdrk");
    if (!hasSession) {
        return new Response(
            renderBlockedHtml("Truy cập bị giới hạn", "Trang cài đặt này chỉ mở qua link dùng 1 lần. Vui lòng liên hệ <b>@cuonghym</b> trên Telegram để nhận link tải."),
            { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
        );
    }

    // Khi trả index.html hoặc links_cache.json cho phiên hợp lệ: gắn chữ ký 15p cho shadowrocket-3u.plist & ẩn tab Module (tách rõ Shadowrocket vs Module)
    if (path === "/" || path === "/index.html" || path === "/links_cache.json") {
        const resp = await next();
        let text = await resp.text();
        const pExp = String(Date.now() + SESSION_TTL_SEC * 1000);
        const pSig = await hmacSign(secret, `plist:${pExp}`);
        const signedPlist = `https://vincenttrick.pages.dev/shadowrocket-3u.plist?p=${pExp}.${pSig}`;
        const signedPlistEnc = encodeURIComponent(signedPlist);
        text = text.replaceAll(
            "https%3A%2F%2Fvincenttrick.pages.dev%2Fshadowrocket-3u.plist",
            signedPlistEnc
        ).replaceAll(
            "https://vincenttrick.pages.dev/shadowrocket-3u.plist",
            signedPlist
        );
        if (path === "/" || path === "/index.html") {
            text = text.replace("</head>", "<style>#tab-btn-locket,#tab-content-locket{display:none!important}</style></head>");
        }
        const hdrs = new Headers(resp.headers);
        hdrs.set("Cache-Control", "no-store");
        return new Response(text, { status: resp.status, headers: hdrs });
    }

    return next();
}
