import { createServer } from "node:http";

// Tiny S3-compatible stub for local dev / e2e: accepts presigned PUTs and
// multipart calls, stores nothing. Point R2_ENDPOINT at it. Real signature
// enforcement is R2's job in production; this validates the browser flow.
const port = Number(process.env.S3_STUB_PORT ?? 9000);

// Browser uploads are cross-origin — R2 needs bucket CORS rules in production
// (allow PUT from APP_URL, expose ETag); the stub mirrors that here.
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "PUT, POST, GET, OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "ETag",
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  // drain the body
  req.on("data", () => {});
  req.on("end", () => {
    if (req.method === "PUT") {
      res.writeHead(200, { ...cors, etag: '"stub-etag"' });
      res.end();
      return;
    }
    if (req.method === "POST" && url.searchParams.has("uploads")) {
      res.writeHead(200, { ...cors, "content-type": "application/xml" });
      res.end(
        `<?xml version="1.0"?><InitiateMultipartUploadResult><Bucket>stub</Bucket><Key>${url.pathname.slice(1)}</Key><UploadId>stub-upload</UploadId></InitiateMultipartUploadResult>`,
      );
      return;
    }
    if (req.method === "POST" && url.searchParams.has("uploadId")) {
      res.writeHead(200, { ...cors, "content-type": "application/xml" });
      res.end(
        `<?xml version="1.0"?><CompleteMultipartUploadResult><Key>${url.pathname.slice(1)}</Key><ETag>"stub-etag"</ETag></CompleteMultipartUploadResult>`,
      );
      return;
    }
    res.writeHead(200, cors);
    res.end();
  });
}).listen(port, () => console.log(`[s3-stub] listening on :${port}`));
