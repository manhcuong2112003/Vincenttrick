/**
 * Cloudflare Worker: Locket Filter Backend (AI-Powered + Transparent Reverse Proxy)
 * Domain: https://locket-filter.manhcuong2112003.workers.dev/
 */

let lastDebugInfo = {
    lastRequestSchema: null,
    lastResult: null,
    timestamp: null
};

// Trạng thái giám sát Server Photobooth & lịch sử chống ngủ (lưu kèm caches.default)
let monitorState = {
    status: "unknown",      // "online" | "offline" | "unconfigured" | "unknown"
    lastPingAt: null,       // Thời điểm gửi lệnh chống ngủ gần nhất (ISO)
    lastPingSource: null,   // "cron" | "telegram" | "dashboard"
    latencyMs: null,
    healthData: null,       // { uptime_sec, ram_mb, active_sessions, total_rendered, total_errors }
    lastError: null,
    pingCount: 0
};

const MONITOR_CACHE_URL = "https://monitor.cache.local/v1/photobooth-state";
const DEFAULT_PHOTOBOOTH_SERVER_URL = "https://locket-photobooth-server.onrender.com";

async function syncDebugToRender(env, payload) {
    const pbServerUrl = getPhotoboothServerUrl(env);
    if (!pbServerUrl) return;
    try {
        const headers = { "Content-Type": "application/json" };
        if (env?.PHOTOBOOTH_SECRET) headers["X-API-Secret"] = env.PHOTOBOOTH_SECRET;
        await fetch(`${pbServerUrl}/last-debug`, {
            method: "POST",
            headers,
            body: JSON.stringify(payload)
        });
    } catch { }
}

async function fetchDebugFromRender(env) {
    const pbServerUrl = getPhotoboothServerUrl(env);
    if (!pbServerUrl) return null;
    try {
        const r = await fetch(`${pbServerUrl}/last-debug`);
        if (r.ok) return await r.json();
    } catch { }
    return null;
}

function getPhotoboothServerUrl(env) {
    return ((env?.PHOTOBOOTH_SERVER_URL || DEFAULT_PHOTOBOOTH_SERVER_URL) + "").trim().replace(/\/+$/, "");
}

function formatVnTime(isoStr) {
    if (!isoStr) return "Chưa có";
    try {
        const d = new Date(isoStr);
        const vn = new Date(d.getTime() + 7 * 3600 * 1000);
        const pad = (n) => String(n).padStart(2, "0");
        return `${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}:${pad(vn.getUTCSeconds())} ${pad(vn.getUTCDate())}/${pad(vn.getUTCMonth() + 1)}`;
    } catch {
        return isoStr;
    }
}

function getPhotoboothUserKey(request) {
    const auth = request.headers.get("authorization") || "";
    if (auth.startsWith("Bearer ")) {
        const token = auth.slice(7).trim();
        const parts = token.split(".");
        if (parts.length >= 2) {
            try {
                let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
                while (b64.length % 4 !== 0) b64 += "=";
                const payload = JSON.parse(atob(b64));
                if (payload.user_id || payload.sub) return String(payload.user_id || payload.sub);
            } catch { }
        }
        return token.slice(-32);
    }
    return request.headers.get("cf-connecting-ip") || "default_user";
}

async function loadMonitorState() {
    if (monitorState.lastPingAt) return monitorState;
    try {
        if (typeof caches !== "undefined" && caches.default) {
            const cached = await caches.default.match(new Request(MONITOR_CACHE_URL));
            if (cached) {
                const data = await cached.json();
                monitorState = Object.assign(monitorState, data);
            }
        }
    } catch { }
    return monitorState;
}

async function saveMonitorState() {
    try {
        if (typeof caches !== "undefined" && caches.default) {
            await caches.default.put(
                new Request(MONITOR_CACHE_URL),
                new Response(JSON.stringify(monitorState), {
                    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" }
                })
            );
        }
    } catch { }
}

async function sendTelegram(env, text) {
    const token = (env?.TELEGRAM_BOT_TOKEN || "").trim();
    const chatId = (env?.TELEGRAM_CHAT_ID || "").trim();
    if (!token || !chatId) return false;
    try {
        const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: "HTML",
                disable_web_page_preview: true
            })
        });
        return resp.ok;
    } catch {
        return false;
    }
}

async function pingPhotoboothServer(env, source = "cron") {
    await loadMonitorState();
    const prevStatus = monitorState.status;
    const serverUrl = getPhotoboothServerUrl(env);
    const nowIso = new Date().toISOString();

    if (!serverUrl) {
        monitorState.status = "unconfigured";
        monitorState.lastPingAt = nowIso;
        monitorState.lastPingSource = source;
        monitorState.lastError = "Chưa cấu hình biến PHOTOBOOTH_SERVER_URL trên Cloudflare";
        await saveMonitorState();
        return monitorState;
    }

    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const resp = await fetch(`${serverUrl}/health`, {
            method: "GET",
            headers: { "User-Agent": "Locket-AntiSleep-Cron/1.0" },
            signal: controller.signal
        });
        const latencyMs = Date.now() - t0;
        if (resp.ok) {
            let healthData = null;
            try { healthData = await resp.json(); } catch { }
            monitorState.status = "online";
            monitorState.lastPingAt = nowIso;
            monitorState.lastPingSource = source;
            monitorState.latencyMs = latencyMs;
            monitorState.healthData = healthData;
            monitorState.lastError = null;
            monitorState.pingCount = (monitorState.pingCount || 0) + 1;
            await saveMonitorState();

            if (prevStatus === "offline") {
                await sendTelegram(
                    env,
                    `✅ <b>Server Photobooth đã ONLINE trở lại!</b>\n⏱ Ping: <code>${latencyMs}ms</code>\n🕒 Lúc: <code>${formatVnTime(nowIso)}</code>`
                );
            }
        } else {
            throw new Error(`HTTP ${resp.status}`);
        }
    } catch (err) {
        monitorState.status = "offline";
        monitorState.lastPingAt = nowIso;
        monitorState.lastPingSource = source;
        monitorState.latencyMs = Date.now() - t0;
        monitorState.lastError = err.message;
        monitorState.pingCount = (monitorState.pingCount || 0) + 1;
        await saveMonitorState();

        if (prevStatus !== "offline") {
            await sendTelegram(
                env,
                `🚨 <b>CẢNH BÁO: Server Photobooth NGỦ hoặc LỖI!</b>\n❌ Lỗi: <code>${err.message}</code>\n🌐 URL: <code>${serverUrl}</code>\n🕒 Lúc: <code>${formatVnTime(nowIso)}</code>\n👉 Nhắn <code>/ping</code> để gửi lệnh đánh thức thủ công.`
            );
        }
    } finally {
        clearTimeout(timer);
    }
    return monitorState;
}

