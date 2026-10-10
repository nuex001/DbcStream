const fs = require("fs");
const { EventEmitter } = require("events");
const { Connection, PublicKey } = require("@solana/web3.js");
const { createDecoder } = require("./decoder");
const { normalizeEvent, dropLegacySwaps } = require("./normalize");
const { enrich } = require("./enrich");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class DbcStream extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string}   opts.rpcUrl            RPC http url
   * @param {string}   [opts.wsUrl]           websocket url (optional)
   * @param {object}   [opts.idl]             the DBC idl.json; defaults to the bundled constant/idl.json
   * @param {string[]} [opts.configs]         ONLY follow these launchpad config addresses
   * @param {string}   [opts.cursorFile]      path to a JSON file; on restart the stream replays what it missed
   * @param {number}   [opts.baseDecimals]    for price math, default 6
   * @param {number}   [opts.quoteDecimals]   for price math, default 9 (SOL)
   * @param {string}   [opts.programId]       defaults to idl.address
   * @param {string}   [opts.commitment]      default "confirmed"
   * @param {number}   [opts.concurrency]     parallel tx fetches, default 2
   * @param {number}   [opts.maxRequestsPerSecond] RPC rate cap, default 5
   * @param {number}   [opts.maxQueue]        max waiting signatures, default 500
   */
  constructor(opts) {
    super();
    if (!opts || !opts.rpcUrl) throw new Error("rpcUrl is required");

    // Use the IDL you pass in, otherwise the one bundled in constant/idl.json
    let idl = opts.idl;
    if (!idl) {
      try {
        idl = require("../constant/idl.json");
      } catch (_) {
        throw new Error("No IDL found. Pass `idl`, or put the DBC idl.json at constant/idl.json");
      }
    }

    this.programId = new PublicKey(opts.programId || idl.address);
    this.commitment = opts.commitment || "confirmed";
    this.concurrency = opts.concurrency || 2;
    this.maxQueue = opts.maxQueue || 500;
    this.minGapMs = 1000 / (opts.maxRequestsPerSecond || 5);
    this.nextSlot = 0; // for the rate limiter
    this.enrichOpts = { baseDecimals: opts.baseDecimals, quoteDecimals: opts.quoteDecimals };

    // Launchpad filter
    this.configKeys = (opts.configs || []).filter(Boolean);
    this.configAddresses = this.configKeys.map((c) => new PublicKey(c));
    this.configSet = new Set(this.configKeys);

    // Cursor (restart safety)
    this.cursorFile = opts.cursorFile || null;
    this.cursorBackfillLimit = opts.cursorBackfillLimit || 2000;
    this.cursorSlot = 0;
    this.cursorSig = null;
    this.cursorDirty = false;
    this.lastCursorWrite = 0;

    this.connection = new Connection(opts.rpcUrl, {
      commitment: this.commitment,
      wsEndpoint: opts.wsUrl || undefined,
      disableRetryOnRateLimit: true, // we handle 429s ourselves (see _fetchTx)
    });
    this.decode = createDecoder(idl, this.programId);

    this.queue = [];
    this.active = 0;
    this.seen = new Set(); // signatures already handled (prevents duplicates)
    this.maxSeen = 5000;
    this.subIds = [];

    this.counters = { received: 0, processed: 0, events: 0, dropped: 0, rateLimited: 0, rpcCalls: 0 };
  }

  stats() {
    return { ...this.counters, queued: this.queue.length, active: this.active };
  }

  _targets() {
    return this.configAddresses.length > 0 ? this.configAddresses : [this.programId];
  }

  // ---- LIVE ----
  // Subscribes first, THEN replays anything missed since the saved cursor, so there is no gap.
  async start() {
    for (const address of this._targets()) {
      const id = this.connection.onLogs(
        address,
        ({ signature, err }) => {
          if (err) return; // ignore failed transactions
          this.counters.received++;
          this._enqueue(signature);
        },
        this.commitment
      );
      this.subIds.push(id);
    }

    if (this.configAddresses.length === 0) {
      console.warn("[dbc-stream] No configs set: following the WHOLE DBC program. Expect heavy traffic.");
    }

    const cursor = this._loadCursor();
    if (cursor) {
      console.log(`[dbc-stream] resuming from slot ${cursor.slot}...`);
      const n = await this.backfill({ sinceSlot: cursor.slot, limit: this.cursorBackfillLimit });
      console.log(`[dbc-stream] caught up on ${n} transaction(s)`);
    }
    return this;
  }

  async stop() {
    for (const id of this.subIds) await this.connection.removeOnLogsListener(id);
    this.subIds = [];
    this._maybeSaveCursor(true);
  }

  // ---- BACKFILL ----
  // Replays past transactions oldest -> newest.
  //   sinceSlot: only transactions at or after this slot (used by the cursor)
  // Delivery is "at least once": the same event may arrive twice after a restart.
  // Every event has a stable `id`, so sinks and consumers can dedupe.
  async backfill({ untilSignature, sinceSlot, limit = 1000 } = {}) {
    const targets = this._targets();
    if (targets.length > 1 && untilSignature) {
      console.warn("[dbc-stream] untilSignature is ignored when following several configs; use sinceSlot or limit.");
      untilSignature = undefined;
    }

    const bySig = new Map(); // signature -> slot (dedupes across configs)
    for (const address of targets) {
      let before;
      let got = 0;
      let reached = false;
      while (!reached && got < limit) {
        const want = Math.min(1000, limit - got);
        await this._throttle();
        this.counters.rpcCalls++;
        const page = await this.connection.getSignaturesForAddress(
          address,
          { before, until: untilSignature, limit: want },
          this.commitment
        );
        if (page.length === 0) break;
        for (const s of page) {
          if (sinceSlot !== undefined && s.slot < sinceSlot) {
            reached = true; // older than the cursor: we're done with this address
            break;
          }
          if (!s.err) bySig.set(s.signature, s.slot);
        }
        got += page.length;
        before = page[page.length - 1].signature;
        if (page.length < want) break;
      }
      if (!reached && sinceSlot !== undefined && got >= limit) {
        console.warn("[dbc-stream] backfill limit reached before the cursor; some events may be missing.");
      }
    }

    const ordered = [...bySig.entries()].sort((a, b) => a[1] - b[1]).map(([sig]) => sig);
    for (const sig of ordered) await this.processSignature(sig);
    this._maybeSaveCursor(true);
    return ordered.length;
  }

  // ---- CURSOR ----
  _loadCursor() {
    if (!this.cursorFile) return null;
    try {
      const c = JSON.parse(fs.readFileSync(this.cursorFile, "utf8"));
      if (typeof c.slot === "number") return c;
    } catch (_) {
      /* no cursor yet */
    }
    return null;
  }

  _trackCursor(slot, signature) {
    if (slot > this.cursorSlot) {
      this.cursorSlot = slot;
      this.cursorSig = signature;
      this.cursorDirty = true;
    }
  }

  // Only saves when nothing is waiting, so the saved slot never skips an unprocessed tx.
  _maybeSaveCursor(force = false) {
    if (!this.cursorFile || !this.cursorDirty) return;
    if (this.queue.length > 0 || this.active > 0) return;
    if (!force && Date.now() - this.lastCursorWrite < 1000) return;
    try {
      const tmp = this.cursorFile + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify({ slot: this.cursorSlot, signature: this.cursorSig, savedAt: Date.now() }));
      fs.renameSync(tmp, this.cursorFile);
      this.cursorDirty = false;
      this.lastCursorWrite = Date.now();
    } catch (err) {
      console.error("[dbc-stream] could not save cursor:", err.message);
    }
  }

  // ---- INTERNALS ----
  _enqueue(signature) {
    if (this.seen.has(signature)) return;
    if (this.queue.length >= this.maxQueue) {
      this.counters.dropped++;
      if (this.counters.dropped % 100 === 1) {
        console.warn(`[dbc-stream] queue full, dropped ${this.counters.dropped} so far. Narrow your configs or raise maxRequestsPerSecond.`);
      }
      return;
    }
    this._markSeen(signature);
    this.queue.push(signature);
    this._pump();
  }

  _markSeen(signature) {
    this.seen.add(signature);
    if (this.seen.size > this.maxSeen) {
      this.seen.delete(this.seen.values().next().value); // drop oldest
    }
  }

  _pump() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const sig = this.queue.shift();
      this.active++;
      this.processSignature(sig)
        .catch((err) => this._report(err, sig))
        .finally(() => {
          this.active--;
          this._pump();
          this._maybeSaveCursor();
        });
    }
  }

  // Spaces out RPC calls so we never exceed maxRequestsPerSecond.
  async _throttle() {
    const now = Date.now();
    const wait = Math.max(0, this.nextSlot - now);
    this.nextSlot = Math.max(now, this.nextSlot) + this.minGapMs;
    if (wait > 0) await sleep(wait);
  }

  // Fetch with: rate limit + backoff on 429 + a few retries if the tx isn't indexed yet.
  async _fetchTx(signature) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      await this._throttle();
      this.counters.rpcCalls++;
      try {
        const tx = await this.connection.getTransaction(signature, {
          commitment: this.commitment,
          maxSupportedTransactionVersion: 1,
        });
        if (tx) return tx;
      } catch (err) {
        if (String(err.message).includes("429")) {
          this.counters.rateLimited++;
          await sleep(1000 * attempt); // back off, then try again
          continue;
        }
        throw err;
      }
      await sleep(500 * attempt); // tx not available yet
    }
    return null;
  }

  async processSignature(signature) {
    this._markSeen(signature);
    const tx = await this._fetchTx(signature);
    if (!tx || !tx.meta || tx.meta.err) return;
    this.counters.processed++;

    // keep each event's original position so ids stay stable after filtering
    const items = this.decode(tx).map((d, index) => ({ d, index }));

    for (const { d, index } of dropLegacySwaps(items)) {
      const event = normalizeEvent(d, {
        signature,
        index,
        slot: tx.slot,
        blockTime: tx.blockTime,
        programId: this.programId.toBase58(),
      });

      // A transaction can touch several launchpads (e.g. routed swaps).
      if (this.configSet.size > 0 && event.data && event.data.config && !this.configSet.has(event.data.config)) {
        continue;
      }

      event.derived = enrich(event, this.enrichOpts);

      this.counters.events++;
      this.emit("event", event); // every event
      this.emit(event.type, event); // only this type, e.g. stream.on("swap", ...)
    }

    this._trackCursor(tx.slot, signature);
  }

  _report(err, signature) {
    if (this.listenerCount("error") > 0) this.emit("error", err, signature);
    else console.error(`[dbc-stream] failed on ${signature}:`, err.message);
  }
}

module.exports = { DbcStream };
