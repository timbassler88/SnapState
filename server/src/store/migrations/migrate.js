/**
 * Simple sequential migration runner.
 *
 * Tracks applied migrations in a `_migrations` table.
 * Reads SQL files in ascending filename order and runs new ones.
 *
 * Usage:
 *   node src/store/migrations/migrate.js
 */

import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pool = new pg.Pool({ connectionString: config.databaseUrl });

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function getApplied(client) {
  const result = await client.query('SELECT name FROM _migrations ORDER BY name');
  return new Set(result.rows.map((r) => r.name));
}

async function run() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getApplied(client);

    const files = (await readdir(__dirname))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  [skip] ${file}`);
        continue;
      }

      const sql = await readFile(path.join(__dirname, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  [apply] ${file}`);
        count++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }

    if (count === 0) {
      console.log('No new migrations to apply.');
    } else {
      console.log(`Applied ${count} migration(s).`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
