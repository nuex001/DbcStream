// Makes events safe to JSON.stringify and gives every event the same envelope.

const { PublicKey } = require("@solana/web3.js");
const { BN } = require("@coral-xyz/anchor");

// BN -> string, PublicKey -> base58, bytes -> hex, recursively.
function toPlain(value) {
  if (value === null || value === undefined) return value;
  if (BN.isBN(value)) return value.toString();
  if (value instanceof PublicKey) return value.toBase58();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = toPlain(v);
    return out;
  }
  return value;
}

// Friendly type names, built from the real event list in the DBC IDL.
// Exact names on purpose: a loose pattern like /migrat/ wrongly caught
// EvtCreateMeteoraMigrationMetadata and EvtWithdrawMigrationFee.
// Anything not listed here arrives as type "other" (see event.name).
const TYPE_BY_EVENT = {
  // launches
  EvtInitializePool: "pool_created",
  EvtInitializePoolWithTransferHook: "pool_created",
  // trades
  EvtSwap: "swap",
  EvtSwap2: "swap",
  EvtSwap2WithTransferHook: "swap",
  // curve filled up -> pool is ready to graduate
  EvtCurveComplete: "curve_complete",
  EvtCurveCompleteWithTransferHook: "curve_complete",
  // fees
  EvtClaimTradingFee: "fee_claim",
  EvtClaimCreatorTradingFee: "fee_claim",
  EvtClaimProtocolFee2: "fee_claim",
  EvtClaimPoolCreationFee: "fee_claim",
  EvtPartnerClaimPoolCreationFee: "fee_claim",
  // withdrawals
  EvtCreatorWithdrawSurplus: "withdraw",
  EvtPartnerWithdrawSurplus: "withdraw",
  EvtWithdrawLeftover: "withdraw",
  EvtWithdrawMigrationFee: "withdraw",
  // launchpad setup
  EvtCreateConfig: "config_created",
  EvtCreateConfigV2: "config_created",
  EvtCreateConfigV2WithTransferHook: "config_created",
  // token metadata
  EvtPartnerMetadata: "metadata",
  EvtVirtualPoolMetadata: "metadata",
};

function friendlyType(eventName) {
  return TYPE_BY_EVENT[eventName] || "other";
}

// DBC emits BOTH EvtSwap (legacy) and EvtSwap2 (richer) for the same swap.
// If a transaction has EvtSwap2, drop its EvtSwap so each swap is counted once.
// Old transactions that only have EvtSwap keep it.
// Takes [{ d: decodedEvent, index }] and returns the filtered list.
function dropLegacySwaps(items) {
  const hasV2 = items.some((i) => i.d.name === "EvtSwap2" || i.d.name === "EvtSwap2WithTransferHook");
  return hasV2 ? items.filter((i) => i.d.name !== "EvtSwap") : items;
}

function normalizeEvent(decoded, ctx) {
  return {
    id: `${ctx.signature}:${ctx.index}`, // unique + stable -> safe to dedupe
    type: friendlyType(decoded.name),    // "swap", "pool_created", ...
    name: decoded.name,                  // raw name from the IDL
    program: ctx.programId,
    signature: ctx.signature,
    slot: ctx.slot,
    blockTime: ctx.blockTime,            // unix seconds (may be null)
    data: toPlain(decoded.data),         // all fields, JSON-safe
  };
}

module.exports = { normalizeEvent, toPlain, friendlyType, dropLegacySwaps };
