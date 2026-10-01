import fs from 'node:fs';
import path from 'node:path';
import { idFor, binderId, cardIds, newImageId } from './ids.mjs';
import { collectionScope } from './paths.mjs';
import { THUMB_VERSION } from './schema.mjs';

export const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
export const LEGACY_MAPS = ['art', 'normal', 'roughness', 'metallic', 'mask'];
export const PACK_MAPS = ['albedo', 'normal', 'metallic', 'roughness', 'ao'];
export const PACK_LAYER_SUFFIX = { normal: '.normal', roughness: '.roughness', metallic: '.metallic', mask: '.mask' };
export const DEFAULT_SLOTS = ['', 'height', 'holo', 'foil', 'normal'];
export const FILE_NAME = /^[A-Za-z0-9_.-]+$/;
export const LAYER_ID = /^[0-9a-f]{12}$/;

export const lower = (s) => String(s ?? '').trim().toLowerCase();
export const byName = (a, b) => a.toLowerCase().localeCompare(b.toLowerCase());
export const channelOf = (map) => (map === 'art' ? 'albedo' : map);
export const mapOf = (channel) => (channel === 'albedo' ? 'art' : channel);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
export const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
export const rarityOf = (value) => RARITIES.find((r) => lower(r) === lower(value)) || null;

export function exists(p) {
    try {
        return fs.statSync(p);
    } catch {
        return null;
    }
}

export const isDir = (p) => !!exists(p)?.isDirectory();
export const isFile = (p) => !!exists(p)?.isFile();

export function subdirs(dir) {
    if (!isDir(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(byName);
}

export function findChild(dir, name) {
    if (!isDir(dir)) return null;
    const hit = fs.readdirSync(dir).find((n) => n.toLowerCase() === name.toLowerCase());
    return hit ? path.join(dir, hit) : null;
}

export function readJson(file, warnings, where) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    } catch (e) {
        warnings.push(`${where}: not valid JSON (${e.message}); skipped`);
        return undefined;
    }
}

function frameFiles(dir) {
    if (!isDir(dir)) return [];
    const files = fs.readdirSync(dir).filter((n) => /^frame_.*\.png$/i.test(n)).sort(byName).map((n) => path.join(dir, n));
    return files.length > 1 ? files : [];
}

export function createPlan({ existing = {}, reuse = null, keepIds = false } = {}) {
    return {
        collections: [],
        cards: [],
        layers: [],
        stickers: [],
        packs: [],
        skins: [],
        files: [],
        warnings: [],
        sources: [],
        reuse: reuse || new Map(),
        keepIds,
        takenIds: new Set(),
        existing: {
            cardIds: new Set(existing.cardIds || []),
            collectionIds: new Set(existing.collectionIds || []),
            packIds: new Set(existing.packIds || []),
            layerIds: new Set(existing.layerIds || []),
            collectionsByFolder: new Map(existing.collectionsByFolder || []),
            cardsByKey: new Map(existing.cardsByKey || []),
            skinsByFolder: new Map(existing.skinsByFolder || []),
        },
    };
}

export function pictureLayer(dir, file, { key, chance = 100, canBeFoil = false, fps = null, speed = 12 }) {
    const maps = {};
    const frames = {};
    for (const map of LEGACY_MAPS) {
        const p = path.join(dir, map === 'art' ? `${file}.png` : `${file}.${map}.png`);
        if (!isFile(p)) continue;
        maps[channelOf(map)] = p;
        const base = file === 'card' ? 'frames' : `frames.${file}`;
        const list = frameFiles(path.join(dir, map === 'art' ? base : `${base}.${map}`));
        if (list.length) frames[channelOf(map)] = list;
    }
    if (!maps.albedo) return null;
    const ownFps = {};
    for (const [map, value] of Object.entries(fps || {})) if (num(value, 0) > 0) ownFps[channelOf(lower(map))] = value;
    return {
        file,
        key,
        chance: clamp(num(chance, 100), 0, 100),
        can_be_foil: canBeFoil ? 1 : 0,
        fps: Object.keys(ownFps).length ? ownFps : null,
        speed: num(speed, 12),
        maps,
        frames,
    };
}

