// Build YOUR OWN server on top of the stream (no helper needed).
// Here: a tiny HTTP server-sent-events endpoint with only swaps.
try { require("dotenv").config(); } catch (_) {}
const http = require("http");
const { DbcStream } = require("../src");

const stream = new DbcStream({
  rpcUrl: process.env.RPC_URL,
  configs: (process.env.CONFIG_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean),
});

const clients = new Set();
stream.on("swap", (e) => {
  for (const res of clients) res.write(`data: ${JSON.stringify(e)}\n\n`);
});

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    clients.add(res);
    req.on("close", () => clients.delete(res));
  })
  .listen(3000, () => console.log("SSE on http://localhost:3000"));

stream.start().catch(console.error);
