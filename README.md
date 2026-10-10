{
  "name": "dbc-stream",
  "version": "0.1.0",
  "description": "Plug-and-play event stream for Meteora Dynamic Bonding Curve (DBC): decoded events, derived price and graduation progress, per-launchpad filtering, restart-safe.",
  "main": "src/index.js",
  "files": [
    "src",
    "constant",
    "README.md",
    "LICENSE"
  ],
  "keywords": [
    "solana",
    "meteora",
    "dbc",
    "bonding-curve",
    "launchpad",
    "events",
    "indexer"
  ],
  "scripts": {
  "test": "node --test",
    "events": "node scripts/list-events.js",
    "find-config": "node scripts/find-config.js",
    "example": "node examples/basic.js",
    "server": "node examples/server.js",
    "demo:fake": "node examples/fake-feed.js",
    "ws-client": "node examples/ws-client.js"
  },
  "license": "MIT",
  "dependencies": {
    "@coral-xyz/anchor": "^0.31.1",
    "@solana/web3.js": "^1.98.0",
    "bs58": "^5.0.0"
  },
  "devDependencies": {
    "@meteora-ag/dynamic-bonding-curve-sdk": "^1.5.13",
    "dotenv": "^16.4.5"
  },
  "optionalDependencies": {
    "ws": "^8.18.0"
  }
}
# DbcStream
