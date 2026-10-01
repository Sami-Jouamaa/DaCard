import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { transaction } from './db.mjs';
import { collectionScope, skinScope } from './paths.mjs';
import { hex } from './ids.mjs';
import { DocumentError, deleteCollection, deletePack } from './documents.mjs';
import { createPlan, planAddons, isAddonDir, builtinSkinList, slotsFromConfig } from './legacy/plan.mjs';
import { applyPlan, planSize } from './legacy/apply.mjs';
import { currentConfig } from './upgrade.mjs';
import { subdirs, isFile } from './content.mjs';

export const MANIFEST = 'dacard-collection.json';
export const FORMAT = 'dacard-collection';
export const FORMAT_VERSION = 1;

function walk(dir, base = dir) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full, base));
        else out.push({ full, relative: path.relative(base, full).split(path.sep).join('/') });
    }
    return out;
}

const rows = (db, sql, ...args) => db.prepare(sql).all(...args);

export function exportName(name) {
    return (String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'collection') + '.dacard.zip';
}

export async function exportCollection({ db, store, paths, id, version, onProgress }) {
    const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
    if (!collection) throw new DocumentError('No such collection', 404);
    const cards = rows(db, 'SELECT * FROM cards WHERE collection_id = ? ORDER BY sort', id);
    const cardIds = cards.map((c) => c.id);
    const layers = rows(db, "SELECT * FROM layers WHERE owner_kind = 'collection' AND owner_id = ? ORDER BY face, position", id)
        .concat(cardIds.length ? rows(db, `SELECT * FROM layers WHERE owner_kind = 'card' AND owner_id IN (${cardIds.map(() => '?').join(',')}) ORDER BY owner_id, face, position`, ...cardIds) : []);
    const packs = rows(db, 'SELECT * FROM packs WHERE collection_id = ? ORDER BY sort', id);
    const packIds = packs.map((p) => p.id);
    const packCards = packIds.length ? rows(db, `SELECT * FROM pack_cards WHERE pack_id IN (${packIds.map(() => '?').join(',')})`, ...packIds) : [];
    const scope = collectionScope(id);
    const images = rows(db, 'SELECT * FROM images WHERE scope = ?', scope);
    const skinIds = [...new Set(packs.flatMap((p) => [p.skin_id, JSON.parse(p.design || '{}')?.base]).filter(Boolean))];
    const skins = skinIds.length ? rows(db, `SELECT * FROM skins WHERE builtin = 0 AND id IN (${skinIds.map(() => '?').join(',')})`, ...skinIds) : [];
    const skinImages = skins.flatMap((s) => rows(db, 'SELECT * FROM images WHERE scope = ?', skinScope(s.id)));
    const manifest = {
        format: FORMAT, version: FORMAT_VERSION, exported: new Date().toISOString(), dacard: version,
        collection, cards, layers, stickers: rows(db, 'SELECT * FROM binder_stickers WHERE collection_id = ? ORDER BY position', id),
        packs, packCards, images, skins, skinImages,
    };

    const files = walk(store.dirOf(scope)).map((f) => ({ ...f, name: `collection/${f.relative}` }))
        .concat(skins.flatMap((s) => walk(store.dirOf(skinScope(s.id))).map((f) => ({ ...f, name: `skins/${s.id}/${f.relative}` }))));
    await fs.promises.mkdir(paths.exportsDir, { recursive: true });
    const name = exportName(collection.name);
    const target = path.join(paths.exportsDir, `${hex(4)}-${name}`);
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 1)), MANIFEST);
    const out = fs.createWriteStream(target);
    const done = pipeline(zip.outputStream, out);
    let count = 0;
    for (const file of files) {
        zip.addFile(file.full, file.name, { compress: !/\.png$/i.test(file.name) });
        if (++count % 50 === 0) onProgress?.(count, files.length, 'Packing files');
    }
    zip.end();
    onProgress?.(files.length, files.length, 'Writing the zip');
    await done;
    return { file: path.basename(target), name, size: fs.statSync(target).size, cards: cards.length };
}

function openZip(file) {
    return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => (err ? reject(err) : resolve(zip))));
}

async function zipEntries(file) {
    const zip = await openZip(file);
    const entries = await new Promise((resolve, reject) => {
        const list = [];
        zip.on('entry', (entry) => {
            list.push(entry);
            zip.readEntry();
        });
        zip.on('end', () => resolve(list));
        zip.on('error', reject);
        zip.readEntry();
    });
    return { zip, entries };
}

function readEntry(zip, entry) {
    return new Promise((resolve, reject) => zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream))));
}