function buildStatusMessage(state, serverUrl) {
    const icon = state.status === "online" ? "🟢 ONLINE" : state.status === "offline" ? "🔴 OFFLINE / NGỦ" : "⚪ CHƯA CẤU HÌNH";
    const hd = state.healthData || {};
    const uptimeMin = typeof hd.uptime_sec === "number" ? `${Math.floor(hd.uptime_sec / 60)} phút` : "—";
    const ram = typeof hd.ram_mb === "number" ? `${hd.ram_mb} MB` : "—";
    const rendered = typeof hd.total_rendered === "number" ? `${hd.total_rendered} ảnh` : "—";
    return [
        `📊 <b>TRẠNG THÁI SERVER PHOTOBOOTH 2K</b>`,
        `• Trạng thái: <b>${icon}</b>`,
        `• Server: <code>${serverUrl || "Chưa cài PHOTOBOOTH_SERVER_URL"}</code>`,
        `• Lệnh chống ngủ gần nhất: <code>${formatVnTime(state.lastPingAt)}</code> (${state.lastPingSource || "—"})`,
        `• Độ trễ ping: <code>${state.latencyMs != null ? state.latencyMs + "ms" : "—"}</code>`,
        `• RAM đang dùng: <code>${ram}</code> | Uptime: <code>${uptimeMin}</code>`,
        `• Tổng ảnh 2K đã ghép: <code>${rendered}</code>`,
        state.lastError ? `• Lỗi gần nhất: <code>${state.lastError}</code>` : ""
    ].filter(Boolean).join("\n");
}

