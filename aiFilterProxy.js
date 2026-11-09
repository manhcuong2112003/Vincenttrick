// aiFilterProxy.js - Bắt mọi request generateFilteredImage của Locket và chuyển thẳng về Cloudflare Worker
const workerUrl = "https://locket-filter.manhcuong2112003.workers.dev/generateFilteredImage";

const method = ($request && $request.method) ? $request.method : "POST";
const headers = ($request && $request.headers) ? $request.headers : {};
const body = ($request && $request.body) ? $request.body : "";

// Xóa host cũ, đổi sang host của worker
headers["Host"] = "locket-filter.manhcuong2112003.workers.dev";
headers["host"] = "locket-filter.manhcuong2112003.workers.dev";

$httpClient.post({
    url: workerUrl,
    headers: headers,
    body: body,
    timeout: 30
}, function(error, response, data) {
    if (error) {
        console.log("aiFilterProxy HTTP Error: " + error);
        $done({ response: { status: 500, body: JSON.stringify({ error: error }) } });
    } else {
        $done({
            response: {
                status: response.status || 200,
                headers: response.headers || { "Content-Type": "application/json" },
                body: data
            }
        });
    }
});