export function readLayerList(plan, dir, entries, { keyPrefix, where }) {
    const out = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!entry || typeof entry !== 'object') continue;
        const file = typeof entry.file === 'string' ? entry.file : '';
        if (!FILE_NAME.test(file)) {
            plan.warnings.push(`${where}: layer file name '${entry.file}' is not valid; skipped`);
            continue;
        }
        const material = (v) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1) : null);
        const common = {
            file,
            roughness: entry.text ? null : material(entry.roughness),
            metallic: entry.text ? null : material(entry.metallic),
            name: text(entry.name),
            text_id: text(entry.id),
            over: entry.over ? 1 : 0,
            price: Math.max(0, num(entry.price, 0)),
        };
        if (entry.text && typeof entry.text === 'object') {
            const layer = {
                ...common,
                key: keyPrefix + file,
                chance: clamp(num(entry.chance, 100), 0, 100),
                can_be_foil: entry.canBeFoil === false ? 0 : 1,
                text: { ...entry.text },
                maps: {},
                frames: {},
                speed: 12,
            };
            delete layer.text.font;
            if (text(entry.text.font)) {
                const font = path.basename(entry.text.font);
                const from = path.join(dir, font);
                if (FILE_NAME.test(font) && isFile(from)) layer.font = { from, ext: path.extname(font).toLowerCase() || '.ttf' };
                else plan.warnings.push(`${where}: text layer '${file}' font ${entry.text.font} is missing; it uses the default font`);
            }
            out.push(layer);
            continue;
        }
        const source = pictureLayer(dir, file, { key: keyPrefix + file, chance: entry.chance, canBeFoil: entry.canBeFoil !== false, fps: entry.fps });
        if (!source) {
            plan.warnings.push(`${where}: layer '${file}' has no ${file}.png; skipped`);
            continue;
        }
        out.push({ ...source, ...common, transform: entry.transform && typeof entry.transform === 'object' ? { ...entry.transform } : null });
    }
    return out;
}

function layerIdFor(plan, file) {
    const reused = plan.reuse.get(lower(file));
    if (reused) {
        plan.takenIds.add(reused.id);
        return reused;
    }
    if (plan.keepIds && LAYER_ID.test(file) && !plan.takenIds.has(file) && !plan.existing.layerIds.has(file)) {
        plan.takenIds.add(file);
        return { id: file, key: null };
    }
    let id;
    do id = newImageId(); while (plan.takenIds.has(id) || plan.existing.layerIds.has(id));
    plan.takenIds.add(id);
    return { id, key: null };
}

export function addLayerRows(plan, layers, { ownerKind, ownerId, face, scope, keyFor }) {
    const ids = {};
    layers.forEach((layer, position) => {
        const reused = layerIdFor(plan, layer.file);
        const id = reused.id;
        if (layer.file) ids[layer.file.toLowerCase()] = id;
        let textJson = layer.text || null;
        if (layer.font) {
            const name = id + layer.font.ext;
            plan.files.push({ kind: 'font', scope, name, from: layer.font.from });
            textJson = { ...textJson, font: name };
        }
        for (const [channel, from] of Object.entries(layer.maps)) plan.files.push({ kind: 'image', scope, setId: id, channel, from });
        for (const [channel, from] of Object.entries(layer.frames)) plan.files.push({ kind: 'frames', scope, setId: id, channel, from });
        plan.layers.push({
            id,
            owner_kind: ownerKind,
            owner_id: ownerId,
            face,
            position,
            key: reused.key || (keyFor && LAYER_ID.test(layer.file) && plan.keepIds ? keyFor(id) : layer.key),
            name: layer.name ?? null,
            text_id: layer.text_id ?? null,
            chance: layer.chance,
            can_be_foil: layer.can_be_foil,
            over: layer.over ?? 0,
            price: layer.price ?? 0,
            transform: layer.transform ?? null,
            text: textJson,
            fps: layer.fps ?? null,
            speed: layer.speed ?? 12,
            roughness: layer.roughness ?? null,
            metallic: layer.metallic ?? null,
        });
    });
    return ids;
}

export function localesOf(value) {
    if (!value || typeof value !== 'object') return null;
    const out = {};
    for (const [lang, t] of Object.entries(value)) {
        if (!t || typeof t !== 'object') continue;
        const entry = {};
        for (const k of ['name', 'shortName', 'description']) if (text(t[k])) entry[k] = t[k];
        if (Object.keys(entry).length) out[lang] = entry;
    }
    return Object.keys(out).length ? out : null;
}

