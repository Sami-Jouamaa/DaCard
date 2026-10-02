import fs from 'node:fs';
import path from 'node:path';
import { compact, fromJson, transaction, toJson, getSetting } from './db.mjs';
import { collectionScope, packScope, skinScope, imageFile, framesDir, frameFile, thumbFile, fontFile } from './paths.mjs';
import { hex, newKey, cardIds, binderId, idFor } from './ids.mjs';
import {
    createPlan, planCard, planCollection, planPack, planSkin, resolveHidden, mapOf, text, lower, slotsFromConfig, typeUsesDepthFor, FILE_NAME,
} from './content.mjs';
import { raritiesOfRow, rarityIn } from './rarities.mjs';
import { copyPlanFiles } from './legacy/apply.mjs';
import { THUMB_VERSION } from './schema.mjs';

const CARD_PICTURE = (channel) => (channel === 'albedo' ? 'card.png' : `card.${channel}.png`);
const CARD_FRAMES = (channel) => (channel === 'albedo' ? 'frames' : `frames.${channel}`);
const LAYER_PICTURE = (id, channel) => (channel === 'albedo' ? `${id}.png` : `${id}.${mapOf(channel)}.png`);
const LAYER_FRAMES = (id, channel) => (channel === 'albedo' ? `frames.${id}` : `frames.${id}.${mapOf(channel)}`);
const PACK_PICTURE = (channel) => `${channel}.png`;
const DESIGN_PICTURE = (id, channel) => (channel === 'albedo' ? `${id}.png` : `${id}.${channel}.png`);

export class DocumentError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

const fileUrl = (scope, relative) => `/files/${scope}/${relative.split(path.sep).join('/')}`;

function emptyView() {
    return { files: {}, folders: {}, sources: {}, frameSources: {} };
}

function addImages(view, store, scope, rows, nameOf, framesOf) {
    for (const row of rows) {
        const name = nameOf(row.set_id, row.channel);
        if (!name) continue;
        view.files[name] = fileUrl(row.scope, imageFile(row.set_id, row.channel)) + `?v=${row.updated_at}`;
        view.sources[name.toLowerCase()] = store.imagePath(row.scope, row.set_id, row.channel);
        if (row.frames > 1 && framesOf) {
            const folder = framesOf(row.set_id, row.channel);
            view.folders[folder] = Array.from({ length: row.frames }, (_, i) =>
                fileUrl(row.scope, path.join(framesDir(row.set_id), row.channel, frameFile(i))) + `?v=${row.updated_at}`);
            view.frameSources[folder.toLowerCase()] = Array.from({ length: row.frames }, (_, i) => store.framePath(row.scope, row.set_id, row.channel, i));
        }
    }
}

function addFont(view, store, scope, name) {
    if (!name || !FILE_NAME.test(name)) return;
    const file = store.fontPath(scope, name);
    if (!fs.existsSync(file)) return;
    view.files[name] = fileUrl(scope, fontFile(name));
    view.sources[name.toLowerCase()] = file;
}

function addThumb(view, store, scope, ownerId) {
    const file = store.thumbPath(scope, ownerId);
    if (!fs.existsSync(file)) return null;
    const url = fileUrl(scope, thumbFile(ownerId)) + `?v=${Math.round(fs.statSync(file).mtimeMs)}`;
    view.thumb = url;
    return url;
}

function layerEntry(row) {
    const entry = { file: row.id };
    if (row.name) entry.name = row.name;
    entry.chance = row.chance;
    entry.canBeFoil = !!row.can_be_foil;
    if (row.over) entry.over = true;
    if (row.price > 0) entry.price = row.price;
    if (row.price_percent > 0) entry.pricePercent = row.price_percent;
    if (typeof row.foil_chance === 'number') entry.foilChance = row.foil_chance;
    if (row.foil_type) entry.foilType = row.foil_type;
    const transform = fromJson(row.transform);
    if (transform) entry.transform = transform;
    if (typeof row.roughness === 'number') entry.roughness = row.roughness;
    if (typeof row.metallic === 'number') entry.metallic = row.metallic;
    const fps = fromJson(row.fps);
    if (fps) entry.fps = Object.fromEntries(Object.entries(fps).map(([k, v]) => [mapOf(k), v]));
    if (row.text_id) entry.id = row.text_id;
    const t = fromJson(row.text);
    if (t) entry.text = t;
    return entry;
}

function variantsOf(rows, groupId) {
    return rows.filter((r) => r.parent_id === groupId).sort((a, b) => a.position - b.position).map(layerEntry);
}

function layerView(db, store, view, scope, ownerKind, ownerId) {
    const rows = db.prepare('SELECT * FROM layers WHERE owner_kind = ? AND owner_id = ? ORDER BY face, position').all(ownerKind, ownerId);
    const images = rows.length
        ? db.prepare(`SELECT * FROM images WHERE set_id IN (${rows.map(() => '?').join(',')})`).all(...rows.map((r) => r.id))
        : [];
    addImages(view, store, scope, images, LAYER_PICTURE, LAYER_FRAMES);
    for (const row of rows) {
        const t = fromJson(row.text);
        if (t?.font) addFont(view, store, scope, t.font);
    }
    const out = { front: [], back: [], defaultBack: null, rows };
    for (const row of rows) {
        if (row.parent_id) continue;
        const entry = row.kind === 'variant' ? { ...layerEntry(row), kind: 'variant', variants: variantsOf(rows, row.id) } : layerEntry(row);
        if (row.kind === 'variant') delete entry.canBeFoil;
        if (row.face === 'default-back') out.defaultBack = { ...entry, key: row.key };
        else out[row.face].push(entry);
    }
    return out;
}

