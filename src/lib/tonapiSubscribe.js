const store = require('../db/store');
const tonapi = require('./tonapi');

// Handles ONLY the TonAPI subscribe/unsubscribe network calls, given
// already-computed raw addresses. The raw address itself must be computed
// and stored in the DB synchronously by the caller (via store.saveWallet's
// rawAddress field) BEFORE this runs, since a webhook could theoretically
// fire before this fire-and-forget call finishes - the DB lookup must
// already have the address either way. This function is safe to run
// fire-and-forget since it only affects TonAPI's own subscription state.
async function syncTonSubscription(rawAddress, previousRawAddress) {
  if (!rawAddress) return;

  try {
    const webhookId = await store.getConfig('tonapi_webhook_id', null);
    if (!webhookId) {
      console.warn('TonAPI webhook not set up yet - run scripts/setup-tonapi-webhook.js. Skipping subscription for now.');
      return;
    }

    if (previousRawAddress && previousRawAddress !== rawAddress) {
      await tonapi.unsubscribeAccounts(webhookId, [previousRawAddress]).catch((e) => console.error('TonAPI unsubscribe failed:', e.message));
    }
    await tonapi.subscribeAccounts(webhookId, [rawAddress]);
  } catch (err) {
    console.error('TonAPI subscription sync failed:', err.message);
  }
}

module.exports = { syncTonSubscription };
