import fs from 'node:fs';
import path from 'node:path';
import { idFor, isMongoId, newImageId } from '../ids.mjs';
import { collectionScope, packScope, skinScope } from '../paths.mjs';
import {
    RARITIES, PACK_MAPS, lower, text, isDir, isFile, subdirs, findChild, readJson, createPlan, planCollection, planCard, resolveHidden,
    pictureLayer, addLayerRows, planSkin, planPack, slotsFromConfig, typeUsesDepthFor, rarityOf,
} from '../content.mjs';

export { createPlan, slotsFromConfig };

export const DEFAULT_COLLECTION = '_Default';
export const ADDON_FILE = 'addon.json';
export const CONTENTS = ['cards', 'packs', 'skins'];

export function isAddonDir(dir) {
    const name = path.basename(dir);
    if (CONTENTS.includes(lower(name)) || lower(name) === 'collections' || name.startsWith('_')) return false;
    return isFile(path.join(dir, ADDON_FILE)) || CONTENTS.some((c) => isDir(path.join(dir, c)));
}

export function findAddonDirs(dataDir) {
    return subdirs(dataDir).map((n) => path.join(dataDir, n)).filter(isAddonDir);
}

const LEGACY_FILE = { cards: null, packs: 'pack.json', skins: 'skin.json' };

export function oldLayoutParts(modDir, dataDir) {
    const parts = [];
    for (const name of CONTENTS.concat(['collections'])) if (isDir(path.join(modDir, name))) parts.push(name + '/');
    if (isFile(path.join(modDir, 'config.json'))) parts.push('config.json');
    for (const name of CONTENTS) {
        const dir = path.join(dataDir, name);
        if (!isDir(dir)) continue;
        const marker = LEGACY_FILE[name];
        if (!marker || subdirs(dir).some((d) => isFile(path.join(dir, d, marker)))) parts.push(`data/${name}/`);
    }
    return parts;
}

