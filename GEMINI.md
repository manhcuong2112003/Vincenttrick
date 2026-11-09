# Quy Tắc Dự Án Shadowrocket (`SDRK / Vincenttrick`)

## 1. Phạm Vi Dự Án (Project Scope)
- Thư mục này quản lý dự án **Shadowrocket (`Vincenttrick`)** trên repository `https://github.com/manhcuong2112003/Vincenttrick` (Cloudflare Pages: `https://vincenttrick.pages.dev/`).
- Bao gồm:
  1. Portal cài đặt Shadowrocket IPA (`index.html`, `Shadowrocket-IPAOMTK.COM.ipa`, `auto_sign_manager.py`).
  2. Cấu hình DNS chống thu hồi chứng chỉ doanh nghiệp (`Vincent-DNS.mobileconfig`).
  3. Gói Mô-đun Shadowrocket mở khóa Locket Gold VIP & Video 30s (`locket.module`, `locket_gold_30s.js`, `locket_30s.js`, `deleteHeader.js`).

## 2. Quy Cách Cấu Hình Shadowrocket Cho Locket (`locket.module`, `locket_gold_30s.js`, `deleteHeader.js`)
1. **Bảo Toàn Trọn Bộ 1.014 Cờ Firebase Remote Config & `ETag` Động:**
   - **Tuyệt đối không** lọc rút gọn danh sách `entries` của `firebaseremoteconfig.googleapis.com` theo từ khóa `"video"`/`"camera"`. Tính năng 30s và giao diện Gold VIP phụ thuộc trực tiếp vào các cờ không chứa chữ `video`:
     - `feature_gates` & `feature_gates_override` (`"can_record_30s_video":"enabled"`, `"video_30s":"enabled"`, `"camera_theme":"enabled"`, `"custom_widget_frames":"enabled"`).
     - `flag_6: "3000"`, `flag_10: "5030"`, `flag_14: "5030"`, `flag_15: "5030"` (cờ giới hạn thời lượng mã hóa).
     - `feature_discovery_popup_config` (Popup hiệu ứng vàng *"Đã mở khoá GOLD thành công!"*).
     - `all_widget_frames`, `available_widget_frames`, `custom_widget_frames_list`, `widget_frames` (Khung **Hoàng Gia Gold VIP 👑**).
     - `is_gold`, `gold_enabled`, `locket_gold_enabled`, `gold_badge_profile_menu`, `gold_custom_app_icons`.
   - Luôn trả về HTTP response header `ETag: String(Date.now())` cùng body `"templateVersion": String(Date.now())`, `"state": "UPDATE"` để ép Firebase iOS SDK nạp cấu hình mới ngay lập tức.
2. **Bắt Buộc Chặn QUIC (`UDP 443`) & Kênh Firebase Realtime Trong `[Rule]` của `locket.module`:**
   - Luôn giữ quy tắc `AND,((PROTOCOL,UDP),(DEST-PORT,443)),REJECT` để ép `NSURLSession` trên iOS hạ từ QUIC (HTTP/3) xuống TCP HTTPS (tránh việc kết nối Firebase đi vòng qua bộ giải mã MITM của Shadowrocket).
   - Chặn `DOMAIN,firebaseremoteconfigrealtime.googleapis.com,REJECT` và `DOMAIN,appattest.apple.com,REJECT` để ngăn Google đẩy luồng Realtime ghi đè lại cấu hình gốc.
3. **Bao Phủ Đầy Đủ `rc-cdn.revenuecat.com` & `sdk.revenuecat.com` Trong `[MITM]` và `[Script]`:**
   - Kịch bản `revenuecat` và danh sách `hostname` trong `[MITM]` phải bao phủ cả `api.revenuecat.com`, `rc-cdn.revenuecat.com`, `sdk.revenuecat.com`, `revenuecat.com` để tiêm đủ 160 quyền VIP, 7 Product Entitlement Mappings và 16 Offerings.
4. **Xóa `ETag` Trong `deleteHeader.js` Bằng Chuỗi Rỗng `""` (Không Dùng Toán Tử `delete`):**
   - Trong môi trường Objective-C bridge (`NSMutableURLRequest`) của Shadowrocket, lệnh `delete headers[k]` không xóa được header gốc của request. Bắt buộc dùng `setHeaderValue(modifiedHeaders, key, "")` cho `X-RevenueCat-ETag`, `If-None-Match` và `If-Modified-Since` để ngăn server trả về `304 Not Modified`.
5. **Quy Trình Người Dùng Chuẩn (Locket App Store + Shadowrocket):**
   - Hỗ trợ người dùng sử dụng trực tiếp app Locket gốc tải từ App Store.
   - Thiết bị chỉ cần: Cài Shadowrocket ➔ Thêm `locket.module` ➔ Bật HTTPS Decryption & Tin cậy chứng chỉ MITM của máy ➔ Bật VPN và dùng Locket.

## 3. Đồng Bộ Git & GitHub Actions
- Trước khi `git push origin main`, luôn chạy `git pull --rebase -X theirs origin main` để tránh xung đột với commit tự động từ GitHub Actions.
- Khi đẩy từ Windows, sử dụng remote có tiền tố username `https://manhcuong2112003@github.com/manhcuong2112003/Vincenttrick.git` để khớp với token lưu trong Windows Credential Manager.

## 4. Nguyên Tắc An Toàn & Bảo Toàn Dữ Liệu Module (Learned from Debugging)
1. **Tuyệt Đối Không Để `expires_date` Quá Khứ:**
   - Toàn bộ 160 quyền VIP trong `subscriber.entitlements` (đặc biệt là `Gold`, `filters`, `all_filters`) bắt buộc phải có `"expires_date": "2099-12-31T23:59:59Z"`. Tuyệt đối không để ngày quá khứ khiến iOS coi gói cước là đã hết hạn.
2. **Bảo Toàn Bộ 3 Kịch Bản Cốt Lõi Trong `locket.module`:**
   - Chỉ giữ nguyên 3 hook chuẩn: `deleteHeader` (request), `revenuecat` (response), `locketFirebase` (response).
   - Tuyệt đối không tùy tiện chèn thêm các hook `http-request` can thiệp vào luồng Locket nếu chưa kiểm thử riêng biệt để tránh nghẽn socket xác thực VIP.
3. **Luôn Xác Thực Độc Lập Bằng Node.js Sandbox Trước Khi Commit:**
   - Trước khi push code `locket_gold_30s.js`, bắt buộc phải chạy script kiểm thử giả lập với cả 2 URL `api.revenuecat.com` và `firebaseremoteconfig.googleapis.com` để đảm bảo:
     - `entitlements.Gold` active = true, `expires_date` năm 2099.
     - `entries.is_gold` = "true".
     - `entries.can_record_30s_video` = "true".
