#!/usr/bin/env node
/**
 * sync_locket_captions.js — Tự động kiểm tra 4 trụ cột, đồng bộ phiên bản module
 * và xác thực toàn bộ Captions / Photobooth / RemoteFilter trước khi push.
 *
 * Chạy: node sync_locket_captions.js
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = __dirname;
const rcPath = path.join(ROOT, "revenuecat_gold.js");
const fbPath = path.join(ROOT, "locket_gold_30s.js");
const locketModPath = path.join(ROOT, "locket.module");
const comboModPath = path.join(ROOT, "combo.module");

function runSandbox(code, url, bodyObj) {
  let result = null;
  vm.runInNewContext(code, {
    $request: { url, headers: {} },
    $response: { status: 200, headers: {}, body: JSON.stringify(bodyObj) },
    $done: (res) => { result = res; },
    console, Date, JSON, Object, Array, String, Number, Boolean, Math
  });
  return result;
}

function main() {
  const rcCode = fs.readFileSync(rcPath, "utf8");
  const fbCode = fs.readFileSync(fbPath, "utf8");

  // 1. Trụ cột 1: RevenueCat (revenuecat_gold.js)
  const rcRes = runSandbox(rcCode, "https://api.revenuecat.com/v1/subscribers/sync_test_uid", {
    subscriber: { original_app_user_id: "sync_test_uid", entitlements: {}, subscriptions: {} }
  });
  const rcBody = JSON.parse(rcRes.body);
  if (rcBody.subscriber.original_app_user_id !== "sync_test_uid") throw new Error("UID not preserved");
  if (rcBody.subscriber.entitlements.Gold?.expires_date !== "2099-12-31T23:59:59Z") throw new Error("Gold expiry invalid");

  // 2. Trụ cột 2 & 3: Firebase Remote Config + App Stability
  const fbRes = runSandbox(fbCode, "https://firebaseremoteconfig.googleapis.com/v1/projects/locket/namespaces/firebase:fetch", { entries: {} });
  const fbBody = JSON.parse(fbRes.body);
  const entryCount = Object.keys(fbBody.entries).length;
  if (entryCount < 1014) throw new Error(`Expected >=1014 entries, got ${entryCount}`);
  if (fbBody.entries.is_gold !== "true" || fbBody.entries.can_record_30s_video !== "true") {
    throw new Error("Core Gold/30s flags missing");
  }

  // 3. Kiểm tra Captions (Static VN Lyrics + Static LIVE Tin nóng; đã gỡ VertexAI quote/breaking_news bị Tap to retry)
  const dyn = JSON.parse(fbBody.entries.overlay_dynamic_captions || "[]");
  if (dyn.includes("quote") || dyn.includes("breaking_news")) {
    throw new Error("Failing VertexAI quote/breaking_news should be removed from overlay_dynamic_captions");
  }
  const ovItems = JSON.parse(fbBody.entries.overlay_items || "[]");
  const gen = ovItems.find(s => s.section && s.section.includes("General"));
  if (!gen || gen.items.some(it => it.overlay_id === "caption:quote" || it.overlay_id === "caption:breaking_news")) {
    throw new Error("Failing VertexAI quote/breaking_news should be removed from General");
  }
  const liveSec = ovItems.find(s => s.section && s.section.includes("Tin nóng"));
  if (!liveSec || !Array.isArray(liveSec.items) || liveSec.items.length < 4) {
    throw new Error("Missing static LIVE Tin nóng section in overlay_items");
  }
  const quotes = JSON.parse(fbBody.entries.quote_caption_options || "[]");
  if (quotes.length < 10) throw new Error("Too few quote_caption_options");

  // 4. Kiểm tra Schema RemoteFilter (Locket 2.73.0)
  for (const key of ["camera_filter_config", "celebrity_camera_filter_config"]) {
    let cfg = JSON.parse(fbBody.entries[key]);
    if (cfg.cameraFilterConfig) cfg = cfg.cameraFilterConfig;
    for (const f of cfg.remoteFilters) {
      if (f.style !== "cutout" || !f.icon?.url?.startsWith("https://") || f.overlay !== true || !f.overlayImageUrl?.startsWith("https://")) {
        throw new Error(`Invalid RemoteFilter schema: ${key} -> ${f.uid}`);
      }
    }
  }

  // 5. Kiểm tra đồng bộ cache-buster ?v= trong locket.module & combo.module
  const locketMod = fs.readFileSync(locketModPath, "utf8");
  const comboMod = fs.readFileSync(comboModPath, "utf8");
  const vL = [...locketMod.matchAll(/\?v=([0-9a-z]+)/g)].map(m => m[1]);
  const vC = [...comboMod.matchAll(/\?v=([0-9a-z]+)/g)].map(m => m[1]);
  if (new Set([...vL, ...vC]).size !== 1) {
    throw new Error(`Cache-buster mismatch: locket=${vL.join(",")} combo=${vC.join(",")}`);
  }

  console.log("SYNC_AND_4_PILLAR_PASS:", {
    version: vL[0],
    rcBytes: rcCode.length,
    fbBytes: fbCode.length,
    entries: entryCount,
    quotes: quotes.length
  });
}

main();