export function planAddons(plan, addonDirs, { slots, cardTypes = null, builtinSkins = [] } = {}) {
    const typeUsesDepth = typeUsesDepthFor(cardTypes);
    const seenCardKeys = new Set();
    const cardIdSet = new Set();
    const collectionKeySet = new Set();
    const collectionsByFolder = new Map(plan.existing.collectionsByFolder);
    const cardsByKey = new Map(plan.existing.cardsByKey);
    const addonInfo = [];

    for (const addonDir of addonDirs) {
        const folder = path.basename(addonDir);
        plan.sources.push(addonDir);
        const meta = isFile(path.join(addonDir, ADDON_FILE)) ? readJson(path.join(addonDir, ADDON_FILE), plan.warnings, `data/${folder}/${ADDON_FILE}`) : null;
        const addonName = text(meta?.name) || folder;
        const thumbPath = text(meta?.thumbnail) ? path.join(addonDir, path.basename(meta.thumbnail)) : path.join(addonDir, 'thumb.png');
        const info = { folder, name: addonName, dir: addonDir, thumb: isFile(thumbPath) ? thumbPath : null, collections: [], defaultCollection: null };
        addonInfo.push(info);
        const cardsDir = findChild(addonDir, 'cards');
        const where = `data/${folder}/cards`;

        const ensureDefault = () => {
            if (info.defaultCollection) return info.defaultCollection;
            const coll = planCollection(plan, {
                dir: cardsDir, data: { name: addonName, layers: { front: [], back: [] }, stickers: [] }, where, idKey: `${folder}/_default`,
                legacyFolder: `${folder}/${DEFAULT_COLLECTION}`, thumb: info.thumb,
            });
            coll.isDefault = true;
            info.collections.push(coll);
            info.defaultCollection = coll;
            return coll;
        };

        for (const collFolder of subdirs(cardsDir)) {
            const collDir = path.join(cardsDir, collFolder);
            if (rarityOf(collFolder)) {
                plan.warnings.push(`${where}/${collFolder}/ is ignored: cards go into ${where}/<collection>/${collFolder}/<card>/`);
                continue;
            }
            const isDefault = lower(collFolder) === lower(DEFAULT_COLLECTION);
            let coll = null;
            if (!isDefault) {
                const jsonPath = path.join(collDir, 'collection.json');
                const data = isFile(jsonPath) ? readJson(jsonPath, plan.warnings, `${where}/${collFolder}/collection.json`) : {};
                if (data === undefined) continue;
                const idKey = text(data.idKey) || collFolder;
                const id = idFor('binder:' + idKey);
                if (collectionKeySet.has(lower(collFolder)) || collectionKeySet.has(lower(idKey)) || plan.existing.collectionIds.has(id)) {
                    plan.warnings.push(`${where}/${collFolder}: another collection has the same folder name or "idKey"; skipped with its cards`);
                    continue;
                }
                collectionKeySet.add(lower(collFolder));
                collectionKeySet.add(lower(idKey));
                coll = planCollection(plan, {
                    dir: collDir, data: { ...data, name: text(data.name) || collFolder }, where: `${where}/${collFolder}`, idKey, id, legacyFolder: collFolder, thumb: info.thumb,
                });
                info.collections.push(coll);
                collectionsByFolder.set(lower(collFolder), id);
            }

            for (const rarityFolder of subdirs(collDir)) {
                const rarity = rarityOf(rarityFolder);
                if (!rarity) continue;
                for (const cardFolder of subdirs(path.join(collDir, rarityFolder))) {
                    const cardDir = path.join(collDir, rarityFolder, cardFolder);
                    const cardWhere = `${where}/${collFolder}/${rarityFolder}/${cardFolder}`;
                    const key = isDefault ? cardFolder : `${collFolder}/${cardFolder}`;
                    if (seenCardKeys.has(lower(key))) {
                        plan.warnings.push(`${cardWhere}: duplicate card folder name; skipped`);
                        continue;
                    }
                    seenCardKeys.add(lower(key));
                    const jsonPath = path.join(cardDir, 'card.json');
                    if (!isFile(jsonPath)) {
                        plan.warnings.push(`${cardWhere} has no card.json; skipped`);
                        continue;
                    }
                    const data = readJson(jsonPath, plan.warnings, `${cardWhere}/card.json`);
                    if (data === undefined) continue;
                    const idKey = text(data?.idKey) || key;
                    const id = idFor(idKey);
                    if (cardIdSet.has(id) || plan.existing.cardIds.has(id)) {
                        plan.warnings.push(`${cardWhere}: same card as another one (same "idKey"); skipped`);
                        continue;
                    }
                    if (!text(data?.name)) {
                        plan.warnings.push(`${cardWhere}/card.json needs a "name"; skipped`);
                        continue;
                    }
                    const owner = coll || ensureDefault();
                    const card = planCard(plan, {
                        dir: cardDir, data, where: cardWhere, key, idKey, collection: owner, rarity, slots, typeUsesDepth, legacyKey: `${folder}/${key}`,
                    });
                    if (!card) continue;
                    cardIdSet.add(id);
                    cardsByKey.set(lower(key), id);
                }
            }
        }

        const back = cardsDir ? pictureLayer(cardsDir, 'back', { key: 'default-back' }) : null;
        if (back) {
            for (const coll of info.collections)
                addLayerRows(plan, [back], { ownerKind: 'collection', ownerId: coll.row.id, face: 'default-back', scope: collectionScope(coll.row.id) });
        }
    }
    resolveHidden(plan);

    const skinsByFolder = new Map(plan.existing.skinsByFolder);
    for (const skin of builtinSkins) skinsByFolder.set(`*/${lower(skin.folder)}`, skin.id);
    const plannedSkins = [];
    for (const info of addonInfo) {
        const skinsDir = findChild(info.dir, 'skins');
        for (const skinFolder of subdirs(skinsDir)) {
            const dir = path.join(skinsDir, skinFolder);
            const meta = isFile(path.join(dir, 'skin.json')) ? readJson(path.join(dir, 'skin.json'), plan.warnings, `data/${info.folder}/skins/${skinFolder}/skin.json`) : {};
            if (meta === undefined) continue;
            const id = newImageId();
            const skin = planSkin(plan, { dir, data: { ...meta, name: text(meta.name) || skinFolder }, id, scope: skinScope(id) });
            plannedSkins.push({ skin, addon: info.folder });
            skinsByFolder.set(`${lower(info.folder)}/${lower(skinFolder)}`, id);
            if (!skinsByFolder.has(`any/${lower(skinFolder)}`)) skinsByFolder.set(`any/${lower(skinFolder)}`, id);
        }
    }
    const resolveSkin = (addon, folder) => {
        if (!text(folder)) return null;
        const f = lower(folder);
        return skinsByFolder.get(`${lower(addon)}/${f}`) ?? skinsByFolder.get(`any/${f}`) ?? skinsByFolder.get(`*/${f}`) ?? null;
    };
    for (const { skin, addon } of plannedSkins)
        if (skin.row.design.base) skin.row.design.base = resolveSkin(addon, skin.row.design.base) ?? skin.row.design.base;

    const packIds = new Set();
    for (const info of addonInfo) {
        const packsDir = findChild(info.dir, 'packs');
        for (const packFolder of subdirs(packsDir)) {
            const dir = path.join(packsDir, packFolder);
            const where = `data/${info.folder}/packs/${packFolder}`;
            if (!isFile(path.join(dir, 'pack.json'))) continue;
            const data = readJson(path.join(dir, 'pack.json'), plan.warnings, `${where}/pack.json`);
            if (!data || typeof data !== 'object') continue;
            const id = isMongoId(data.id) ? data.id.toLowerCase() : idFor('pack:' + packFolder);
            if (packIds.has(id) || plan.existing.packIds.has(id)) {
                plan.warnings.push(`${where}: another booster pack has the same id; skipped`);
                continue;
            }
            packIds.add(id);

            const rule = data.cards && typeof data.cards === 'object' ? data.cards : {};
            const collections = new Set();
            const cards = new Set();
            if (rule.all) for (const coll of info.collections) collections.add(coll.row.id);
            for (const name of Array.isArray(rule.collections) ? rule.collections : []) {
                if (lower(name) === lower(DEFAULT_COLLECTION)) {
                    if (info.defaultCollection) collections.add(info.defaultCollection.row.id);
                    continue;
                }
                const cid = collectionsByFolder.get(lower(name));
                if (cid) collections.add(cid);
                else plan.warnings.push(`${where}: collection '${name}' is not installed; left out of the pack`);
            }
            for (const key of Array.isArray(rule.cards) ? rule.cards : []) {
                const cid = cardsByKey.get(lower(key));
                if (cid) cards.add(cid);
                else plan.warnings.push(`${where}: card '${key}' is not installed; left out of the pack`);
            }
            const rarities = (Array.isArray(rule.rarities) ? rule.rarities : []).map(rarityOf).filter(Boolean);
            const single = collections.size === 1 && cards.size === 0 ? [...collections][0] : null;
            const skinId = resolveSkin(info.folder, data.skin);
            if (text(data.skin) && !skinId) plan.warnings.push(`${where}: skin '${data.skin}' is not installed; the pack uses its own maps`);
            planPack(plan, {
                dir, data: { ...data, name: text(data.name) || packFolder }, id, collectionId: single, collections: single ? [] : [...collections], cards: [...cards],
                rarities, skinId, base: resolveSkin(info.folder, data.base) ?? text(data.base), scope: single ? collectionScope(single) : packScope(id),
            });
        }
    }
    return plan;
}

export function builtinSkinList(defaultSkinsDir) {
    return subdirs(defaultSkinsDir).map((folder) => {
        const dir = path.join(defaultSkinsDir, folder);
        let name = folder;
        try {
            const meta = JSON.parse(fs.readFileSync(path.join(dir, 'skin.json'), 'utf8'));
            if (text(meta?.name)) name = meta.name.trim();
        } catch { }
        const maps = PACK_MAPS.filter((m) => isFile(path.join(dir, `${m}.png`)));
        return { id: folder.toLowerCase().replace(/[^a-z0-9_-]/g, '_'), folder, name, dir, maps, thumb: isFile(path.join(dir, 'thumb.png')) ? path.join(dir, 'thumb.png') : null };
    }).filter((s) => s.maps.includes('albedo'));
}

export { RARITIES };
