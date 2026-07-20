const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: false }, // Neon requires SSL
  // Bumped from 5 -> 8 to match the deposit monitor's concurrency (8 users
  // in flight at once) so its queries don't queue up behind each other on a
  // pool that's too small, while still comfortably under Neon's free-tier
  // connection cap (well over 100 via the pooled connection string).
  max: 8,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  console.error('Unexpected Postgres pool error', err);
});

module.exports = pool;
