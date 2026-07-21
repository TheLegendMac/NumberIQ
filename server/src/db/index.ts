import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from '../ingest/fetch.js';

const HERE = dirname(fileURLToPath(import.meta.url));

let instance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (instance) return instance;
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(process.env.NUMBERIQ_DB ?? join(DATA_DIR, 'numberiq.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(join(HERE, 'schema.sql'), 'utf8'));
  instance = db;
  return db;
}

/** Used by tests to run against an isolated in-memory database. */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(
    readFileSync(join(HERE, 'schema.sql'), 'utf8').replace(/PRAGMA journal_mode = WAL;/, ''),
  );
  return db;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}