function cardTextOf(plan, data, dir, scope, collectionId, where) {
    const settings = data.cardText;
    if (!settings || typeof settings !== 'object') return null;
    const out = {};
    for (const part of ['name', 'description']) {
        const style = settings[part];
        if (!style || typeof style !== 'object') continue;
        out[part] = { ...style };
        if (text(style.font)) {
            const font = path.basename(style.font);
            const from = path.join(dir, font);
            if (FILE_NAME.test(font) && isFile(from)) {
                const name = `${collectionId}_${part}${path.extname(font).toLowerCase() || '.ttf'}`;
                plan.files.push({ kind: 'font', scope, name, from });
                out[part].font = name;
            } else {
                plan.warnings.push(`${where}: the cards' ${part} font ${style.font} is missing; the default font is used`);
                delete out[part].font;
            }
        }
    }
    return out;
}

export function planCollection(plan, { dir, data, where, idKey, id = binderId(idKey), legacyFolder = null, thumb = null, sort = plan.collections.length }) {
    const time = Date.now();
    const scope = collectionScope(id);
    const coll = {
        row: {
            id, id_key: idKey, name: text(data.name) || idKey, short_name: text(data.shortName), description: text(data.description),
            locales: localesOf(data.locales), card_text: null, legacy_folder: legacyFolder, sort, created_at: time, updated_at: time,
        },
        dir, layerIds: {}, isDefault: false,
    };
    coll.row.card_text = cardTextOf(plan, data, dir, scope, id, where);
    let front, back;
    if (data.layers && typeof data.layers === 'object') {
        front = readLayerList(plan, dir, data.layers.front, { keyPrefix: `coll:${idKey}:`, where });
        back = readLayerList(plan, dir, data.layers.back, { keyPrefix: `coll:${idKey}:`, where });
    } else {
        const overlay = pictureLayer(dir, 'overlay', { key: `coll:${idKey}:overlay` });
        const oldBack = pictureLayer(dir, 'back', { key: `coll-back:${idKey}:back` });
        front = overlay ? [overlay] : [];
        back = oldBack ? [oldBack] : [];
    }
    const keyFor = (layerId) => `coll:${idKey}:${layerId}`;
    Object.assign(coll.layerIds, addLayerRows(plan, front, { ownerKind: 'collection', ownerId: id, face: 'front', scope, keyFor }));
    Object.assign(coll.layerIds, addLayerRows(plan, back, { ownerKind: 'collection', ownerId: id, face: 'back', scope, keyFor }));
    if (data.defaultBack && typeof data.defaultBack === 'object') {
        const entry = readLayerList(plan, dir, [data.defaultBack], { keyPrefix: 'default-back:', where })
            .map((l) => ({ ...l, key: data.defaultBack.key || 'default-back' }));
        addLayerRows(plan, entry, { ownerKind: 'collection', ownerId: id, face: 'default-back', scope });
    }

    const stickers = [];
    if (Array.isArray(data.stickers)) {
        for (const s of data.stickers) {
            const file = path.basename(String(s?.file || ''));
            if (file && isFile(path.join(dir, file))) stickers.push({ from: path.join(dir, file), placement: s });
            else plan.warnings.push(`${where}: sticker picture '${s?.file}' is missing; skipped`);
        }
    } else if (isFile(path.join(dir, 'sticker.png'))) {
        stickers.push({ from: path.join(dir, 'sticker.png'), placement: data.sticker || {} });
    }
    stickers.forEach((s, position) => {
        const setId = layerIdFor(plan, path.basename(s.from, '.png')).id;
        plan.files.push({ kind: 'image', scope, setId, channel: 'albedo', from: s.from });
        const p = s.placement || {};
        plan.stickers.push({
            collection_id: id, position, set_id: setId,
            x: num(p.x, 0.5), y: num(p.y, 0.4), width: num(p.width, 0.6), height: num(p.height, 0.3), rotation: num(p.rotation, 0),
        });
    });
    if (thumb && isFile(thumb)) plan.files.push({ kind: 'thumb', scope, ownerId: id, from: thumb });
    plan.collections.push(coll);
    return coll;
}

