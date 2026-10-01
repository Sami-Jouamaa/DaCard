(() => {
    'use strict';

    const ADDON_FILE = 'addon.json', THUMB_FILE = 'thumb.png';
    const CARDS = 'cards', PACKS = 'packs', SKINS = 'skins';
    const CONTENTS = [CARDS, PACKS, SKINS];
    const TEMPLATE = { folder: 'dacardtemplate', name: 'DaCard Template' };
    const STARTER = 'My Addon';
    const FALLBACK_SKIN = 'escape_from_tarkov';
    const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
    const DEFAULT_COLLECTION = '_Default';
    const CARD_FILE = 'card.json', COLLECTION_FILE = 'collection.json', PACK_FILE = 'pack.json', SKIN_FILE = 'skin.json';
    const HEX12 = /^[0-9a-f]{12}$/, PREFIXED = /^[a-z0-9]+_([0-9a-f]{12})$/i;
    const IGNORED = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;
    const THUMB_SIZE = 256;
    const LOGO_SVG = '<svg class="logo-icon" viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="7" width="15" height="21" rx="2" transform="rotate(-12 10.5 17.5)" fill="none" stroke="currentColor" stroke-width="2.4"/><rect x="13" y="4" width="15" height="21" rx="2" fill="currentColor"/></svg>';

    const lower = (s) => String(s || '').trim().toLowerCase();
    const isRarity = (name) => RARITIES.some((r) => lower(r) === lower(name));
    const isDefault = (name) => lower(name) === lower(DEFAULT_COLLECTION);
    const hex = (bytes) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
    const folderFor = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'addon';
    const isItemName = (name) => HEX12.test(name);
    const hashOf = (name) => (HEX12.test(name) ? name : PREFIXED.test(name) ? PREFIXED.exec(name)[1].toLowerCase() : lower(name));

    async function idFor(key) {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('DaCard:' + key.toLowerCase()));
        return Array.from(new Uint8Array(hash).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
    }

    async function getDir(parent, name, create = false) {
        try { return await parent.getDirectoryHandle(name, { create }); } catch { return null; }
    }
    async function getFile(parent, name) {
        try { return await (await parent.getFileHandle(name)).getFile(); } catch { return null; }
    }
    async function kindOf(dir, name) {
        if (await getFile(dir, name)) return 'file';
        if (await getDir(dir, name)) return 'directory';
        return null;
    }
    async function writeFile(dir, name, data) {
        const handle = await dir.getFileHandle(name, { create: true });
        const w = await handle.createWritable();
        await w.write(data);
        await w.close();
    }
    async function writePath(dir, path, data) {
        const parts = path.split('/');
        for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
        await writeFile(dir, parts[parts.length - 1], data);
    }
    async function readJson(dir, name) {
        const file = await getFile(dir, name);
        if (!file) return null;
        try { return JSON.parse(await file.text()); } catch { return null; }
    }
    const writeJson = (dir, name, data) => writeFile(dir, name, new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));

    async function copyInto(from, to) {
        for await (const [name, handle] of from.entries()) {
            if (handle.kind === 'file') await writeFile(to, name, await handle.getFile());
            else await copyInto(handle, await to.getDirectoryHandle(name, { create: true }));
        }
    }

    async function moveDir(fromParent, fromName, toParent, toName) {
        const from = await fromParent.getDirectoryHandle(fromName);
        if (await kindOf(toParent, toName)) throw new Error(`${toName} already exists`);
        await copyInto(from, await toParent.getDirectoryHandle(toName, { create: true }));
        await fromParent.removeEntry(fromName, { recursive: true });
        return toParent.getDirectoryHandle(toName);
    }

    async function* dirs(dir) {
        if (!dir) return;
        for await (const [name, handle] of dir.entries()) if (handle.kind === 'directory') yield [name, handle];
    }

    async function freeName(parent, old = '') {
        let name = hashOf(old);
        if (!HEX12.test(name)) name = hex(6);
        while (await kindOf(parent, name)) name = hex(6);
        return name;
    }

    async function isAddonDir(handle) {
        if (await getFile(handle, ADDON_FILE)) return true;
        for (const c of CONTENTS) if (await getDir(handle, c)) return true;
        return false;
    }

    async function scan(data) {
        const list = [];
        if (!data) return list;
        for await (const [folder, dir] of dirs(data)) {
            if (CONTENTS.includes(lower(folder)) || !(await isAddonDir(dir))) continue;
            const info = (await readJson(dir, ADDON_FILE)) || {};
            const name = typeof info.name === 'string' && info.name.trim() ? info.name.trim() : folder;
            const thumbName = typeof info.thumbnail === 'string' && /^[A-Za-z0-9_.-]+$/.test(info.thumbnail) ? info.thumbnail : THUMB_FILE;
            list.push({ folder, name, dir, info, thumb: await getFile(dir, thumbName) });
        }
        list.sort((a, b) => a.name.localeCompare(b.name));
        return list;
    }

    async function ensure(data, addons, folder) {
        const found = addons.find((a) => a.folder === folder) || (!folder && addons.length === 1 ? addons[0] : null);
        if (found) return found;
        if (folder) throw new Error(`The addon ${folder} is gone. Reload the page.`);
        return create(data, { name: STARTER }, null);
    }

    async function create(data, { name, thumb }) {
        const folder = folderFor(name);
        if (CONTENTS.includes(folder)) throw new Error(`"${name}" can't be an addon name`);
        if (await kindOf(data, folder)) throw new Error(`An addon in data/${folder}/ already exists`);
        const dir = await data.getDirectoryHandle(folder, { create: true });
        const info = { name: name.trim() };
        if (thumb) {
            await writeFile(dir, THUMB_FILE, thumb);
            info.thumbnail = THUMB_FILE;
        }
        await writeJson(dir, ADDON_FILE, info);
        return { folder, name: info.name, dir, info, thumb: thumb || null };
    }

    async function thumbnail(file) {
        const bitmap = await createImageBitmap(file);
        const k = Math.min(1, THUMB_SIZE / Math.max(bitmap.width, bitmap.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(bitmap.width * k));
        c.height = Math.max(1, Math.round(bitmap.height * k));
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(bitmap, 0, 0, c.width, c.height);
        bitmap.close && bitmap.close();
        return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the picture'))), 'image/png'));
    }

    async function contents(addon) {
        const out = { cards: 0, collections: 0, packs: 0, skins: 0 };
        const cards = await getDir(addon.dir, CARDS);
        for await (const [coll, cdir] of dirs(cards)) {
            if (isRarity(coll)) continue;
            if (!isDefault(coll) && await getFile(cdir, COLLECTION_FILE)) out.collections++;
            for await (const [rarity, rdir] of dirs(cdir)) {
                if (!isRarity(rarity)) continue;
                for await (const [, card] of dirs(rdir)) if (await getFile(card, CARD_FILE)) out.cards++;
            }
        }
        for await (const [, pack] of dirs(await getDir(addon.dir, PACKS))) if (await getFile(pack, PACK_FILE)) out.packs++;
        for await (const [] of dirs(await getDir(addon.dir, SKINS))) out.skins++;
        return out;
    }

    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const describe = (c) => [c.cards && plural(c.cards, 'card'), c.collections && plural(c.collections, 'binder'),
        c.packs && plural(c.packs, 'pack'), c.skins && plural(c.skins, 'skin')].filter(Boolean).join(' · ') || 'Empty';

    const CRC_TABLE = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            t[n] = c >>> 0;
        }
        return t;
    })();
    function crc32(data) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    function makeZip(entries) {
        const enc = new TextEncoder();
        const parts = [], central = [];
        let offset = 0;
        for (const e of entries) {
            const name = enc.encode(e.name), crc = crc32(e.data), size = e.data.length;
            const local = new DataView(new ArrayBuffer(30));
            local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
            local.setUint32(14, crc, true); local.setUint32(18, size, true); local.setUint32(22, size, true);
            local.setUint16(26, name.length, true);
            parts.push(local, name, e.data);
            const cen = new DataView(new ArrayBuffer(46));
            cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
            cen.setUint32(16, crc, true); cen.setUint32(20, size, true); cen.setUint32(24, size, true);
            cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
            central.push(cen, name);
            offset += 30 + name.length + size;
        }
        const censize = central.reduce((n, p) => n + p.byteLength, 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
        end.setUint32(12, censize, true); end.setUint32(16, offset, true);
        return new Blob([...parts, ...central, end], { type: 'application/zip' });
    }

    async function readZip(blob) {
        const tail = new DataView(await blob.slice(Math.max(0, blob.size - 65558)).arrayBuffer());
        let eocd = -1;
        for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        if (eocd < 0) throw new Error('Not a .zip file');
        const count = tail.getUint16(eocd + 10, true), size = tail.getUint32(eocd + 12, true), start = tail.getUint32(eocd + 16, true);
        if (start === 0xFFFFFFFF || count === 0xFFFF) throw new Error('This .zip is too big (Zip64 is not supported)');
        const cd = new DataView(await blob.slice(start, start + size).arrayBuffer());
        const utf8 = new TextDecoder('utf-8');
        const entries = [];
        for (let p = 0, i = 0; i < count; i++) {
            if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('This .zip is damaged');
            const method = cd.getUint16(p + 10, true), packed = cd.getUint32(p + 20, true);
            const nameLen = cd.getUint16(p + 28, true), extraLen = cd.getUint16(p + 30, true), commentLen = cd.getUint16(p + 32, true);
            const offset = cd.getUint32(p + 42, true);
            const name = utf8.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen)).replace(/\\/g, '/');
            p += 46 + nameLen + extraLen + commentLen;
            if (name.endsWith('/')) continue;
            if (method !== 0 && method !== 8) throw new Error(`${name} uses an unsupported compression`);
            entries.push({
                name,
                async blob() {
                    const head = new DataView(await blob.slice(offset, offset + 30).arrayBuffer());
                    const from = offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
                    const data = blob.slice(from, from + packed);
                    if (method === 0) return data;
                    return new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
                },
            });
        }
        return entries;
    }

    async function inspect(file) {
        const errors = [];
        let entries = (await readZip(file)).filter((e) => !IGNORED.test(e.name));
        if (entries.some((e) => e.name.startsWith('/') || /^[A-Za-z]:/.test(e.name) || e.name.split('/').includes('..')))
            throw new Error('The .zip has unsafe paths');
        const tops = new Set(entries.map((e) => e.name.split('/')[0]));
        let wrapper = null;
        if (tops.size === 1 && entries.every((e) => e.name.includes('/')) && !CONTENTS.includes(lower([...tops][0]))) {
            wrapper = [...tops][0];
            entries = entries.map((e) => ({ ...e, name: e.name.slice(wrapper.length + 1) }));
        }
        const byName = new Map(entries.map((e) => [e.name, e]));
        let info = {};
        if (byName.has(ADDON_FILE)) {
            try { info = JSON.parse(await (await byName.get(ADDON_FILE).blob()).text()) || {}; } catch { errors.push(`${ADDON_FILE} is not valid JSON`); }
        }
        const thumbName = typeof info.thumbnail === 'string' && /^[A-Za-z0-9_.-]+$/.test(info.thumbnail) ? info.thumbnail : THUMB_FILE;
        const unknown = new Set();
        const counts = { cards: 0, collections: 0, packs: 0, skins: 0 };
        const skins = new Set(), packDirs = new Set(), packJsons = new Set();
        for (const { name } of entries) {
            const parts = name.split('/');
            const top = lower(parts[0]);
            if (parts.length === 1) {
                if (name !== ADDON_FILE && name !== thumbName) unknown.add(name);
                continue;
            }
            if (!CONTENTS.includes(top) || parts[0] !== top) { unknown.add(parts[0] + '/'); continue; }
            if (top === CARDS) {
                if (parts.length >= 5 && !isRarity(parts[2])) unknown.add(`${parts.slice(0, 3).join('/')}/ (not a rarity)`);
                if (parts.length === 5 && parts[4] === CARD_FILE) counts.cards++;
                if (parts.length === 3 && parts[2] === COLLECTION_FILE && !isDefault(parts[1])) counts.collections++;
            }
            if (top === PACKS && parts.length >= 3) {
                packDirs.add(parts[1]);
                if (parts.length === 3 && parts[2] === PACK_FILE) { packJsons.add(parts[1]); counts.packs++; }
            }
            if (top === SKINS && parts.length >= 3) skins.add(parts[1]);
        }
        counts.skins = skins.size;
        for (const p of packDirs) if (!packJsons.has(p)) unknown.add(`${PACKS}/${p}/ (no ${PACK_FILE})`);
        if (unknown.size) errors.push(`Not allowed: ${[...unknown].slice(0, 6).join(', ')}${unknown.size > 6 ? ', …' : ''}`);
        if (!entries.some((e) => CONTENTS.includes(e.name.split('/')[0]) && e.name.includes('/')))
            errors.push(`No ${CONTENTS.join(', ')} folder`);
        const name = typeof info.name === 'string' && info.name.trim() ? info.name.trim() : wrapper || file.name.replace(/\.zip$/i, '');
        const refs = [];
        for (const p of packJsons) {
            let pack = null;
            try { pack = JSON.parse(await (await byName.get(`${PACKS}/${p}/${PACK_FILE}`).blob()).text()); } catch { }
            if (!pack || typeof pack !== 'object') continue;
            for (const key of ['skin', 'base'])
                if (typeof pack[key] === 'string' && pack[key].trim()) refs.push({ pack: pack.name || p, key, skin: pack[key].trim() });
        }
        const collectionCards = new Map(), defined = new Set();
        for (const { name: path } of entries) {
            const parts = path.split('/');
            if (parts[0] !== CARDS || isDefault(parts[1] || '') || isRarity(parts[1] || '')) continue;
            if (parts.length === 3 && parts[2] === COLLECTION_FILE) defined.add(lower(parts[1]));
            if (parts.length === 5 && parts[4] === CARD_FILE) collectionCards.set(lower(parts[1]), (collectionCards.get(lower(parts[1])) || 0) + 1);
        }
        const collectionRefs = [...collectionCards].filter(([folder]) => !defined.has(folder)).map(([folder, cards]) => ({ folder, cards }));
        return { name, folder: folderFor(name), info, thumbName, entries, counts, errors, refs, collectionRefs, skins: new Set([...skins].map(lower)) };
    }

    function dependency(requires, type, folder, what) {
        const known = (Array.isArray(requires) ? requires : []).find((r) => r && r.type === type && lower(r.folder) === lower(folder));
        return { type, folder, what, label: known && known.name ? known.name : folder, from: known ? known.addonName || known.addon : null };
    }

    const plural2 = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    function missingDeps(inspected, { skins = [], collections = [] }) {
        const haveSkins = new Set(skins.map((s) => lower(s.folder)));
        const haveColls = new Set(collections.map((c) => lower(c.folder)));
        const out = [];
        for (const ref of inspected.collectionRefs)
            if (!haveColls.has(lower(ref.folder))) out.push(dependency(inspected.info.requires, 'collection', ref.folder, plural2(ref.cards, 'card')));
        const seen = new Set();
        for (const ref of inspected.refs) {
            const key = lower(ref.skin);
            if (inspected.skins.has(key) || haveSkins.has(key) || seen.has(key)) continue;
            seen.add(key);
            out.push(dependency(inspected.info.requires, 'skin', ref.skin, ref.pack));
        }
        return out;
    }

    const dependencyText = (d) => `${d.type === 'skin' ? 'Skin' : 'Collection'} ${d.label}${d.from ? ` (${d.from})` : ''} · ${d.what}`;

    async function install(data, inspected, { replace = false, onProgress } = {}) {
        const { folder, entries } = inspected;
        if (CONTENTS.includes(folder)) throw new Error(`"${inspected.name}" can't be an addon name`);
        if (await kindOf(data, folder)) {
            if (!replace) throw new Error(`data/${folder}/ already exists`);
            await data.removeEntry(folder, { recursive: true });
        }
        const dir = await data.getDirectoryHandle(folder, { create: true });
        for (const [i, entry] of entries.entries()) {
            if (entry.name === ADDON_FILE) continue;
            await writePath(dir, entry.name, await entry.blob());
            if (onProgress) onProgress(i + 1, entries.length);
        }
        await writeJson(dir, ADDON_FILE, { ...inspected.info, name: inspected.name });
        return folder;
    }

    async function requirements(addon, { skins = [], collections = [], addons = [] }) {
        const before = Array.isArray(addon.info && addon.info.requires) ? addon.info.requires : [];
        const addonName = (folder) => (addons.find((a) => a.folder === folder) || { name: folder }).name;
        const previous = (type, folder) => before.find((r) => r && r.type === type && lower(r.folder) === lower(folder));
        const out = [];
        const cardsDir = await getDir(addon.dir, CARDS);
        for await (const [folder, cdir] of dirs(cardsDir)) {
            if (isDefault(folder) || isRarity(folder) || await getFile(cdir, COLLECTION_FILE)) continue;
            let cards = 0;
            for await (const [rarity, rdir] of dirs(cdir)) if (isRarity(rarity)) for await (const [, card] of dirs(rdir)) if (await getFile(card, CARD_FILE)) cards++;
            if (!cards) continue;
            const found = collections.find((c) => lower(c.folder) === lower(folder) && c.addon !== addon.folder);
            out.push(found ? { type: 'collection', folder, name: found.data.name, addon: found.addon, addonName: addonName(found.addon) }
                : previous('collection', folder) || { type: 'collection', folder });
        }
        const own = new Set();
        for await (const [name] of dirs(await getDir(addon.dir, SKINS))) own.add(lower(name));
        for await (const [, pack] of dirs(await getDir(addon.dir, PACKS))) {
            const json = await readJson(pack, PACK_FILE);
            if (!json || typeof json !== 'object') continue;
            for (const key of ['skin', 'base']) {
                const skin = typeof json[key] === 'string' ? json[key].trim() : null;
                if (!skin || own.has(lower(skin)) || out.some((r) => r.type === 'skin' && lower(r.folder) === lower(skin))) continue;
                const found = skins.find((x) => lower(x.folder) === lower(skin));
                if (found && !found.addon) continue;
                out.push(found ? { type: 'skin', folder: skin, name: found.data.name, addon: found.addon, addonName: addonName(found.addon) }
                    : previous('skin', skin) || { type: 'skin', folder: skin });
            }
        }
        return out;
    }

    async function exportZip(addon, onProgress, context = {}) {
        const files = [];
        const walk = async (dir, path) => {
            for await (const [name, handle] of dir.entries()) {
                if (handle.kind === 'directory') await walk(handle, `${path}${name}/`);
                else files.push([`${path}${name}`, handle]);
            }
        };
        await walk(addon.dir, '');
        const entries = [];
        for (const [i, [name, handle]] of files.entries()) {
            if (name === ADDON_FILE) continue;
            entries.push({ name, data: new Uint8Array(await (await handle.getFile()).arrayBuffer()) });
            if (onProgress) onProgress(i + 1, files.length);
        }
        const info = { ...((await readJson(addon.dir, ADDON_FILE)) || {}), name: addon.name };
        const requires = await requirements(addon, context);
        if (requires.length) info.requires = requires; else delete info.requires;
        await writeJson(addon.dir, ADDON_FILE, info);
        addon.info = info;
        entries.unshift({ name: ADDON_FILE, data: new TextEncoder().encode(JSON.stringify(info, null, 2) + '\n') });
        return makeZip(entries);
    }

    function renameAll(list, names) {
        let changed = false;
        if (!Array.isArray(list)) return false;
        for (let i = 0; i < list.length; i++) {
            const value = typeof list[i] === 'string' ? list[i].trim().replace(/\\/g, '/') : null;
            const hit = value && Object.keys(names).find((k) => lower(k) === lower(value));
            if (hit) { list[i] = names[hit]; changed = true; }
        }
        return changed;
    }

    async function rewritePacks(data, maps, addon) {
        const roots = [[null, data]];
        for await (const [folder, dir] of dirs(data)) if (!CONTENTS.includes(lower(folder))) roots.push([folder, dir]);
        for (const [folder, root] of roots) {
            const own = folder === addon;
            for await (const [, pack] of dirs(await getDir(root, PACKS))) {
                const json = await readJson(pack, PACK_FILE);
                if (!json || typeof json !== 'object') continue;
                let changed = false;
                if (json.cards && typeof json.cards === 'object') {
                    changed = renameAll(json.cards.collections, maps.collections || {}) || changed;
                    changed = renameAll(json.cards.cards, maps.cards || {}) || changed;
                }
                for (const key of ['skin', 'base']) {
                    const skin = typeof json[key] === 'string' ? json[key].trim() : null;
                    const hit = skin && Object.keys(maps.skins || {}).find((k) => lower(k) === lower(skin));
                    if (!hit) continue;
                    const skinsRoot = await getDir(root, SKINS);
                    if (!own && skinsRoot && await getDir(skinsRoot, skin)) continue;
                    json[key] = maps.skins[hit];
                    changed = true;
                }
                if (changed) await writeJson(pack, PACK_FILE, json);
            }
        }
    }

    async function rename(data, addon, name, others = []) {
        const clean = String(name || '').trim();
        if (!clean) throw new Error('The addon needs a name');
        const folder = folderFor(clean);
        if (CONTENTS.includes(folder)) throw new Error(`"${clean}" can't be an addon name`);
        let dir = addon.dir;
        if (folder !== addon.folder) {
            if (await kindOf(data, folder)) throw new Error(`An addon in data/${folder}/ already exists`);
            const target = await data.getDirectoryHandle(folder, { create: true });
            try {
                await copyInto(addon.dir, target);
            } catch (e) {
                await data.removeEntry(folder, { recursive: true }).catch(() => {});
                throw e;
            }
            await data.removeEntry(addon.folder, { recursive: true });
            dir = target;
        }
        await writeJson(dir, ADDON_FILE, { ...((await readJson(dir, ADDON_FILE)) || {}), name: clean });
        for (const other of others) {
            if (other.folder === addon.folder) continue;
            const json = await readJson(other.dir, ADDON_FILE);
            if (!json || !Array.isArray(json.requires)) continue;
            let changed = false;
            for (const r of json.requires)
                if (r && typeof r === 'object' && r.addon === addon.folder) { r.addon = folder; r.addonName = clean; changed = true; }
            if (changed) await writeJson(other.dir, ADDON_FILE, json);
        }
        return folder;
    }

    window.CardAddonKit = {
        ADDON_FILE, THUMB_FILE, CONTENTS, TEMPLATE, LOGO_SVG, STARTER, CARDS, PACKS, SKINS,
        folderFor, isItemName, hashOf, freeName, hex, idFor, scan, ensure, create, thumbnail, contents, describe,
        FALLBACK_SKIN, makeZip, crc32, readZip, inspect, missingDeps, dependency, requirements, install, exportZip, rewritePacks,
        rename, getDir, getFile, kindOf, writeFile, readJson, writeJson, copyInto, moveDir, dirs,
    };

    let app = null;
    const $ = (sel, root = document) => root.querySelector(sel);
    const modal = { kind: null, payload: null };

    function render() {
        const grid = $('#addon-grid');
        if (!grid || !app) return;
        const addons = app.state.addons || [];
        grid.innerHTML = '';
        for (const addon of addons) {
            const tile = document.createElement('div');
            tile.className = 'addon-tile';
            let src = '';
            if (addon.thumb) { src = URL.createObjectURL(addon.thumb); app.state.urls.push(src); }
            tile.innerHTML = `
                <div class="addon-thumb-wrap">
                    <button type="button" class="addon-thumb addon-thumb-edit" title="Change thumbnail">${src ? `<img alt="" src="${src}">` : LOGO_SVG}</button>
                    ${src ? '<button type="button" class="facade-iconbtn addon-thumb-clear" title="Remove thumbnail">×</button>' : ''}
                    <input type="file" accept="image/*" hidden>
                </div>
                <div class="addon-info">
                    <b>${app.escapeHtml(addon.name)}</b>
                    <small class="addon-what">…</small>
                    <small class="addon-missing" hidden></small>
                    <code>data/${app.escapeHtml(addon.folder)}/</code>
                </div>
                <div class="addon-actions">
                    <button type="button" class="facade-btn fx-sm" data-act="rename">Rename</button>
                    <button type="button" class="facade-btn fx-sm" data-act="export">Export</button>
                    <button type="button" class="facade-btn fx-sm fx-red" data-act="delete">Delete</button>
                </div>`;
            contents(addon).then((c) => { addon.counts = c; $('.addon-what', tile).textContent = describe(c); }).catch(() => {});
            const needs = installedNeeds(addon);
            const needsEl = $('.addon-missing', tile);
            needsEl.hidden = !needs.length;
            needsEl.textContent = needs.length ? `Needs: ${needs.map(dependencyText).join('; ')}` : '';
            const key = `${addon.folder}|${needs.map((d) => d.folder).join(',')}`;
            if (needs.length && !reported.has(key)) {
                reported.add(key);
                app.toast.err(`${addon.name}: missing dependencies`, `${needs.map(dependencyText).join('; ')}. Install them for these to work.`);
            }
            $('[data-act="export"]', tile).addEventListener('click', (e) => exportAddon(addon, e.currentTarget));
            $('[data-act="rename"]', tile).addEventListener('click', () => openRename(addon));
            $('[data-act="delete"]', tile).addEventListener('click', (e) => deleteAddon(addon, e.currentTarget));
            const thumbButton = $('.addon-thumb-edit', tile), thumbInput = $('input[type="file"]', tile);
            thumbButton.addEventListener('click', () => thumbInput.click());
            thumbInput.addEventListener('change', () => { const f = thumbInput.files[0]; thumbInput.value = ''; changeThumbnail(addon, f); });
            thumbButton.addEventListener('dragover', (e) => { if ([...e.dataTransfer.items].some((i) => i.type.startsWith('image/'))) { e.preventDefault(); e.stopPropagation(); } });
            thumbButton.addEventListener('drop', (e) => {
                const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
                if (!f) return;
                e.preventDefault();
                e.stopPropagation();
                changeThumbnail(addon, f);
            });
            const clear = $('.addon-thumb-clear', tile);
            if (clear) clear.addEventListener('click', () => changeThumbnail(addon, null));
            grid.appendChild(tile);
        }
        const empty = $('#addon-empty');
        empty.hidden = addons.length > 0;
        empty.textContent = !app.state.data ? 'Connect the mod folder.' : 'No addons yet.';
        const count = $('#addons-count');
        count.hidden = !app.state.data;
        count.textContent = addons.length;
    }

    async function setThumbnail(addon, blob) {
        const info = { ...(addon.info || {}), name: addon.name };
        const old = typeof info.thumbnail === 'string' && /^[A-Za-z0-9_.-]+$/.test(info.thumbnail) ? info.thumbnail : THUMB_FILE;
        if (blob) {
            await writeFile(addon.dir, THUMB_FILE, blob);
            info.thumbnail = THUMB_FILE;
        } else {
            delete info.thumbnail;
        }
        if ((!blob || old !== THUMB_FILE) && old !== ADDON_FILE && await getFile(addon.dir, old)) await addon.dir.removeEntry(old).catch(() => {});
        await writeJson(addon.dir, ADDON_FILE, info);
        addon.info = info;
        addon.thumb = blob;
    }

    async function changeThumbnail(addon, file) {
        try {
            await setThumbnail(addon, file ? await thumbnail(file) : null);
            render();
            app.toast.ok(file ? 'Thumbnail changed' : 'Thumbnail removed', addon.name);
        } catch (e) {
            app.toast.err('Could not change the thumbnail', e.message);
        }
    }

    function openRename(addon) {
        modal.payload = { addon };
        openModal('rename', 'Rename addon', `
            <label class="field"><span>Name</span><input type="text" class="facade-input" id="ad-rename" maxlength="40" autocomplete="off"><small class="field-note" id="ad-rename-folder"></small></label>
            <small class="field-note">Items players own keep working.</small>`, 'Rename');
        const input = $('#ad-rename');
        input.value = addon.name;
        const show = () => {
            const folder = folderFor(input.value.trim());
            $('#ad-rename-folder').innerHTML = input.value.trim()
                ? `<code>data/${app.escapeHtml(folder)}/</code>${folder !== addon.folder ? ` · was <code>data/${app.escapeHtml(addon.folder)}/</code>` : ''}` : 'Folder name.';
        };
        input.addEventListener('input', show);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') runRename(); });
        show();
        input.focus();
        input.select();
    }

    async function runRename() {
        const { addon } = modal.payload;
        const name = $('#ad-rename').value.trim();
        if (!name) { app.toast.err('The addon needs a name'); $('#ad-rename').focus(); return; }
        if (name === addon.name) { closeModal(); return; }
        const ok = $('#addon-modal-ok');
        ok.disabled = true;
        $('#addon-modal-status').textContent = 'Renaming…';
        try {
            const folder = await rename(app.state.data, addon, name, app.state.addons || []);
            closeModal();
            await app.rescan();
            app.toast.ok('Addon renamed', `${name} · data/${folder}/`);
        } catch (e) {
            app.toast.err('Could not rename the addon', e.message);
            ok.disabled = false;
            $('#addon-modal-status').textContent = '';
        }
    }

    async function exportAddon(addon, button) {
        const label = button.textContent;
        button.disabled = true;
        try {
            const zip = await exportZip(addon, (done, total) => { button.textContent = `${done} / ${total}`; }, context());
            app.download(zip, `${addon.folder}.zip`);
            app.toast.ok('Addon exported', `${addon.folder}.zip`);
        } catch (e) {
            app.toast.err('Could not export', e.message);
        } finally {
            button.disabled = false;
            button.textContent = label;
        }
    }

    async function deleteAddon(addon, button) {
        if (!button.dataset.armed) {
            button.dataset.armed = '1';
            button.textContent = 'Click again to delete';
            setTimeout(() => { if (button.isConnected && button.dataset.armed) { delete button.dataset.armed; button.textContent = 'Delete'; } }, 3000);
            return;
        }
        button.disabled = true;
        try {
            await app.state.data.removeEntry(addon.folder, { recursive: true });
            app.toast.ok('Addon deleted', `${addon.name} · its items are removed when the server restarts.`);
            await app.rescan();
        } catch (e) {
            app.toast.err('Could not delete the addon', e.message);
            button.disabled = false;
        }
    }

    const reported = new Set();
    const context = () => ({ skins: app.state.skins || [], collections: app.state.collections || [], addons: app.state.addons || [] });

    function installedNeeds(addon) {
        const out = [];
        const requires = addon.info && addon.info.requires;
        const collections = app.state.collections || [];
        const orphans = new Map();
        for (const card of app.state.list || [])
            if (card.addon === addon.folder && card.collection && !collections.some((c) => lower(c.folder) === lower(card.collection)))
                orphans.set(card.collection, (orphans.get(card.collection) || 0) + 1);
        for (const [folder, n] of orphans) out.push(dependency(requires, 'collection', folder, plural2(n, 'card')));
        const skins = app.state.skins;
        if (skins) {
            const have = new Set(skins.map((x) => lower(x.folder)));
            for (const pack of (app.state.packs || []).filter((x) => x.addon === addon.folder))
                for (const key of ['skin', 'base']) {
                    const skin = typeof pack.data[key] === 'string' ? pack.data[key].trim() : null;
                    if (skin && !have.has(lower(skin)) && !out.some((d) => d.type === 'skin' && lower(d.folder) === lower(skin)))
                        out.push(dependency(requires, 'skin', skin, pack.data.name));
                }
        }
        return out;
    }

    function missingNote(missing) {
        const notes = [];
        if (missing.some((m) => m.type === 'collection')) notes.push('Cards have no binder until installed.');
        if (missing.some((m) => m.type === 'skin')) notes.push(`Packs use ${fallbackName()} until installed.`);
        return notes.join(' ');
    }

    function fallbackName() {
        const skin = (app.state.skins || []).find((s) => !s.addon && lower(s.folder) === FALLBACK_SKIN);
        return skin ? skin.data.name : FALLBACK_SKIN;
    }


    function openModal(kind, title, body, action) {
        modal.kind = kind;
        $('#addon-modal-title').textContent = title;
        $('#addon-modal-body').innerHTML = body;
        $('#addon-modal-ok').textContent = action;
        $('#addon-modal-ok').disabled = false;
        $('#addon-modal-status').textContent = '';
        $('#addon-modal').hidden = false;
    }

    function closeModal() {
        $('#addon-modal').hidden = true;
        modal.kind = null;
        modal.payload = null;
    }

    async function pickZip(file) {
        if (!file) return;
        if (!app.state.data) { app.toast.err('Connect the mod folder first'); return; }
        let inspected;
        try {
            inspected = await inspect(file);
        } catch (e) {
            app.toast.err(`Could not read ${file.name}`, e.message);
            return;
        }
        if (inspected.errors.length) { app.toast.err('Not a DaCard addon', inspected.errors.join('. ')); return; }
        const existing = (app.state.addons || []).find((a) => a.folder === inspected.folder);
        const missing = missingDeps(inspected, {
            skins: (app.state.skins || []).filter((x) => x.addon !== inspected.folder),
            collections: (app.state.collections || []).filter((c) => c.addon !== inspected.folder),
        });
        modal.payload = { inspected, replace: !!existing, missing };
        openModal('import', 'Import addon', `
            <p><b>${app.escapeHtml(inspected.name)}</b> <code>data/${app.escapeHtml(inspected.folder)}/</code></p>
            <p class="field-note">${describe(inspected.counts)}</p>
            ${missing.length ? `<div class="addon-warn"><b>Missing dependencies</b><ul>${missing.map((m) => `<li>${app.escapeHtml(dependencyText(m))}</li>`).join('')}</ul><small>${app.escapeHtml(missingNote(missing))}</small></div>` : ''}
            ${existing ? '<p class="addon-warn">Replaces the installed one.</p>' : ''}`, existing ? 'Replace' : 'Install');
    }

    async function runImport() {
        const { inspected, replace, missing } = modal.payload;
        const ok = $('#addon-modal-ok');
        ok.disabled = true;
        try {
            await install(app.state.data, inspected, { replace, onProgress: (d, t) => { $('#addon-modal-status').textContent = `${d} / ${t}`; } });
            closeModal();
            await app.rescan({ migrate: true });
            app.toast.ok('Addon installed', `${inspected.name} · restart the SPT server to get it in game.`);
            if (missing && missing.length)
                app.toast.err('Missing dependencies', `${missing.map(dependencyText).join('; ')}. ${missingNote(missing)}`);
        } catch (e) {
            app.toast.err('Could not install the addon', e.message);
            ok.disabled = false;
        }
    }

    function openCreate() {
        if (!app.state.data) { app.toast.err('Connect the mod folder first'); return; }
        modal.payload = { thumb: null };
        openModal('create', 'Create addon', `
            <div class="addon-create-head">
                <label class="field"><span>Name</span><input type="text" class="facade-input" id="ad-name" maxlength="40" autocomplete="off" placeholder="e.g. Raiders Set"><small class="field-note" id="ad-folder">Folder name.</small></label>
                <label class="addon-thumb addon-thumb-pick" title="Thumbnail"><input type="file" id="ad-thumb" accept="image/*" hidden><span>Thumbnail</span></label>
            </div>
            <small class="field-note">Pick it as the Addon when you make cards, collections or booster packs.</small>`, 'Create');
        $('#ad-name').addEventListener('input', () => {
            const name = $('#ad-name').value.trim();
            $('#ad-folder').innerHTML = name ? `<code>data/${folderFor(name)}/</code>` : 'Folder name.';
        });
        $('#ad-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') runCreate(); });
        $('#ad-thumb').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                modal.payload.thumb = await thumbnail(file);
                const url = URL.createObjectURL(modal.payload.thumb);
                app.state.urls.push(url);
                $('.addon-thumb-pick span').innerHTML = `<img alt="" src="${url}">`;
            } catch (err) {
                app.toast.err('Could not use that picture', err.message);
            }
        });
        $('#ad-name').focus();
    }

    async function runCreate() {
        const name = $('#ad-name').value.trim();
        if (!name) { app.toast.err('The addon needs a name'); $('#ad-name').focus(); return; }
        const ok = $('#addon-modal-ok');
        ok.disabled = true;
        try {
            const target = await create(app.state.data, { name, thumb: modal.payload.thumb });
            closeModal();
            await app.rescan();
            app.toast.ok('Addon created', `${name} · data/${target.folder}/`);
        } catch (e) {
            app.toast.err('Could not create the addon', e.message);
            ok.disabled = false;
        }
    }

    window.CCAddons = {
        init(helpers) {
            app = helpers;
            $('#addon-import').addEventListener('click', () => $('#addon-file').click());
            $('#addon-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; pickZip(f); });
            $('#addon-create').addEventListener('click', openCreate);
            $('#addon-modal-close').addEventListener('click', closeModal);
            $('#addon-modal-cancel').addEventListener('click', closeModal);
            $('#addon-modal-ok').addEventListener('click', () => ({ import: runImport, create: runCreate, rename: runRename }[modal.kind] || (() => {}))());
            const pane = $('#pane-addons');
            pane.addEventListener('dragover', (e) => { if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) e.preventDefault(); });
            pane.addEventListener('drop', (e) => {
                const file = [...e.dataTransfer.files].find((f) => /\.zip$/i.test(f.name));
                if (!file) return;
                e.preventDefault();
                pickZip(file);
            });
            render();
        },
        render,
    };
})();
