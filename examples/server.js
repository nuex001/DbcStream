// A ready-made WebSocket server for dbc-stream.   npm run server  ->  ws://localhost:8080
// This file is NOT part of the library: copy it, change it, or build your own.
//
// What clients can ask for (all filters are optional, lists are comma separated):
//   ws://host:8080                                  every event
//   ws://host:8080?types=swap,pool_created          only these event types
//   ws://host:8080?pool=<pool address>              only events for these pools
//   ws://host:8080?config=<config address>          only events for these launchpads
//   ws://host:8080?types=swap&pool=A,B&replay=20    combine them; replay = last N matching events first
//   http://host:8080/health                         { ok, clients, ...stream.stats() }
//
// Note: `pool` and `config` match event.data.pool / event.data.config. Events that don't
// carry that field (some fee and admin events) are skipped when you filter on it.
const http = require("http");

const MAX_LIST = 100; // max values per filter, so one client can't send a huge list

function parseList(value) {
  if (!value) return null;
  const items = value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_LIST);
  return items.length ? new Set(items) : null;
}

function parseFilters(url) {
  return {
    types: parseList(url.searchParams.get("types")),
    pools: parseList(url.searchParams.get("pool")),
    configs: parseList(url.searchParams.get("config")),
  };
}

function matches(f, event) {
  const data = event.data || {};
  if (f.types && !f.types.has(event.type)) return false;
  if (f.pools && !f.pools.has(data.pool)) return false;
  if (f.configs && !f.configs.has(data.config)) return false;
  return true;
}

function attachWebSocketServer(
  stream,
  { port = 8080, heartbeatMs = 30000, bufferSize = 200, maxClients = 500 } = {}
) {
  const { WebSocketServer } = require("ws"); // npm i ws

  const server = http.createServer((req, res) => {
    if (req.url.split("?")[0] === "/health") {
      const stats = typeof stream.stats === "function" ? stream.stats() : {};
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, clients: wss.clients.size, ...stats }));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  const wss = new WebSocketServer({ server });

  const recent = []; // last `bufferSize` events, for ?replay=N

  wss.on("connection", (socket, req) => {
    if (wss.clients.size > maxClients) {
      socket.close(1013, "too many clients");
      return;
    }

    const url = new URL(req.url, "http://localhost");
    socket.filters = parseFilters(url);
    socket.isAlive = true;
    socket.on("pong", () => (socket.isAlive = true));
    socket.on("error", () => {});

    const replay = Math.min(Number(url.searchParams.get("replay")) || 0, bufferSize);
    if (replay > 0) {
      recent
        .filter((e) => matches(socket.filters, e))
        .slice(-replay)
        .forEach((e) => socket.send(JSON.stringify(e)));
    }
  });

  // Heartbeat: drop clients that stopped answering pings
  const timer = setInterval(() => {
    for (const client of wss.clients) {
      if (!client.isAlive) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, heartbeatMs);
  timer.unref();

  const onEvent = (event) => {
    recent.push(event);
    if (recent.length > bufferSize) recent.shift();

    const message = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === 1 && matches(client.filters, event)) client.send(message);
    }
  };
  stream.on("event", onEvent);

  server.listen(port);

  return {
    server,
    wss,
    close() {
      stream.off("event", onEvent);
      clearInterval(timer);
      for (const client of wss.clients) client.terminate();
      wss.close();
      server.close();
    },
  };
}

module.exports = { attachWebSocketServer };

// Run directly:  node examples/server.js
if (require.main === module) {
  try { require("dotenv").config(); } catch (_) {}
  const { DbcStream } = require("../src");

  const configs = (process.env.CONFIG_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const stream = new DbcStream({
    rpcUrl: process.env.RPC_URL,
    wsUrl: process.env.WS_URL,
    configs,
    cursorFile: process.env.CURSOR_FILE || "./cursor.json",
  });

  const port = Number(process.env.PORT) || 8080;
  attachWebSocketServer(stream, { port });
  stream.start().catch(console.error);
  console.log(`Streaming on ws://localhost:${port}`);
}