export function planCard(plan, {
    dir, data, where, key, idKey, ids = null, collection, rarity, slots = DEFAULT_SLOTS, typeUsesDepth = (t) => t !== '2d', legacyKey = null,
    sort = plan.cards.length, thumb = undefined, thumbVersion = undefined,
}) {
    const time = Date.now();
    if (!text(data?.name)) {
        plan.warnings.push(`${where}: the card needs a "name"; skipped`);
        return null;
    }
    const { id, foilId } = ids || cardIds(idKey);
    const scope = collectionScope(collection.row.id);
    const hasLayers = !!(data.layers && typeof data.layers === 'object');

    const textures = {};
    const textureFrames = {};
    for (const suffix of slots) {
        const p = path.join(dir, suffix === '' ? 'card.png' : `card.${suffix}.png`);
        if (isFile(p)) textures[suffix] = p;
    }
    if (!textures[''] && !hasLayers) {
        plan.warnings.push(`${where} is missing card.png; skipped`);
        return null;
    }
    for (const suffix of Object.keys(textures)) {
        const list = frameFiles(path.join(dir, suffix === '' ? 'frames' : `frames.${suffix}`));
        if (list.length) textureFrames[suffix] = list;
    }
    const front = readLayerList(plan, dir, data.layers?.front, { keyPrefix: 'card:', where });
    const back = readLayerList(plan, dir, data.layers?.back, { keyPrefix: 'card:', where });
    if (hasLayers && front.length === 0 && !textures['']) {
        plan.warnings.push(`${where} has no front layer (and no card.png); skipped`);
        return null;
    }

    const type = lower(data.type) || (textures.height ? '3d' : '2d');
    const depth = typeUsesDepth(type);
    const animation = data.animation && typeof data.animation === 'object' ? {
        fps: num(data.animation.fps, 12),
        slots: data.animation.slots ? Object.fromEntries(Object.entries(data.animation.slots).map(([k, v]) => [channelOf(lower(k)), v])) : undefined,
    } : null;
    if (depth) {
        const channelFor = (suffix) => (suffix === '' ? 'albedo' : suffix.replace(/\./g, '_'));
        for (const [suffix, from] of Object.entries(textures)) plan.files.push({ kind: 'image', scope, setId: id, channel: channelFor(suffix), from });
        for (const [suffix, list] of Object.entries(textureFrames)) plan.files.push({ kind: 'frames', scope, setId: id, channel: channelFor(suffix), from: list });
    } else if (!hasLayers) {
        const picture = pictureLayer(dir, 'card', { key: 'card:card', canBeFoil: true, fps: data.animation?.slots, speed: num(data.animation?.fps, 12) });
        if (picture) front.unshift(picture);
    }

    const keyFor = (layerId) => `card:${layerId}`;
    addLayerRows(plan, front, { ownerKind: 'card', ownerId: id, face: 'front', scope, keyFor });
    addLayerRows(plan, back, { ownerKind: 'card', ownerId: id, face: 'back', scope, keyFor });
    const thumbFile = thumb !== undefined ? thumb : path.join(dir, 'thumb.png');
    const drawn = !!thumbFile && isFile(thumbFile);
    if (drawn) plan.files.push({ kind: 'thumb', scope, ownerId: id, from: thumbFile });
    else if (textures['']) plan.files.push({ kind: 'thumb', scope, ownerId: id, from: textures[''] });

    const hidden = (Array.isArray(data.hideCollectionLayers) ? data.hideCollectionLayers : []).map((f) => lower(f));
    const card = {
        owner: collection,
        hidden,
        row: {
            id, foil_id: foilId, id_key: idKey, collection_id: collection.row.id, rarity, type,
            name: data.name.trim(), short_name: text(data.shortName), description: text(data.description),
            locales: localesOf(data.locales),
            holo: data.holo && typeof data.holo === 'object' ? data.holo : null,
            glow: data.glow && typeof data.glow === 'object' ? data.glow : null,
            floats: data.floats && typeof data.floats === 'object' && Object.keys(data.floats).length ? data.floats : null,
            animation: depth ? animation : null,
            text_align: data.textAlign && typeof data.textAlign === 'object' ? data.textAlign : null,
            collection_layers: data.collectionLayers === false ? 0 : 1,
            hidden_layers: null,
            legacy_key: legacyKey,
            thumb_version: thumbVersion ?? (drawn && !front.some((l) => l.chance < 100) ? THUMB_VERSION : 0),
            sort, created_at: time, updated_at: time,
        },
    };
    plan.cards.push(card);
    return card;
}

export function resolveHidden(plan) {
    for (const card of plan.cards) {
        if (!card.hidden.length) continue;
        const ids = card.hidden.map((f) => card.owner.layerIds?.[f] || (LAYER_ID.test(f) ? f : null)).filter(Boolean);
        card.row.hidden_layers = ids.length ? ids : null;
    }
}