function renderDashboardHtml(state, serverUrl, keyParam) {
    const isOnline = state.status === "online";
    const badgeColor = isOnline ? "#16a34a" : state.status === "offline" ? "#dc2626" : "#64748b";
    const badgeText = isOnline ? "ONLINE (Đang thức)" : state.status === "offline" ? "OFFLINE / ĐANG NGỦ" : "CHƯA CẤU HÌNH";
    const hd = state.healthData || {};
    const keyQuery = keyParam ? `?key=${encodeURIComponent(keyParam)}` : "";
    return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Locket Photobooth Dashboard</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:20px}
  .card{max-width:560px;margin:0 auto 16px;background:#1e293b;border-radius:16px;padding:20px;box-shadow:0 8px 24px rgba(0,0,0,.35)}
  h1{font-size:20px;margin:0 0 12px;display:flex;align-items:center;justify-content:space-between}
  .badge{font-size:12px;padding:4px 10px;border-radius:999px;background:${badgeColor};color:#fff;font-weight:700}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #334155;font-size:14px}
  .row:last-child{border-bottom:none}
  .label{color:#94a3b8}
  .val{font-weight:600;text-align:right;word-break:break-all}
  button{width:100%;padding:12px;border:none;border-radius:12px;background:#3b82f6;color:#fff;font-size:15px;font-weight:700;cursor:pointer;margin-top:12px}
  button:active{opacity:.85}
  pre{background:#0f172a;padding:12px;border-radius:10px;overflow-x:auto;font-size:12px;color:#38bdf8;margin:8px 0 0}
</style>
</head>
<body>
  <div class="card">
    <h1>📸 Photobooth 2K Monitor <span class="badge">${badgeText}</span></h1>
    <div class="row"><span class="label">Server hiện tại</span><span class="val">${serverUrl || "Chưa cài PHOTOBOOTH_SERVER_URL"}</span></div>
    <div class="row"><span class="label">Lệnh chống ngủ gần nhất</span><span class="val">${formatVnTime(state.lastPingAt)} (${state.lastPingSource || "—"})</span></div>
    <div class="row"><span class="label">Độ trễ Ping</span><span class="val">${state.latencyMs != null ? state.latencyMs + " ms" : "—"}</span></div>
    <div class="row"><span class="label">RAM đang dùng</span><span class="val">${hd.ram_mb != null ? hd.ram_mb + " MB" : "—"}</span></div>
    <div class="row"><span class="label">Uptime</span><span class="val">${hd.uptime_sec != null ? Math.floor(hd.uptime_sec / 60) + " phút" : "—"}</span></div>
    <div class="row"><span class="label">Tổng ảnh 2K đã ghép</span><span class="val">${hd.total_rendered != null ? hd.total_rendered : "—"}</span></div>
    <div class="row"><span class="label">Tổng số lần chống ngủ</span><span class="val">${state.pingCount || 0}</span></div>
    ${state.lastError ? `<div class="row"><span class="label">Lỗi gần nhất</span><span class="val" style="color:#f87171">${state.lastError}</span></div>` : ""}
    <button onclick="doPing(this)">⚡ Gửi lệnh chống ngủ ngay (Ping Now)</button>
  </div>
  <div class="card">
    <div style="font-weight:700;font-size:15px;margin-bottom:6px">🧾 Lần xử lý Filter / Photobooth gần nhất</div>
    <pre>${JSON.stringify(lastDebugInfo.lastResult || { note: "Chưa có lượt chụp nào trong phiên này" }, null, 2)}</pre>
  </div>
  <script>
    async function doPing(btn){
      btn.disabled=true; btn.textContent="Đang gửi lệnh ping...";
      try { await fetch("/api/ping${keyQuery}", { method:"POST" }); location.reload(); }
      catch(e){ alert("Lỗi: "+e.message); btn.disabled=false; btn.textContent="⚡ Gửi lệnh chống ngủ ngay (Ping Now)"; }
    }
  </script>
</body>
</html>`;
}

// Bộ nhớ đệm ảnh đầu ra trên Edge Isolate (kết hợp cùng caches.default)
const recentGeneratedImages = new Map();

// Danh sách Prompt tối ưu riêng cho FLUX.2 Klein 4B cho toàn bộ 80+ Filter của Locket 2.73.0
const FILTER_PROMPTS = {
    // Celebrate & Party
    disco: "Show the person in the photo with the exact same pose and background, illuminated by vibrant colorful 70s disco party lights and glowing reflections",
    disco_lights: "Show the person in the photo with the exact same pose and background, illuminated by vibrant colorful disco ball lighting and neon party glow",
    princess: "Show the person in the photo with the exact same pose and background, wearing a sparkling silver diamond princess tiara on their head and a pink satin sash",
    cash_money: "Show the person in the photo with the exact same pose and background, with crisp US $100 bills raining down through the air around them",
    slimed: "Show the person in the photo with the exact same pose and background, with bright green glossy Nickelodeon slime splashing over their head and shoulders",
    happy_birthday: "Show the person in the photo with the exact same pose and background, with colorful festive birthday confetti falling through the air around them",
    camera_filter_2026: "Show the person in the photo with the exact same pose and background, surrounded by falling gold and white celebratory confetti",
    new_year_glasses: "Show the person in the photo with the exact same pose and background, wearing festive glittering 2026 New Year party glasses",
    tuxedo: "Show the person in the photo with the exact same pose and background, dressed in a sharp classic black tuxedo with a bow tie",
    camera_filter_tuxedo: "Show the person in the photo with the exact same pose and background, dressed in a sharp classic black tuxedo with a festive party hat",
    fireworks: "Show the person in the photo with the exact same pose and background, with colorful fireworks exploding in the sky behind them",

    // Holidays (Noel, Valentine, Easter, St. Patrick)
    elf: "Show the person in the photo with the exact same pose and background, dressed up in a festive Christmas Elf costume with a green pointed elf hat with red trim and a red and green elf collar",
    elf_cutout: "Show the person in the photo with the exact same pose and background, dressed up in a festive Christmas Elf costume with a green pointed elf hat with red trim and a red and green elf collar",
    camera_filter_elf: "Show the person in the photo with the exact same pose and background, dressed up in a festive Christmas Elf costume with a green pointed elf hat and elf ears",
    santa: "Show the person in the photo with the exact same pose and background, dressed up as Santa Claus with a red velvet Santa hat with white fur trim and a red Santa coat",
    santa_cutout: "Show the person in the photo with the exact same pose and background, dressed up as Santa Claus with a red velvet Santa hat with white fur trim and a red Santa coat",
    camera_filter_santa: "Show the person in the photo with the exact same pose and background, dressed up as Santa Claus with a classic red and white Santa hat and suit",
    frosty: "Show the person in the photo with the exact same pose and background, with realistic winter snow gently covering their hair, shoulders, and the background",
    frosty_cutout: "Show the person in the photo with the exact same pose and background, with realistic winter snow gently covering their hair, shoulders, and the background",
    snow: "Show the person in the photo with the exact same pose and background, with magical winter snowflakes falling around them and snow on their shoulders",
    snowflake: "Show the person in the photo with the exact same pose and background, with magical winter snowflakes falling around them",
    sweet_hearts: "Show the person in the photo with the exact same pose and background, holding a cute pastel pink conversation candy heart that says LOVE YOU",
    candy_hearts: "Show the person in the photo with the exact same pose and background, holding a cute pastel pink conversation candy heart that says BE MINE",
    candy_hearts_filter: "Show the person in the photo with the exact same pose and background, holding a cute pastel pink conversation candy heart that says XOXO",
    heart_tee: "Show the person in the photo with the exact same pose and background, wearing a clean white t-shirt with a cute red heart print",
    roses: "Show the person in the photo with the exact same pose and background, holding a romantic red rose",
    rose_filter: "Show the person in the photo with the exact same pose and background, holding a romantic red rose",
    bearded: "Show the person in the photo with the exact same pose and background, with a neat medium-length ginger beard and matching ginger eyebrows",
    leprechaun: "Show the person in the photo with the exact same pose and background, wearing a festive Irish leprechaun green top hat with a gold buckle and green outfit",
    lucky_face: "Show the person in the photo with the exact same pose and background, with cute subtle freckles across the nose and a small glossy green four-leaf clover sticker on each cheek",
    easter_bunny: "Show the person in the photo with the exact same pose and background, wearing a cute fluffy white Easter Bunny hood with long pink-lined bunny ears leaving their face clearly visible",
    easter_bunney_cutout: "Show the person in the photo with the exact same pose and background, wearing a cute fluffy white Easter Bunny hood with long pink-lined bunny ears leaving their face clearly visible",
    easter_chick: "Show the person in the photo with the exact same pose and background, wearing a cute fluffy bright yellow Easter chick hoodie with a tiny orange beak on the hood above their forehead",
    easter_chick_cutout: "Show the person in the photo with the exact same pose and background, wearing a cute fluffy bright yellow Easter chick hoodie with a tiny orange beak on the hood above their forehead",

    // Cute & Stickers
    flower_crown: "Show the person in the photo with the exact same pose and background, wearing a vibrant crown of fresh colorful wildflowers resting naturally on their head",
    cutesy: "Show the person in the photo with the exact same pose and background, with cute rosy blush on their cheeks, gentle freckles across the nose, and soft kawaii sparkles",
    sticker_face: "Show the person in the photo with the exact same pose and background, with cute colorful glossy heart and star stickers placed playfully across their cheeks and forehead",
    sticker_Face: "Show the person in the photo with the exact same pose and background, with cute colorful glossy heart and star stickers placed playfully across their cheeks and forehead",
    love_bug: "Show the person in the photo with the exact same pose and background, wearing a cute headband with playful antennae topped with bright yellow hearts",
    locket: "Show the person in the photo with the exact same pose and background, wearing a shiny gold heart-shaped locket necklace around their neck",
    kisses: "Show the person in the photo with the exact same pose and background, with playful red lipstick kiss marks on their cheeks",
    baby_tee: "Show the person in the photo with the exact same pose and background, wearing a trendy pastel yellow fitted t-shirt",

    // Costumes
    cowboy: "Show the person in the photo with the exact same pose and background, wearing a classic brown leather Western cowboy hat and a denim jacket with a red paisley bandana",
    cowboy_cowgirl: "Show the person in the photo with the exact same pose and background, wearing a classic brown leather Western cowboy hat and a western jacket with a bandana",
    giraffe: "Show the person in the photo with the exact same pose and background, wearing a cute plush giraffe onesie hoodie with giraffe pattern and small giraffe ears on the hood",
    wedding: "Show the person in the photo with the exact same pose and background, dressed in elegant formal wedding attire with a white tuxedo or white bridal veil",
    clown: "Show the person in the photo with the exact same pose and background, wearing a colorful rainbow curly clown wig, a bright red foam clown nose, and a playful circus collar",
    founding_father: "Show the person in the photo with the exact same pose and background, wearing a classic 18th-century white powdered curly colonial wig",
    Founding_father: "Show the person in the photo with the exact same pose and background, wearing a classic 18th-century white powdered curly colonial wig",

    // Hiệu ứng Thời tiết AI (FLUX.2 Klein 4B)
    ai_blizzard_snow: "Show the person in the photo with the exact same face and pose, surrounded by a heavy winter snowstorm with thick white snow covering the ground, background, their hair and shoulders, dense falling snowflakes, and cold icy blue winter lighting",
    ai_scorching_sun: "Show the person in the photo with the exact same face and pose, bathed in intense blazing golden sunlight with a huge bright glowing sun and warm lens flare in the sky behind them, dry arid sunlit background, heat haze, and hot golden summer lighting",

    // Looks & Hair
    bye_brows: "Show the person in the photo with the exact same pose and background, with their eyebrows smoothly removed while keeping their face and expression identical",
    no_eyebrows: "Show the person in the photo with the exact same pose and background, with their eyebrows smoothly removed while keeping their face and expression identical",
    braces: "Show the person in the photo with the exact same pose and background, wearing shiny metallic orthodontic braces with colorful bands on their teeth",
    tatted: "Show the person in the photo with the exact same pose and background, with cool artistic temporary tattoos on their cheeks and neck",
    beard: "Show the person in the photo with the exact same pose and background, with a full, well-groomed thick beard and mustache added naturally to their face",
    buns: "Show the person in the photo with the exact same pose and background, with their hair styled into two cute symmetrical space buns on top of their head",
    mohawk: "Show the person in the photo with the exact same pose and background, sporting a bold punk rock spiky mohawk hairstyle",
    bob_cut: "Show the person in the photo with the exact same pose and background, with their hair styled into a sleek chin-length classic bob haircut",
    bowling_ball: "Show the person in the photo with the exact same pose and background, with a completely smooth shiny bald head while keeping their face identical",
    bowling_Ball: "Show the person in the photo with the exact same pose and background, with a completely smooth shiny bald head while keeping their face identical",
    blonde_bleached: "Show the person in the photo with the exact same pose and background, with trendy platinum bleached blonde buzz-cut hair",
    silver_fox: "Show the person in the photo with the exact same pose and background, with sleek metallic platinum silver hair",

    // Goofy & Fun
    looks_maxxing: "Show the person in the photo with the exact same pose and background, with an ultra-sharp chiseled supermodel jawline and defined cheekbones",
    influencer: "Show the person in the photo with the exact same pose and background, with ultra-glamorous beauty influencer makeup, glowing highlighter, and glossy lips",
    toothless: "Show the person in the photo with the exact same pose and background, with a funny goofy gap where one front tooth is missing",
    okay_wig: "Show the person in the photo with the exact same pose and background, wearing a bright neon orange straight bob wig",
    wig: "Show the person in the photo with the exact same pose and background, wearing a vibrant neon pink straight-hair wig",
    fire_breather: "Show the person in the photo with the exact same pose and background, with a dramatic theatrical flame effect glowing in front of them",
    fire_breathing: "Show the person in the photo with the exact same pose and background, with a dramatic dragon flame effect glowing in front of them",
    frame_mog: "Show the person in the photo with the exact same pose and background, with broad athletic bodybuilder shoulders in a red gym tank top",

    // Movies, Pop Culture & Fantasy
    practical_magic: "Show the person in the photo with the exact same pose and background, surrounded by magical glowing purple and gold witchy sparkles and enchanted moonlight",
    wizard: "Show the person in the photo with the exact same pose and background, dressed as a Hogwarts wizard wearing a dark magical robe, house scarf, and holding a glowing magic wand",
    wuthering_heights: "Show the person in the photo with the exact same pose and background, dressed in dramatic Victorian period romance attire on a misty moor",
    stranger_things: "Show the person in the photo with the exact same pose and background, styled in 1980s retro Hawkins fashion with dramatic neon synthwave lighting",
    Stranger_things: "Show the person in the photo with the exact same pose and background, styled in 1980s retro Hawkins fashion with dramatic neon synthwave lighting",
    survivor: "Show the person in the photo with the exact same pose and background, wearing a tropical island Survivor buff headband in an outdoor adventure setting",
    pop_star: "Show the person in the photo with the exact same pose and background, dressed as a glamorous stage pop star with glittering concert outfit and microphone",
    royalty: "Show the person in the photo with the exact same pose and background, dressed in royal king or queen regalia with a golden jeweled crown and velvet cape",
    reality_tv: "Show the person in the photo with the exact same pose and background, styled like a glamorous reality TV star with dramatic lighting",
    ogre: "Show the person in the photo with the exact same pose and background, playfully styled as a friendly green fantasy ogre with ogre ears and a rustic vest",
    superman: "Show the person in the photo with the exact same pose and background, wearing a classic blue and red superhero suit with a flowing red cape",
    fairytale: "Show the person in the photo with the exact same pose and background, dressed as fairytale royalty in an enchanted glowing forest setting",
    glam: "Show the person in the photo with the exact same pose and background, with red-carpet Hollywood glamour makeup and sparkling lighting",

    // Decades & Transformations
    seventies: "Show the person in the photo with the exact same pose and background, styled in groovy 1970s vintage fashion and warm retro film tones",
    eighties: "Show the person in the photo with the exact same pose and background, styled in bold 1980s neon retro fashion and hairstyle",
    nineties: "Show the person in the photo with the exact same pose and background, styled in iconic 1990s vintage streetwear fashion",
    two_thousands: "Show the person in the photo with the exact same pose and background, styled in trendy Y2K 2000s fashion and metallic aesthetic",
    two_thousand_tens: "Show the person in the photo with the exact same pose and background, styled in 2010s hipster aesthetic fashion",
    cow: "Show the person in the photo with the exact same pose and background, wearing a funny cute plush cow hood with black-and-white cow spots and little horns",
    old_person: "Show the person in the photo with the exact same pose and background, aged into a wise elderly version of themselves with silver hair and gentle wrinkles",
    little_kid: "Show the person in the photo with the exact same pose and background, with a cute cheerful cartoon-like youthful glow and playful colorful cap",
    teenager: "Show the person in the photo with the exact same pose and background, styled in trendy varsity jacket collegiate fashion",
    zombie: "Show the person in the photo with the exact same pose and background, with playful Halloween zombie movie makeup and spooky green lighting",
    pirate: "Show the person in the photo with the exact same pose and background, dressed as a Caribbean pirate captain with a tricorn pirate hat and bandana",
    supermodel: "Show the person in the photo with the exact same pose and background, styled like a high-fashion runway supermodel with editorial studio lighting",
    goth: "Show the person in the photo with the exact same pose and background, styled in dark romantic gothic fashion with black velvet and silver accessories",
    spider: "Show the person in the photo with the exact same pose and background, with a cool realistic Halloween prop spider resting on their shoulder",
    rain: "Show the person in the photo with the exact same pose and background, in a cinematic pouring rain scene with water droplets and dramatic reflections",
    fire: "Show the person in the photo with the exact same pose and background, with cinematic fiery orange sparks and warm dramatic flames glowing in the background",
    underwater: "Show the person in the photo with the exact same pose and background, as if submerged in clear tropical blue underwater light with floating bubbles",
    lava: "Show the person in the photo with the exact same pose and background, with glowing volcanic magma cracks and embers in the background",
    jungle: "Show the person in the photo with the exact same pose and background, with lush tropical jungle vines and exotic leaves surrounding the background",
    aliens: "Show the person in the photo with the exact same pose and background, with a glowing sci-fi UFO hovering in the background sky",
    video_game: "Show the person in the photo with the exact same pose and background, rendered in vibrant 3D Fortnite video game cel-shaded art style",
    blocks: "Show the person in the photo with the exact same pose and background, rendered in colorful blocky Minecraft voxel art style",
    watercolor: "Show the person in the photo with the exact same pose and background, rendered as a soft artistic watercolor painting with visible brush strokes",
    golden_hour: "Show the person in the photo with the exact same pose and background, bathed in warm golden hour sunset light with soft glowing lens flare",
    ghost: "Show the person in the photo with the exact same pose and background, with a cute translucent classic bedsheet ghost floating subtly in the background",

    // VIP Stickers (AI-powered)
    stk_gold_crown: "Show the person in the photo with the exact same pose and background, wearing a luxurious royal gold crown with sparkling jewels on their head",
    stk_sweet_valentine: "Show the person in the photo with the exact same pose and background, surrounded by floating pink and red glowing Valentine hearts and soft romantic bokeh",
    stk_christmas_bell: "Show the person in the photo with the exact same pose and background, wearing a festive Christmas Santa hat with golden jingle bells and warm holiday lights",
    stk_tet_mai: "Show the person in the photo with the exact same pose and background, surrounded by blooming yellow Lunar New Year apricot blossoms and festive red lucky envelopes",
    stk_halloween_pumpkin: "Show the person in the photo with the exact same pose and background, with glowing jack-o-lantern Halloween pumpkins and spooky purple candlelight around them",
    stk_midautumn_rabbit: "Show the person in the photo with the exact same pose and background, with glowing colorful Mid-Autumn lanterns and a cute white jade rabbit on their shoulder"
};

function extractSafeRequestSchema(obj, prefix = "", depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 4) return {};
    const schema = {};
    for (const key of Object.keys(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        const val = obj[key];
        if (val === null) {
            schema[path] = "null";
        } else if (Array.isArray(val)) {
            schema[path] = `array(len=${val.length})`;
        } else if (typeof val === "object") {
            Object.assign(schema, extractSafeRequestSchema(val, path, depth + 1));
        } else if (typeof val === "string") {
            if (val.startsWith("https://") || val.startsWith("http://")) {
                try {
                    const u = new URL(val);
                    schema[path] = `url(${u.protocol}//${u.hostname}${u.searchParams.has("token") ? "?token=..." : ""})`;
                } catch {
                    schema[path] = "url(invalid)";
                }
            } else if (val.startsWith("gs://")) {
                schema[path] = "gs_uri";
            } else if (val.length > 500) {
                schema[path] = `long_string(len=${val.length})`;
            } else {
                schema[path] = path.endsWith("filter_id") || path.endsWith("filterId") || path.endsWith("filter")
                    ? `string(${val.slice(0, 40)})`
                    : `string(len=${val.length})`;
            }
        } else {
            schema[path] = typeof val;
        }
    }
    return schema;
}

function findImageUrl(obj) {
    if (!obj) return null;
    if (typeof obj === "string") {
        if (obj.startsWith("http://") || obj.startsWith("https://")) return obj;
        if (obj.startsWith("gs://")) {
            const parts = obj.slice(5).split("/");
            const bucket = parts[0];
            const path = encodeURIComponent(parts.slice(1).join("/"));
            return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${path}?alt=media`;
        }
        return null;
    }
    if (typeof obj === "object") {
        if (obj.image_url && typeof obj.image_url === "string") return findImageUrl(obj.image_url);
        if (obj.imageUrl && typeof obj.imageUrl === "string") return findImageUrl(obj.imageUrl);
        if (obj.url && typeof obj.url === "string") return findImageUrl(obj.url);
        for (const key of Object.keys(obj)) {
            const found = findImageUrl(obj[key]);
            if (found) return found;
        }
    }
    return null;
}

function findBase64Image(obj) {
    if (!obj) return null;
    if (typeof obj === "string") {
        if (
            obj.length > 500 &&
            !obj.startsWith("http://") &&
            !obj.startsWith("https://") &&
            !obj.startsWith("gs://") &&
            !obj.startsWith("eyJ") &&
            !/\s/.test(obj.slice(0, 200))
        ) {
            return obj;
        }
        return null;
    }
    if (typeof obj === "object") {
        for (const key of Object.keys(obj)) {
            if (key === "prompt" || key === "userInput") continue;
            const found = findBase64Image(obj[key]);
            if (found) return found;
        }
    }
    return null;
}

function findFilterId(obj) {
    if (!obj) return "normal";
    if (typeof obj === "object") {
        if (obj.filter_id && typeof obj.filter_id === "string") return obj.filter_id;
        if (obj.filterId && typeof obj.filterId === "string") return obj.filterId;
        if (obj.filter && typeof obj.filter === "string") return obj.filter;
        if (obj.id && typeof obj.id === "string") return obj.id;
        for (const key of Object.keys(obj)) {
            if (typeof obj[key] === "object") {
                const found = findFilterId(obj[key]);
                if (found && found !== "normal") return found;
            }
        }
    }
    return "normal";
}

function findPrompt(obj) {
    if (!obj) return null;
    if (typeof obj === "object") {
        if (obj.prompt && typeof obj.prompt === "string") return obj.prompt;
        for (const key of Object.keys(obj)) {
            if (typeof obj[key] === "object") {
                const found = findPrompt(obj[key]);
                if (found) return found;
            }
        }
    }
    return null;
}

function getImageFormat(bytes) {
    if (
        bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 &&
        bytes[2] === 0x4E && bytes[3] === 0x47 && bytes[4] === 0x0D &&
        bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A
    ) return { extension: "png", contentType: "image/png" };
    if (
        bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 &&
        bytes[2] === 0xFF
    ) return { extension: "jpg", contentType: "image/jpeg" };
    if (
        bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 &&
        bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 &&
        bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) return { extension: "webp", contentType: "image/webp" };
    return { extension: "jpg", contentType: "image/jpeg" };
}

async function cacheGeneratedImageOnEdge(origin, imageBytes, imageFormat) {
    const bytes = imageBytes instanceof Uint8Array ? imageBytes : new Uint8Array(imageBytes);
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${imageFormat.extension}`;
    const selfUrl = `${origin}/uploads/ai-filters/${id}`;

    recentGeneratedImages.set(id, {
        bytes,
        contentType: imageFormat.contentType,
        createdAt: Date.now()
    });
    if (recentGeneratedImages.size > 30) {
        const oldestKey = recentGeneratedImages.keys().next().value;
        recentGeneratedImages.delete(oldestKey);
    }

    try {
        if (typeof caches !== "undefined" && caches.default) {
            const cacheResp = new Response(bytes, {
                headers: {
                    "Content-Type": imageFormat.contentType,
                    "Cache-Control": "public, max-age=86400",
                    "Access-Control-Allow-Origin": "*"
                }
            });
            await caches.default.put(new Request(selfUrl), cacheResp);
        }
    } catch { }

    return selfUrl;
}

async function uploadToImgdbWithFallback(origin, imageBytes, imageFormat) {
    const selfHostedUrl = await cacheGeneratedImageOnEdge(origin, imageBytes, imageFormat);
    const bytes = imageBytes instanceof Uint8Array ? imageBytes : new Uint8Array(imageBytes);

    try {
        const form = new FormData();
        form.append(
            "file",
            new Blob([bytes], { type: imageFormat.contentType }),
            `filter.${imageFormat.extension}`
        );
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4500);
        try {
            const response = await fetch("https://imgdb.io/api/v1/upload?ttl=86400", {
                method: "POST",
                body: form,
                signal: controller.signal
            });
            if (response.ok) {
                const result = await response.json();
                if (typeof result?.url === "string" && result.url.startsWith("https://imgdb.io/")) {
                    return result.url;
                }
            }
        } finally {
            clearTimeout(timer);
        }
    } catch (e) {
        console.warn("imgdb upload fallback to self-hosted Edge Cache:", e.message);
    }

    return selfHostedUrl;
}

export default {
    async fetch(request, env, ctx) {
        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Allow-Headers": "*"
                }
            });
        }

        const url = new URL(request.url);

        // 1. Endpoint phục vụ ảnh đã lọc từ bộ nhớ đệm Edge Cache / Isolate Map
        if (url.pathname.startsWith("/uploads/ai-filters/")) {
            const id = url.pathname.slice("/uploads/ai-filters/".length);
            const memItem = recentGeneratedImages.get(id);
            if (memItem) {
                return new Response(memItem.bytes, {
                    status: 200,
                    headers: {
                        "Content-Type": memItem.contentType,
                        "Cache-Control": "public, max-age=86400",
                        "Access-Control-Allow-Origin": "*"
                    }
                });
            }
            try {
                if (typeof caches !== "undefined" && caches.default) {
                    const cached = await caches.default.match(new Request(request.url));
                    if (cached) return cached;
                }
            } catch { }
            return new Response("Image URL expired or unavailable", { status: 404 });
        }

        // 2. Health check endpoint
        if (url.pathname === "/" || url.pathname === "/health") {
            return new Response(JSON.stringify({
                status: "online",
                service: "Locket Filter Engine",
                mode: "AI-Powered Direct URL Output",
                uptime: new Date().toISOString()
            }), {
                headers: { "Content-Type": "application/json" }
            });
        }

        // 2.1 Endpoint chẩn đoán
        if (url.pathname === "/last-payload") {
            let dbg = lastDebugInfo;
            if (!dbg.lastResult) {
                const remote = await fetchDebugFromRender(env);
                if (remote && remote.lastResult) dbg = remote;
            }
            return new Response(JSON.stringify({
                lastRequestSchema: dbg.lastRequestSchema,
                lastResult: dbg.lastResult,
                timestamp: dbg.timestamp
            }, null, 2), {
                headers: { "Content-Type": "application/json" }
            });
        }

        // 2.2 Web Dashboard tối giản (/dashboard) + Ping thủ công (/api/ping)
        if (url.pathname === "/dashboard" || url.pathname === "/api/ping") {
            const dashPass = (env?.DASHBOARD_PASS || "").trim();
            const keyParam = url.searchParams.get("key") || "";
            if (dashPass && keyParam !== dashPass) {
                return new Response("Unauthorized. Vui lòng thêm ?key=MAT_KHAU vào cuối đường link.", { status: 401 });
            }
            if (url.pathname === "/api/ping") {
                const st = await pingPhotoboothServer(env, "dashboard");
                return new Response(JSON.stringify(st, null, 2), {
                    headers: { "Content-Type": "application/json" }
                });
            }
            const st = await loadMonitorState();
            const serverUrl = getPhotoboothServerUrl(env);
            return new Response(renderDashboardHtml(st, serverUrl, keyParam), {
                headers: { "Content-Type": "text/html; charset=utf-8" }
            });
        }

        // 2.3 Đăng ký Webhook Telegram Bot chỉ với 1 lần mở link (/setup-telegram?key=...)
        if (url.pathname === "/setup-telegram") {
            const dashPass = (env?.DASHBOARD_PASS || "").trim();
            const keyParam = url.searchParams.get("key") || "";
            if (dashPass && keyParam !== dashPass) {
                return new Response("Unauthorized", { status: 401 });
            }
            const token = (env?.TELEGRAM_BOT_TOKEN || "").trim();
            if (!token) {
                return new Response("Chưa cấu hình biến TELEGRAM_BOT_TOKEN trên Cloudflare Worker.", { status: 400 });
            }
            const webhookUrl = `${url.origin}/telegram`;
            const tgResp = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
            const tgJson = await tgResp.json();
            return new Response(JSON.stringify({ webhookUrl, telegramResponse: tgJson }, null, 2), {
                headers: { "Content-Type": "application/json" }
            });
        }

        // 2.4 Telegram Bot Webhook (/telegram) — Quản trị Server qua lệnh /status, /ping, /last
        if (url.pathname === "/telegram" && request.method === "POST") {
            try {
                const update = await request.json();
                const msg = update?.message;
                const chatId = msg?.chat?.id ? String(msg.chat.id) : "";
                const allowedChatId = (env?.TELEGRAM_CHAT_ID || "").trim();
                const text = (msg?.text || "").trim();

                if (chatId && (!allowedChatId || chatId === allowedChatId)) {
                    const serverUrl = getPhotoboothServerUrl(env);
                    if (text.startsWith("/ping")) {
                        const st = await pingPhotoboothServer(env, "telegram");
                        await sendTelegram(env, `⚡ <b>Đã gửi lệnh chống ngủ thủ công!</b>\n\n${buildStatusMessage(st, serverUrl)}`);
                    } else if (text.startsWith("/status") || text.startsWith("/start") || text.startsWith("/help")) {
                        const st = await loadMonitorState();
                        const helpNote = `\n\n📌 <b>Lệnh quản trị:</b>\n• <code>/status</code> — Xem trạng thái & lần chống ngủ gần nhất\n• <code>/ping</code> — Gửi lệnh chống ngủ / đánh thức ngay\n• <code>/last</code> — Xem kết quả/lỗi lần chụp gần nhất`;
                        await sendTelegram(env, buildStatusMessage(st, serverUrl) + helpNote);
                    } else if (text.startsWith("/last")) {
                        let resData = lastDebugInfo.lastResult;
                        if (!resData) {
                            const remote = await fetchDebugFromRender(env);
                            if (remote && remote.lastResult) resData = remote.lastResult;
                        }
                        const info = resData
                            ? `<pre>${JSON.stringify(resData, null, 2)}</pre>`
                            : "Chưa có lượt chụp nào trong phiên Worker hiện tại.";
                        await sendTelegram(env, `🧾 <b>Lần chụp Filter / Photobooth gần nhất:</b>\n${info}`);
                    }
                }
            } catch (e) {
                console.error("Telegram webhook error:", e.message);
            }
            return new Response("OK", { status: 200 });
        }

        // 2.5 API chọn khung Photobooth tự do cho Web Thư Viện Khung (/api/photobooth/frames & /api/photobooth/select-frame)
        if (url.pathname === "/api/photobooth/frames") {
            const pbServerUrl = getPhotoboothServerUrl(env);
            const r = await fetch(`${pbServerUrl}/frames`);
            const txt = await r.text();
            return new Response(txt, {
                status: r.status,
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                    "Access-Control-Allow-Origin": "*"
                }
            });
        }

        if (url.pathname === "/api/photobooth/select-frame") {
            if (request.method === "OPTIONS") {
                return new Response(null, {
                    status: 204,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                        "Access-Control-Allow-Headers": "Content-Type"
                    }
                });
            }
            const pbServerUrl = getPhotoboothServerUrl(env);
            const pbHeaders = { "Content-Type": "application/json" };
            if (env?.PHOTOBOOTH_SECRET) {
                pbHeaders["X-API-Secret"] = env.PHOTOBOOTH_SECRET;
            }
            if (request.method === "GET") {
                const userKey = url.searchParams.get("userKey") || "default_user";
                const r = await fetch(`${pbServerUrl}/custom-frame?userKey=${encodeURIComponent(userKey)}`);
                return new Response(await r.text(), {
                    status: r.status,
                    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
                });
            }
            const r = await fetch(`${pbServerUrl}/custom-frame`, {
                method: "POST",
                headers: pbHeaders,
                body: await request.text()
            });
            return new Response(await r.text(), {
                status: r.status,
                headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
            });
        }

        // 3. Endpoint xử lý Filter ảnh: /generateFilteredImage
        if (url.pathname.endsWith("/generateFilteredImage") || url.pathname.includes("generateFilteredImage")) {
            const startTime = Date.now();
            let fetchMs = 0;
            let aiMs = 0;
            let uploadMs = 0;
            let storageStatus = null;
            let cfResizedHeader = null;
            let inputBytesLen = 0;
            let filterId = "normal";

            try {
                let imageBase64 = "";
                let foundImageUrl = "";
                let promptText = "";
                let rawPhotoBytes = null;
                let inputImageResized = false;

                const contentType = request.headers.get("content-type") || "";

                if (contentType.includes("application/json")) {
                    const json = await request.json();
                    lastDebugInfo.timestamp = new Date().toISOString();
                    lastDebugInfo.lastRequestSchema = extractSafeRequestSchema(json);

                    filterId = findFilterId(json);
                    const incomingPrompt = findPrompt(json) || "";
                    imageBase64 = findBase64Image(json) || "";
                    foundImageUrl = findImageUrl(json) || "";

                    // Chuyển tiếp riêng Photobooth sang Server 2K
                    const pbServerUrl = getPhotoboothServerUrl(env);
                    if (filterId.startsWith("photobooth") && pbServerUrl) {
                        const pbStart = Date.now();
                        const pbHeaders = { "Content-Type": "application/json" };
                        if (env?.PHOTOBOOTH_SECRET) {
                            pbHeaders["X-API-Secret"] = env.PHOTOBOOTH_SECRET;
                        }
                        const pbResp = await fetch(`${pbServerUrl}/photobooth`, {
                            method: "POST",
                            headers: pbHeaders,
                            body: JSON.stringify({
                                filterId,
                                userKey: getPhotoboothUserKey(request),
                                imageUrl: foundImageUrl,
                                imageBase64,
                                authorization: request.headers.get("authorization") || ""
                            })
                        });
                        if (!pbResp.ok) {
                            const errTxt = await pbResp.text();
                            throw new Error(`Photobooth Server HTTP ${pbResp.status}: ${errTxt.slice(0, 160)}`);
                        }
                        const pbJson = await pbResp.json();
                        if (!pbJson?.outputUrl) {
                            throw new Error("Photobooth Server did not return outputUrl");
                        }

                        const finalPayload = {
                            result: {
                                status: 200,
                                data: { outputUrl: pbJson.outputUrl },
                                outputUrl: pbJson.outputUrl,
                                errors: []
                            }
                        };
                        lastDebugInfo.lastResult = {
                            status: "ok",
                            mode: "photobooth-2k-server",
                            filterId,
                            shot: pbJson.shot,
                            renderMs: pbJson.renderMs,
                            totalMs: Date.now() - startTime,
                            outputBytes: pbJson.outputBytes,
                            outputUrl: pbJson.outputUrl
                        };
                        console.log("LOCKET_RESULT:", JSON.stringify(lastDebugInfo.lastResult));
                        ctx.waitUntil(syncDebugToRender(env, lastDebugInfo));
                        return new Response(JSON.stringify(finalPayload), {
                            status: 200,
                            headers: {
                                "Content-Type": "application/json; charset=utf-8",
                                "Access-Control-Allow-Origin": "*"
                            }
                        });
                    }

                    // Ưu tiên tuyệt đối Prompt đã tinh chỉnh riêng cho FLUX.2 Klein 4B để toàn bộ kho filter (Elf, Santa, Giraffe...) hoạt động 100%
                    if (FILTER_PROMPTS[filterId]) {
                        promptText = FILTER_PROMPTS[filterId];
                    } else if (FILTER_PROMPTS[filterId.toLowerCase()]) {
                        promptText = FILTER_PROMPTS[filterId.toLowerCase()];
                    } else if (incomingPrompt) {
                        const cleaned = incomingPrompt
                            .replace(/\s+/g, " ")
                            .replace(/If no (face|person|people) is present.*$/i, "")
                            .replace(/Do not change the overall comp.*$/i, "")
                            .trim();
                        promptText = cleaned.slice(0, 320) || "Show the person in the photo with the exact same pose and background, enhanced with a vibrant aesthetic photo filter";
                    } else {
                        promptText = "Show the person in the photo with the exact same pose and background, enhanced with a vibrant aesthetic photo filter";
                    }

                    if (foundImageUrl) {
                        const storageFetchStartedAt = Date.now();
                        const storageFetchController = new AbortController();
                        const storageFetchTimeout = setTimeout(() => storageFetchController.abort(), 12000);
                        try {
                            const storageHeaders = {
                                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"
                            };
                            try {
                                const parsedImgUrl = new URL(foundImageUrl);
                                const incomingAuth = request.headers.get("authorization");
                                if (
                                    incomingAuth &&
                                    parsedImgUrl.hostname === "firebasestorage.googleapis.com" &&
                                    !parsedImgUrl.searchParams.has("token")
                                ) {
                                    storageHeaders["Authorization"] = incomingAuth;
                                }
                            } catch { }

                            const imgResp = await fetch(foundImageUrl, {
                                headers: storageHeaders,
                                cf: {
                                    image: {
                                        width: 511,
                                        height: 511,
                                        fit: "scale-down",
                                        format: "jpeg"
                                    }
                                },
                                signal: storageFetchController.signal
                            });
                            fetchMs = Date.now() - storageFetchStartedAt;
                            storageStatus = imgResp.status;
                            cfResizedHeader = imgResp.headers.get("cf-resized");

                            if (imgResp.ok) {
                                const buf = await imgResp.arrayBuffer();
                                rawPhotoBytes = new Uint8Array(buf);
                                inputBytesLen = rawPhotoBytes.byteLength;
                                inputImageResized = true;
                            } else {
                                await imgResp.body?.cancel();
                            }
                        } catch (fetchErr) {
                            fetchMs = Date.now() - storageFetchStartedAt;
                            console.error("Storage fetch error:", fetchErr.message);
                        } finally {
                            clearTimeout(storageFetchTimeout);
                        }
                    }
                } else if (contentType.includes("multipart/form-data")) {
                    const formData = await request.formData();
                    filterId = formData.get("filter_id") || formData.get("filterId") || formData.get("filter") || "normal";
                    const file = formData.get("image") || formData.get("file") || formData.get("photo");
                    if (file && typeof file !== "string") {
                        const buffer = await file.arrayBuffer();
                        rawPhotoBytes = new Uint8Array(buffer);
                        inputBytesLen = rawPhotoBytes.byteLength;
                    }
                } else {
                    const rawBuf = await request.arrayBuffer();
                    if (rawBuf && rawBuf.byteLength > 0) {
                        rawPhotoBytes = new Uint8Array(rawBuf);
                        inputBytesLen = rawPhotoBytes.byteLength;
                    }
                }

                if (!rawPhotoBytes && imageBase64) {
                    rawPhotoBytes = new Uint8Array(base64ToArrayBuffer(imageBase64));
                    inputBytesLen = rawPhotoBytes.byteLength;
                }

                if (!rawPhotoBytes || rawPhotoBytes.byteLength === 0) {
                    throw new Error("Could not read the input image from the request or Firebase Storage");
                }
                if (foundImageUrl && !inputImageResized) {
                    throw new Error(`Could not fetch/resize the Firebase input image (status=${storageStatus})`);
                }

                if (!env?.AI || typeof env.AI.run !== "function") {
                    throw new Error("AI binding is missing");
                }

                let finalPhotoBytes = null;

                const runFluxWithPrompt = async (promptToUse) => {
                    const modelImageFormat = getImageFormat(rawPhotoBytes);
                    const aiForm = new FormData();
                    aiForm.append("prompt", `Edit image 0: ${promptToUse}`);
                    aiForm.append(
                        "input_image_0",
                        new Blob([rawPhotoBytes], { type: modelImageFormat.contentType }),
                        `input.${modelImageFormat.extension}`
                    );
                    aiForm.append("width", "512");
                    aiForm.append("height", "512");
                    const aiFormResponse = new Response(aiForm);
                    const rawAiOutput = await env.AI.run("@cf/black-forest-labs/flux-2-klein-4b", {
                        multipart: {
                            body: aiFormResponse.body,
                            contentType: aiFormResponse.headers.get("content-type")
                        }
                    });
                    let aiBuffer = null;
                    if (rawAiOutput) {
                        if (rawAiOutput instanceof ArrayBuffer) {
                            aiBuffer = rawAiOutput;
                        } else if (rawAiOutput instanceof Uint8Array) {
                            aiBuffer = rawAiOutput.buffer.slice(rawAiOutput.byteOffset, rawAiOutput.byteOffset + rawAiOutput.byteLength);
                        } else if (rawAiOutput instanceof Response) {
                            aiBuffer = await rawAiOutput.arrayBuffer();
                        } else if (typeof rawAiOutput.arrayBuffer === "function") {
                            aiBuffer = await rawAiOutput.arrayBuffer();
                        } else if (rawAiOutput?.image) {
                            aiBuffer = rawAiOutput.image instanceof ArrayBuffer ? rawAiOutput.image : base64ToArrayBuffer(rawAiOutput.image);
                        } else {
                            const streamResp = new Response(rawAiOutput);
                            aiBuffer = await streamResp.arrayBuffer();
                        }
                    }
                    if (!aiBuffer || aiBuffer.byteLength === 0) {
                        throw new Error("Image-to-image model returned no image bytes");
                    }
                    return new Uint8Array(aiBuffer);
                };

                const aiStartedAt = Date.now();
                try {
                    finalPhotoBytes = await runFluxWithPrompt(promptText);
                } catch (firstAiErr) {
                    console.warn(`First AI run failed for ${filterId} (${firstAiErr.message}), retrying with safe prompt...`);
                    finalPhotoBytes = await runFluxWithPrompt(
                        "Show the person in the photo with the exact same pose and background, with a vibrant festive aesthetic camera filter"
                    );
                }
                aiMs = Date.now() - aiStartedAt;

                const imageFormat = getImageFormat(finalPhotoBytes);
                const uploadStartedAt = Date.now();
                const effectiveUrl = await uploadToImgdbWithFallback(url.origin, finalPhotoBytes, imageFormat);
                uploadMs = Date.now() - uploadStartedAt;

                // Chuẩn 100% Firebase HTTPSCallable + DataResponse<GenerateFilteredImagePayload> của Locket 2.73.0
                const finalPayload = {
                    result: {
                        status: 200,
                        data: {
                            outputUrl: effectiveUrl
                        },
                        outputUrl: effectiveUrl,
                        errors: []
                    }
                };

                const totalMs = Date.now() - startTime;
                lastDebugInfo.lastResult = {
                    status: "ok",
                    filterId,
                    promptLen: promptText.length,
                    inputBytes: inputBytesLen,
                    outputBytes: finalPhotoBytes.byteLength,
                    storageStatus,
                    cfResized: cfResizedHeader,
                    fetchMs,
                    aiMs,
                    uploadMs,
                    totalMs,
                    outputUrl: effectiveUrl
                };

                console.log("LOCKET_RESULT:", JSON.stringify(lastDebugInfo.lastResult));
                ctx.waitUntil(syncDebugToRender(env, lastDebugInfo));

                return new Response(JSON.stringify(finalPayload), {
                    status: 200,
                    headers: {
                        "Content-Type": "application/json; charset=utf-8",
                        "Access-Control-Allow-Origin": "*"
                    }
                });

            } catch (err) {
                lastDebugInfo.lastResult = {
                    status: "error",
                    filterId,
                    error: err.message,
                    inputBytes: inputBytesLen,
                    storageStatus,
                    cfResized: cfResizedHeader,
                    fetchMs,
                    aiMs,
                    uploadMs,
                    totalMs: Date.now() - startTime
                };
                lastDebugInfo.timestamp = new Date().toISOString();
                console.error("LOCKET_RESULT:", JSON.stringify(lastDebugInfo.lastResult));
                if (ctx && typeof ctx.waitUntil === "function") {
                    ctx.waitUntil(
                        sendTelegram(
                            env,
                            `⚠️ <b>Lỗi xử lý Filter / Photobooth</b>\n• Filter: <code>${filterId}</code>\n• Lỗi: <code>${err.message}</code>\n• Lúc: <code>${formatVnTime(lastDebugInfo.timestamp)}</code>`
                        )
                    );
                }
                return new Response(JSON.stringify({
                    error: {
                        status: "INTERNAL",
                        message: err.message
                    }
                }), {
                    status: 500,
                    headers: {
                        "Content-Type": "application/json; charset=utf-8",
                        "Access-Control-Allow-Origin": "*"
                    }
                });
            }
        }

        // 4. TẤT CẢ các Cloud Function khác của Locket (fetchUsers, getMomentViews, ...):
        // Transparent Reverse Proxy sang https://api.locketcamera.com
        const targetUrl = new URL(request.url);
        targetUrl.hostname = "api.locketcamera.com";
        targetUrl.protocol = "https:";
        targetUrl.port = "443";

        const proxyHeaders = new Headers(request.headers);
        proxyHeaders.set("host", "api.locketcamera.com");

        const proxyReqInit = {
            method: request.method,
            headers: proxyHeaders,
            redirect: "follow"
        };

        if (request.method !== "GET" && request.method !== "HEAD") {
            proxyReqInit.body = request.body;
        }

        return fetch(targetUrl.toString(), proxyReqInit);
    },

    // Cron Trigger chống ngủ tự động (cài lịch */10 * * * * trên Cloudflare Dashboard)
    async scheduled(event, env, ctx) {
        ctx.waitUntil(pingPhotoboothServer(env, "cron"));
    }
};

function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToArrayBuffer(base64) {
    try {
        let clean = (base64 || "").replace(/^data:image\/[a-z]+;base64,/, "").replace(/[\r\n\s]/g, "");
        clean = clean.replace(/-/g, "+").replace(/_/g, "/");
        while (clean.length % 4 !== 0) {
            clean += "=";
        }
        const binary = atob(clean);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    } catch (e) {
        return new ArrayBuffer(0);
    }
}
