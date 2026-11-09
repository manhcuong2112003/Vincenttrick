// logFilterRequest.js - Bắt và in toàn bộ Header, Body của request generateFilteredImage
const url = ($request && $request.url) ? $request.url : "";
const method = ($request && $request.method) ? $request.method : "UNKNOWN";
const headers = ($request && $request.headers) ? JSON.stringify($request.headers) : "{}";
let body = $request && $request.body ? $request.body : "";

let previewBody = "";
if (typeof body === "string") {
    previewBody = body.length > 500 ? body.substring(0, 500) + "... [Tổng độ dài: " + body.length + "]" : body;
} else {
    previewBody = "[Body là Buffer nhị phân, độ dài: " + (body ? body.byteLength || body.length : 0) + "]";
}

console.log("========== [LOCKET AI FILTER CAPTURE] ==========");
console.log("METHOD: " + method);
console.log("URL: " + url);
console.log("HEADERS: " + headers);
console.log("BODY PREVIEW: " + previewBody);
console.log("================================================");

$done({});
