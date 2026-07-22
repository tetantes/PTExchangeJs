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

// Called the moment a webhook fires (which only gives us account_id + tx_hash,
// no amount) - this fetches the actual transaction so we know what happened.
// NOTE: field paths below are based on TonAPI's documented v2 transaction
// schema; worth double-checking against a real payload once live, since I
// can't call this endpoint from here without your API key.
async function getTransaction(txHash) {
  const { data } = await api.get(`/v2/blockchain/transactions/${txHash}`);
  return data;
}

module.exports = { createWebhook, listWebhooks, deleteWebhook, subscribeAccounts, unsubscribeAccounts, getTransaction };
