// Turns one fetched transaction into a list of decoded Anchor events.


const bs58 = require("bs58");
const { BorshCoder, EventParser } = require("@coral-xyz/anchor");

// First 8 bytes of every emit_cpi! instruction (sha256("anchor:event")[0..8])
const EMIT_CPI_TAG = Buffer.from("e445a52e51cb9a1d", "hex");

function createDecoder(idl, programId) {
  const coder = new BorshCoder(idl);
  const logParser = new EventParser(programId, coder);

  return function decodeTransaction(tx) {
    const meta = tx.meta;
    const events = [];

    // A) emit_cpi! events (inner instructions)
    const keys = tx.transaction.message.getAccountKeys({
      accountKeysFromLookups: meta.loadedAddresses, // needed for v0 transactions
    });

    for (const group of meta.innerInstructions || []) {
      for (const ix of group.instructions) {
        const ixProgram = keys.get(ix.programIdIndex);
        if (!ixProgram || !ixProgram.equals(programId)) continue;

        const data = Buffer.from(bs58.decode(ix.data));
        if (!data.subarray(0, 8).equals(EMIT_CPI_TAG)) continue;

        // After the 8-byte tag comes: [8-byte event discriminator][borsh data]
        const decoded = coder.events.decode(data.subarray(8).toString("base64"));
        if (decoded) events.push(decoded);
      }
    }

    // B) emit! events (logs)
    for (const decoded of logParser.parseLogs(meta.logMessages || [])) {
      events.push(decoded);
    }

    return events;
  };
}

module.exports = { createDecoder };
