import fs from 'node:fs';
import path from 'node:path';
import { transaction, toJson } from '../db.mjs';

export function planSize(plan) {
    return plan.files.reduce((n, f) => n + (f.kind === 'frames' ? f.from.length : 1), 0);
}

function scopesOf(plan) {
    return [...new Set(plan.files.map((f) => f.scope))];
}

export async function copyPlanFiles(store, plan, onProgress) {
    const total = planSize(plan);
    let done = 0;
    const tick = (message) => onProgress?.({ done, total, message });
    tick('Copying pictures');
    for (const file of plan.files) {
        if (file.kind === 'image') {
            await fs.promises.mkdir(path.dirname(store.imagePath(file.scope, file.setId, file.channel)), { recursive: true });
            await fs.promises.copyFile(file.from, store.imagePath(file.scope, file.setId, file.channel));
            done++;
        } else if (file.kind === 'frames') {
            for (let i = 0; i < file.from.length; i++) {
                const to = store.framePath(file.scope, file.setId, file.channel, i);
                await fs.promises.mkdir(path.dirname(to), { recursive: true });
                await fs.promises.copyFile(file.from[i], to);
                done++;
            }
        } else if (file.kind === 'thumb') {
            await store.putThumb(file.scope, file.ownerId, file.from);
            done++;
        } else if (file.kind === 'font') {
            await store.putFont(file.scope, file.name, file.from);
            done++;
        }
        if (done % 25 === 0 || done === total) tick('Copying pictures');
    }
}

export function insertPlanRows(db, plan) {
    const time = Date.now();
    const collection = db.prepare(`INSERT INTO collections (id, id_key, name, short_name, description, locales, card_text, legacy_folder, sort, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const card = db.prepare(`INSERT INTO cards (id, foil_id, id_key, collection_id, rarity, type, name, short_name, description, locales, holo, glow, floats,
        animation, text_align, collection_layers, hidden_layers, legacy_key, thumb_version, sort, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const layer = db.prepare(`INSERT INTO layers (id, owner_kind, owner_id, face, position, key, name, text_id, chance, can_be_foil, over, price, transform, text, fps, speed, roughness, metallic)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const sticker = db.prepare(`INSERT INTO binder_stickers (collection_id, position, set_id, x, y, width, height, rotation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const skin = db.prepare(`INSERT INTO skins (id, name, builtin, design, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const pack = db.prepare(`INSERT INTO packs (id, collection_id, name, short_name, description, locales, all_collections, rarities, card_count, price, purchasable,
        loot_percent, background, look, skin_id, design, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const packCollection = db.prepare('INSERT OR IGNORE INTO pack_collections (pack_id, collection_id) VALUES (?, ?)');
    const packCard = db.prepare('INSERT OR IGNORE INTO pack_cards (pack_id, card_id) VALUES (?, ?)');
    const image = db.prepare(`INSERT INTO images (set_id, channel, scope, frames, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(set_id, channel) DO UPDATE SET scope = excluded.scope, frames = max(images.frames, excluded.frames), updated_at = excluded.updated_at`);
    const sortBase = (table) => db.prepare(`SELECT COALESCE(MAX(sort) + 1, 0) AS n FROM ${table}`).get().n;

    transaction(db, () => {
        const collSort = sortBase('collections'), cardSort = sortBase('cards'), packSort = sortBase('packs'), skinSort = sortBase('skins');
        for (const { row: r } of plan.collections)
            collection.run(r.id, r.id_key, r.name, r.short_name, r.description, toJson(r.locales), toJson(r.card_text), r.legacy_folder, collSort + r.sort, r.created_at, r.updated_at);
        for (const { row: r } of plan.cards)
            card.run(r.id, r.foil_id, r.id_key, r.collection_id, r.rarity, r.type, r.name, r.short_name, r.description, toJson(r.locales), toJson(r.holo), toJson(r.glow),
                toJson(r.floats), toJson(r.animation), toJson(r.text_align), r.collection_layers, toJson(r.hidden_layers), r.legacy_key, r.thumb_version ?? 0, cardSort + r.sort, r.created_at, r.updated_at);
        for (const l of plan.layers)
            layer.run(l.id, l.owner_kind, l.owner_id, l.face, l.position, l.key, l.name, l.text_id, l.chance, l.can_be_foil, l.over, l.price,
                toJson(l.transform), toJson(l.text), toJson(l.fps), l.speed, l.roughness ?? null, l.metallic ?? null);
        for (const s of plan.stickers) sticker.run(s.collection_id, s.position, s.set_id, s.x, s.y, s.width, s.height, s.rotation);
        for (const { row: r } of plan.skins) skin.run(r.id, r.name, r.builtin, toJson(r.design), skinSort + r.sort, r.created_at, r.updated_at);
        for (const { row: r, collections, cards } of plan.packs) {
            pack.run(r.id, r.collection_id, r.name, r.short_name, r.description, toJson(r.locales), r.all_collections, toJson(r.rarities), r.card_count, r.price,
                r.purchasable, r.loot_percent, r.background, r.look, r.skin_id, toJson(r.design), packSort + r.sort, r.created_at, r.updated_at);
            for (const c of collections) packCollection.run(r.id, c);
            for (const c of cards) packCard.run(r.id, c);
        }
        for (const f of plan.files) {
            if (f.kind === 'image') image.run(f.setId, f.channel, f.scope, 0, time);
            else if (f.kind === 'frames') image.run(f.setId, f.channel, f.scope, f.from.length, time);
        }
    });
}

export async function applyPlan(db, store, plan, onProgress) {
    const scopes = scopesOf(plan);
    const fresh = scopes.filter((s) => !fs.existsSync(store.dirOf(s)));
    try {
        await copyPlanFiles(store, plan, onProgress);
        onProgress?.({ done: planSize(plan), total: planSize(plan), message: 'Saving to the database' });
        insertPlanRows(db, plan);
    } catch (e) {
        for (const scope of fresh) await fs.promises.rm(store.dirOf(scope), { recursive: true, force: true }).catch(() => { });
        throw e;
    }
}
