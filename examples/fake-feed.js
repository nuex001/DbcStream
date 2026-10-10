// Test the WebSocket server with NO RPC and NO idl. Emits a fake event every second.
//   Terminal 1: npm run demo:fake
//   Terminal 2: npm run ws-client
const { EventEmitter } = require("events");
const { attachWebSocketServer } = require("./server");

const fake = new EventEmitter();
fake.stats = () => ({ fake: true });

const port = Number(process.env.PORT) || 8080;
attachWebSocketServer(fake, { port });
console.log(`Fake feed on ws://localhost:${port}  (health: http://localhost:${port}/health)`);

let n = 0;
setInterval(() => {
  n++;
  const isPool = n % 5 === 0;
  fake.emit("event", {
    id: `fake${n}:0`,
    type: isPool ? "pool_created" : "swap",
    name: isPool ? "EvtInitializePool" : "EvtSwap2",
    signature: `fakesignature${n}`,
    slot: 1000 + n,
    blockTime: Math.floor(Date.now() / 1000),
    data: { pool: `Pool${n % 3}`, config: "FakeConfig" },
    derived: isPool ? null : { side: n % 2 ? "buy" : "sell", price: 2.6e-7, progress_pct: n % 100 },
  });
}, 1000);
