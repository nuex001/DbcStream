// Tiny test client. Reconnects automatically.
//
//   node examples/ws-client.js
//   node examples/ws-client.js "ws://localhost:8080?types=swap&replay=5"
//   node examples/ws-client.js "ws://localhost:8080?pool=<pool address>&replay=10"
//   node examples/ws-client.js "wss://your-domain.com?types=pool_created"
const WebSocket = require("ws");

const url = process.argv[2] || "ws://localhost:8080?replay=5";
let retry = 1000;

function connect() {
  const ws = new WebSocket(url);

  ws.on("open", () => {
    retry = 1000;
    console.log("connected to", url);
  });

  ws.on("message", (raw) => {
    const e = JSON.parse(raw);
    const d = e.derived;
    console.log(e.type.padEnd(13), e.signature.slice(0, 8), d ? `${d.side} price=${d.price.toExponential(3)} progress=${d.progress_pct}%` : "");
  });

  ws.on("close", () => {
    console.log(`disconnected, retrying in ${retry / 1000}s`);
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, 15000);
  });

  ws.on("error", (err) => console.error("ws error:", err.message));
}

connect();
