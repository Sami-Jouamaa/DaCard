import fs from 'node:fs';
import path from 'node:path';
import { layout, skinScope } from './paths.mjs';
import { openDatabase, upgradeSchema, pendingSchema, schemaVersion, getSetting, setSetting, setMeta, recordMigration, transaction, toJson } from './db.mjs';
import { createImageStore } from './images.mjs';
import { createPlan, planAddons, findAddonDirs, oldLayoutParts, builtinSkinList, slotsFromConfig } from './legacy/plan.mjs';
import { applyPlan, planSize } from './legacy/apply.mjs';

const PICTURE_SURFACE = ['roughness', 'metallic'];

export const SETTING_KEYS = ['rarities', 'loot', 'containers', 'textures', 'cardTypes', 'backProperty', 'overlayProperty', 'binders', 'geek', 'foil', 'retiredItems'];

function readJsonFile(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    } catch {
        return null;
    }
}

export function defaultConfig(paths) {
    return readJsonFile(paths.defaultConfig) || {};
}

export function currentConfig(db, paths) {
    const defaults = defaultConfig(paths);
    const out = {};
    for (const key of SETTING_KEYS) {
        const value = getSetting(db, key, undefined);
        out[key] = value === undefined ? defaults[key] : value;
    }
    return out;
}

function ensureSettings(db, paths, source) {
    const defaults = defaultConfig(paths);
    const config = source || {};
    for (const key of SETTING_KEYS) {
        if (getSetting(db, key, undefined) !== undefined) continue;
        const value = config[key] !== undefined ? config[key] : defaults[key];
        if (value !== undefined) setSetting(db, key, value);
    }
}

const OLD_WEIGHTS = { common: 68, uncommon: 22, rare: 7, epic: 2, legendary: 1 };

function migrateRaritySettings(db, legacyConfig) {
    const rarities = getSetting(db, 'rarities', undefined);
    const packs = getSetting(db, 'packs', undefined) ?? legacyConfig?.packs;
    const old = rarities && typeof rarities === 'object' && Object.values(rarities).some((r) => r && ('lootPercent' in r || 'holo' in r));
    let changed = false;
    if (old) {
        const weights = Object.fromEntries(Object.entries(packs?.rarityWeights || {}).map(([k, v]) => [k.toLowerCase(), v]));
        const chances = [];
        const next = {};
        for (const [name, r] of Object.entries(rarities)) {
            const { lootPercent, holo, ...rest } = r || {};
            if (Number.isFinite(lootPercent) && lootPercent > 0) chances.push(Math.min(100, lootPercent));
            const weight = weights[name.toLowerCase()] ?? OLD_WEIGHTS[name.toLowerCase()] ?? 0;
            next[name] = { weight: Number.isFinite(rest.weight) ? rest.weight : Math.max(0, +weight || 0), ...rest };
        }
        setSetting(db, 'rarities', next);
        if (getSetting(db, 'loot', undefined) === undefined && chances.length) {
            const none = chances.reduce((p, c) => p * (1 - c / 100), 1);
            setSetting(db, 'loot', { cardPercent: Math.round((1 - none) * 10000) / 100 });
        }
        changed = true;
    }
    if (getSetting(db, 'packs', undefined) !== undefined) {
        db.prepare("DELETE FROM settings WHERE key = 'packs'").run();
        changed = true;
    }
    const foil = getSetting(db, 'foil', undefined);
    if (foil && typeof foil === 'object' && 'priceMultiplier' in foil) {
        const { priceMultiplier, ...rest } = foil;
        setSetting(db, 'foil', rest);
        changed = true;
    }
    const geek = getSetting(db, 'geek', undefined);
    if (geek && typeof geek === 'object' && 'sellFoilCards' in geek) {
        const { sellFoilCards, ...rest } = geek;
        setSetting(db, 'geek', rest);
        changed = true;
    }
    return changed && old;
}

export function legacyFolderState(paths) {
    try {
        return fs.readdirSync(paths.legacyDir).length > 0;
    } catch {
        return false;
    }
}

async function seedBuiltinSkins(db, store, paths) {
    const skins = builtinSkinList(paths.defaultSkinsDir);
    const time = Date.now();
    const known = new Map(db.prepare('SELECT id, updated_at FROM skins WHERE builtin = 1').all().map((r) => [r.id, r.updated_at]));
    let changed = 0;
    for (const skin of skins) {
        const newest = Math.max(...skin.maps.map((m) => fs.statSync(path.join(skin.dir, `${m}.png`)).mtimeMs));
        if (known.has(skin.id) && known.get(skin.id) >= newest) continue;
        const scope = skinScope(skin.id);
        for (const map of skin.maps) await store.putImage(scope, skin.id, map, path.join(skin.dir, `${map}.png`));
        if (skin.thumb) await store.putThumb(scope, skin.id, skin.thumb);
        db.prepare(`INSERT INTO skins (id, name, builtin, design, sort, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, builtin = 1, updated_at = excluded.updated_at`)
            .run(skin.id, skin.name, toJson({ look: 'textures' }), -1000 + changed, time, Math.ceil(newest));
        changed++;
    }
    return { skins, changed };
}

export function legacyState(paths) {
    const addons = findAddonDirs(paths.dataDir);
    const config = fs.existsSync(path.join(paths.dataDir, 'config.json'));
    const old = oldLayoutParts(paths.modDir, paths.dataDir);
    return { addons, config, old, pending: addons.length > 0 || config };
}

