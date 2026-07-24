const axios = require('axios');
const config = require('../config');

// Webhook MANAGEMENT (create/subscribe/unsubscribe) lives on rt.tonapi.io.
const rt = axios.create({
  baseURL: 'https://rt.tonapi.io',
  headers: { Authorization: `Bearer ${config.tonapiKey}` },
  timeout: 15000,
});

// Actual blockchain DATA (looking up a transaction's amount/sender once a
// webhook fires) lives on the main tonapi.io domain - different subdomain.
const api = axios.create({
  baseURL: 'https://tonapi.io',
  headers: { Authorization: `Bearer ${config.tonapiKey}` },
  timeout: 15000,
});

async function createWebhook(endpointUrl) {
  const { data } = await rt.post('/webhooks', { endpoint: endpointUrl });
  return data.webhook_id;
}

async function listWebhooks() {
  const { data } = await rt.get('/webhooks');
  return data.webhooks || [];
}

async function deleteWebhook(webhookId) {
  await rt.delete(`/webhooks/${webhookId}`);
}

// accountIds: array of RAW addresses ("0:abcd...", not "EQ..."/"UQ...")
async function subscribeAccounts(webhookId, accountIds) {
  const accounts = accountIds.map((account_id) => ({ account_id }));
  const { data } = await rt.post(`/webhooks/${webhookId}/account-tx/subscribe`, { accounts });
  return data;
}

async function unsubscribeAccounts(webhookId, accountIds) {
  const { data } = await rt.post(`/webhooks/${webhookId}/account-tx/unsubscribe`, { accounts: accountIds });
  return data;
}

// Retries transient failures instead of dropping the request entirely:
//   429 - rate limited (a burst of webhook deliveries hitting TonAPI at once)
//   404 - the transaction the webhook just told us about isn't indexed in
//         their REST API yet. The webhook fires the instant TonAPI's node
//         SEES the tx; their REST/indexing layer can lag a second or two
//         behind that. This is what caused deposits to sometimes arrive
//         late or not at all - retrying with a short wait covers that gap.
async function withRetry(fn, { attempts = 3, retryStatuses = [429], baseDelay = 500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status;
      if (retryStatuses.includes(status) && i < attempts - 1) {
        const delay = baseDelay * (i + 1);
        console.warn(`TonAPI ${status}, retrying in ${delay}ms (attempt ${i + 1}/${attempts})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

// Called the moment a webhook fires (which only gives us account_id + tx_hash,
// no amount) - this fetches the actual transaction so we know what happened.
// Generous retry profile: up to 5 attempts, ~1s/2s/3s/4s backoff (~10s total
// patience) to ride out indexing lag, since a slightly-late notification is
// far better than a silently dropped one.
async function getTransaction(txHash) {
  return withRetry(
    async () => {
      const { data } = await api.get(`/v2/blockchain/transactions/${txHash}`);
      return data;
    },
    { attempts: 5, retryStatuses: [429, 404], baseDelay: 1000 }
  );
}

// Real on-chain balance straight from TonAPI - no Vercel call needed, and we
// already have the raw account_id from the webhook payload itself. An
// account always exists once it's had any activity, so no 404 retry needed
// here - just the rate-limit case.
async function getAccountBalance(rawAddress) {
  const data = await withRetry(async () => {
    const { data } = await api.get(`/v2/accounts/${rawAddress}`);
    return data;
  });
  return Number(data.balance) / 1e9; // nanotons -> TON
}

module.exports = { createWebhook, listWebhooks, deleteWebhook, subscribeAccounts, unsubscribeAccounts, getTransaction, getAccountBalance };
