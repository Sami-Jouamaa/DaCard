(() => {
    'use strict';

    const K = window.CardAddonKit;
    const { getDir, getFile, kindOf, writeFile, readJson, writeJson, copyInto, dirs, CONTENTS, CARDS, PACKS, SKINS } = K;
    const LOG_FILE = 'migrations.json';
    const CARD_FILE = 'card.json', COLLECTION_FILE = 'collection.json', PACK_FILE = 'pack.json', SKIN_FILE = 'skin.json';
    const DEFAULT_COLLECTION = '_Default';
    const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
    const LAYER_NAME = String.raw`((front|back)_\d+|layer_[0-9a-f]{10})`;
    const FILE_NAME = /^[A-Za-z0-9_.-]+$/;
    const lower = (s) => String(s || '').trim().toLowerCase();
    const isRarity = (name) => RARITIES.some((r) => lower(r) === lower(name));

    async function move(dir, from, to, apply) {
        const kind = await kindOf(dir, from);
        if (!kind) return false;
        if (!apply) return true;
        if (!(await kindOf(dir, to))) {
            if (kind === 'file') await writeFile(dir, to, await getFile(dir, from));
            else await copyInto(await getDir(dir, from), await dir.getDirectoryHandle(to, { create: true }));
        }
        await dir.removeEntry(from, { recursive: kind === 'directory' });
        return true;
    }

    async function remove(dir, name, apply) {
        const kind = await kindOf(dir, name);
        if (!kind) return false;
        if (apply) await dir.removeEntry(name, { recursive: kind === 'directory' });
        return true;
    }

    async function* addonDirs(data) {
        for await (const [name, dir] of dirs(data)) {
            if (CONTENTS.includes(lower(name))) continue;
            if (await getFile(dir, K.ADDON_FILE) || await getDir(dir, CARDS) || await getDir(dir, PACKS) || await getDir(dir, SKINS)) yield [name, dir];
        }
    }

    async function* cardFoldersIn(cards, base) {
        if (!cards) return;
        yield { dir: cards, path: base, json: null };
        for await (const [name, coll] of dirs(cards)) {
            if (await getFile(coll, COLLECTION_FILE)) yield { dir: coll, path: `${base}/${name}`, json: COLLECTION_FILE };
            for await (const [rarityName, rarity] of dirs(coll))
                for await (const [cardName, card] of dirs(rarity))
                    if (await getFile(card, CARD_FILE)) yield { dir: card, path: `${base}/${name}/${rarityName}/${cardName}`, json: CARD_FILE };
        }
    }

    const framesFolder = (file, map) => (file === 'card' ? 'frames' : 'frames.' + file) + (map ? '.' + map : '');

    const addons = {
        id: 'addons',
        title: `Addons (1.0 data moved into the ${K.TEMPLATE.name} addon)`,

        async *folders({ data }) {
            if (!data) return;
            for (const name of CONTENTS) {
                const dir = await getDir(data, name);
                if (dir) yield { dir, name, path: name };
            }
        },

        async merge(fromParent, name, toParent) {
            const from = await getDir(fromParent, name);
            const existing = await getDir(toParent, name);
            if (!existing) {
                await copyInto(from, await toParent.getDirectoryHandle(name, { create: true }));
            } else {
                for await (const [child, handle] of from.entries()) {
                    if (handle.kind === 'directory') await this.merge(from, child, existing);
                    else if (!(await getFile(existing, child))) await writeFile(existing, child, await handle.getFile());
                }
            }
            await fromParent.removeEntry(name, { recursive: true });
        },

        async work(folder, apply, roots) {
            if (!apply) return true;
            const target = await roots.data.getDirectoryHandle(K.TEMPLATE.folder, { create: true });
            if (!(await getFile(target, K.ADDON_FILE))) await writeJson(target, K.ADDON_FILE, { name: K.TEMPLATE.name });
            await this.merge(roots.data, folder.name, target);
            return true;
        },
    };

    const layerMaps = {
        id: 'layer-maps',
        title: 'Layer maps (albedo, normal, roughness, metallic, mask)',
        oldFile: new RegExp(String.raw`^${LAYER_NAME}\.(foil|normalmask)\.png$`, 'i'),
        oldFrames: new RegExp(String.raw`^frames\.${LAYER_NAME}\.(foil|normalmask)$`, 'i'),

        async *folders({ data }) {
            if (!data) return;
            yield* cardFoldersIn(await getDir(data, CARDS), CARDS);
            for await (const [name, dir] of addonDirs(data)) yield* cardFoldersIn(await getDir(dir, CARDS), `${name}/${CARDS}`);
        },

        renameMaps(maps) {
            let changed = false;
            if ('foil' in maps) {
                if (!('mask' in maps)) maps.mask = maps.foil;
                delete maps.foil;
                changed = true;
            }
            if ('normalmask' in maps) {
                delete maps.normalmask;
                changed = true;
            }
            return changed;
        },

        async isFlat(dir, card) {
            const type = typeof card.type === 'string' ? card.type.trim().toLowerCase() : null;
            return type === '2d' || (!type && !(await getFile(dir, 'card.height.png')));
        },

        async work(folder, apply) {
            const { dir, json } = folder;
            const root = json ? await readJson(dir, json) : {};
            if (!root || typeof root !== 'object') return false;
            const bases = new Set();
            let jsonChanged = false;
            if (root.layers && typeof root.layers === 'object') {
                for (const side of ['front', 'back']) {
                    for (const entry of Array.isArray(root.layers[side]) ? root.layers[side] : []) {
                        if (!entry || typeof entry !== 'object') continue;
                        if (typeof entry.file === 'string' && FILE_NAME.test(entry.file)) bases.add(entry.file);
                        if (entry.fps && typeof entry.fps === 'object') jsonChanged = this.renameMaps(entry.fps) || jsonChanged;
                    }
                }
            } else if (json === CARD_FILE && await this.isFlat(dir, root)) {
                bases.add('card');
                const slots = root.animation && root.animation.slots;
                if (slots && typeof slots === 'object') jsonChanged = this.renameMaps(slots) || jsonChanged;
            } else if (!json) {
                bases.add('back');
            } else if (json === COLLECTION_FILE) {
                bases.add('overlay');
                bases.add('back');
            }

            let filesChanged = false;
            for (const file of bases) {
                filesChanged = await move(dir, `${file}.foil.png`, `${file}.mask.png`, apply) || filesChanged;
                filesChanged = await move(dir, framesFolder(file, 'foil'), framesFolder(file, 'mask'), apply) || filesChanged;
                filesChanged = await remove(dir, `${file}.normalmask.png`, apply) || filesChanged;
                filesChanged = await remove(dir, framesFolder(file, 'normalmask'), apply) || filesChanged;
            }
            const stray = [];
            for await (const [name, handle] of dir.entries())
                if (handle.kind === 'file' ? this.oldFile.test(name) : this.oldFrames.test(name)) stray.push(name);
            for (const name of stray) filesChanged = await remove(dir, name, apply) || filesChanged;

            if (apply && jsonChanged) await writeJson(dir, json, root);
            return jsonChanged || filesChanged;
        },
    };

    const addonNames = {
        id: 'item-hashes',
        title: 'Addon item folders (hash names)',

        async *folders({ data }) {
            if (!data) return;
            for await (const [name, dir] of addonDirs(data)) yield { dir, name, path: name };
        },

        async list(dir) {
            const out = [];
            for await (const entry of dirs(dir)) out.push(entry);
            return out;
        },

        async definedElsewhere(data, own, folder) {
            for await (const [name, dir] of addonDirs(data)) {
                if (name === own) continue;
                for (const [coll, cdir] of await this.list(await getDir(dir, CARDS)))
                    if (K.hashOf(coll) === K.hashOf(folder) && await getFile(cdir, COLLECTION_FILE)) return true;
            }
            return false;
        },

        async needed(dir, addon) {
            const ok = (name) => K.isItemName(name);
            for (const [coll, cdir] of await this.list(await getDir(dir, CARDS))) {
                if (isRarity(coll)) continue;
                if (lower(coll) !== lower(DEFAULT_COLLECTION) && !ok(coll)) return true;
                for (const [rarity, rdir] of await this.list(cdir)) {
                    if (!isRarity(rarity)) continue;
                    for (const [card, cardDir] of await this.list(rdir)) if (await getFile(cardDir, CARD_FILE) && !ok(card)) return true;
                }
            }
            for (const [pack, pdir] of await this.list(await getDir(dir, PACKS))) {
                const json = await readJson(pdir, PACK_FILE);
                if (!json) continue;
                if (!ok(pack)) return true;
            }
            for (const [skin] of await this.list(await getDir(dir, SKINS))) if (!ok(skin)) return true;
            return false;
        },

        async work(folder, apply, roots) {
            let { dir, name } = folder;
            const clean = K.folderFor(name);
            if (!apply) return clean !== name || this.needed(dir, clean);
            if (clean !== name) {
                if (await getDir(roots.data, clean) && lower(clean) !== lower(name)) throw new Error(`data/${clean} already exists`);
                const temp = `${clean}_${K.hex(4)}`;
                await copyInto(dir, await roots.data.getDirectoryHandle(temp, { create: true }));
                await roots.data.removeEntry(name, { recursive: true });
                dir = await K.moveDir(roots.data, temp, roots.data, clean);
                name = clean;
            }
            const ok = (n) => K.isItemName(n);
            const maps = { collections: {}, cards: {}, skins: {} };

            const cards = await getDir(dir, CARDS);
            for (const [oldColl, cdir] of await this.list(cards)) {
                if (isRarity(oldColl)) continue;
                const isDefault = lower(oldColl) === lower(DEFAULT_COLLECTION);
                let collDir = cdir, newColl = oldColl;
                if (!isDefault && !ok(oldColl)) {
                    const own = await readJson(cdir, COLLECTION_FILE);
                    if (own || !(await this.definedElsewhere(roots.data, name, oldColl))) {
                        const json = own || {};
                        if (!(typeof json.name === 'string' && json.name.trim())) json.name = oldColl;
                        if (!(typeof json.idKey === 'string' && json.idKey.trim())) json.idKey = oldColl;
                        await writeJson(cdir, COLLECTION_FILE, json);
                    }
                    newColl = await K.freeName(cards, oldColl);
                    collDir = await K.moveDir(cards, oldColl, cards, newColl);
                    maps.collections[oldColl] = newColl;
                }
                for (const [rarity, rdir] of await this.list(collDir)) {
                    if (!isRarity(rarity)) continue;
                    for (const [oldName, cardDir] of await this.list(rdir)) {
                        const json = await readJson(cardDir, CARD_FILE);
                        if (!json) continue;
                        const newName = ok(oldName) ? oldName : await K.freeName(rdir, oldName);
                        const oldKey = isDefault ? oldName : `${oldColl}/${oldName}`;
                        const newKey = isDefault ? newName : `${newColl}/${newName}`;
                        if (oldKey === newKey) continue;
                        if (!(typeof json.idKey === 'string' && json.idKey.trim())) await writeJson(cardDir, CARD_FILE, { ...json, idKey: oldKey });
                        if (newName !== oldName) await K.moveDir(rdir, oldName, rdir, newName);
                        maps.cards[oldKey] = newKey;
                    }
                }
            }

            const packs = await getDir(dir, PACKS);
            for (const [oldName, pdir] of await this.list(packs)) {
                let json = await readJson(pdir, PACK_FILE);
                if (!json || typeof json !== 'object') continue;
                if (ok(oldName)) continue;
                const id = typeof json.id === 'string' && /^[0-9a-f]{24}$/i.test(json.id.trim()) ? json.id.trim().toLowerCase() : await K.idFor('pack:' + oldName);
                const { id: _old, ...rest } = json;
                await writeJson(pdir, PACK_FILE, { id, ...rest });
                await K.moveDir(packs, oldName, packs, await K.freeName(packs, oldName));
            }

            const skins = await getDir(dir, SKINS);
            for (const [oldName, sdir] of await this.list(skins)) {
                if (ok(oldName)) continue;
                const json = (await readJson(sdir, SKIN_FILE)) || {};
                if (!(typeof json.name === 'string' && json.name.trim())) await writeJson(sdir, SKIN_FILE, { ...json, name: oldName });
                const newName = await K.freeName(skins, oldName);
                await K.moveDir(skins, oldName, skins, newName);
                maps.skins[oldName] = newName;
            }

            if (Object.keys(maps.collections).length + Object.keys(maps.cards).length + Object.keys(maps.skins).length)
                await K.rewritePacks(roots.data, maps, clean);
            return true;
        },
    };

    async function grayPng(value) {
        const v = Math.max(0, Math.min(255, Math.round(value * 255)));
        const zipped = new Uint8Array(await new Response(new Blob([new Uint8Array([0, v])]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
        const chunk = (type, data) => {
            const body = new Uint8Array(4 + data.length);
            body.set(new TextEncoder().encode(type), 0);
            body.set(data, 4);
            const out = new DataView(new ArrayBuffer(12 + data.length));
            out.setUint32(0, data.length);
            new Uint8Array(out.buffer).set(body, 4);
            out.setUint32(8 + data.length, K.crc32(body));
            return out;
        };
        return new Blob([new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])),
            chunk('IDAT', zipped), chunk('IEND', new Uint8Array(0))], { type: 'image/png' });
    }

    async function list(dir) {
        const out = [];
        for await (const entry of dirs(dir)) out.push(entry);
        return out;
    }

    const defaultSkins = {
        id: 'default-skins',
        title: 'Stock skins (now shipped with the mod)',
        ignored: new Set([SKIN_FILE, 'thumb.png']),

        async *folders({ data, defaults }) {
            if (!data || !defaults) return;
            for await (const [name, dir] of addonDirs(data)) yield { dir, name, path: name };
        },

        async files(dir) {
            const out = new Map();
            for await (const [name, handle] of dir.entries())
                if (handle.kind === 'file' && !this.ignored.has(lower(name))) out.set(lower(name), handle);
            return out;
        },

        async same(a, b) {
            const [fa, fb] = await Promise.all([a.getFile(), b.getFile()]);
            if (fa.size !== fb.size) return false;
            const [x, y] = await Promise.all([fa.arrayBuffer(), fb.arrayBuffer()]).then((r) => r.map((buf) => new Uint8Array(buf)));
            for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
            return true;
        },

        async stock(dir, defaults) {
            const files = await this.files(dir);
            if (!files.size) return null;
            for (const [name, stock] of await list(defaults)) {
                const other = await this.files(stock);
                if (other.size !== files.size) continue;
                let match = true;
                for (const [file, handle] of files) if (!other.has(file) || !(await this.same(handle, other.get(file)))) { match = false; break; }
                if (match) return name;
            }
            return null;
        },

        async work(folder, apply, roots) {
            const skins = await getDir(folder.dir, SKINS);
            const maps = { skins: {} };
            for (const [name, dir] of await list(skins)) {
                const stock = await this.stock(dir, roots.defaults);
                if (!stock) continue;
                if (!apply) return true;
                await skins.removeEntry(name, { recursive: true });
                maps.skins[name] = stock;
            }
            if (apply && Object.keys(maps.skins).length) await K.rewritePacks(roots.data, maps, folder.name);
            return Object.keys(maps.skins).length > 0;
        },
    };

    const packLayers = {
        id: 'pack-layers',
        title: 'Booster pack layers (albedo, normal, roughness, metallic, mask)',
        hashLayer: /^layer_[0-9a-f]{10}$/,
        layerFile: /^layer_[A-Za-z0-9]+(\.[A-Za-z.]+)?\.png$/i,
        oldKeys: ['artMask', 'metallic', 'roughness', 'normal', 'metallicMask', 'roughnessMask', 'normalMask', 'normalmask', 'foil', 'finish'],
        kept: [['artMask', '.mask'], ['metallic', '.metallic'], ['foil', '.metallic'], ['roughness', '.roughness'], ['normal', '.normal']],
        finishes: { foil: [1, 0.2], base: null, print: [0, 0.62] },

        async *folders({ data }) {
            if (!data) return;
            const roots = [['', data]];
            for await (const [name, dir] of addonDirs(data)) roots.push([`${name}/`, dir]);
            for (const [prefix, root] of roots)
                for (const [name, dir] of await list(await getDir(root, PACKS))) yield { dir, path: `${prefix}${PACKS}/${name}` };
        },

        needs(json) {
            return Array.isArray(json.layers) && json.layers.some((e) => e && typeof e === 'object' && typeof e.file === 'string'
                && (!this.hashLayer.test(e.file) || this.oldKeys.some((k) => k in e)));
        },

        async work(folder, apply) {
            const { dir } = folder;
            const json = await readJson(dir, PACK_FILE);
            if (!json || typeof json !== 'object' || !this.needs(json)) return false;
            if (!apply) return true;
            const taken = new Set();
            for await (const [n] of dir.entries()) taken.add(lower(n));
            const keep = new Set(), used = new Set();
            const fresh = () => {
                let stem;
                do stem = 'layer_' + K.hex(5); while (used.has(stem) || [...taken].some((n) => n.startsWith(stem)));
                used.add(stem);
                return stem;
            };
            for (const entry of json.layers) {
                if (!entry || typeof entry !== 'object' || typeof entry.file !== 'string') continue;
                const old = /\.png$/i.test(entry.file) || this.oldKeys.some((k) => k in entry);
                const oldStem = entry.file.replace(/\.png$/i, '');
                const stem = this.hashLayer.test(oldStem) && !used.has(oldStem) ? (used.add(oldStem), oldStem) : fresh();
                const moves = [[`${oldStem}.png`, `${stem}.png`]];
                const has = (to) => moves.some((m) => lower(m[1]) === lower(to));
                for (const [key, suffix] of this.kept)
                    if (typeof entry[key] === 'string' && !has(`${stem}${suffix}.png`)) moves.push([entry[key], `${stem}${suffix}.png`]);
                if (entry.file === oldStem)
                    for (const suffix of ['.mask', '.metallic', '.roughness', '.normal'])
                        if (!has(`${stem}${suffix}.png`) && await getFile(dir, `${oldStem}${suffix}.png`)) moves.push([`${oldStem}${suffix}.png`, `${stem}${suffix}.png`]);
                const temps = [];
                for (const [from, to] of moves) {
                    if (!(await getFile(dir, from))) continue;
                    const temp = `migrating_${K.hex(6)}.png`;
                    await move(dir, from, temp, true);
                    temps.push([temp, to]);
                }
                for (const [temp, to] of temps) {
                    if (await getFile(dir, to)) await dir.removeEntry(to);
                    await move(dir, temp, to, true);
                    keep.add(lower(to));
                }
                const finish = typeof entry.finish === 'string' ? lower(entry.finish) : 'print';
                const flat = finish in this.finishes ? this.finishes[finish] : this.finishes.print;
                if (old && flat) {
                    for (const [suffix, value] of [['.metallic', flat[0]], ['.roughness', flat[1]]]) {
                        const name = `${stem}${suffix}.png`;
                        if (keep.has(lower(name))) continue;
                        await writeFile(dir, name, await grayPng(value));
                        keep.add(lower(name));
                    }
                }
                for (const key of this.oldKeys) delete entry[key];
                entry.file = stem;
            }
            const doomed = [];
            for await (const [name, handle] of dir.entries())
                if (handle.kind === 'file' && this.layerFile.test(name) && !keep.has(lower(name))) doomed.push(name);
            for (const name of doomed) await dir.removeEntry(name);
            await writeJson(dir, PACK_FILE, json);
            return true;
        },
    };

    const ALL = [addons, layerMaps, defaultSkins, packLayers, addonNames];

    async function pendingOf(migration, roots) {
        const folders = [];
        try {
            for await (const folder of migration.folders(roots)) {
                try { if (await migration.work(folder, false, roots)) folders.push(folder); } catch { }
            }
        } catch { }
        return folders;
    }

    async function pending(roots) {
        const found = [];
        for (const migration of ALL) {
            const folders = await pendingOf(migration, roots);
            if (folders.length) found.push({ migration, folders });
        }
        return found;
    }

    async function readLog(data) {
        const log = data ? await readJson(data, LOG_FILE) : null;
        return log && Array.isArray(log.applied) ? log : { applied: [] };
    }

    async function apply(roots, found, onProgress) {
        const { data } = roots;
        const records = [], failed = [];
        let done = 0;
        const total = () => found.reduce((n, f) => n + f.folders.length, 0);
        for (const migration of ALL) {
            const folders = await pendingOf(migration, roots);
            if (!folders.length) continue;
            const entry = found.find((f) => f.migration === migration);
            if (entry) entry.folders = folders; else found.push({ migration, folders });
            const updated = [];
            for (const folder of folders) {
                try {
                    await migration.work(folder, true, roots);
                    updated.push(folder.path);
                } catch (e) {
                    failed.push(`${folder.path}: ${e.message}`);
                }
                if (onProgress) onProgress(++done, total());
            }
            if (updated.length)
                records.push({ id: migration.id, title: migration.title, by: 'dashboard', date: new Date().toISOString(), folders: updated, seen: true });
        }
        if (records.length && data) {
            const log = await readLog(data);
            log.applied.push(...records);
            await writeJson(data, LOG_FILE, log);
        }
        return { records, failed };
    }

    async function unseen(data) {
        return (await readLog(data)).applied.filter((r) => r && !r.seen);
    }

    async function markSeen(data) {
        const log = await readLog(data);
        if (!log.applied.some((r) => r && !r.seen)) return;
        for (const r of log.applied) if (r) r.seen = true;
        await writeJson(data, LOG_FILE, log);
    }

    window.CardMigrations = { pending, apply, unseen, markSeen };
})();