export function designLayers(plan, dir, entries, scope) {
    if (!Array.isArray(entries)) return [];
    const out = [];
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object' || typeof entry.file !== 'string') continue;
        const stem = entry.file.replace(/\.png$/i, '');
        const id = layerIdFor(plan, stem).id;
        const copy = { ...entry, file: id };
        const albedo = path.join(dir, `${stem}.png`);
        if (isFile(albedo)) plan.files.push({ kind: 'image', scope, setId: id, channel: 'albedo', from: albedo });
        for (const [channel, suffix] of Object.entries(PACK_LAYER_SUFFIX)) {
            const from = path.join(dir, `${stem}${suffix}.png`);
            if (isFile(from)) plan.files.push({ kind: 'image', scope, setId: id, channel, from });
        }
        if (entry.text && typeof entry.text === 'object' && text(entry.text.font)) {
            const font = path.basename(entry.text.font);
            const from = path.join(dir, font);
            if (FILE_NAME.test(font) && isFile(from)) {
                const name = id + (path.extname(font).toLowerCase() || '.ttf');
                plan.files.push({ kind: 'font', scope, name, from });
                copy.text = { ...entry.text, font: name };
            } else {
                copy.text = { ...entry.text };
                delete copy.text.font;
            }
        }
        out.push(copy);
    }
    return out;
}

export function planMaps(plan, dir, scope, setId) {
    for (const map of PACK_MAPS) {
        const from = path.join(dir, `${map}.png`);
        if (isFile(from)) plan.files.push({ kind: 'image', scope, setId, channel: map, from });
    }
}

export function planSkin(plan, { dir, data, id, scope }) {
    const time = Date.now();
    planMaps(plan, dir, scope, id);
    if (isFile(path.join(dir, 'thumb.png'))) plan.files.push({ kind: 'thumb', scope, ownerId: id, from: path.join(dir, 'thumb.png') });
    const design = { look: Array.isArray(data.layers) ? 'layers' : 'textures', base: text(data.base), layers: designLayers(plan, dir, data.layers, scope) };
    const skin = { row: { id, name: text(data.name) || id, builtin: 0, design, sort: plan.skins.length, created_at: time, updated_at: time } };
    plan.skins.push(skin);
    return skin;
}

export function planPack(plan, { dir, data, id, collectionId, all = false, collections = [], cards = [], rarities = [], skinId = null, base = null, scope }) {
    const time = Date.now();
    planMaps(plan, dir, scope, id);
    if (isFile(path.join(dir, 'thumb.png'))) plan.files.push({ kind: 'thumb', scope, ownerId: id, from: path.join(dir, 'thumb.png') });
    const look = ['preset', 'layers', 'textures'].includes(data.look) ? data.look : (skinId ? 'preset' : 'textures');
    const design = { base, layers: designLayers(plan, dir, data.layers, scope) };
    const pack = {
        row: {
            id, collection_id: collectionId, name: text(data.name) || id, short_name: text(data.shortName), description: text(data.description),
            locales: localesOf(data.locales), all_collections: all ? 1 : 0, rarities: rarities.length ? rarities : null,
            card_count: clamp(Math.round(num(data.cardCount, 3)), 1, 10), price: Math.max(0, num(data.price, 25000)),
            purchasable: data.purchasable === false ? 0 : 1, loot_percent: Math.max(0, num(data.lootPercent, 0)), background: text(data.background),
            look, skin_id: skinId, design, sort: plan.packs.length, created_at: time, updated_at: time,
        },
        collections,
        cards,
    };
    plan.packs.push(pack);
    return pack;
}

export function slotsFromConfig(config) {
    const list = Array.isArray(config?.textures) && config.textures.length ? config.textures.map((t) => String(t?.suffix ?? '')) : DEFAULT_SLOTS;
    return list.includes('') ? list : [''].concat(list);
}

export function typeUsesDepthFor(cardTypes) {
    return (type) => {
        const settings = cardTypes ? Object.entries(cardTypes).find(([k]) => lower(k) === type)?.[1] : null;
        if (!settings && !cardTypes) return type !== '2d';
        const list = settings?.slots;
        return !Array.isArray(list) || list.some((s) => lower(s) === 'height');
    };
}

export { idFor };
