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

## 5. Nguyên Tắc Chống Hồi Quy & Cô Lập Tính Năng (Regression Prevention Invariant)
1. **Tuyệt Đối Không Phá Hỏng Tính Năng Cốt Lõi Khi Thêm Tính Năng Mới:**
   - Gold VIP, Video 30s và Khung Hoàng Gia là tính năng sống còn cấp độ 1 (P0).
   - Khi phát triển hoặc sửa lỗi cho các tính năng cấp độ 2 (như AI Camera Filter, PhotoBooth, v.v.), **tuyệt đối không được làm suy chuyển hoặc gián đoạn luồng RevenueCat và Firebase Remote Config đã hoạt động ổn định**.
2. **Cấm Ghi Đè Payload Tĩnh (Raw Dump Overwrite) Làm Hỏng Dynamic Engine:**
   - Tuyệt đối không thay thế cơ chế tiêm động (Dynamic Entitlement Injection) bằng một chuỗi JSON tĩnh (`RAW_SUBS`) được trích xuất từ thiết bị khác.
   - Luôn duy trì bộ tiêm động:
     - Giữ nguyên và kế thừa `original_app_user_id` của thiết bị gọi request (tránh lệch UUID thiết bị).
     - Luôn đảm bảo `unsubscribe_detected_at: null`, `billing_issues_detected_at: null`, `refunded_at: null`.
     - Duy trì 160 entitlement keys với hạn 2099.
3. **Nguyên Tắc Định Tuyến Mạng An Toàn (Transparent Proxy Invariant):**
   - Khi cần điều hướng traffic sang Cloudflare Worker hoặc backend bên ngoài:
     - Worker bắt buộc phải có cơ chế **Transparent Reverse Proxy**: Chỉ xử lý riêng các path được chỉ định (như `/generateFilteredImage`), toàn bộ các path Cloud Functions còn lại (như `fetchUsers`, `getMomentViews`, `createDynamicLink`...) phải được forward 100% nguyên vẹn sang `https://api.locketcamera.com`.
     - Tuyệt đối không để Worker trả về 404 cho các hàm nội bộ của Locket, gây corrupt dữ liệu người dùng trên iOS.
4. **Kiểm Thử Hồi Quy 4 Trụ Cột (4-Pillar Regression Test) Trước Khi Commit:**
   - Bất kỳ thay đổi nào trên `locket_gold_30s.js`, `locket.module` hoặc `worker.js` đều phải vượt qua bài kiểm tra Node.js sandbox đồng thời:
     1. **Trụ cột 1 (RevenueCat):** Gold active = true, `expires_date` = 2099, `unsubscribe_detected_at` = null, App User ID được bảo toàn.
     2. **Trụ cột 2 (Firebase Remote Config):** Đủ 1,014 cờ, `is_gold: "true"`, `video_30s: "true"`, ETag động.
     3. **Trụ cột 3 (App Stability):** `functions_domains` an toàn, không làm đứt gãy kết nối với backend Locket.
     4. **Trụ cột 4 (Zero Side-Effects):** Xác nhận rõ việc sửa lỗi B không tạo ra bất kỳ thay đổi tiêu cực nào lên tính năng A.