function stripView(view) {
    const { sources, frameSources, ...client } = view;
    return client;
}

export function cardDocument(db, store, id, { internal = false } = {}) {
    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
    if (!card) throw new DocumentError('No such card', 404);
    const scope = collectionScope(card.collection_id);
    const view = emptyView();
    addImages(view, store, scope, db.prepare('SELECT * FROM images WHERE set_id = ?').all(card.id), (_, c) => CARD_PICTURE(c), (_, c) => CARD_FRAMES(c));
    const layers = layerView(db, store, view, scope, 'card', card.id);
    addThumb(view, store, scope, card.id);
    const animation = fromJson(card.animation);
    const json = {
        name: card.name,
        type: card.type,
        ...(card.short_name && { shortName: card.short_name }),
        ...(card.description && { description: card.description }),
        ...(fromJson(card.locales) && { locales: fromJson(card.locales) }),
        ...(fromJson(card.holo) && { holo: fromJson(card.holo) }),
        ...(fromJson(card.glow) && { glow: fromJson(card.glow) }),
        ...(fromJson(card.floats) && { floats: fromJson(card.floats) }),
        ...(animation && { animation: { fps: animation.fps, ...(animation.slots && { slots: Object.fromEntries(Object.entries(animation.slots).map(([k, v]) => [mapOf(k), v])) }) } }),
        ...(fromJson(card.text_align) && { textAlign: fromJson(card.text_align) }),
        ...(card.collection_layers ? {} : { collectionLayers: false }),
        ...(fromJson(card.hidden_layers) && { hideCollectionLayers: fromJson(card.hidden_layers) }),
        layers: { front: layers.front, back: layers.back },
    };
    const doc = { kind: 'card', id: card.id, collectionId: card.collection_id, rarity: card.rarity, idKey: card.id_key, json, ...view };
    return internal ? { ...doc, row: card, layerRows: layers.rows } : stripView(doc);
}

export function collectionDocument(db, store, id, { internal = false } = {}) {
    const coll = db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
    if (!coll) throw new DocumentError('No such collection', 404);
    const scope = collectionScope(coll.id);
    const view = emptyView();
    const layers = layerView(db, store, view, scope, 'collection', coll.id);
    const stickers = db.prepare('SELECT * FROM binder_stickers WHERE collection_id = ? ORDER BY position').all(coll.id);
    if (stickers.length)
        addImages(view, store, scope, db.prepare(`SELECT * FROM images WHERE set_id IN (${stickers.map(() => '?').join(',')})`).all(...stickers.map((s) => s.set_id)),
            (setId, c) => (c === 'albedo' ? `${setId}.png` : null));
    const cardText = fromJson(coll.card_text);
    for (const part of ['name', 'description']) if (cardText?.[part]?.font) addFont(view, store, scope, cardText[part].font);
    addThumb(view, store, scope, coll.id);
    const json = {
        name: coll.name,
        ...(coll.short_name && { shortName: coll.short_name }),
        ...(coll.description && { description: coll.description }),
        ...(fromJson(coll.locales) && { locales: fromJson(coll.locales) }),
        ...(cardText && { cardText }),
        ...(fromJson(coll.rarities) && { rarities: fromJson(coll.rarities) }),
        ...(typeof coll.foil_chance === 'number' && { foilChance: coll.foil_chance }),
        ...(fromJson(coll.foil_types) && { foilTypes: fromJson(coll.foil_types) }),
        stickers: stickers.map((s) => ({ file: `${s.set_id}.png`, x: s.x, y: s.y, width: s.width, height: s.height, rotation: s.rotation })),
        layers: { front: layers.front, back: layers.back },
        ...(layers.defaultBack && { defaultBack: layers.defaultBack }),
    };
    const doc = { kind: 'collection', id: coll.id, idKey: coll.id_key, json, ...view };
    return internal ? { ...doc, row: coll, layerRows: layers.rows, stickerRows: stickers } : stripView(doc);
}

function designView(db, store, view, scope, design) {
    const ids = (design?.layers || []).map((l) => l.file).filter(Boolean);
    if (ids.length)
        addImages(view, store, scope, db.prepare(`SELECT * FROM images WHERE set_id IN (${ids.map(() => '?').join(',')})`).all(...ids), DESIGN_PICTURE);
    for (const layer of design?.layers || []) if (layer?.text?.font) addFont(view, store, scope, layer.text.font);
}

function packScopeOf(pack) {
    return pack.collection_id ? collectionScope(pack.collection_id) : packScope(pack.id);
}

