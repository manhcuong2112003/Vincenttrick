// deleteHeader.js - Xóa ETag / If-None-Match để ép RevenueCat và Firebase luôn trả về HTTP 200 kèm JSON mới nhất
function setHeaderValue(headers, key, value) {
    const lowerKey = key.toLowerCase();
    for (let k in headers) {
        if (k.toLowerCase() === lowerKey) {
            headers[k] = value;
        }
    }
    headers[key] = value;
}

var modifiedHeaders = $request.headers || {};

const headersToModify = {
    "X-RevenueCat-ETag": "",
    "x-revenuecat-etag": "",
    "If-None-Match": "",
    "if-none-match": "",
    "If-Modified-Since": "",
    "if-modified-since": "",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache"
};

for (let key in headersToModify) {
    setHeaderValue(modifiedHeaders, key, headersToModify[key]);
}

$done({ headers: modifiedHeaders });
