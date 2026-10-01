import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA, LATEST } from './schema.mjs';

export function openDatabase(file, { readOnly = false } = {}) {
    if (!readOnly) fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file, { readOnly });
    db.exec('PRAGMA busy_timeout = 10000');
    if (!readOnly) {
        db.exec('PRAGMA journal_mode = WAL');
        db.exec('PRAGMA synchronous = NORMAL');
    }
    db.exec('PRAGMA foreign_keys = ON');
    return db;
}

export const schemaVersion = (db) => db.prepare('PRAGMA user_version').get().user_version;

export function pendingSchema(db) {
    const current = schemaVersion(db);
    if (current > LATEST) throw new Error(`The database is from a newer DaCard (schema ${current}, this dashboard knows up to ${LATEST}). Update DaCard.`);
    return SCHEMA.filter((s) => s.version > current);
}

export function upgradeSchema(db) {
    const steps = pendingSchema(db);
    for (const step of steps) {
        transaction(db, () => {
            db.exec(step.sql);
            if (step.run) step.run(db);
            db.exec(`PRAGMA user_version = ${step.version}`);
        });
    }
    return steps;
}

export function transaction(db, work) {
    db.exec('BEGIN IMMEDIATE');
    try {
        const result = work();
        db.exec('COMMIT');
        return result;
    } catch (e) {
        try { db.exec('ROLLBACK'); } catch { }
        throw e;
    }
}

export const toJson = (value) => (value === undefined || value === null ? null : JSON.stringify(value));

export function fromJson(text, fallback = null) {
    if (text === null || text === undefined || text === '') return fallback;
    try {
        return JSON.parse(text);
    } catch {
        return fallback;
    }
}

export const now = () => Date.now();

export function getSetting(db, key, fallback) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? fromJson(row.value, fallback) : fallback;
}

export function setSetting(db, key, value) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}

export function getMeta(db, key) {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? row.value : null;
}

export function setMeta(db, key, value) {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

export function recordMigration(db, { migration, title, by, details, seen = false }) {
    db.prepare('INSERT INTO migrations (migration, title, by, date, details, seen) VALUES (?, ?, ?, ?, ?, ?)')
        .run(migration, title, by, new Date().toISOString(), toJson(details), seen ? 1 : 0);
}