export function packDocument(db, store, id, { internal = false } = {}) {
    const pack = db.prepare('SELECT * FROM packs WHERE id = ?').get(id);
    if (!pack) throw new DocumentError('No such booster pack', 404);
    const scope = packScopeOf(pack);
    const view = emptyView();
    addImages(view, store, scope, db.prepare('SELECT * FROM images WHERE set_id = ?').all(pack.id), (_, c) => PACK_PICTURE(c));
    const design = fromJson(pack.design, {});
    designView(db, store, view, scope, design);
    addThumb(view, store, scope, pack.id);
    const cards = db.prepare('SELECT card_id FROM pack_cards WHERE pack_id = ?').all(pack.id).map((r) => r.card_id);
    const json = {
        id: pack.id,
        name: pack.name,
        ...(pack.short_name && { shortName: pack.short_name }),
        ...(pack.description && { description: pack.description }),
        ...(fromJson(pack.locales) && { locales: fromJson(pack.locales) }),
        look: pack.look,
        ...(pack.skin_id && { skin: pack.skin_id }),
        ...(design.base && { base: design.base }),
        layers: design.layers || [],
        cards: { cards, ...(fromJson(pack.rarities) && { rarities: fromJson(pack.rarities) }) },
        cardCount: pack.card_count,
        price: pack.price,
        purchasable: !!pack.purchasable,
        lootPercent: pack.loot_percent,
        ...(pack.background && { background: pack.background }),
    };
    const doc = { kind: 'pack', id: pack.id, collectionId: pack.collection_id, json, ...view };
    return internal ? { ...doc, row: pack } : stripView(doc);
}

export function skinDocument(db, store, id, { internal = false } = {}) {
    const skin = db.prepare('SELECT * FROM skins WHERE id = ?').get(id);
    if (!skin) throw new DocumentError('No such skin', 404);
    const scope = skinScope(skin.id);
    const view = emptyView();
    addImages(view, store, scope, db.prepare('SELECT * FROM images WHERE set_id = ?').all(skin.id), (_, c) => PACK_PICTURE(c));
    const design = fromJson(skin.design, {});
    designView(db, store, view, scope, design);
    addThumb(view, store, scope, skin.id);
    const json = { name: skin.name, ...(design.base && { base: design.base }), ...(design.look === 'layers' && { layers: design.layers || [] }) };
    const doc = { kind: 'skin', id: skin.id, builtin: !!skin.builtin, json, ...view };
    return internal ? { ...doc, row: skin } : stripView(doc);
}

const SAFE_PATH = (name) => {
    const parts = String(name).split('/');
    return parts.length <= 2 && parts.every((p) => FILE_NAME.test(p) && p !== '.' && p !== '..');
};

async function stage(paths, uploads, keep, previous) {
    const dir = path.join(paths.tempDir, hex(8));
    await fs.promises.mkdir(dir, { recursive: true });
    for (const [name, data] of uploads) {
        if (!SAFE_PATH(name)) throw new DocumentError(`Bad file name "${name}"`);
        const to = path.join(dir, ...name.split('/'));
        await fs.promises.mkdir(path.dirname(to), { recursive: true });
        await fs.promises.writeFile(to, data);
    }
    const uploaded = new Set([...uploads.keys()].map((n) => n.toLowerCase()));
    const uploadedFolders = new Set([...uploads.keys()].filter((n) => n.includes('/')).map((n) => n.split('/')[0].toLowerCase()));
    for (const name of keep) {
        const key = name.toLowerCase();
        if (previous?.sources?.[key] && !uploaded.has(key) && fs.existsSync(previous.sources[key]))
            await fs.promises.copyFile(previous.sources[key], path.join(dir, name));
        if (previous?.frameSources?.[key] && !uploadedFolders.has(key)) {
            const folder = path.join(dir, name);
            await fs.promises.mkdir(folder, { recursive: true });
            for (const [i, from] of previous.frameSources[key].entries())
                if (fs.existsSync(from)) await fs.promises.copyFile(from, path.join(folder, `frame_${String(i).padStart(3, '0')}.png`));
        }
    }
    return dir;
}

function allPreviousNames(previous) {
    if (!previous) return [];
    return Object.keys(previous.sources).concat(Object.keys(previous.frameSources));
}

const existingLayerIds = (db, exceptOwner) =>
    db.prepare('SELECT id FROM layers WHERE NOT (owner_kind = ? AND owner_id = ?)').all(exceptOwner.kind, exceptOwner.id).map((r) => r.id)
        .concat(db.prepare('SELECT DISTINCT set_id AS id FROM images').all().map((r) => r.id));

function reuseMap(layerRows, extra = []) {
    const map = new Map();
    for (const row of layerRows || []) map.set(row.id.toLowerCase(), { id: row.id, key: row.key });
    for (const id of extra) map.set(id.toLowerCase(), { id, key: null });
    return map;
}

async function finishImages(db, store, plan, oldSets) {
    for (const f of plan.files)
        if (f.kind === 'frames') await fs.promises.rm(path.join(store.dirOf(f.scope), framesDir(f.setId)), { recursive: true, force: true });
    await copyPlanFiles(store, plan);
    const wanted = new Map();
    for (const f of plan.files) if (f.kind === 'image' || f.kind === 'frames') {
        const key = `${f.setId}|${f.channel}`;
        wanted.set(key, Math.max(wanted.get(key) ?? 0, f.kind === 'frames' ? f.from.length : 0));
    }
    return async () => {
        for (const row of oldSets) {
            const key = `${row.set_id}|${row.channel}`;
            const stillScope = plan.files.some((f) => f.setId === row.set_id && f.scope === row.scope);
            if (wanted.has(key) && stillScope) {
                if (!wanted.get(key)) await fs.promises.rm(path.join(store.dirOf(row.scope), framesDir(row.set_id), row.channel), { recursive: true, force: true });
                continue;
            }
            await fs.promises.rm(store.imagePath(row.scope, row.set_id, row.channel), { force: true });
            await fs.promises.rm(path.join(store.dirOf(row.scope), framesDir(row.set_id), row.channel), { recursive: true, force: true });
        }
    };
}

