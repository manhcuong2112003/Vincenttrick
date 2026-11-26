// revenuecat_gold.js - Vincenttrick Ultra-Light RevenueCat Hook (~6 KB)
// Tối ưu tốc độ nạp JavaScriptCore trên Shadowrocket + chống cache HTTP
(function () {
    const ENT_KEYS = ["Gold", "gold", "locket_gold", "filters", "filter", "Filters", "Filter", "camera_filters", "all_filters", "effects", "video", "video_upload", "camera_roll_video", "extended_video", "longer_video", "longer_videos", "video_15s", "video_30s", "video_duration", "longer_video_30s", "camera_roll_video_30s", "video_upload_30s", "upload_video_30s", "upload_video", "longer_video_upload", "extended_video_upload", "upload_longer_video", "upload_extended_video", "camera_roll_longer_video", "camera_roll_extended_video", "camera_roll_30s", "camera_roll_15s", "allow_30s_video", "allow_longer_video", "30s_video", "30s_video_upload", "30s_camera_roll", "video_trim", "video_trimming", "video_trimmer", "camera_roll_trim", "camera_roll_video_trim", "gallery_video", "gallery_video_30s", "gallery_upload", "library_video", "library_video_30s", "photo_library_video", "photo_library_video_30s", "gold_camera_roll", "gold_camera_roll_video", "gold_video_upload", "gold_video_30s", "gold_video_15s", "gold_longer_video", "gold_extended_video", "captions", "caption", "custom_captions", "custom_caption", "extended_captions", "extended_caption", "long_captions", "long_caption", "dynamic_captions", "dynamic_caption", "caption_styles", "caption_icons", "caption_options", "caption_prompts", "zodiac_captions", "holiday_captions", "quote_captions", "breaking_news", "breaking_news_caption", "color_palette", "music_caption", "link_caption", "poll_caption", "weather_caption", "location_caption", "time_caption", "review_caption", "streak_caption", "locket_count_caption", "unlimited_captions", "all_captions", "all_overlays", "overlays", "overlay", "overlay_picker", "overlay_items", "overlay_navigator", "music", "poll", "links", "link", "comments", "comment", "rollcall", "private_mode", "viewer_mode", "private_viewing", "close_friends", "best_friends", "privacy", "unlimited_friends", "custom_widget_frames", "widget_frames", "custom_frames", "widget_frame", "frames", "custom_widget_frame", "widget", "widgets", "streak_recovery", "streakRecovery", "app_icon_picker", "app_icons", "custom_app_icons", "app_icon", "camera_roll", "camera_roll_enabled", "camera_theme", "camera_themes", "themes", "theme", "locket_views", "moment_views", "locket_view", "moment_view", "profile_badge", "profileBadge", "gold_since_badge", "goldSinceBadge", "gold_badge_profile_menu", "gold_badge", "badge", "crown", "gold_crown", "crown_badge", "gold_profile_badge", "profile_gold_badge", "gold_crown_badge", "vip_badge", "subscriber_badge", "membership_badge", "gold_member", "gold_status", "profile_badge_enabled", "badge_enabled", "gold_badge_enabled", "locket_badge", "locket_crown", "locket_gold_badge", "remove_ads", "groups", "qr_code", "user_qr", "qr_user"];
    const SUB_KEYS = ["locket_2400_1y", "locket_299_1m", "locket_199_1m", "locket_gold_annual", "locket_gold_monthly", "locket_gold_yearly"];
    const PEM_ENTITLEMENTS = ["Gold", "unlimited_friends", "custom_widget_frames", "streak_recovery", "streakRecovery", "app_icon_picker", "camera_roll", "camera_roll_video", "video_upload", "camera_theme", "locket_views", "long_captions", "longer_video", "longer_videos", "video_15s", "video_30s", "video_duration", "video_upload_30s", "camera_roll_video_30s", "longer_video_30s", "upload_video_30s", "longer_video_upload", "extended_video_upload", "upload_longer_video", "upload_extended_video", "camera_roll_longer_video", "camera_roll_30s", "30s_video_upload", "video_trim", "video_trimming", "photo_library_video", "photo_library_video_30s", "gallery_video_30s", "profile_badge", "profileBadge", "gold_since_badge", "goldSinceBadge", "remove_ads", "groups", "filters", "camera_filters", "captions", "overlays", "qr_code", "user_qr"];
    const PEM_PRODUCTS = ["locket_2400_1y", "locket_299_1m", "locket_199_1m", "locket_gold_annual", "locket_gold_monthly", "locket_gold_yearly", "Gold"];
    const OFFERINGS_DATA = {"current_offering_id": "locket_299", "custom_web_checkout_enabled": true, "offerings": [{"description": "Locket Gold (Monthly + Yearly)", "identifier": "locket_299", "metadata": null, "packages": [{"identifier": "$rc_monthly", "platform_product_identifier": "locket_299_1m"}, {"identifier": "$rc_annual", "platform_product_identifier": "locket_2400_1y"}]}, {"description": "Locket Gold (Monthly only)", "identifier": "locket_299_monthly", "metadata": null, "packages": [{"identifier": "$rc_monthly", "platform_product_identifier": "locket_299_1m_only"}]}, {"description": "Locket Gold $3.99 (Monthly + Yearly)", "identifier": "locket_399", "metadata": null, "packages": [{"identifier": "$rc_monthly", "platform_product_identifier": "locket_399_1m"}, {"identifier": "$rc_annual", "platform_product_identifier": "locket_3600_1y"}]}, {"description": "Locket Gold $4.99 (Monthly + Yearly)", "identifier": "locket_499", "metadata": null, "packages": [{"identifier": "$rc_monthly", "platform_product_identifier": "locket_499_1m"}, {"identifier": "$rc_annual", "platform_product_identifier": "locket_4800_1y"}]}, {"description": "Locket Gold $3.99 (Monthly only)", "identifier": "locket_399_monthly", "metadata": null, "packages": [{"identifier": "$rc_monthly", "platform_product_identifier": "locket_399_1m_only"}]}, {"description": "Locket Gold $4.99 (Monthly only)", "identifier": "locket_499_monthly", "metadata": null, "packages": [{"identifier": "$rc_monthly", "platform_product_identifier": "locket_499_1m_only"}]}, {"description": "Locket Gold $5.99 (Monthly + Yearly)", "identifier": "locket_599", "metadata": null, "packages": [{"identifier": "$rc_monthly", "platform_product_identifier": "locket_599_1m"}, {"identifier": "$rc_annual", "platform_product_identifier": "locket_6000_1y"}]}, {"description": "Locket Gold $5.99 (Monthly only)", "identifier": "locket_599_monthly", "metadata": null, "packages": [{"identifier": "$rc_monthly", "platform_product_identifier": "locket_599_1m_only"}]}, {"description": "Locket Gold $10.00 (Yearly only)", "identifier": "locket_1000_yearly", "metadata": null, "packages": [{"identifier": "$rc_annual", "platform_product_identifier": "locket_1000_1y_only"}]}, {"description": "Locket Gold $15.00 (Yearly only)", "identifier": "locket_1500_yearly", "metadata": null, "packages": [{"identifier": "$rc_annual", "platform_product_identifier": "locket_1500_1y_only"}]}, {"description": "Locket Gold $20.00 (Yearly only)", "identifier": "locket_2000_yearly", "metadata": null, "packages": [{"identifier": "$rc_annual", "platform_product_identifier": "locket_2000_1y_only"}]}, {"description": "Locket Gold $0.99 (Monthly + Yearly)", "identifier": "locket_099", "metadata": null, "packages": [{"identifier": "$rc_monthly", "platform_product_identifier": "locket_099_1m"}, {"identifier": "$rc_annual", "platform_product_identifier": "locket_800_1y"}]}, {"description": "Locket Gold $0.99 (Monthly only)", "identifier": "locket_099_monthly", "metadata": null, "packages": [{"identifier": "$rc_monthly", "platform_product_identifier": "locket_099_1m_only"}]}, {"description": "Locket Gold $1.99 (Monthly + Yearly)", "identifier": "locket_199", "metadata": null, "packages": [{"identifier": "$rc_monthly", "platform_product_identifier": "locket_199_1m"}, {"identifier": "$rc_annual", "platform_product_identifier": "locket_1600_1y"}]}, {"description": "Locket Gold $1.99 (Monthly only)", "identifier": "locket_199_monthly", "metadata": null, "packages": [{"identifier": "$rc_monthly", "platform_product_identifier": "locket_199_1m_only"}]}, {"description": "Locket Gold $3.99 (Monthly + Yearly, Yearly Trial)", "identifier": "locket_399_yearly_trial", "metadata": null, "packages": [{"identifier": "$rc_monthly", "platform_product_identifier": "locket_399_1m_yearly_trial"}, {"identifier": "$rc_annual", "platform_product_identifier": "locket_3600_1y_yearly_trial"}]}], "placements": {"fallback_offering_id": "locket_299"}};

    const url = (typeof $request !== "undefined" && $request && $request.url) ? $request.url : "";
    let headers = (typeof $response !== "undefined" && $response && $response.headers) ? Object.assign({}, $response.headers) : {};
    let body = (typeof $response !== "undefined" && $response && $response.body) ? $response.body : "{}";

    try {
        const nowIso = new Date().toISOString();
        const nowMs = Date.now();
        const expIso = "2099-12-31T23:59:59Z";
        const purIso = "2024-01-01T00:00:00Z";

        if (url.includes("product_entitlement_mapping")) {
            let pemMap = {};
            for (let i = 0; i < PEM_PRODUCTS.length; i++) {
                let pid = PEM_PRODUCTS[i];
                pemMap[pid] = { product_identifier: pid, entitlements: PEM_ENTITLEMENTS };
            }
            body = JSON.stringify({ product_entitlement_mapping: pemMap });
        } else if (url.includes("/offerings")) {
            body = JSON.stringify(OFFERINGS_DATA);
        } else if (url.includes("/subscribers") || url.includes("/receipts")) {
            let obj = {};
            try { obj = JSON.parse(body); } catch (e) { obj = {}; }

            let uidMatch = url.match(/\/subscribers\/([^/?]+)/);
            let extractedUid = uidMatch ? decodeURIComponent(uidMatch[1]) : "locket_gold_vip";

            obj.request_date = nowIso;
            obj.request_date_ms = nowMs;
            obj.subscriber = obj.subscriber || {};
            obj.subscriber.first_seen = obj.subscriber.first_seen || purIso;
            obj.subscriber.last_seen = nowIso;
            obj.subscriber.management_url = null;
            obj.subscriber.non_subscriptions = obj.subscriber.non_subscriptions || {};
            obj.subscriber.original_app_user_id = (obj.subscriber.original_app_user_id && obj.subscriber.original_app_user_id !== "null") ? obj.subscriber.original_app_user_id : extractedUid;
            obj.subscriber.original_application_version = obj.subscriber.original_application_version || "1.0";
            obj.subscriber.original_purchase_date = obj.subscriber.original_purchase_date || purIso;
            obj.subscriber.other_purchases = obj.subscriber.other_purchases || {};
            obj.subscriber.subscriber_attributes = obj.subscriber.subscriber_attributes || {};

            let entObj = obj.subscriber.entitlements || {};
            const entTemplate = { expires_date: expIso, grace_period_expires_date: null, product_identifier: "locket_2400_1y", purchase_date: purIso };
            for (let i = 0; i < ENT_KEYS.length; i++) entObj[ENT_KEYS[i]] = entTemplate;
            obj.subscriber.entitlements = entObj;

            let subObj = obj.subscriber.subscriptions || {};
            const subTemplate = {
                auto_resume_date: null, billing_issues_detected_at: null, expires_date: expIso,
                grace_period_expires_date: null, is_sandbox: false, original_purchase_date: purIso,
                ownership_type: "PURCHASED", period_type: "normal", product_plan_identifier: null,
                purchase_date: purIso, refunded_at: null, store: "app_store", unsubscribe_detected_at: null
            };
            for (let i = 0; i < SUB_KEYS.length; i++) subObj[SUB_KEYS[i]] = subTemplate;
            obj.subscriber.subscriptions = subObj;

            body = JSON.stringify(obj);
        }

        headers["etag"] = String(nowMs);
        headers["ETag"] = String(nowMs);
        headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0";
        headers["Pragma"] = "no-cache";
        $done({ headers, body });
    } catch (e) {
        $done({ body });
    }
})();
