try { require("dotenv").config(); } catch (_) {}
const { DbcStream } = require("../src");

// CONFIG_KEYS=addr1,addr2  -> only follow YOUR launchpad(s)
const configs = (process.env.CONFIG_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean);

const stream = new DbcStream({
  rpcUrl: process.env.RPC_URL,
  wsUrl: process.env.WS_URL,
  configs,
  cursorFile: process.env.CURSOR_FILE || "./cursor.json", // remembers where we stopped
});

stream.on("pool_created", (e) => console.log("NEW POOL", e.data.base_mint, "config", e.data.config));
stream.on("swap", (e) => {
  console.log(e);
  
  const d = e.derived;
  console.log(`SWAP ${d.side} price=${d.price.toExponential(3)} progress=${d.progress_pct}% ${e.signature.slice(0, 8)}`);
});

stream.start().catch(console.error);
console.log(configs.length ? `Following ${configs.length} config(s)` : "Following whole program");

setInterval(() => console.log("stats", stream.stats()), 30000);