function writeImageRows(db, plan, oldSetIds) {
    if (oldSetIds.length) db.prepare(`DELETE FROM images WHERE set_id IN (${oldSetIds.map(() => '?').join(',')})`).run(...oldSetIds);
    const time = Date.now();
    const insert = db.prepare(`INSERT INTO images (set_id, channel, scope, frames, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(set_id, channel) DO UPDATE SET scope = excluded.scope, frames = max(images.frames, excluded.frames), updated_at = excluded.updated_at`);
    for (const f of plan.files) {
        if (f.kind === 'image') insert.run(f.setId, f.channel, f.scope, 0, time);
        else if (f.kind === 'frames') insert.run(f.setId, f.channel, f.scope, f.from.length, time);
    }
}

const insertLayer = (db) => db.prepare(`INSERT INTO layers (id, owner_kind, owner_id, face, position, key, name, text_id, chance, can_be_foil, over, price, transform, text, fps, speed, roughness, metallic, price_percent, foil_chance, foil_type, kind, parent_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

function writeLayerRows(db, plan) {
    const insert = insertLayer(db);
    for (const l of plan.layers)
        insert.run(l.id, l.owner_kind, l.owner_id, l.face, l.position, l.key, l.name, l.text_id, l.chance, l.can_be_foil, l.over, l.price,
            toJson(l.transform), toJson(l.text), toJson(l.fps), l.speed, l.roughness ?? null, l.metallic ?? null, l.price_percent ?? 0, l.foil_chance ?? null, l.foil_type ?? null, l.kind ?? null, l.parent_id ?? null);
}

function oldImageRows(db, setIds) {
    return setIds.length ? db.prepare(`SELECT * FROM images WHERE set_id IN (${setIds.map(() => '?').join(',')})`).all(...setIds) : [];
}

function defaultsOf(paths) {
    try {
        return JSON.parse(fs.readFileSync(paths.defaultConfig, 'utf8'));
    } catch {
        return {};
    }
}

export function rarityListOf(db, paths, collectionId) {
    const row = db.prepare('SELECT rarities FROM collections WHERE id = ?').get(collectionId);
    return raritiesOfRow(row, { rarities: getSetting(db, 'rarities', defaultsOf(paths).rarities) });
}

function settingsFor(db, paths) {
    const defaults = defaultsOf(paths);
    const textures = getSetting(db, 'textures', defaults.textures);
    const cardTypes = getSetting(db, 'cardTypes', defaults.cardTypes);
    return { slots: slotsFromConfig({ textures }), typeUsesDepth: typeUsesDepthFor(cardTypes) };
}

export async function saveCard({ db, store, paths, id = null, collectionId, rarity, json, uploads, keep = [], keepAll = {}, thumbVersion = undefined }) {
    const collection = db.prepare('SELECT id, id_key FROM collections WHERE id = ?').get(collectionId);
    if (!collection) throw new DocumentError('Pick a collection for the card');
    const r = rarityIn(rarityListOf(db, paths, collection.id), rarity);
    if (!r) throw new DocumentError(`"${rarity}" is not one of the collection's rarities`);
    if (!text(json?.name)) throw new DocumentError('The card needs a name');
    const previous = id ? cardDocument(db, store, id, { internal: true }) : null;
    const keepNames = new Set(keep.map((k) => String(k)));
    if (previous && keepAll.picture) for (const name of allPreviousNames(previous)) if (/^(card(\.[a-z0-9_]+)?\.png|frames(\.[a-z0-9_]+)?)$/i.test(name)) keepNames.add(name);
    if (previous && keepAll.layers) for (const name of allPreviousNames(previous)) if (!/^(card(\.[a-z0-9_]+)?\.png|frames(\.[a-z0-9_]+)?|thumb\.png)$/i.test(name)) keepNames.add(name);
    if (previous && keepAll.layers && !json.layers) json = { ...json, layers: previous.json.layers };
    const dir = await stage(paths, uploads, keepNames, previous);
    if (previous && !uploads.has('thumb.png')) {
        const oldThumb = store.thumbPath(collectionScope(previous.row.collection_id), previous.row.id);
        if (fs.existsSync(oldThumb)) await fs.promises.copyFile(oldThumb, path.join(dir, 'thumb.png'));
    }
    try {
        const plan = createPlan({
            reuse: reuseMap(previous?.layerRows),
            keepIds: true,
            existing: { layerIds: existingLayerIds(db, { kind: 'card', id: id || '' }) },
        });
        const idKey = previous ? previous.row.id_key : newKey('card');
        const ids = previous ? { id: previous.row.id, foilId: previous.row.foil_id } : cardIds(idKey);
        if (!previous && db.prepare('SELECT 1 FROM cards WHERE id = ? OR foil_id = ?').get(ids.id, ids.id)) throw new DocumentError('Card id clash, try again', 409);
        const { slots, typeUsesDepth } = settingsFor(db, paths);
        const thumb = fs.existsSync(path.join(dir, 'thumb.png')) ? path.join(dir, 'thumb.png') : null;
        const owner = { row: { id: collection.id }, layerIds: {} };
        const card = planCard(plan, {
            dir, data: json, where: json.name, key: null, idKey, ids, collection: owner, rarity: r, slots, typeUsesDepth,
            legacyKey: previous?.row.legacy_key ?? null, sort: previous?.row.sort ?? 0, thumb,
            thumbVersion: thumbVersion ?? (uploads.has('thumb.png') ? THUMB_VERSION : previous?.row.thumb_version ?? 0),
        });
        if (!card) throw new DocumentError(plan.warnings.join('; ') || 'The card could not be saved');
        resolveHidden(plan);
        if (!previous) card.row.sort = db.prepare('SELECT COALESCE(MAX(sort) + 1, 0) AS n FROM cards').get().n;
        const oldSetIds = previous ? [previous.row.id, ...previous.layerRows.map((l) => l.id)] : [];
        const oldRows = oldImageRows(db, oldSetIds);
        const cleanup = await finishImages(db, store, plan, oldRows);
        const row = card.row;
        transaction(db, () => {
            if (previous) {
                db.prepare('DELETE FROM layers WHERE owner_kind = ? AND owner_id = ?').run('card', row.id);
                db.prepare(`UPDATE cards SET collection_id = ?, rarity = ?, type = ?, name = ?, short_name = ?, description = ?, locales = ?, holo = ?, glow = ?, floats = ?,
                    animation = ?, text_align = ?, collection_layers = ?, hidden_layers = ?, thumb_version = ?, updated_at = ? WHERE id = ?`)
                    .run(row.collection_id, row.rarity, row.type, row.name, row.short_name, row.description, toJson(row.locales), toJson(row.holo), toJson(row.glow),
                        toJson(row.floats), toJson(row.animation), toJson(row.text_align), row.collection_layers, toJson(row.hidden_layers), row.thumb_version, Date.now(), row.id);
            } else {
                db.prepare(`INSERT INTO cards (id, foil_id, id_key, collection_id, rarity, type, name, short_name, description, locales, holo, glow, floats, animation,
                    text_align, collection_layers, hidden_layers, legacy_key, thumb_version, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                    .run(row.id, row.foil_id, row.id_key, row.collection_id, row.rarity, row.type, row.name, row.short_name, row.description, toJson(row.locales),
                        toJson(row.holo), toJson(row.glow), toJson(row.floats), toJson(row.animation), toJson(row.text_align), row.collection_layers,
                        toJson(row.hidden_layers), row.legacy_key, row.thumb_version, row.sort, row.created_at, row.updated_at);
            }
            writeLayerRows(db, plan);
            writeImageRows(db, plan, oldSetIds);
        });
        await cleanup();
        if (previous && previous.row.collection_id !== row.collection_id)
            await store.removeThumb(collectionScope(previous.row.collection_id), row.id);
        return { id: row.id, warnings: plan.warnings };
    } finally {
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => { });
    }
}

export async function moveCard({ db, store, paths, id, collectionId, rarity }) {
    const previous = cardDocument(db, store, id, { internal: true });
    const target = collectionId || previous.collectionId;
    const list = rarityListOf(db, paths, target);
    const wanted = rarityIn(list, rarity || previous.rarity) || list[0].name;
    return saveCard({
        db, store, paths, id, collectionId: target, rarity: wanted, json: previous.json,
        uploads: new Map(), keepAll: { picture: true, layers: true },
    });
}

export async function setCardThumb({ db, store, id, data }) {
    const card = db.prepare('SELECT collection_id FROM cards WHERE id = ?').get(id);
    if (!card) throw new DocumentError('No such card', 404);
    await store.putThumb(collectionScope(card.collection_id), id, data);
    db.prepare('UPDATE cards SET thumb_version = ? WHERE id = ?').run(THUMB_VERSION, id);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function setCollectionThumb({ db, store, id, data }) {
    if (!db.prepare('SELECT id FROM collections WHERE id = ?').get(id)) throw new DocumentError('No such collection', 404);
    if (!data?.length) {
        await store.removeThumb(collectionScope(id), id);
        return;
    }
    if (!data.subarray(0, 8).equals(PNG_SIGNATURE)) throw new DocumentError('The icon has to be a PNG');
    await store.putThumb(collectionScope(id), id, data);
}

export async function duplicateCard({ db, store, paths, id }) {
    const previous = cardDocument(db, store, id, { internal: true });
    const uploads = new Map();
    const json = structuredClone(previous.json);
    json.name = `${json.name}_copy`;
    const fresh = new Map();
    const rename = (file) => {
        if (!fresh.has(file)) fresh.set(file, hex(6));
        return fresh.get(file);
    };
    for (const side of ['front', 'back'])
        json.layers[side] = json.layers[side].map((l) => ({ ...l, file: rename(l.file), ...(l.text?.font && { text: { ...l.text, font: rename(l.file) + path.extname(l.text.font) } }) }));
    const renameName = (name) => {
        const m = /^(frames\.)?([0-9a-f]{12})(.*)$/i.exec(name);
        if (m && fresh.has(m[2])) return (m[1] || '') + fresh.get(m[2]) + m[3];
        return name;
    };
    for (const [name, from] of Object.entries(previous.sources)) uploads.set(renameName(name), await fs.promises.readFile(from));
    for (const [folder, list] of Object.entries(previous.frameSources))
        for (const [i, from] of list.entries()) uploads.set(`${renameName(folder)}/frame_${String(i).padStart(3, '0')}.png`, await fs.promises.readFile(from));
    const thumb = store.thumbPath(collectionScope(previous.collectionId), previous.id);
    if (fs.existsSync(thumb)) uploads.set('thumb.png', await fs.promises.readFile(thumb));
    return saveCard({ db, store, paths, collectionId: previous.collectionId, rarity: previous.rarity, json, uploads, thumbVersion: previous.row.thumb_version });
}

export async function deleteCard({ db, store, id }) {
    const previous = cardDocument(db, store, id, { internal: true });
    const sets = [previous.row.id, ...previous.layerRows.map((l) => l.id)];
    const rows = oldImageRows(db, sets);
    transaction(db, () => {
        db.prepare('DELETE FROM layers WHERE owner_kind = ? AND owner_id = ?').run('card', id);
        db.prepare(`DELETE FROM images WHERE set_id IN (${sets.map(() => '?').join(',')})`).run(...sets);
        db.prepare('DELETE FROM cards WHERE id = ?').run(id);
    });
    for (const row of rows) {
        await fs.promises.rm(store.imagePath(row.scope, row.set_id, row.channel), { force: true });
        await fs.promises.rm(path.join(store.dirOf(row.scope), framesDir(row.set_id)), { recursive: true, force: true });
    }
    for (const l of previous.layerRows) {
        const t = fromJson(l.text);
        if (t?.font) await fs.promises.rm(store.fontPath(collectionScope(previous.collectionId), t.font), { force: true });
    }
    await store.removeThumb(collectionScope(previous.collectionId), id);
}

export async function saveCollection({ db, store, paths, id = null, json, uploads, keep = [] }) {
    if (!text(json?.name)) throw new DocumentError('The collection needs a name');
    const clash = db.prepare('SELECT id FROM collections WHERE lower(name) = lower(?) AND id <> ?').get(json.name.trim(), id || '');
    if (clash) throw new DocumentError(`A collection called "${json.name.trim()}" already exists`);
    const previous = id ? collectionDocument(db, store, id, { internal: true }) : null;
    const keepNames = new Set(keep.map(String));
    for (const name of Object.keys(previous?.sources || {})) if (/\.(ttf|otf)$/i.test(name)) keepNames.add(name);
    const dir = await stage(paths, uploads, keepNames, previous);
    try {
        const idKey = previous ? previous.row.id_key : newKey('coll');
        const collId = previous ? previous.row.id : binderId(idKey);
        const plan = createPlan({
            reuse: reuseMap(previous?.layerRows, (previous?.stickerRows || []).map((s) => s.set_id)),
            keepIds: true,
            existing: { layerIds: existingLayerIds(db, { kind: 'collection', id: collId }).filter((x) => !(previous?.stickerRows || []).some((s) => s.set_id === x)) },
        });
        const thumb = fs.existsSync(path.join(dir, 'thumb.png')) ? path.join(dir, 'thumb.png') : null;
        const data = { ...json, layers: json.layers || { front: [], back: [] }, stickers: Array.isArray(json.stickers) ? json.stickers : [] };
        const coll = planCollection(plan, { dir, data, where: json.name, idKey, id: collId, legacyFolder: previous?.row.legacy_folder ?? null, thumb, sort: previous?.row.sort ?? 0 });
        if (!previous) coll.row.sort = db.prepare('SELECT COALESCE(MAX(sort) + 1, 0) AS n FROM collections').get().n;
        const oldSetIds = previous ? [...previous.layerRows.map((l) => l.id), ...previous.stickerRows.map((s) => s.set_id)] : [];
        const cleanup = await finishImages(db, store, plan, oldImageRows(db, oldSetIds));
        const row = coll.row;
        const valid = new Set(plan.layers.filter((l) => l.owner_kind === 'collection').map((l) => l.id));
        let moved = [];
        transaction(db, () => {
            if (previous) {
                db.prepare('DELETE FROM layers WHERE owner_kind = ? AND owner_id = ?').run('collection', row.id);
                db.prepare('DELETE FROM binder_stickers WHERE collection_id = ?').run(row.id);
                db.prepare(`UPDATE collections SET name = ?, short_name = ?, description = ?, locales = ?, card_text = ?, rarities = ?, foil_chance = ?, foil_types = ?,
                    updated_at = ? WHERE id = ?`)
                    .run(row.name, row.short_name, row.description, toJson(row.locales), toJson(row.card_text), toJson(row.rarities), row.foil_chance, toJson(row.foil_types),
                        Date.now(), row.id);
            } else {
                db.prepare(`INSERT INTO collections (id, id_key, name, short_name, description, locales, card_text, legacy_folder, sort, created_at, updated_at,
                    rarities, foil_chance, foil_types) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                    .run(row.id, row.id_key, row.name, row.short_name, row.description, toJson(row.locales), toJson(row.card_text), row.legacy_folder, row.sort,
                        row.created_at, row.updated_at, toJson(row.rarities), row.foil_chance, toJson(row.foil_types));
            }
            writeLayerRows(db, plan);
            if (previous) moved = moveRarities(db, paths, row.id, json.rarityMoves);
            const sticker = db.prepare('INSERT INTO binder_stickers (collection_id, position, set_id, x, y, width, height, rotation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            for (const s of plan.stickers) sticker.run(s.collection_id, s.position, s.set_id, s.x, s.y, s.width, s.height, s.rotation);
            writeImageRows(db, plan, oldSetIds);
            if (previous) {
                for (const card of db.prepare('SELECT id, hidden_layers FROM cards WHERE collection_id = ? AND hidden_layers IS NOT NULL').all(row.id)) {
                    const kept = (fromJson(card.hidden_layers) || []).filter((h) => valid.has(h));
                    db.prepare('UPDATE cards SET hidden_layers = ? WHERE id = ?').run(kept.length ? JSON.stringify(kept) : null, card.id);
                }
            }
        });
        await cleanup();
        return { id: row.id, warnings: [...plan.warnings, ...moved] };
    } finally {
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => { });
    }
}

function moveRarities(db, paths, collectionId, moves) {
    const list = rarityListOf(db, paths, collectionId);
    const map = new Map(Object.entries(moves && typeof moves === 'object' ? moves : {}).map(([k, v]) => [k.toLowerCase(), v]));
    const target = (name) => rarityIn(list, name) || rarityIn(list, map.get(String(name).toLowerCase())) || list[0].name;
    const counts = new Map();
    for (const card of db.prepare('SELECT id, rarity FROM cards WHERE collection_id = ?').all(collectionId)) {
        const to = target(card.rarity);
        if (to === card.rarity) continue;
        db.prepare('UPDATE cards SET rarity = ?, updated_at = ? WHERE id = ?').run(to, Date.now(), card.id);
        if (!rarityIn(list, card.rarity)) counts.set(`${card.rarity} → ${to}`, (counts.get(`${card.rarity} → ${to}`) || 0) + 1);
    }
    for (const pack of db.prepare('SELECT id, rarities FROM packs WHERE collection_id = ? AND rarities IS NOT NULL').all(collectionId)) {
        const kept = [...new Set((fromJson(pack.rarities) || []).map((r) => rarityIn(list, r) || rarityIn(list, map.get(String(r).toLowerCase()))).filter(Boolean))];
        db.prepare('UPDATE packs SET rarities = ? WHERE id = ?').run(kept.length && kept.length < list.length ? JSON.stringify(kept) : null, pack.id);
    }
    return [...counts.entries()].map(([what, n]) => `${n} card${n === 1 ? '' : 's'} moved: ${what}`);
}

export async function deleteCollection({ db, store, id }) {
    const coll = db.prepare('SELECT id FROM collections WHERE id = ?').get(id);
    if (!coll) throw new DocumentError('No such collection', 404);
    const cardIdsOf = db.prepare('SELECT id FROM cards WHERE collection_id = ?').all(id).map((r) => r.id);
    transaction(db, () => {
        if (cardIdsOf.length) db.prepare(`DELETE FROM layers WHERE owner_kind = 'card' AND owner_id IN (${cardIdsOf.map(() => '?').join(',')})`).run(...cardIdsOf);
        db.prepare("DELETE FROM layers WHERE owner_kind = 'collection' AND owner_id = ?").run(id);
        for (const pack of db.prepare('SELECT id FROM packs WHERE collection_id = ?').all(id)) db.prepare('DELETE FROM images WHERE set_id = ?').run(pack.id);
        db.prepare('DELETE FROM collections WHERE id = ?').run(id);
        db.prepare('DELETE FROM images WHERE scope = ?').run(collectionScope(id));
    });
    await store.removeScope(collectionScope(id));
    compact(db);
}

function packRule(db, paths, collectionId, json) {
    const cards = json.cards && typeof json.cards === 'object' ? json.cards : {};
    const picked = (Array.isArray(cards.cards) ? cards.cards : []).filter((c) => db.prepare('SELECT 1 FROM cards WHERE id = ? AND collection_id = ?').get(c, collectionId));
    const list = rarityListOf(db, paths, collectionId);
    const rarities = [...new Set((Array.isArray(cards.rarities) ? cards.rarities : []).map((r) => rarityIn(list, r)).filter(Boolean))];
    return { cards: picked, rarities: rarities.length < list.length ? rarities : [] };
}

export async function savePack({ db, store, paths, id = null, collectionId = null, json, uploads, keep = [] }) {
    if (!text(json?.name)) throw new DocumentError('The booster pack needs a name');
    if (!collectionId) throw new DocumentError('Pick the collection the booster pack opens cards of');
    if (!db.prepare('SELECT 1 FROM collections WHERE id = ?').get(collectionId)) throw new DocumentError('No such collection');
    const clash = db.prepare('SELECT id FROM packs WHERE lower(name) = lower(?) AND id <> ?').get(json.name.trim(), id || '');
    if (clash) throw new DocumentError(`"${json.name.trim()}" already exists`);
    const previous = id ? packDocument(db, store, id, { internal: true }) : null;
    const packId = previous ? previous.id : idFor('pack:' + newKey('pack'));
    const scope = collectionId ? collectionScope(collectionId) : packScope(packId);
    const keepNames = new Set(keep.map(String));
    const dir = await stage(paths, uploads, keepNames, previous);
    try {
        const design = fromJson(previous?.row.design, {});
        const plan = createPlan({
            reuse: reuseMap([], (design.layers || []).map((l) => l.file).filter(Boolean)),
            keepIds: true,
            existing: { layerIds: existingLayerIds(db, { kind: 'pack', id: packId }).filter((x) => !(design.layers || []).some((l) => l.file === x)) },
        });
        const rule = packRule(db, paths, collectionId, json);
        const skinId = json.skin && db.prepare('SELECT 1 FROM skins WHERE id = ?').get(json.skin) ? json.skin : null;
        const base = json.base && db.prepare('SELECT 1 FROM skins WHERE id = ?').get(json.base) ? json.base : null;
        const pack = planPack(plan, {
            dir, data: json, id: packId, collectionId, cards: rule.cards, rarities: rule.rarities, skinId, base, scope,
        });
        if (!previous) pack.row.sort = db.prepare('SELECT COALESCE(MAX(sort) + 1, 0) AS n FROM packs').get().n;
        else pack.row.sort = previous.row.sort;
        if (fs.existsSync(path.join(dir, 'thumb.png')) && !plan.files.some((f) => f.kind === 'thumb')) plan.files.push({ kind: 'thumb', scope, ownerId: packId, from: path.join(dir, 'thumb.png') });
        const oldSetIds = previous ? [packId, ...(design.layers || []).map((l) => l.file).filter(Boolean)] : [];
        const cleanup = await finishImages(db, store, plan, oldImageRows(db, oldSetIds));
        const r = pack.row;
        transaction(db, () => {
            db.prepare('DELETE FROM packs WHERE id = ?').run(r.id);
            db.prepare(`INSERT INTO packs (id, collection_id, name, short_name, description, locales, all_collections, rarities, card_count, price, purchasable,
                loot_percent, background, look, skin_id, design, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(r.id, r.collection_id, r.name, r.short_name, r.description, toJson(r.locales), r.all_collections, toJson(r.rarities), r.card_count, r.price,
                    r.purchasable, r.loot_percent, r.background, r.look, r.skin_id, toJson(r.design), r.sort, previous?.row.created_at ?? r.created_at, Date.now());
            for (const c of pack.cards) db.prepare('INSERT OR IGNORE INTO pack_cards (pack_id, card_id) VALUES (?, ?)').run(r.id, c);
            writeImageRows(db, plan, oldSetIds);
        });
        await cleanup();
        if (previous && previous.collectionId !== collectionId)
            await store.removeThumb(previous.collectionId ? collectionScope(previous.collectionId) : packScope(packId), packId);
        return { id: r.id, warnings: plan.warnings };
    } finally {
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => { });
    }
}

export async function deletePack({ db, store, id }) {
    const previous = packDocument(db, store, id, { internal: true });
    const design = fromJson(previous.row.design, {});
    const sets = [id, ...(design.layers || []).map((l) => l.file).filter(Boolean)];
    const rows = oldImageRows(db, sets);
    transaction(db, () => {
        db.prepare('DELETE FROM packs WHERE id = ?').run(id);
        db.prepare(`DELETE FROM images WHERE set_id IN (${sets.map(() => '?').join(',')})`).run(...sets);
    });
    for (const row of rows) await fs.promises.rm(store.imagePath(row.scope, row.set_id, row.channel), { force: true });
    if (previous.collectionId) await store.removeThumb(collectionScope(previous.collectionId), id);
    else await store.removeScope(packScope(id));
    compact(db);
}

export async function saveSkin({ db, store, paths, id = null, json, uploads }) {
    if (!text(json?.name)) throw new DocumentError('The skin needs a name');
    const previous = id ? db.prepare('SELECT * FROM skins WHERE id = ?').get(id) : null;
    if (id && !previous) throw new DocumentError('No such skin', 404);
    if (previous?.builtin) throw new DocumentError('Built-in skins can\'t be changed');
    if (db.prepare('SELECT 1 FROM skins WHERE lower(name) = lower(?) AND id <> ?').get(json.name.trim(), id || '')) throw new DocumentError(`A skin "${json.name.trim()}" already exists`);
    const skinId = previous ? previous.id : hex(6);
    const scope = skinScope(skinId);
    const dir = await stage(paths, uploads, new Set(), null);
    try {
        const oldDesign = fromJson(previous?.design, {});
        const plan = createPlan({
            reuse: reuseMap([], (oldDesign.layers || []).map((l) => l.file).filter(Boolean)),
            keepIds: true,
            existing: { layerIds: existingLayerIds(db, { kind: 'skin', id: skinId }).filter((x) => x !== skinId && !(oldDesign.layers || []).some((l) => l.file === x)) },
        });
        const skin = planSkin(plan, { dir, data: json, id: skinId, scope });
        skin.row.sort = previous ? previous.sort : db.prepare('SELECT COALESCE(MAX(sort) + 1, 0) AS n FROM skins').get().n;
        if (fs.existsSync(path.join(dir, 'thumb.png')) && !plan.files.some((f) => f.kind === 'thumb')) plan.files.push({ kind: 'thumb', scope, ownerId: skinId, from: path.join(dir, 'thumb.png') });
        const oldSetIds = previous ? [skinId, ...(oldDesign.layers || []).map((l) => l.file).filter(Boolean)] : [];
        const cleanup = await finishImages(db, store, plan, oldImageRows(db, oldSetIds));
        const r = skin.row;
        transaction(db, () => {
            if (previous) db.prepare('UPDATE skins SET name = ?, design = ?, updated_at = ? WHERE id = ?').run(r.name, toJson(r.design), Date.now(), r.id);
            else db.prepare('INSERT INTO skins (id, name, builtin, design, sort, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?, ?)').run(r.id, r.name, toJson(r.design), r.sort, r.created_at, r.updated_at);
            writeImageRows(db, plan, oldSetIds);
        });
        await cleanup();
        return { id: skinId, warnings: plan.warnings };
    } finally {
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => { });
    }
}

export async function deleteSkin({ db, store, id }) {
    const skin = db.prepare('SELECT builtin FROM skins WHERE id = ?').get(id);
    if (!skin) throw new DocumentError('No such skin', 404);
    if (skin.builtin) throw new DocumentError('Built-in skins can\'t be deleted');
    transaction(db, () => {
        db.prepare('DELETE FROM skins WHERE id = ?').run(id);
        db.prepare('DELETE FROM images WHERE scope = ?').run(skinScope(id));
    });
    await store.removeScope(skinScope(id));
}

export { lower };
