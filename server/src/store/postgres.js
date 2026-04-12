import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

let pool;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    pool.on('error', (err) => {
      console.error(JSON.stringify({ level: 'error', msg: 'Postgres pool error', err: err.message }));
    });
  }
  return pool;
}

/**
 * Parameterized query helper.
 * @param {string} text - SQL with $1, $2, ... placeholders
 * @param {unknown[]} [params]
 */
export async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

export async function checkPostgresHealth() {
  try {
    const p = getPool();
    await p.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Close the pool. Called during graceful shutdown / test teardown.
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