export function inspect(modDir) {
    const paths = layout(modDir);
    const exists = fs.existsSync(paths.dbFile);
    let schemaSteps = [];
    if (exists) {
        const db = openDatabase(paths.dbFile, { readOnly: true });
        try {
            schemaSteps = pendingSchema(db);
        } finally {
            db.close();
        }
    }
    const legacy = legacyState(paths);
    return { paths, databaseExists: exists, schemaSteps: exists ? schemaSteps.map((s) => s.title) : ['Database created'], legacy };
}

async function moveToLegacy(paths, sources, extras) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(paths.legacyDir, stamp);
    await fs.promises.mkdir(target, { recursive: true });
    for (const source of sources.concat(extras.filter((f) => fs.existsSync(f)))) {
        const to = path.join(target, path.basename(source));
        try {
            await fs.promises.rename(source, to);
        } catch {
            await fs.promises.cp(source, to, { recursive: true });
            await fs.promises.rm(source, { recursive: true, force: true });
        }
    }
    return target;
}

export async function runUpgrade({ modDir, by = 'dashboard', onProgress, onLog } = {}) {
    const paths = layout(modDir);
    const log = (line) => onLog?.(line);
    const db = openDatabase(paths.dbFile);
    const summary = { schema: [], skins: 0, legacy: null, warnings: [] };
    try {
        const before = schemaVersion(db);
        summary.schema = upgradeSchema(db, { dataDir: paths.dataDir, by }).map((s) => s.title);
        const store = createImageStore(db, paths.dataDir);
        const legacy = legacyState(paths);
        if (legacy.old.length)
            summary.warnings.push(`${legacy.old.join(', ')}: data from DaCard before 1.1.0 is not converted. Install DaCard 1.1.0 once to upgrade it, then this version.`);

        const legacyConfig = legacy.config ? readJsonFile(path.join(paths.dataDir, 'config.json')) : null;
        transaction(db, () => ensureSettings(db, paths, legacyConfig));
        if (transaction(db, () => migrateRaritySettings(db, legacyConfig)) && before > 0) {
            recordMigration(db, { migration: 'rarity-weights', title: 'Rarity chances: one roll per card, one card chance per container', by });
            log('Rarity chances: one roll per card, one card chance per container');
        }
        if (getSetting(db, 'retiredItems', undefined) === 'keep') {
            transaction(db, () => {
                setSetting(db, 'retiredItems', 'refund');
                recordMigration(db, { migration: 'retired-keep', title: 'Deleted items: "Keep" is now "Remove and refund"', by });
            });
            log('Deleted items: "Keep" is now "Remove and refund"');
        }
        const textures = getSetting(db, 'textures', undefined);
        if (Array.isArray(textures)) {
            const has = new Set(textures.map((t) => String(t?.suffix ?? '').toLowerCase()));
            const added = (defaultConfig(paths).textures || []).filter((t) => PICTURE_SURFACE.includes(t.suffix) && !has.has(t.suffix));
            if (added.length) {
                transaction(db, () => {
                    setSetting(db, 'textures', [...textures, ...added]);
                    recordMigration(db, { migration: 'picture-surface', title: '3D layer: roughness and metallic maps', by });
                });
                log('3D layer: roughness and metallic maps');
            }
        }
        const builtins = await seedBuiltinSkins(db, store, paths);
        summary.skins = builtins.changed;

        if (legacy.pending) {
            const config = { ...defaultConfig(paths), ...(legacyConfig || {}) };
            const existing = {
                cardIds: db.prepare('SELECT id FROM cards').all().map((r) => r.id),
                collectionIds: db.prepare('SELECT id FROM collections').all().map((r) => r.id),
                packIds: db.prepare('SELECT id FROM packs').all().map((r) => r.id),
                layerIds: db.prepare('SELECT id FROM layers').all().map((r) => r.id),
            };
            const plan = planAddons(createPlan({ existing }), legacy.addons, { slots: slotsFromConfig(config), cardTypes: config.cardTypes, builtinSkins: builtins.skins });
            log(`Converting ${legacy.addons.length} addon(s): ${plan.collections.length} collection(s), ${plan.cards.length} card(s), ${plan.packs.length} booster pack(s), ${plan.skins.length} skin(s), ${planSize(plan)} file(s)`);
            for (const w of plan.warnings) log('Warning: ' + w);
            await applyPlan(db, store, plan, onProgress);
            const migrationsLog = readJsonFile(path.join(paths.dataDir, 'migrations.json'));
            const moved = await moveToLegacy(paths, legacy.addons, [path.join(paths.dataDir, 'config.json'), path.join(paths.dataDir, 'migrations.json')]);
            transaction(db, () => {
                for (const record of migrationsLog?.applied || [])
                    if (record && !record.seen) recordMigration(db, { migration: record.id, title: record.title, by: record.by || 'server', details: { folders: record.folders }, seen: false });
                recordMigration(db, {
                    migration: 'database',
                    title: 'Addons moved into the database',
                    by,
                    seen: by === 'dashboard',
                    details: {
                        collections: plan.collections.map((c) => c.row.name),
                        cards: plan.cards.length,
                        packs: plan.packs.length,
                        skins: plan.skins.length,
                        backup: path.relative(paths.modDir, moved),
                        warnings: plan.warnings,
                    },
                });
                setMeta(db, 'legacyImportedAt', new Date().toISOString());
            });
            summary.legacy = { collections: plan.collections.length, cards: plan.cards.length, packs: plan.packs.length, skins: plan.skins.length, backup: moved, warnings: plan.warnings };
        }
        if (before > 0 && summary.schema.length && !summary.legacy)
            recordMigration(db, { migration: 'schema', title: summary.schema.join(', '), by, seen: by === 'dashboard' });
        return summary;
    } finally {
        db.close();
    }
}
