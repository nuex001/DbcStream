// Adds an `event.derived` object so builders don't have to do the math.
// Works on the plain (JSON-safe) event produced by normalizeEvent.

const Q64 = 2 ** 64; // DBC prices are sqrt prices in Q64.64 fixed point

function enrichSwap(event, opts) {
  const d = event.data;
  const r = d.swap_result || {};
  const baseDecimals = opts.baseDecimals ?? 6;  // DBC base tokens are usually 6 decimals
  const quoteDecimals = opts.quoteDecimals ?? 9; // 9 for SOL, 6 for USDC

  // trade_direction 0 = base -> quote (a SELL), 1 = quote -> base (a BUY)
  const side = d.trade_direction === 0 ? "sell" : "buy";

  // EvtSwap2 and legacy EvtSwap name the input amount differently
  const input = r.included_fee_input_amount ?? r.actual_input_amount;
  const output = r.output_amount;

  // Price = (sqrtPrice / 2^64)^2, then adjust for decimals -> quote per 1 whole base token
  const sqrt = Number(r.next_sqrt_price) / Q64;
  const price = sqrt * sqrt * 10 ** (baseDecimals - quoteDecimals);

  // Graduation progress (only EvtSwap2 carries the reserve + threshold)
  let progressPct = null;
  if (d.quote_reserve_amount && d.migration_threshold) {
    progressPct = Number((BigInt(d.quote_reserve_amount) * 10000n) / BigInt(d.migration_threshold)) / 100;
  }

  return {
    side,
    base_amount: side === "sell" ? input : output,  // raw units (strings)
    quote_amount: side === "sell" ? output : input, // raw units (strings)
    price,                                          // quote per whole base token
    progress_pct: progressPct,                      // 0 - 100, or null
  };
}

function enrich(event, opts = {}) {
  if (event.type === "swap" && event.data && event.data.swap_result) return enrichSwap(event, opts);
  return null;
}

module.exports = { enrich };