async function extract(zip, entries, target, onProgress, filter = () => true) {
    const files = entries.filter((e) => !/\/$/.test(e.fileName) && filter(e.fileName));
    let done = 0;
    for (const entry of files) {
        const to = path.join(target, ...entry.fileName.split('/'));
        if (!path.resolve(to).startsWith(path.resolve(target) + path.sep)) throw new Error(`Unsafe path in the zip: ${entry.fileName}`);
        await fs.promises.mkdir(path.dirname(to), { recursive: true });
        await pipeline(await readEntry(zip, entry), fs.createWriteStream(to));
        if (++done % 25 === 0 || done === files.length) onProgress?.(done, files.length, 'Unpacking');
    }
}

function wrapper(entries) {
    const names = entries.map((e) => e.fileName).filter((n) => !n.startsWith('__MACOSX/'));
    const tops = new Set(names.map((n) => n.split('/')[0]));
    if (tops.size === 1) {
        const top = [...tops][0];
        if (names.every((n) => n.startsWith(top + '/'))) return top + '/';
    }
    return '';
}

export async function inspectZip(file) {
    const { zip, entries } = await zipEntries(file);
    try {
        const prefix = wrapper(entries);
        const manifestEntry = entries.find((e) => e.fileName === prefix + MANIFEST);
        if (manifestEntry) {
            const chunks = [];
            for await (const chunk of await readEntry(zip, manifestEntry)) chunks.push(chunk);
            const manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (manifest.format !== FORMAT) throw new DocumentError('This is not a DaCard collection');
            if (manifest.version > FORMAT_VERSION) throw new DocumentError('This collection is from a newer DaCard. Update DaCard to import it.');
            return { kind: 'collection', prefix, manifest, name: manifest.collection?.name, cards: manifest.cards?.length || 0 };
        }
        const names = entries.map((e) => e.fileName.slice(prefix.length));
        if (names.some((n) => /^(addon\.json|cards\/|packs\/|skins\/)/i.test(n))) return { kind: 'addon', prefix };
        throw new DocumentError('This zip has no DaCard collection in it');
    } finally {
        zip.close();
    }
}

export async function importZip({ db, store, paths, file, replace = false, onProgress, onLog }) {
    const info = await inspectZip(file);
    return info.kind === 'collection'
        ? importCollection({ db, store, paths, file, info, replace, onProgress })
        : importAddon({ db, store, paths, file, info, replace, onProgress, onLog });
}

async function importCollection({ db, store, paths, file, info, replace, onProgress }) {
    const m = info.manifest;
    const coll = m.collection;
    const existing = db.prepare('SELECT id, name FROM collections WHERE id = ?').get(coll.id);
    if (existing && !replace) throw new DocumentError(`"${existing.name}" is already installed. Import it again with Replace to overwrite it.`, 409);
    const cardIds = m.cards.map((c) => c.id).concat(m.cards.map((c) => c.foil_id));
    const elsewhere = cardIds.length
        ? db.prepare(`SELECT c.name, k.name AS coll FROM cards c JOIN collections k ON k.id = c.collection_id WHERE c.collection_id <> ? AND (c.id IN (${cardIds.map(() => '?').join(',')}) OR c.foil_id IN (${cardIds.map(() => '?').join(',')}))`)
            .all(coll.id, ...cardIds, ...cardIds)
        : [];
    if (elsewhere.length) throw new DocumentError(`Some of its cards are already in another collection: ${elsewhere.slice(0, 5).map((c) => `${c.name} (${c.coll})`).join(', ')}`, 409);
    const packIds = m.packs.map((p) => p.id);
    const packClash = packIds.length ? db.prepare(`SELECT name FROM packs WHERE id IN (${packIds.map(() => '?').join(',')}) AND (collection_id IS NULL OR collection_id <> ?)`).all(...packIds, coll.id) : [];
    if (packClash.length) throw new DocumentError(`Its booster pack "${packClash[0].name}" is already installed elsewhere`, 409);
    const layerIds = m.layers.map((l) => l.id);
    const layerClash = layerIds.length
        ? db.prepare(`SELECT id FROM layers WHERE id IN (${layerIds.map(() => '?').join(',')}) AND NOT (owner_kind = 'collection' AND owner_id = ?) AND owner_id NOT IN (SELECT id FROM cards WHERE collection_id = ?)`).all(...layerIds, coll.id, coll.id)
        : [];
    if (layerClash.length) throw new DocumentError('Its layers clash with installed ones; it can\'t be imported', 409);

    const staging = path.join(paths.tempDir, hex(8));
    const { zip, entries } = await zipEntries(file);
    try {
        await extract(zip, entries, staging, onProgress, (n) => n.startsWith(info.prefix + 'collection/') || n.startsWith(info.prefix + 'skins/'));
    } finally {
        zip.close();
    }
    try {
        if (existing) await deleteCollection({ db, store, id: coll.id });
        const root = info.prefix ? path.join(staging, ...info.prefix.split('/').filter(Boolean)) : staging;
        await fs.promises.mkdir(path.dirname(store.dirOf(collectionScope(coll.id))), { recursive: true });
        await moveTree(path.join(root, 'collection'), store.dirOf(collectionScope(coll.id)));
        const newSkins = m.skins.filter((s) => !db.prepare('SELECT 1 FROM skins WHERE id = ?').get(s.id));
        for (const skin of newSkins) await moveTree(path.join(root, 'skins', skin.id), store.dirOf(skinScope(skin.id)));
        onProgress?.(1, 1, 'Saving to the database');
        const insert = (table, row) => {
            const cols = Object.keys(row);
            db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c]));
        };
        transaction(db, () => {
            insert('collections', { ...coll, sort: db.prepare('SELECT COALESCE(MAX(sort) + 1, 0) AS n FROM collections').get().n });
            for (const row of m.cards) insert('cards', row);
            for (const row of m.layers) insert('layers', row);
            for (const row of m.stickers) insert('binder_stickers', row);
            for (const row of newSkins) insert('skins', row);
            for (const row of m.skinImages.filter((i) => newSkins.some((s) => skinScope(s.id) === i.scope))) insert('images', row);
            for (const row of m.packs) insert('packs', { ...row, skin_id: row.skin_id && db.prepare('SELECT 1 FROM skins WHERE id = ?').get(row.skin_id) ? row.skin_id : null });
            for (const row of m.packCards) insert('pack_cards', row);
            for (const row of m.images) insert('images', row);
        });
        return { kind: 'collection', id: coll.id, name: coll.name, cards: m.cards.length, packs: m.packs.length, replaced: !!existing, warnings: [] };
    } finally {
        await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => { });
    }
}

