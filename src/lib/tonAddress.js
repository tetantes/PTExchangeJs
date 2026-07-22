// TON's "friendly" address format (the EQ.../UQ... strings we store) is:
//   byte[0]      tag (bounceable/non-bounceable/testnet flags)
//   byte[1]      workchain, signed 8-bit
//   byte[2..33]  32-byte account hash
//   byte[34..35] CRC16 checksum
// base64url-encoded (36 bytes -> 48 chars). TonAPI's webhook subscription API
// wants the "raw" form instead: "<workchain>:<64 lowercase hex chars>".
function friendlyToRaw(friendlyAddress) {
  const b64 = friendlyAddress.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length !== 36) {
    throw new Error(`Invalid TON address length: expected 36 bytes, got ${bytes.length}`);
  }

  let workchain = bytes[1];
  if (workchain === 0xff) workchain = -1; // masterchain, signed byte

  const hash = bytes.subarray(2, 34).toString('hex');
  return `${workchain}:${hash}`;
}

module.exports = { friendlyToRaw };
