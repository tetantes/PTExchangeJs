const axios = require('axios');
const http = require('http');
const https = require('https');
const config = require('../config');

const gatewayHeaders = { 'x-gateway-key': config.gatewayKey };

// Without keepAlive, every single call opens a fresh TCP connection and does
// a full TLS handshake against the same host - typically 100-300ms of pure
// connection setup on top of the actual request, repeated on every dashboard
// view, wallet check, and deposit-monitor tick. Reusing sockets cuts that to
// near-zero after the first request to each host.
const keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 20 });
const keepAliveHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 20 });

const ton = axios.create({
  baseURL: config.tonApiUrl, timeout: 15000,
  httpAgent: keepAliveHttpAgent, httpsAgent: keepAliveHttpsAgent,
});
const bsc = axios.create({
  baseURL: config.bscApiUrl, timeout: 15000,
  httpAgent: keepAliveHttpAgent, httpsAgent: keepAliveHttpsAgent,
});

async function safePost(client, path, json) {
  try {
    const { data } = await client.post(path, json, { headers: gatewayHeaders });
    return data;
  } catch (err) {
    return { success: false, message: err.response?.data?.message || err.message };
  }
}

module.exports = {
  // ── Registration / API keys ──
  register: (userId, username) => safePost(ton, '/register', { user_id: String(userId), username: username || '' }),

  // ── TON ──
  tonGenerateWallet: (apiKey, version) => safePost(ton, '/wallet', { api_key: apiKey, action: 'generate', version }),
  tonImportWallet: (apiKey, mnemonic, version) => safePost(ton, '/wallet', { api_key: apiKey, action: 'import', mnemonic, version }),
  tonBalance: (address) => safePost(ton, '/balance', { address }),
  tonTransactions: (address, limit = 10) => safePost(ton, '/transactions', { address, limit }),
  payTon: (apiKey, toAddress, amount, comment) => safePost(ton, '/pay/ton', { api_key: apiKey, to_address: toAddress, amount, comment }),

  // ── BSC ──
  bscGenerateWallet: (apiKey) => safePost(bsc, '/bsc/wallet', { action: 'generate', api_key: apiKey }),
  bscImportWallet: (apiKey, { mnemonic, privateKey }) =>
    safePost(bsc, '/bsc/wallet', privateKey
      ? { action: 'import', api_key: apiKey, private_key: privateKey }
      : { action: 'import', api_key: apiKey, mnemonic }),
  bscBalance: (apiKeyOrAddress) =>
    safePost(bsc, '/bsc/balance', apiKeyOrAddress.apiKey ? { api_key: apiKeyOrAddress.apiKey } : { address: apiKeyOrAddress.address }),
  bscTransactions: (apiKey, limit = 10) => safePost(bsc, '/bsc/transactions', { api_key: apiKey, limit }),

  // Was documented in the API docs screen but never actually implemented as
  // a callable function - needed now for the in-bot /send flow.
  payBnb: (apiKey, toAddress, amount) => safePost(bsc, '/pay/bnb', { api_key: apiKey, to_address: toAddress, amount }),
  payBep20: (apiKey, toAddress, tokenSymbol, amount) =>
    safePost(bsc, '/pay/bep20', { api_key: apiKey, to_address: toAddress, token_symbol: tokenSymbol, amount }),

  // NEW - needs a matching endpoint added on your Vercel gateway (see the
  // deploy notes). /register is idempotent (always returns the same key for
  // a known user_id), so "regenerate" was silently calling that and getting
  // the same key back. This calls a dedicated endpoint instead.
  regenerateApiKey: (userId, oldApiKey) => safePost(ton, '/regenerate-key', { user_id: String(userId), old_api_key: oldApiKey }),

  // ── Deposit polling (used by the cron job) ──
  recentTransactions: (apiKey, limit = 10) => safePost(ton, '/trans', { api_key: apiKey, limit }),

  // ── Jetton search (direct Toncenter call - was hardcoded key in TPY, now env var) ──
  findJettonMasters: async (query) => {
    try {
      const { data } = await axios.get('https://toncenter.com/api/v3/jetton/masters', {
        params: { name: query, limit: 10, offset: 0 },
        headers: { 'X-API-Key': config.toncenterKey },
        timeout: 15000,
        httpsAgent: keepAliveHttpsAgent,
      });
      return data;
    } catch {
      return null;
    }
  },
};
