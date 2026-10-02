import fs from 'node:fs';
import path from 'node:path';
import { collectionScope, packScope, scopeDir } from './paths.mjs';
import { recordMigration } from './db.mjs';

export const RETIRED_FOIL_LAYERS = 'retiredFoilLayers';

function retireFoilLayers(db) {
    const ids = db.prepare('SELECT id FROM layers WHERE foil = 1').all().map((r) => r.id);
    if (!ids.length) return 0;
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(RETIRED_FOIL_LAYERS);
    let known = [];
    try {
        known = row ? JSON.parse(row.value) : [];
    } catch { }
    const all = [...new Set([...(Array.isArray(known) ? known : []), ...ids])];
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(RETIRED_FOIL_LAYERS, JSON.stringify(all));
    const marks = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM layers WHERE id IN (${marks})`).run(...ids);
    db.prepare(`DELETE FROM images WHERE set_id IN (${marks})`).run(...ids);
    for (const card of db.prepare('SELECT id, hidden_layers FROM cards WHERE hidden_layers IS NOT NULL').all()) {
        let hidden = [];
        try {
            hidden = JSON.parse(card.hidden_layers) || [];
        } catch { }
        const kept = hidden.filter((h) => !ids.includes(h));
        if (kept.length !== hidden.length) db.prepare('UPDATE cards SET hidden_layers = ? WHERE id = ?').run(kept.length ? JSON.stringify(kept) : null, card.id);
    }
    return ids.length;
}

function pickCollection(db, pack) {
    const counts = new Map();
    const add = (id, n) => counts.set(id, (counts.get(id) || 0) + n);
    if (pack.all_collections) {
        for (const r of db.prepare('SELECT collection_id AS id, COUNT(*) AS n FROM cards GROUP BY collection_id').all()) add(r.id, r.n);
    } else {
        for (const r of db.prepare(`SELECT c.collection_id AS id, COUNT(*) AS n FROM pack_collections p JOIN cards c ON c.collection_id = p.collection_id
            WHERE p.pack_id = ? GROUP BY c.collection_id`).all(pack.id)) add(r.id, r.n);
        for (const r of db.prepare(`SELECT c.collection_id AS id, COUNT(*) AS n FROM pack_cards p JOIN cards c ON c.id = p.card_id
            WHERE p.pack_id = ? GROUP BY c.collection_id`).all(pack.id)) add(r.id, r.n);
        if (!counts.size) for (const r of db.prepare('SELECT collection_id AS id, COUNT(*) AS n FROM cards GROUP BY collection_id').all()) add(r.id, r.n);
    }
    const order = new Map(db.prepare('SELECT id, sort FROM collections').all().map((r) => [r.id, r.sort]));
    return [...counts.entries()].filter(([id]) => order.has(id))
        .sort((a, b) => b[1] - a[1] || order.get(a[0]) - order.get(b[0]))[0]?.[0]
        ?? db.prepare('SELECT id FROM collections ORDER BY sort, name LIMIT 1').get()?.id ?? null;
}

function mergeInto(from, to) {
    if (!fs.existsSync(from)) return;
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const a = path.join(from, entry.name), b = path.join(to, entry.name);
        if (entry.isDirectory()) mergeInto(a, b);
        else if (!fs.existsSync(b)) fs.copyFileSync(a, b);
    }
}

function bindPacks(db, context) {
    const moved = [];
    for (const pack of db.prepare('SELECT * FROM packs').all()) {
        if (pack.collection_id) {
            const extras = db.prepare('DELETE FROM pack_cards WHERE pack_id = ?').run(pack.id).changes;
            db.prepare('DELETE FROM pack_collections WHERE pack_id = ?').run(pack.id);
            if (pack.all_collections) db.prepare('UPDATE packs SET all_collections = 0 WHERE id = ?').run(pack.id);
            if (extras) moved.push({ name: pack.name, collection: db.prepare('SELECT name FROM collections WHERE id = ?').get(pack.collection_id)?.name, dropped: extras });
            continue;
        }
        const target = pickCollection(db, pack);
        if (!target) continue;
        const handPicked = !pack.all_collections && !db.prepare('SELECT 1 FROM pack_collections WHERE pack_id = ?').get(pack.id);
        if (handPicked)
            db.prepare('DELETE FROM pack_cards WHERE pack_id = ? AND card_id NOT IN (SELECT id FROM cards WHERE collection_id = ?)').run(pack.id, target);
        else db.prepare('DELETE FROM pack_cards WHERE pack_id = ?').run(pack.id);
        db.prepare('DELETE FROM pack_collections WHERE pack_id = ?').run(pack.id);
        db.prepare('UPDATE packs SET collection_id = ?, all_collections = 0 WHERE id = ?').run(target, pack.id);
        db.prepare('UPDATE images SET scope = ? WHERE scope = ?').run(collectionScope(target), packScope(pack.id));
        if (context.dataDir) {
            const from = scopeDir(context.dataDir, packScope(pack.id));
            mergeInto(from, scopeDir(context.dataDir, collectionScope(target)));
            context.afterCommit?.push(() => fs.rmSync(from, { recursive: true, force: true }));
        }
        moved.push({ name: pack.name, collection: db.prepare('SELECT name FROM collections WHERE id = ?').get(target)?.name });
    }
    return moved;
}

export function retireFoilLayersAndBindPacks(db, context = {}) {
    const foils = retireFoilLayers(db);
    const packs = bindPacks(db, context);
    if (packs.length)
        recordMigration(db, {
            migration: 'packs-collection',
            title: 'Booster packs now belong to one collection',
            by: context.by || 'dashboard',
            details: { packs },
        });
    return { foils, packs };
}
