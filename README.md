# dbc-stream

Decoded, ready-to-use events for **Meteora Dynamic Bonding Curve (DBC)**. Plain JavaScript.

DBC events are hard to read from raw transactions (inner instructions, duplicate swap events,
BN values). `dbc-stream` does that for you and gives you clean events for **one launchpad**.

```js
const { DbcStream } = require("dbc-stream");

const stream = new DbcStream({
  rpcUrl: process.env.RPC_URL,
  configs: ["YourLaunchpadConfigAddress"],   // follow only your launchpad
  cursorFile: "./cursor.json",               // optional: resume after a restart
});

stream.on("pool_created", (e) => console.log("new token", e.data.base_mint));
stream.on("swap", (e) => console.log(e.derived.side, e.derived.price, e.derived.progress_pct + "%"));
stream.start();
```

## Event shape

```json
{
  "id": "<signature>:<index>",
  "type": "swap",
  "name": "EvtSwap2",
  "signature": "...", "slot": 454532498, "blockTime": 1791459205,
  "data": { "...": "all fields from the program, as strings" },
  "derived": { "side": "sell", "price": 2.6e-7, "base_amount": "...", "quote_amount": "...", "progress_pct": 83.67 }
}
```

| type | events it covers | meaning |
|---|---|---|
| `pool_created` | `EvtInitializePool`, `...WithTransferHook` | a token launched on the curve |
| `swap` | `EvtSwap2`, `EvtSwap2WithTransferHook`, legacy `EvtSwap` | a buy or sell (counted once) |
| `curve_complete` | `EvtCurveComplete`, `...WithTransferHook` | curve filled up, pool is ready to graduate |
| `fee_claim` | `EvtClaim*Fee*` | creator, partner or protocol claimed fees |
| `withdraw` | `Evt*Withdraw*` | surplus, leftover or migration-fee withdrawal |
| `config_created` | `EvtCreateConfig*` | a launchpad config was created |
| `metadata` | `EvtPartnerMetadata`, `EvtVirtualPoolMetadata` | token or partner metadata |
| `other` | everything else | raw name in `event.name` |

DBC has no "migrated" event. `curve_complete` is the last DBC signal before graduation.

`derived` is only set on swaps. `price` is quote per whole base token (set `baseDecimals` /
`quoteDecimals` if not 6 / 9). `progress_pct` is how close the pool is to graduating.

## Options

| option | default | what it does |
|---|---|---|
| `rpcUrl` | required | Solana RPC (http) |
| `wsUrl` | rpc default | RPC websocket |
| `configs` | none | only follow these launchpad config addresses |
| `cursorFile` | none | save progress; replay missed events on restart |
| `idl` | bundled | DBC IDL |
| `maxRequestsPerSecond` | 5 | RPC rate cap |
| `maxQueue` | 500 | max waiting transactions |

`stream.backfill({ limit })` replays history. `stream.stats()` returns live counters.
Delivery is **at-least-once**: after a restart an event can repeat, so dedupe on `event.id`.

## Serve it over WebSocket

The package itself has no server and no `ws` dependency. A ready-made server lives in
[`examples/server.js`](examples/server.js): run it, copy it, or build your own with
`stream.on("event", ...)` (see `examples/custom-server.js`).

```bash
npm i ws          # the example server needs it
npm run server    # ws://localhost:8080
```

Clients choose what they get with a query string (all optional, lists are comma separated):

| URL | gives you |
|---|---|
| `ws://host:8080` | every event |
| `ws://host:8080?types=swap,pool_created` | only those event types |
| `ws://host:8080?pool=<pool address>` | only events for those pools |
| `ws://host:8080?config=<config address>` | only events for those launchpads |
| `ws://host:8080?types=swap&pool=A,B&replay=20` | combine filters; `replay=20` sends the last 20 matching events first |
| `http://host:8080/health` | `{ ok, clients, ...stream.stats() }` |

`pool` and `config` match `event.data.pool` / `event.data.config`; events without that field
are skipped when you filter on it. The server pings clients (drops dead connections), keeps the
last 200 events for `replay`, and limits clients (`maxClients`, default 500). For a public
`wss://` endpoint, put it behind a TLS proxy such as Caddy or nginx.

Try it with no RPC at all: `npm run demo:fake` in one terminal, `npm run ws-client` in another.

## Docker

```bash
docker build -t dbc-stream .
docker run -p 8080:8080 -e RPC_URL=... -e CONFIG_KEYS=... dbc-stream
```

## Setup from source

```bash
npm install
cp .env.example .env      # set RPC_URL and CONFIG_KEYS
npm run events            # list event names in the IDL
npm run find-config -- <token mint>   # find the config behind a launched token
npm run example
npm test
```

Tip: a partner `PoolConfig` is not the same as the DAMM v2 migration fee config keys in the Meteora docs.

## Notes
- Without `configs`, the stream follows the entire DBC program. That is very busy and will hit free RPC limits.
- The bundled IDL is `constant/idl.json`. Replace it, or pass `idl`, if Meteora updates the program.

MIT licensed.
# DbcStream
