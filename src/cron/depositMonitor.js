const cron = require('node-cron');
const gateway = require('../lib/gateway');
const store = require('../db/store');
const { notifyDeposit } = require('../lib/notify');

const CONCURRENCY = 8;

async function processUser(bot, u) {
  try {
    const lastTxTime = u.last_tx_time || 0;
    const data = await gateway.recentTransactions(u.api_key, 10);
    if (!data.success) return;

    let newestTime = lastTxTime;

    for (const tx of data.transactions || []) {
      if (tx.type !== 'incoming') continue;
      const txTime = Number(tx.time || 0);
      if (txTime <= lastTxTime) continue;

      const amount = tx.amount || 0;
      const [newBalance] = await Promise.all([
        store.addBalance(u.id, amount),
        store.incrementTxStats(u.id, 0), // deposits don't count toward total_paid (that's outgoing)
      ]);

      await notifyDeposit(bot.telegram, u.id, {
        amount, comment: tx.comment, txLink: tx.tx_link, newBalance, chain: 'TON',
      });

      if (txTime > newestTime) newestTime = txTime;
    }

    if (newestTime > lastTxTime) await store.updateLastTxTime(u.id, newestTime);
  } catch {
    // Silent per-user failure - one bad account shouldn't stop the batch.
  }
}

async function runWithConcurrency(items, limit, worker) {
  let index = 0;
  async function next() {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, next);
  await Promise.all(workers);
}

let isRunning = false;

async function checkDeposits(bot) {
  if (isRunning) return;
  isRunning = true;
  try {
    const users = await store.getUsersForDepositCheck();
    await runWithConcurrency(users, CONCURRENCY, (u) => processUser(bot, u));
  } finally {
    isRunning = false;
  }
}

function startDepositMonitor(bot) {
  // Now a SAFETY-NET fallback, not the primary path - the /webhook/deposit
  // route in index.js handles real-time notifications the moment your
  // Vercel gateway calls it. This just catches anything a missed/failed
  // webhook delivery would otherwise leave unnoticed, so it runs far less
  // often (every 15 min instead of every 60s) since it's no longer the only
  // thing standing between a deposit and the user finding out about it -
  // this also means far fewer calls to your Vercel API's /trans endpoint.
  cron.schedule('*/15 * * * *', () => checkDeposits(bot));
  console.log('✅ Deposit monitor scheduled as fallback (every 15 min, concurrency ' + CONCURRENCY + ').');
}

module.exports = { startDepositMonitor, checkDeposits };