async function moveTree(from, to) {
    if (!fs.existsSync(from)) return;
    await fs.promises.rm(to, { recursive: true, force: true });
    await fs.promises.mkdir(path.dirname(to), { recursive: true });
    try {
        await fs.promises.rename(from, to);
    } catch {
        await fs.promises.cp(from, to, { recursive: true });
    }
}

async function importAddon({ db, store, paths, file, info, replace, onProgress, onLog }) {
    const staging = path.join(paths.tempDir, hex(8));
    const { zip, entries } = await zipEntries(file);
    try {
        await extract(zip, entries, staging, onProgress);
    } finally {
        zip.close();
    }
    try {
        let root = info.prefix ? path.join(staging, ...info.prefix.split('/').filter(Boolean)) : staging;
        if (!isAddonDir(root)) {
            const inner = subdirs(root).map((d) => path.join(root, d)).find(isAddonDir);
            if (inner) root = inner;
        }
        const named = path.join(staging, '_addon_' + hex(3));
        if (!isAddonDir(root)) {
            await fs.promises.mkdir(named, { recursive: true });
            for (const entry of fs.readdirSync(root)) if (entry !== path.basename(named)) await fs.promises.rename(path.join(root, entry), path.join(named, entry));
            root = named;
        }
        const config = currentConfig(db, paths);
        const builtins = builtinSkinList(paths.defaultSkinsDir);
        const options = { slots: slotsFromConfig(config), cardTypes: config.cardTypes, builtinSkins: builtins };
        if (replace) {
            const probe = planAddons(createPlan(), [root], options);
            for (const coll of probe.collections)
                if (db.prepare('SELECT 1 FROM collections WHERE id = ?').get(coll.row.id)) await deleteCollection({ db, store, id: coll.row.id });
            for (const pack of probe.packs)
                if (db.prepare('SELECT 1 FROM packs WHERE id = ?').get(pack.row.id)) await deletePack({ db, store, id: pack.row.id });
        }
        const existing = {
            cardIds: db.prepare('SELECT id FROM cards').all().map((r) => r.id),
            collectionIds: db.prepare('SELECT id FROM collections').all().map((r) => r.id),
            packIds: db.prepare('SELECT id FROM packs').all().map((r) => r.id),
            layerIds: db.prepare('SELECT id FROM layers').all().map((r) => r.id),
            collectionsByFolder: db.prepare('SELECT legacy_folder, id FROM collections WHERE legacy_folder IS NOT NULL').all().map((r) => [r.legacy_folder.toLowerCase(), r.id]),
            cardsByKey: db.prepare('SELECT legacy_key, id FROM cards WHERE legacy_key IS NOT NULL').all().map((r) => [r.legacy_key.split('/').slice(1).join('/').toLowerCase(), r.id]),
        };
        const plan = planAddons(createPlan({ existing }), [root], options);
        for (const w of plan.warnings) onLog?.(w);
        if (!plan.collections.length && !plan.packs.length && !plan.skins.length) throw new DocumentError(plan.warnings[0] || 'Nothing in this addon could be imported');
        await applyPlan(db, store, plan, (p) => onProgress?.(p.done, p.total, p.message));
        return {
            kind: 'addon', collections: plan.collections.map((c) => ({ id: c.row.id, name: c.row.name })), cards: plan.cards.length,
            packs: plan.packs.length, skins: plan.skins.length, files: planSize(plan), warnings: plan.warnings,
        };
    } finally {
        await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => { });
    }
}
