(() => {
    'use strict';

    const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
    const DEFAULT_COLLECTION = '_Default';
    const RARITY_DEFAULTS = {
        Common: { price: 5000, color: '#B8BCC4' },
        Uncommon: { price: 15000, color: '#4FD65A' },
        Rare: { price: 40000, color: '#3F8CFF' },
        Epic: { price: 100000, color: '#B04FFF' },
        Legendary: { price: 250000, color: '#FFB32E' },
    };
    const CARD_W = 490, CARD_H = 684;
    const WINDOW_RECT = [0.031, 0.022, 0.969, 0.978];
    const PREVIEW_SCALE = 0.5;

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

    const state = {
        dir: null,
        root: null,
        data: null,
        cards: null,
        rarities: structuredClone(RARITY_DEFAULTS),
        list: [],
        urls: [],
        use3d: false,
        depthRange: null,
        art: null,                        // CardMedia (image, image sequence or video / GIF)
        depth: null,
        foil: null,                         // CardMedia
        normal: null,                       // CardMedia
        show: 'art',
        crop: { zoom: 1, cx: 0.5, cy: 0.5 },
        editing: null,
        editFoil: undefined,
        editFoilName: '',
        editNormal: undefined,
        editNormalName: '',
        editImages: null,
        layers: null,                       // CardLayerKit editor of the card form (front / back layer lists)
        editingCard: null,                  // a saved card open in the edit window (the card form, moved into it)
        draft: null,                        // the New card form's work while the edit window has the form
        cardsView: '*',                     // Cards: '*' all, '' no collection, else a collection folder
        pictureDirty: false,                // changed since it was opened: written again when saving
        layersDirty: false,
        textAlign: {},
        collHidden: new Set(),              // the collection's layers (by file) switched off on this card; 'all': every one
        collPreview: { folder: null, layers: { front: [], back: [] } },
        collLayers: new Map(),              // collection folder -> Promise of its layers (for previews)
        collections: [],
        addons: [],
        config: null,
        coll: null,
    };

    const toast = {
        ok: (title, body) => window.FacadeToast ? FacadeToast.success(title, body) : console.log(title, body),
        err: (title, body) => window.FacadeToast ? FacadeToast.error(title, body) : console.error(title, body),
    };

    const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'card';

    function hexToRgbTriple(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        if (!m) return '142, 142, 147';
        const n = parseInt(m[1], 16);
        return `${n >> 16}, ${(n >> 8) & 255}, ${n & 255}`;
    }

    function rarityColor(rarity) { return (state.rarities[rarity] || RARITY_DEFAULTS.Rare).color; }
    function rarityPrice(rarity) { return (state.rarities[rarity] || RARITY_DEFAULTS.Rare).price; }

    function paintRarity(el, rarity) {
        el.style.setProperty('--cc-rarity', rarityColor(rarity));
        el.style.setProperty('--cc-rarity-rgb', hexToRgbTriple(rarityColor(rarity)));
    }

    function download(blob, filename) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function pageFolderPath() {
        if (location.protocol !== 'file:') return '';
        let p = decodeURIComponent(location.pathname);
        if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
        if (location.host) p = '//' + location.host + p;
        p = p.replace(/\/[^/]*$/, '');
        return /^[A-Za-z]:|^\/\//.test(p) ? p.replace(/\//g, '\\') : p;
    }
    const DATA_FOLDER = 'data', CARDS_FOLDER = 'cards', DATA_SUBFOLDERS = ['cards', 'packs', 'skins'];
    const CONFIG_FILE = 'config.json', PAGE_FILE = 'DaCardDashboard.html';

    function axisLock(dx, dy, shift) {
        if (!shift) return [dx, dy];
        return Math.abs(dx) >= Math.abs(dy) ? [dx, 0] : [0, dy];
    }

    function setRange(input) {
        const min = +input.min, max = +input.max;
        input.style.setProperty('--fx-pct', ((+input.value - min) / (max - min)) * 100 + '%');
    }

    function enhanceSelect(sel) {
        if (window.FacadeSelect) FacadeSelect.enhance(sel, { buttonClass: 'cc-select' });
    }
    function syncSelect(sel) { if (window.FacadeSelect) FacadeSelect.sync(sel); }

    function idb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('dacard-creator', 1);
            req.onupgradeneeded = () => req.result.createObjectStore('kv');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    async function idbGet(key) {
        const db = await idb();
        return new Promise((resolve) => {
            const req = db.transaction('kv').objectStore('kv').get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(undefined);
        });
    }
    async function idbSet(key, value) {
        const db = await idb();
        return new Promise((resolve) => {
            const tx = db.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(value, key);
            tx.oncomplete = resolve;
            tx.onerror = resolve;
        });
    }

    async function getDir(parent, name, create = false) {
        try { return await parent.getDirectoryHandle(name, { create }); } catch { return null; }
    }
    async function getFile(parent, name) {
        try { return await (await parent.getFileHandle(name)).getFile(); } catch { return null; }
    }
    async function writeFile(dir, name, data) {
        const handle = await dir.getFileHandle(name, { create: true });
        const w = await handle.createWritable();
        await w.write(data);
        await w.close();
    }

    async function connectFolder() {
        if (!window.showDirectoryPicker) {
            toast.err('This browser can\'t save into folders', 'Open this page in Chrome or Edge. You can still download cards as a .zip.');
            return;
        }
        let dir;
        try {
            dir = await window.showDirectoryPicker({ id: 'dacard', mode: 'readwrite' });
        } catch (e) {
            if (e.name !== 'AbortError') toast.err('Could not open the folder', e.message);
            return;
        }
        if (await useFolder(dir)) toast.ok('Folder connected', `Cards are saved into ${dir.name}.`);
    }

    async function useFolder(dir) {
        let root = null, data = null;
        const modName = pageFolderPath().split(/[\\/]/).pop();
        const inside = modName && dir.name !== modName ? await getDir(dir, modName) : null;
        if (inside && (await getDir(inside, DATA_FOLDER) || await getFile(inside, PAGE_FILE))) dir = inside;
        if (await getDir(dir, DATA_FOLDER) || await getFile(dir, PAGE_FILE)) {
            root = dir; data = await getDir(dir, DATA_FOLDER, true);
        } else if (await getFile(dir, CONFIG_FILE) || (await CardAddonKit.scan(dir)).length) {
            data = dir;
        } else {
            for (const f of DATA_SUBFOLDERS) if (await getDir(dir, f)) { data = dir; break; }
        }
        if (!data) {
            toast.err('That isn\'t the mod folder', 'Pick the Guro-DaCard folder (the one with DaCardDashboard.html and data/ in it).');
            return false;
        }
        state.dir = dir; state.root = root; state.data = data;
        await idbSet('folder', dir);
        await readConfig();
        updateFolderUi();
        await rescan();
        await warnOldLayout();
        return true;
    }

    async function defaultSkinsDir() {
        const defaults = state.root ? await getDir(state.root, 'defaults') : null;
        return defaults ? getDir(defaults, 'skins') : null;
    }

    async function migrationRoots() {
        return { data: state.data, defaults: await defaultSkinsDir() };
    }

    async function scanAddons() {
        state.addons = state.data ? await CardAddonKit.scan(state.data) : [];
        fillAddonSelects();
        if (window.CCAddons) CCAddons.render();
        packsChanged('addons');
    }

    async function rescan({ migrate = false } = {}) {
        if (migrate) {
            const found = await CardMigrations.pending(await migrationRoots()).catch(() => []);
            if (found.length) {
                const { failed } = await CardMigrations.apply(await migrationRoots(), found).catch((e) => ({ failed: [e.message] }));
                if (failed.length) toast.err('Some updates failed', failed.join('\n'));
            }
        }
        await checkMigrations();
        await scanAddons();
        await scanCollections();
        await scanCards();
        packsChanged('folder');
    }

    const addonName = (folder) => (state.addons.find((a) => a.folder === folder) || { name: folder || CardAddonKit.STARTER }).name;
    const formAddon = () => (state.editingCard ? state.editingCard.addon : $('#f-addon').value);
    const collAddon = () => (state.coll && state.coll.source ? state.coll.source.addon : $('#c-addon').value);
    const addonPath = (folder) => `data/${folder || CardAddonKit.folderFor(CardAddonKit.STARTER)}`;

    function fillAddonSelects() {
        const options = state.addons.length
            ? state.addons.map((a) => `<option value="${escapeHtml(a.folder)}">${escapeHtml(a.name)}</option>`).join('')
            : `<option value="">${escapeHtml(CardAddonKit.STARTER)} (new)</option>`;
        for (const sel of [$('#f-addon'), $('#c-addon'), $('#b-addon')]) {
            const value = sel.value;
            sel.innerHTML = options;
            if ([...sel.options].some((o) => o.value === value)) sel.value = value;
            syncSelect(sel);
        }
        fillCollectionSelects();
    }

    let outdated = [];

    async function checkMigrations() {
        if (!window.CardMigrations) return;
        const notes = await CardMigrations.unseen(state.data).catch(() => []);
        for (const r of notes) toast.ok('Data updated', `${r.title} · ${(r.folders || []).length} on server start`);
        if (notes.length) await CardMigrations.markSeen(state.data).catch(() => {});
        outdated = await CardMigrations.pending(await migrationRoots()).catch(() => []);
        const count = new Set(outdated.flatMap((f) => f.folders.map((x) => x.path))).size;
        const bar = $('#migrate-bar');
        bar.hidden = !count;
        $('#migrate-what').textContent = count ? `${count} to update` : '';
        bar.title = outdated.map((f) => f.migration.title).join('\n');
    }

    async function runMigrations() {
        const button = $('#migrate-run');
        if (button.disabled || !outdated.length) return;
        button.disabled = true;
        try {
            const { records, failed } = await CardMigrations.apply(await migrationRoots(), outdated,
                (done, total) => { button.textContent = `Updating ${done} / ${total}…`; });
            const count = records.reduce((n, r) => n + r.folders.length, 0);
            if (failed.length) toast.err('Some updates failed', failed.join('\n'));
            if (count) toast.ok('Data updated', `${count} updated`);
            await rescan();
        } catch (e) {
            toast.err('Could not update', e.message);
        } finally {
            button.disabled = false;
            button.textContent = 'Update all';
        }
    }

    async function warnOldLayout() {
        const old = [];
        if (state.root)
            for (const name of ['cards', 'collections', 'packs', 'skins']) if (await getDir(state.root, name)) old.push(`${name}/`);
        if (state.root && await getFile(state.root, CONFIG_FILE)) old.push(CONFIG_FILE);
        if (old.length)
            toast.err('Old folder layout', `${old.join(', ')} ${old.length === 1 ? 'is' : 'are'} ignored: cards, packs and skins go into an addon (Add-ons tab), the settings into data/config.json.`);
    }

    async function restoreFolder() {
        const dir = await idbGet('folder').catch(() => null);
        if (!dir || !dir.queryPermission) return;
        const perm = await dir.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
            await useFolder(dir);
            return;
        }
        const btn = $('#folder-connect');
        btn.textContent = `Reconnect "${dir.name}"`;
        const reconnect = async () => {
            document.removeEventListener('pointerdown', reconnect, true);
            btn.onclick = null;
            try {
                if ((await dir.requestPermission({ mode: 'readwrite' })) === 'granted') {
                    await useFolder(dir);
                    return;
                }
            } catch { }
            wireConnect();
        };
        btn.onclick = reconnect;
        document.addEventListener('pointerdown', reconnect, true);
    }

    function wireConnect() {
        const btn = $('#folder-connect');
        btn.textContent = state.data ? 'Change folder…' : 'Connect mod folder…';
        btn.onclick = connectFolder;
    }

    async function readConfig() {
        state.rarities = structuredClone(RARITY_DEFAULTS);
        state.config = null;
        if (!state.data) { renderSettings(); return; }
        const file = await getFile(state.data, CONFIG_FILE);
        if (!file) { renderSettings(); return; }
        try {
            const config = JSON.parse(await file.text());
            state.config = config;
            for (const [name, r] of Object.entries(config.rarities || {})) {
                const key = RARITIES.find((x) => x.toLowerCase() === name.toLowerCase());
                if (!key) continue;
                if (r.price > 0) state.rarities[key].price = r.price;
                if (/^#[0-9a-f]{6}$/i.test(r.color || '')) state.rarities[key].color = r.color;
            }
        } catch (e) {
            toast.err('config.json could not be read', e.message);
        }
        renderSettings();
        packsChanged('config');
    }

    function packsChanged(what) {
        if (window.CCPacks) window.CCPacks.changed(what);
    }

    function updateFolderUi() {
        const pill = $('#folder-pill');
        const on = !!state.data;
        pill.textContent = on ? state.dir.name : 'Not connected';
        pill.className = 'facade-pill fx-sm ' + (on ? 'fx-green' : 'fx-grey');
        $('#folder-note').hidden = on;
        const path = pageFolderPath();
        $('#folder-path-row').hidden = on || !path || !window.showDirectoryPicker;
        $('#folder-path').textContent = path;
        wireConnect();
        $('#save-card').hidden = !on;
        $('#save-zip').classList.toggle('fx-blue', !on);
        $('#save-zip').classList.toggle('fx-on', !on);
        refreshPrices();
        updateFolderHint();
    }

    const THUMB_FILE = 'thumb.png';
    const THUMB_SCALE = 0.5;

    async function scanCards() {
        state.urls.forEach(URL.revokeObjectURL);
        state.urls = [];
        const list = [];
        for (const addon of state.data ? state.addons : []) {
            const cards = await getDir(addon.dir, CARDS_FOLDER);
            if (!cards) continue;
            for await (const [collFolder, cdir] of cards.entries()) {
                if (cdir.kind !== 'directory' || isRarity(collFolder)) continue;
                const collection = isDefault(collFolder) ? null : collFolder;
                for (const rarity of RARITIES) {
                    const rdir = await getDir(cdir, rarity);
                    if (!rdir) continue;
                    for await (const [name, handle] of rdir.entries()) {
                        if (handle.kind !== 'directory') continue;
                        const jsonFile = await getFile(handle, 'card.json');
                        if (!jsonFile) continue;
                        let data = {};
                        try { data = JSON.parse(await jsonFile.text()); } catch { data = { name, _broken: true }; }
                        const firstLayer = data.layers && data.layers.front && data.layers.front[0];
                        const art = await getFile(handle, 'card.png') || (firstLayer && firstLayer.file ? await getFile(handle, `${firstLayer.file}.png`) : null);
                        const thumb = await getFile(handle, THUMB_FILE);
                        const hasDepth = !!(await getFile(handle, 'card.height.png'));
                        const hasFoilMask = !!(await getFile(handle, 'card.foil.png'));
                        const hasNormal = !!(await getFile(handle, 'card.normal.png'));
                        const key = collection ? `${collection}/${name}` : name;
                        list.push({ key, collection, rarity, folder: name, dir: handle, rdir, cards, addon: addon.folder, data, art, thumb, hasDepth, hasFoilMask, hasNormal });
                    }
                }
            }
        }
        list.sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity) || (a.data.name || a.folder).localeCompare(b.data.name || b.folder)
            || collName(a.collection).localeCompare(collName(b.collection)));
        state.list = list;
        renderCardsSide();
        renderCards();
        const count = $('#cards-count');
        count.hidden = !state.data;
        count.textContent = list.length;
        updateFolderHint();
        packsChanged('cards');
    }

    function cardType(c) { return (c.data.type || (c.hasDepth ? '3d' : '2d')).toLowerCase(); }

    function renderCards() {
        const grid = $('#cards-grid');
        const q = $('#cards-search').value.trim().toLowerCase();
        const rarity = $('#cards-rarity').value;
        const view = state.cardsView;
        const shown = state.list.filter((c) =>
            (view === '*' || (view === '' ? !c.collection : view === '?' ? isOrphan(c) : sameName(c.collection, view))) &&
            (!rarity || c.rarity === rarity) &&
            (!q || (c.data.name || '').toLowerCase().includes(q) || collName(c.collection).toLowerCase().includes(q) || c.folder.includes(q)));
        grid.innerHTML = '';
        for (const c of shown) {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'card-tile';
            paintRarity(tile, c.rarity);
            let src = '';
            if (c.thumb || c.art) { src = URL.createObjectURL(c.thumb || c.art); state.urls.push(src); }
            tile.innerHTML = `
                <img alt="" ${src ? `src="${src}"` : ''} loading="lazy">
                <span class="tile-name">${escapeHtml(c.data.name || c.folder)}</span>
                <span class="tile-meta">
                    <span class="facade-pill fx-sm rarity-pill">${c.rarity}</span>
                    ${cardType(c) === '3d' ? '<span class="facade-chip fx-purple">3D layer</span>' : ''}
                    ${c.data.animation ? '<span class="facade-chip fx-amber">Animated</span>' : ''}
                </span>
                <span class="tile-coll">${escapeHtml(collName(c.collection))}${state.addons.length > 1 ? ` · ${escapeHtml(addonName(c.addon))}` : ''}</span>`;
            tile.addEventListener('click', () => openEdit(c));
            grid.appendChild(tile);
        }
        const empty = $('#cards-empty');
        empty.hidden = shown.length > 0;
        empty.textContent = !state.data ? 'Connect the mod folder to see your cards.'
            : state.list.length ? 'No card matches.' : 'No cards yet. Make one under New card.';
    }

    // Cards' left column: All cards, every collection (its binder), No collection
    function renderCardsSide() {
        const side = $('#cards-side');
        side.innerHTML = '';
        const entries = [{ key: '*', name: 'All cards', count: state.list.length }];
        for (const coll of state.collections)
            entries.push({ key: coll.folder, name: coll.data.name, count: state.list.filter((c) => isMember(c, coll)).length, coll });
        const loose = state.list.filter((c) => !c.collection).length;
        if (loose) entries.push({ key: '', name: 'No collection', count: loose });
        const orphans = state.list.filter(isOrphan).length;
        if (orphans) entries.push({ key: '?', name: 'Missing collection', count: orphans });
        if (!entries.some((e) => e.key === state.cardsView)) state.cardsView = '*';
        closeConfirm();
        for (const e of entries) {
            const item = document.createElement('div');
            item.tabIndex = 0;
            item.setAttribute('role', 'button');
            item.className = 'cards-side-item' + (e.key === state.cardsView ? ' is-on' : '');
            const thumb = document.createElement(e.coll ? 'canvas' : 'span');
            thumb.className = 'cards-side-thumb' + (e.coll ? '' : ' is-icon');
            if (e.coll) drawBinder(thumb, e.coll.stickers);
            else if (e.key === '*') thumb.innerHTML = CardAddonKit.LOGO_SVG;
            else thumb.textContent = '○';
            item.appendChild(thumb);
            item.insertAdjacentHTML('beforeend', `<span class="cards-side-name">${escapeHtml(e.name)}</span><span class="facade-chip fx-grey cards-side-count">${e.count}</span>`);
            if (e.coll) {
                const actions = document.createElement('span');
                actions.className = 'cards-side-actions';
                actions.innerHTML = '<button type="button" class="facade-iconbtn" data-act="edit" title="Edit collection" aria-label="Edit collection">✎</button><button type="button" class="facade-iconbtn cards-side-delete" data-act="delete" title="Delete collection" aria-label="Delete collection">×</button>';
                actions.querySelector('[data-act="edit"]').addEventListener('click', (ev) => { ev.stopPropagation(); openCollection(e.coll); });
                actions.querySelector('[data-act="delete"]').addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    const n = state.list.filter((c) => isMember(c, e.coll)).length;
                    confirmMenu(ev.currentTarget, `Delete "${e.coll.data.name}"?`, n ? `${n} card${n === 1 ? '' : 's'} move to No collection.` : 'It has no cards.', 'Delete', () => deleteCollection(e.coll));
                });
                item.appendChild(actions);
            }
            const choose = () => {
                state.cardsView = e.key;
                for (const el of side.children) el.classList.toggle('is-on', el === item);
                renderCards();
            };
            item.addEventListener('click', choose);
            item.addEventListener('keydown', (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === item) { ev.preventDefault(); choose(); } });
            side.appendChild(item);
        }
        if (state.data) {
            const add = document.createElement('button');
            add.type = 'button';
            add.className = 'facade-btn fx-sm cards-side-new';
            add.textContent = '+ New collection';
            add.addEventListener('click', () => openCollection(null));
            side.appendChild(add);
        }
    }

    let confirmEl = null;
    function closeConfirm() {
        if (!confirmEl) return;
        confirmEl.remove();
        confirmEl = null;
    }

    function confirmMenu(anchor, title, note, action, run) {
        closeConfirm();
        const menu = document.createElement('div');
        menu.className = 'confirm-menu';
        menu.setAttribute('role', 'dialog');
        menu.innerHTML = `<b></b><small></small><div class="confirm-actions"><button type="button" class="facade-btn fx-sm" data-act="no">Cancel</button><button type="button" class="facade-btn fx-sm fx-red fx-on" data-act="yes"></button></div>`;
        menu.querySelector('b').textContent = title;
        menu.querySelector('small').textContent = note;
        menu.querySelector('[data-act="yes"]').textContent = action;
        menu.querySelector('[data-act="no"]').addEventListener('click', closeConfirm);
        menu.querySelector('[data-act="yes"]').addEventListener('click', () => { closeConfirm(); run(); });
        menu.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        document.body.appendChild(menu);
        const r = anchor.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - menu.offsetWidth - 8))}px`;
        menu.style.top = `${r.bottom + window.scrollY + 6}px`;
        confirmEl = menu;
        menu.querySelector('[data-act="no"]').focus();
    }

    const isRarity = (folder) => RARITIES.some((r) => sameName(r, folder));
    const isDefault = (folder) => !folder || sameName(folder, DEFAULT_COLLECTION);
    const sameColl = (a, b) => (isDefault(a) && isDefault(b)) || sameName(a, b);
    function collName(folder) {
        if (isDefault(folder)) return 'No collection';
        const coll = state.collections.find((c) => sameName(c.folder, folder));
        return coll ? coll.data.name : 'Missing collection';
    }

    function findCard(collection, folder, except = null) {
        return state.list.find((c) => c !== except && sameColl(c.collection, collection) && sameName(c.folder, folder));
    }

    const has3d = () => state.use3d;

    const DEPTH_FLOATS = { near: '_nearDepth', far: '_farDepth' };
    const DEPTH_GAP = 0.02;
    const round3 = (v) => Math.round(v * 1000) / 1000;

    function depthDefaults() {
        const types = (state.config && state.config.cardTypes) || {};
        const key = Object.keys(types).find((k) => sameName(k, '3d'));
        const floats = (key && types[key] && types[key].floats) || {};
        const material = window.CardView ? CardView.MATERIAL : { nearDepth: 0, farDepth: 1 };
        return {
            near: Number.isFinite(floats[DEPTH_FLOATS.near]) ? floats[DEPTH_FLOATS.near] : material.nearDepth,
            far: Number.isFinite(floats[DEPTH_FLOATS.far]) ? floats[DEPTH_FLOATS.far] : material.farDepth,
        };
    }

    const depthRange = () => state.depthRange || depthDefaults();

    function depthFromFloats(floats) {
        const f = floats || {}, near = f[DEPTH_FLOATS.near], far = f[DEPTH_FLOATS.far];
        if (!Number.isFinite(near) && !Number.isFinite(far)) return null;
        const d = depthDefaults();
        return { near: Number.isFinite(near) ? near : d.near, far: Number.isFinite(far) ? far : d.far };
    }

    function depthFloats(existing, is3d) {
        const floats = { ...(existing || {}) };
        delete floats[DEPTH_FLOATS.near];
        delete floats[DEPTH_FLOATS.far];
        if (is3d && state.depthRange) {
            floats[DEPTH_FLOATS.near] = round3(state.depthRange.near);
            floats[DEPTH_FLOATS.far] = round3(state.depthRange.far);
        }
        return Object.keys(floats).length ? floats : null;
    }

    function showDepthRange() {
        const { near, far } = depthRange();
        const box = $('#depth-range');
        box.style.setProperty('--near', near);
        box.style.setProperty('--far', far);
        $('#depth-near').value = near;
        $('#depth-far').value = far;
        $('#depth-near').style.zIndex = near > 0.5 ? 2 : 1;
        $('#depth-far').style.zIndex = near > 0.5 ? 1 : 2;
        $('#depth-note').textContent = `White ${near.toFixed(2)} · black ${far.toFixed(2)} of the box's depth` + (state.depthRange ? '' : ' (default)');
        $('#depth-reset').hidden = !state.depthRange;
    }

    function applyDepthMaterial() {
        const { near, far } = depthRange();
        if (cardView) cardView.setMaterial({ nearDepth: near, farDepth: far });
    }

    function wireDepthRange() {
        const nearInput = $('#depth-near'), farInput = $('#depth-far');
        const moved = (which) => {
            let near = +nearInput.value, far = +farInput.value;
            if (which === 'near') near = Math.max(0, Math.min(near, far - DEPTH_GAP));
            else far = Math.min(1, Math.max(far, near + DEPTH_GAP));
            state.depthRange = { near, far };
            showDepthRange();
            applyDepthMaterial();
        };
        nearInput.addEventListener('input', () => moved('near'));
        farInput.addEventListener('input', () => moved('far'));
        $('#depth-reset').addEventListener('click', () => {
            state.depthRange = null;
            showDepthRange();
            applyDepthMaterial();
        });
    }

    function set3d(on, changed = false) {
        state.use3d = !!on;
        if (changed) state.pictureDirty = state.layersDirty = true;
        CardLayerKit.smoothResize($('#picture-3d'), updateFormVisibility);
        updatePlayback();
    }

    function updateFormVisibility() {
        const is3d = has3d();
        $('#f-3d').checked = is3d;
        $('#picture-3d').classList.toggle('is-on', is3d);
        $('#picture-3d-body').hidden = !is3d;
        $('#foil-clear').hidden = !state.foil;
        $('#normal-clear').hidden = !state.normal;
        showDepthRange();
        const depthView = is3d && !!state.art && !!state.depth;
        if (!depthView) state.show = 'art';
        for (const b of $$('#crop-toggle button')) b.classList.toggle('fx-on', b.dataset.show === state.show);
        $('#crop-toggle').hidden = !depthView || preview3d();
        drawCrop();
    }

    const roubles = (n) => `${Math.round(n).toLocaleString('en-US')} ₽`;
    const priceNote = (rarity) => `${roubles(rarityPrice(rarity))}, foil ${roubles(rarityPrice(rarity) * foilMultiplier(state.config))}`;

    function refreshPrices() {
        const rarity = $('#f-rarity').value;
        $('#f-price').textContent = priceNote(rarity);
        paintRarity($('#crop'), rarity);
        paintRarity($('#card-3d'), rarity);
        refresh3d();
    }

    const newFolder = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

    function updateFolderHint() {
        const hint = $('#f-folder');
        const editing = state.editingCard;
        const coll = $('#f-collection').value;
        const where = `${escapeHtml(addonPath(formAddon()))}/cards/${escapeHtml(coll || DEFAULT_COLLECTION)}/${$('#f-rarity').value}/`;
        if (!editing) { hint.innerHTML = `Folder: <code>${where}&lt;new id&gt;/</code>`; return; }
        const other = findCard(coll, editing.folder, editing);
        hint.innerHTML = `Folder: <code>${where}${escapeHtml(editing.folder)}/</code>` +
            (other ? ` · <b style="color:rgb(var(--facade-red))">already used</b>` : '');
    }

    function readForm() {
        return {
            name: $('#f-name').value.trim(),
            shortName: $('#f-short').value.trim(),
            description: $('#f-desc').value.trim(),
            rarity: $('#f-rarity').value,
            collection: $('#f-collection').value,
            hideCollectionLayers: hiddenCollFiles(),
            textAlign: Object.fromEntries(Object.entries(state.textAlign).filter(([, v]) => v)),
        };
    }

    // managed: "animation" / "layers" as they are now (a key with no value removes it); keys not in it stay as they were
    function cardJson(f, type, existing = {}, managed = {}) {
        const data = Object.assign({}, existing, { name: f.name, type });
        for (const [key, value] of [['shortName', f.shortName], ['description', f.description]]) {
            if (value) data[key] = value; else delete data[key];
        }
        if (f.textAlign && Object.keys(f.textAlign).length) data.textAlign = f.textAlign; else delete data.textAlign;
        if (f.hideCollectionLayers && f.hideCollectionLayers.length) data.hideCollectionLayers = f.hideCollectionLayers; else delete data.hideCollectionLayers;
        delete data.collectionLayers;
        for (const key of ['animation', 'layers', 'floats']) {
            if (!(key in managed)) continue;
            if (managed[key]) data[key] = managed[key]; else delete data[key];
        }
        for (const key of ['price', 'buyPrice', 'sellPrice', 'collection', 'foil']) delete data[key];
        const ordered = { name: data.name, type: data.type };
        for (const [k, v] of Object.entries(data)) if (!(k in ordered)) ordered[k] = v;
        return JSON.stringify(ordered, null, 2) + '\n';
    }

    function loadImage(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Not an image this browser can read')); };
            img.src = url;
        });
    }

    async function setPicture(kind, file) {
        if (!file) return;
        if (kind === 'sticker' && state.coll) await addSticker(file, true);
    }

    const cropRect = (img, crop = state.crop) => CardLayerKit.cropRect(img, crop);

    function renderCard(img, canvas, crop = state.crop) {
        CardLayerKit.drawCropped(img, crop, canvas);
    }

    // What the preview shows now: the current frame of an animated map
    let playT = 0;
    const frameOf = (media) => (media ? media.frameAt(playT) : null);
    const depthShown = () => state.show === 'depth' && !!state.depth && !showingBack();
    const showingBack = () => !!state.layers && state.layers.side === 'back';

    // What the preview's drag moves: the selected layer, else a 3D card's picture (and its depth map)
    function cropTarget() {
        const layer = state.layers && state.layers.selected;
        if (layer && CardLayerKit.hasContent(layer)) return { layer };
        return has3d() && state.art && !showingBack() ? { crop: state.crop, img: frameOf(depthShown() ? state.depth : state.art), layer: null } : null;
    }

    function cropMoved(target) {
        if (!target.layer) { state.pictureDirty = true; return; }
        state.layersDirty = true;
        state.layers.refreshTransform(target.layer);
    }

    // A 3D card's picture, under its layers in the 2D view (in game: behind the window)
    function pictureParts() {
        if (!has3d() || !state.art) return [];
        return [{
            art: cardCanvas(frameOf(state.art)),
            foil: state.foil ? maskOf(frameOf(state.foil)) : null,
            normal: state.normal ? cardCanvas(frameOf(state.normal)) : null,
            canBeFoil: true, frame: false,
        }];
    }

    // The card's layers, the collection's over them, the card's layers marked over the collection
    const everyCopy = (layers, selected = null, rare = false) => (rare ? layers : layers.filter((l) => l.chance >= 100 || l === selected));

    function stackParts(side) {
        const coll = state.collPreview.layers;
        return CardLayerKit.parts(everyCopy(CardLayerKit.ordered(state.layers[side], coll[side]), state.layers.selected, $('#f-rare').checked), playT, formCtx());
    }

    // The chosen collection's layers, for the previews
    const collFile = (layer) => layer.file;
    const hiddenKey = () => (state.collHidden === 'all' ? '*' : [...state.collHidden].sort().join('|'));
    const withoutHidden = (layers, hidden) => ({
        front: layers.front.filter((l) => !hidden.has(collFile(l))),
        back: layers.back.filter((l) => !hidden.has(collFile(l))),
    });

    async function ensureCollPreview() {
        const folder = $('#f-collection').value || null;
        if (state.collPreview.folder === folder && state.collPreview.hiddenKey === hiddenKey() && state.collPreview.ready) { renderCardAlign(); return; }
        const coll = folder ? state.collections.find((c) => sameName(c.folder, folder)) : null;
        const all = await collectionLayers(coll);
        if (($('#f-collection').value || null) !== folder) return;
        if (state.collHidden === 'all') state.collHidden = new Set([...all.front, ...all.back].map(collFile));
        const hidden = state.collHidden;
        state.collPreview = { folder, hiddenKey: hiddenKey(), all, layers: withoutHidden(all, hidden), ready: true };
        state.layers.setCollection(folder ? {
            name: collName(folder), front: all.front, back: all.back,
            isOn: (l) => !hidden.has(collFile(l)), toggle: setCollLayers,
        } : null);
        renderCardAlign();
        updatePlayback();
    }

    function setCollLayers(layers, on) {
        if (state.collHidden === 'all') return;
        for (const l of layers) state.collHidden[on ? 'delete' : 'add'](collFile(l));
        ensureCollPreview().then(() => drawCrop());
    }

    function hiddenCollFiles() {
        const all = state.collPreview.all;
        if (!all || state.collHidden === 'all') return [];
        return [...all.front, ...all.back].map(collFile).filter((f) => state.collHidden.has(f));
    }

    let cropOverlay = null, collOverlay = null;

    function drawCrop(also3d = true) {
        if (also3d) refresh3d();
        if (cropOverlay) cropOverlay.update(showingBack() ? 'back' : 'front');
        const canvas = $('#crop');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, CARD_W, CARD_H);
        const back = showingBack();
        const holo = $('#f-holo').checked;
        const parts = back ? stackParts('back') : [...pictureParts(), ...stackParts('front')];
        const stack = !depthShown() && parts.length ? CardLayerKit.composite(parts, { foil: holo, normal: false }) : null;
        canvas.classList.toggle('is-empty', !stack && !depthShown());
        if (back && !stack) {
            if (defaultBackImg) coverFit(canvas, defaultBackImg);
            else defaultBackImage().then((img) => { if (img) drawCrop(false); });
        }
        if (!stack && !depthShown() && !(back && defaultBackImg)) {
            ctx.fillStyle = 'rgba(255,255,255,.35)';
            ctx.font = '600 26px system-ui, sans-serif';
            ctx.textAlign = 'center';
            if (back) noBack(ctx); else ctx.fillText('No layers yet', CARD_W / 2, CARD_H / 2);
            return;
        }
        if (depthShown()) renderCard(frameOf(state.depth), canvas);
        else {
            ctx.drawImage(stack.color, 0, 0);
            if (holo) drawFoilTint(ctx, stack.foil);
        }
        // The selected layer's outline
        drawOutline(ctx, state.layers && state.layers.selected, back ? 'back' : 'front');
        if (back) return;
        const [x0, y0, x1, y1] = WINDOW_RECT;
        ctx.save();
        ctx.setLineDash([10, 8]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,.7)';
        ctx.strokeRect(x0 * CARD_W, y0 * CARD_H, (x1 - x0) * CARD_W, (y1 - y0) * CARD_H);
        ctx.restore();
    }

    // No back layers and no data/cards/back.png: the back is plain black in game
    function noBack(ctx) {
        ctx.fillStyle = '#050506';
        ctx.fillRect(0, 0, CARD_W, CARD_H);
        ctx.fillStyle = 'rgba(255,255,255,.4)';
        ctx.font = '600 24px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No back layers', CARD_W / 2, CARD_H / 2 - 14);
        ctx.font = '400 19px system-ui, sans-serif';
        ctx.fillText('(and no data/cards/back.png): black in game', CARD_W / 2, CARD_H / 2 + 16);
    }

    // A dashed outline around the selected layer, if it is on the side shown
    function drawOutline(ctx, layer, side) {
        const corners = layer && layer.side === side ? CardLayerKit.outline(layer) : null;
        if (!corners) return;
        ctx.save();
        ctx.setLineDash([7, 5]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgb(255, 64, 64)';
        ctx.beginPath();
        corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
    }

    // Drag / double-click on a preview canvas move a layer / make it fill the card (layerOf() says which). Scrolling
    // over a preview scrolls the page: sizes and turns are on the layer's sliders.
    const posOf = (layer) => (CardLayerKit.isText(layer) ? layer.text : layer.transform);

    function pickLayer(e, canvas, editor, side, t) {
        if (!editor) return;
        const r = canvas.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * CARD_W, y = ((e.clientY - r.top) / r.height) * CARD_H;
        const rare = editor === state.layers ? $('#f-rare').checked : $('#coll-rare').checked;
        const hit = CardLayerKit.hitTest(everyCopy(CardLayerKit.ordered(editor[side]), editor.selected, rare), x, y, t);
        if (hit !== editor.selected) editor.select(hit, { reveal: true });
    }

    function wireLayerDrag(canvas, layerOf, moved, pick) {
        const k = () => canvas.getBoundingClientRect().width / CARD_W || PREVIEW_SCALE;
        let drag = null;
        canvas.addEventListener('pointerdown', (e) => {
            if (pick) pick(e);
            const layer = layerOf();
            if (!layer || !CardLayerKit.hasContent(layer)) return;
            drag = { x0: e.clientX, y0: e.clientY, layer, x: posOf(layer).x, y: posOf(layer).y };
            canvas.setPointerCapture(e.pointerId);
            canvas.classList.add('is-dragging');
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const [dx, dy] = axisLock(e.clientX - drag.x0, e.clientY - drag.y0, e.shiftKey);
            posOf(drag.layer).x = drag.x + dx / k() / CARD_W;
            posOf(drag.layer).y = drag.y + dy / k() / CARD_H;
            moved(drag.layer);
        });
        const end = () => { drag = null; canvas.classList.remove('is-dragging'); };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        canvas.addEventListener('dblclick', () => {
            const layer = layerOf();
            if (!layer || !layer.maps.art || CardLayerKit.isText(layer)) return;
            Object.assign(layer.transform, CardLayerKit.IDENTITY, { scale: CardLayerKit.fillScale(layer) });
            moved(layer);
        });
    }

    function wireCrop() {
        const canvas = $('#crop');
        cropOverlay = layerOverlay(canvas, () => state.layers && state.layers.selected, (layer) => {
            state.layersDirty = true;
            state.layers.refreshTransform(layer);
            drawCrop();
        });
        const viewScale = () => canvas.getBoundingClientRect().width / CARD_W || PREVIEW_SCALE;
        let drag = null;
        canvas.addEventListener('pointerdown', (e) => {
            if (!depthShown()) pickLayer(e, canvas, state.layers, showingBack() ? 'back' : 'front', playT);
            const target = cropTarget();
            if (!target) return;
            const t = target.layer && posOf(target.layer);
            drag = { x0: e.clientX, y0: e.clientY, target, from: t ? { x: t.x, y: t.y } : { cx: target.crop.cx, cy: target.crop.cy } };
            canvas.setPointerCapture(e.pointerId);
            canvas.classList.add('is-dragging');
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const target = drag.target, k = viewScale();
            const [dx, dy] = axisLock(e.clientX - drag.x0, e.clientY - drag.y0, e.shiftKey);
            if (target.layer) {
                posOf(target.layer).x = drag.from.x + dx / k / CARD_W;
                posOf(target.layer).y = drag.from.y + dy / k / CARD_H;
            } else {
                const img = frameOf(depthShown() ? state.depth : state.art);
                const { w, h } = CardMedia.size(img);
                const scale = cropRect(img, target.crop).scale;
                target.crop.cx = drag.from.cx - (dx / k / scale) / w;
                target.crop.cy = drag.from.cy - (dy / k / scale) / h;
            }
            cropMoved(target);
            drawCrop();
        });
        const end = () => { drag = null; canvas.classList.remove('is-dragging'); };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        canvas.addEventListener('dblclick', () => {
            const target = cropTarget();
            if (!target || !target.layer) { resetCrop(); return; }
            if (CardLayerKit.isText(target.layer)) return;
            Object.assign(target.layer.transform, CardLayerKit.IDENTITY, { scale: CardLayerKit.fillScale(target.layer) });
            cropMoved(target);
            drawCrop();
        });

        const zoom = $('#crop-zoom');
        zoom.addEventListener('input', () => setZoom(+zoom.value));
        setRange(zoom);
        $('#crop-reset').addEventListener('click', resetCrop);

        for (const btn of $$('#crop-toggle button')) {
            btn.addEventListener('click', () => {
                state.show = btn.dataset.show;
                for (const b of $$('#crop-toggle button')) b.classList.toggle('fx-on', b === btn);
                drawCrop();
            });
        }
    }

    function setZoom(z) {
        state.crop.zoom = Math.min(6, Math.max(1, z));
        state.pictureDirty = true;
        syncZoom();
        drawCrop();
    }

    function syncZoom() {
        const input = $('#crop-zoom');
        input.value = state.crop.zoom;
        setRange(input);
    }

    function resetCrop() {
        state.crop = { zoom: 1, cx: 0.5, cy: 0.5 };
        setZoom(1);
    }

    function wireDrop(zone, input, kind) {
        zone.addEventListener('click', () => input.click());
        zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
        input.addEventListener('change', () => { setPicture(kind, input.files[0]); input.value = ''; });
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('is-over');
            setPicture(kind, e.dataTransfer.files[0]);
        });
    }

    function cardCanvas(img) {
        const canvas = document.createElement('canvas');
        canvas.width = CARD_W; canvas.height = CARD_H;
        renderCard(img, canvas);
        return canvas;
    }

    const pngBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const canvasBlob = (img) => pngBlob(cardCanvas(img));

    function foilMaskCanvas(draw, preview = false) {
        const canvas = document.createElement('canvas');
        canvas.width = CARD_W; canvas.height = CARD_H;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        draw(ctx);
        const image = ctx.getImageData(0, 0, CARD_W, CARD_H);
        const px = image.data;
        let transparent = false;
        for (let i = 3; i < px.length; i += 4) if (px[i] < 250) { transparent = true; break; }
        for (let i = 0; i < px.length; i += 4) {
            const v = transparent ? px[i + 3] : Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
            if (preview) { px[i] = px[i + 1] = px[i + 2] = 255; px[i + 3] = v; }
            else { px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255; }
        }
        ctx.putImageData(image, 0, 0);
        return canvas;
    }

    const maskOf = (img, preview = false) => foilMaskCanvas((ctx) => renderCard(img, ctx.canvas), preview);

    // foil: the stack's foil (R) as a mask for the rainbow tint
    function drawFoilTint(ctx, foil) {
        const tint = document.createElement('canvas');
        tint.width = CARD_W; tint.height = CARD_H;
        const t = tint.getContext('2d');
        const g = t.createLinearGradient(0, 0, CARD_W, CARD_H);
        const hues = ['#ff4d6d', '#ffd24d', '#5dff8a', '#4dd2ff', '#b44dff', '#ff4d6d'];
        hues.forEach((c, i) => g.addColorStop(i / (hues.length - 1), c));
        t.fillStyle = g;
        t.fillRect(0, 0, CARD_W, CARD_H);
        const mask = document.createElement('canvas');
        mask.width = CARD_W; mask.height = CARD_H;
        const mg = mask.getContext('2d');
        const src = foil.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, CARD_W, CARD_H);
        const out = mg.createImageData(CARD_W, CARD_H);
        for (let i = 0; i < out.data.length; i += 4) { out.data[i] = out.data[i + 1] = out.data[i + 2] = 255; out.data[i + 3] = src.data[i]; }
        mg.putImageData(out, 0, 0);
        t.globalCompositeOperation = 'destination-in';
        t.drawImage(mask, 0, 0);
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.drawImage(tint, 0, 0);
        ctx.restore();
    }

    const MEDIA_SLOTS = ['art', 'depth', 'foil', 'normal'];
    const MEDIA_MAP = { art: 'art', depth: 'height', foil: 'foil', normal: 'normal' };
    const MEDIA_EMPTY = {
        art: 'PNG, JPG, WebP · MP4, WebM, GIF',
        depth: 'white = near, black = far',
        foil: 'No mask: all foil',
        normal: 'No normal map',
    };
    const MEDIA_WHAT = { art: 'picture', depth: 'depth map', foil: 'foil mask', normal: 'normal map' };
    const KIND_LABEL = { image: 'Image', sequence: 'Image sequence', video: 'Video', gif: 'GIF' };
    const PICK = {
        image: { accept: 'image/png,image/jpeg,image/webp,image/bmp,image/avif', multiple: false },
        sequence: { accept: 'image/*', multiple: true },
        video: { accept: 'video/*,image/gif,.gif', multiple: false },
    };

    async function setMedia(slot, kind, files) {
        if (!files || !files.length) return;
        let media;
        try {
            media = await CardMedia.open(kind, files);
        } catch (e) {
            toast.err(`Could not open ${files[0].name}`, e.message);
            return;
        }
        const old = state[slot];
        state[slot] = media;
        if (old) old.dispose();
        if (slot === 'art') {
            state.crop = { zoom: 1, cx: 0.5, cy: 0.5 };
            $('#crop-zoom').value = 1; setRange($('#crop-zoom'));
            if (!$('#f-name').value.trim()) {
                let name = files[0].name.replace(/\.[^.]+$/, '');
                if (media.kind === 'sequence') name = name.replace(/[_\-\s.]*\d+$/, '');
                $('#f-name').value = name.replace(/[_-]+/g, ' ').trim();
                updateFolderHint();
            }
        } else if (state.art && Math.abs(media.width / media.height - state.art.width / state.art.height) > 0.01) {
            toast.err('Different shape', `The ${MEDIA_WHAT[slot]} should have the same width:height as the picture, or they won't line up.`);
        }
        if (slot === 'foil') $('#f-holo').checked = true;
        state.pictureDirty = true;
        if (state.layers) state.layers.select(null);
        renderMedia(slot);
        updateFormVisibility();
        updatePlayback();
    }

    function clearMedia(slot) {
        if (state[slot]) state[slot].dispose();
        state[slot] = null;
        state.pictureDirty = true;
        renderMedia(slot);
        updateFormVisibility();
    }

    function renderMedia(slot) {
        const media = state[slot];
        const box = $(`#media-${slot}`);
        $(`#${slot}-name`).textContent = media
            ? `${KIND_LABEL[media.isGif ? 'gif' : media.kind]} · ${media.name} · ${media.width} × ${media.height}` : MEDIA_EMPTY[slot];
        $(`#drop-${slot}`).classList.toggle('has-file', !!media);
        if (media && pickers[slot]) pickers[slot].kind = media.kind;
        const anim = $('.media-anim', box);
        anim.hidden = !media || !media.animated;
        if (anim.hidden) return;
        $('.media-fps', anim).value = media.fps;
        const split = $('.media-split', anim);
        split.hidden = media.kind !== 'video';
        split.disabled = media.split;
        split.textContent = media.split ? 'Frames split' : 'Split frames';
        $('.media-info', anim).textContent = media.info();
    }

    // Video / GIF → frames (saving splits whatever isn't yet)
    async function splitMedia(slot) {
        const media = state[slot];
        if (!media || media.kind !== 'video' || media.split) return true;
        const box = $(`#media-${slot}`);
        const button = $('.media-split', box), info = $('.media-info', box);
        button.disabled = true;
        try {
            await media.splitFrames((done, total) => { info.textContent = `Splitting: frame ${done} of ${total}…`; });
            state.pictureDirty = true;
            return true;
        } catch (e) {
            toast.err(`Could not split the ${MEDIA_WHAT[slot]}`, e.message);
            return false;
        } finally {
            if (state[slot] === media) renderMedia(slot);
            drawCrop();
        }
    }

    const pickers = {};
    function wireMedia(slot) {
        const box = $(`#media-${slot}`);
        const zone = $(`#drop-${slot}`), input = $('.media-file', box);
        const pick = (kind) => {
            input.accept = PICK[kind].accept;
            input.multiple = PICK[kind].multiple;
            input.dataset.kind = kind;
            input.click();
        };
        pickers[slot] = CardMedia.picker($('.media-pick', box), pick);
        zone.addEventListener('click', (e) => { if (!e.target.closest('button')) pick(pickers[slot].kind); });
        input.addEventListener('change', () => { setMedia(slot, input.dataset.kind, [...input.files]); input.value = ''; });
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('is-over');
            const files = [...e.dataTransfer.files];
            setMedia(slot, CardMedia.kindOf(files), files);
        });
        const fps = $('.media-fps', box);
        fps.addEventListener('change', async () => {
            const media = state[slot];
            if (!media) return;
            const wasSplit = media.split;
            media.setFps(fps.value);
            // A GIF's frames are decoded already: splitting it again is instant
            if (wasSplit && media.isGif) await media.splitFrames();
            state.pictureDirty = true;
            renderMedia(slot);
            drawCrop();
        });
        $('.media-split', box).addEventListener('click', () => splitMedia(slot));
        box.addEventListener('pointerdown', () => { if (state.layers && state.layers.selected) state.layers.select(null); });
    }

    // Plays the animated maps in the preview while the New card form is showing
    let playing = false, playStart = 0, lastKeys = '';
    const animatedMedia = () => [
        ...MEDIA_SLOTS.map((s) => state[s]),
        ...(state.layers ? CardLayerKit.mediaOf([...state.layers.front, ...state.layers.back]) : []),
        ...CardLayerKit.mediaOf([...state.collPreview.layers.front, ...state.collPreview.layers.back]),
    ].filter((m) => m && m.animated);

    function updatePlayback() {
        if (playing || !animatedMedia().length) return;
        playing = true;
        playStart = performance.now();
        requestAnimationFrame(playTick);
    }

    function playTick(now) {
        const media = animatedMedia();
        if (!media.length) { playing = false; return; }
        requestAnimationFrame(playTick);
        if ($('#card-form').hidden || !$('#card-form').getClientRects().length || document.hidden) {
            media.forEach((m) => m.pause());
            return;
        }
        playT = Math.max(0, (now - playStart) / 1000);
        const keys = media.map((m) => m.frameKey(playT)).join();
        if (keys === lastKeys) return;
        lastKeys = keys;
        if (preview3d()) update3dFrames(); else drawCrop(false);
    }

    let cardView = null;
    let refreshQueued = false;
    // The back of cards with no back layers: the mod's data/cards/back.png, as in game (else the Card Creator's own)
    let defaultBack = null, defaultBackImg = null;
    function defaultBackImage() {
        return defaultBack ||= (async () => {
            const addon = state.addons.find((a) => a.folder === (state.coll ? collAddon() : formAddon()));
            const cards = addon && await getDir(addon.dir, CARDS_FOLDER);
            const file = cards && await getFile(cards, 'back.png');
            const img = (file && await blobImage(file)) || await loadUrl(DEFAULT_BACK).catch(() => null);
            defaultBackImg = img;
            return img;
        })();
    }
    const blobImages = new WeakMap();

    const blobImage = (blob) => {
        if (!blob) return Promise.resolve(null);
        if (!blobImages.has(blob)) blobImages.set(blob, loadImage(blob).catch(() => null));
        return blobImages.get(blob);
    };
    const preview3d = () => !$('#card-3d').hidden;

    function showPreview(view) {
        if (view === '3d' && !cardView) {
            try {
                cardView = window.CardView.create($('#card-3d'));
            } catch (e) {
                toast.err('No 3D preview', e.message);
                view = 'place';
            }
        }
        const want3d = view === '3d';
        for (const b of $$('#preview-view button')) b.classList.toggle('fx-on', b.dataset.view === view);
        CardLayerKit.smoothResize($('#card-3d').closest('.crop-wrap'), () => {
            $('#crop').hidden = want3d;
            $('#card-3d').hidden = !want3d;
        });
        paintRarity($('#card-3d'), $('#f-rarity').value);
        updateFormVisibility();
        if (cardView) cardView.resize();
    }

    function refresh3d() {
        if (!cardView || !preview3d() || refreshQueued) return;
        refreshQueued = true;
        requestAnimationFrame(async () => {
            refreshQueued = false;
            await ensureCollPreview();
            const is3d = has3d();
            const backParts = stackParts('back');
            applyDepthMaterial();
            cardView.set(await viewInput({
                is3d,
                picture: is3d && state.art ? {
                    art: cardCanvas(frameOf(state.art)),
                    depth: state.depth ? cardCanvas(frameOf(state.depth)) : null,
                    foil: state.foil ? maskOf(frameOf(state.foil)) : null,
                    normal: state.normal ? cardCanvas(frameOf(state.normal)) : null,
                } : null,
                front: stackParts('front'), back: backParts,
                holo: $('#f-holo').checked, rarity: $('#f-rarity').value,
            }));
        });
    }

    // What the 3D view draws (CardView.set): the picture (3D: behind the window) and the stacked layers, like the game
    async function viewInput({ is3d, picture, front, back, holo, rarity }) {
        const surface = { surface: true, roughness: window.CardView ? CardView.roughnessOf(is3d ? '3d' : '2d') : CardLayerKit.DEFAULT_ROUGHNESS };
        const f = CardLayerKit.composite(front, surface), b = CardLayerKit.composite(back, surface);
        const white = CardLayerKit.newCanvas();
        const wg = white.getContext('2d');
        wg.fillStyle = '#fff';
        wg.fillRect(0, 0, CARD_W, CARD_H);
        return {
            art: picture ? picture.art : null,
            depth: is3d && picture ? picture.depth : null,
            normal: picture ? picture.normal : null,
            foilMask: picture ? picture.foil || white : null,
            overlay: f.color, layerFoil: f.foil, layerNormal: f.normal, layerSurface: f.surface,
            back: back.length ? b.color : await defaultBackImage(),
            backFoil: b.foil, backNormal: b.normal, backSurface: b.surface,
            type: is3d ? '3d' : '2d', foil: holo,
            rarityColor: rarityColor(rarity),
        };
    }

    const update3dFrames = () => refresh3d();

    function wirePreview3d() {
        for (const b of $$('#preview-view button')) b.addEventListener('click', () => showPreview(b.dataset.view));
        if (!window.CardView || !window.CardView.available()) {
            const b = $('#preview-view button[data-view="3d"]');
            b.disabled = true;
            b.title = 'The 3D preview needs WebGL2 (Chrome or Edge)';
        }
        $('#f-collection').addEventListener('change', () => {
            state.collHidden = new Set();
            ensureCollPreview().then(() => drawCrop());
        });
    }

    async function collectCard() {
        const f = readForm();
        const is3d = has3d();
        const editing = state.editingCard;
        if (!f.name) { toast.err('The card needs a name'); $('#f-name').focus(); return null; }
        if (!is3d && !state.layers.front.some(CardLayerKit.hasContent)) { toast.err('Add a front layer first', 'Add a picture or a text layer, or turn on the 3D layer.'); return null; }
        if (is3d && (!state.art || !state.depth)) { toast.err('Add the 3D layer\'s albedo and depth map', 'The 3D layer needs both, or turn it off.'); return null; }
        // An opened card: only what changed is written again
        const writePicture = is3d && (!editing || state.pictureDirty), writeLayers = !editing || state.layersDirty;
        let layerSave = null;
        if (writePicture) for (const slot of MEDIA_SLOTS) if (!(await splitMedia(slot))) return null;
        if (writeLayers) {
            try {
                await CardLayerKit.splitAll([...state.layers.front, ...state.layers.back], (done, total) => setStatus(`Splitting a layer's video: frame ${done} of ${total}…`));
            } catch (e) {
                toast.err('Could not split a layer\'s video', e.message);
                return null;
            }
        }
        const slug = editing ? editing.folder : newFolder();

        // [path, () => Promise<Blob>]: frames are rendered one at a time while saving
        const render = { art: canvasBlob, depth: canvasBlob, foil: (img) => pngBlob(maskOf(img)), normal: canvasBlob };
        const names = { art: ['card.png', 'frames'], depth: ['card.height.png', 'frames.height'], foil: ['card.foil.png', 'frames.foil'], normal: ['card.normal.png', 'frames.normal'] };
        const files = [];
        const fps = {};
        const managed = {};
        for (const slot of writePicture ? MEDIA_SLOTS : []) {
            const media = state[slot];
            if (!media) continue;
            const [still, folder] = names[slot];
            files.push([still, () => media.withFrame(0, render[slot])]);
            if (media.animated && media.count > 1) {
                fps[MEDIA_MAP[slot]] = media.fps;
                for (let i = 0; i < media.count; i++)
                    files.push([`${folder}/frame_${String(i).padStart(3, '0')}.png`, () => media.withFrame(i, render[slot])]);
            }
        }
        // Every animated map plays at its own speed ("fps": the picture's, for anything that reads only that)
        const speeds = Object.values(fps);
        if (writePicture) managed.animation = speeds.length ? { fps: fps.art ?? speeds[0], slots: fps } : null;
        if (writeLayers) {
            layerSave = CardLayerKit.files(state.layers.lists(), { incremental: !!editing });
            const out = layerSave;
            files.push(...out.files);
            managed.layers = out.json.front.length || out.json.back.length ? out.json : null;
            if (!is3d) {
                // A 2D card's pictures are all layers: card.png is its thumbnail (for Cards), the layers every copy shows
                managed.animation = null;
                const always = CardLayerKit.ordered(state.layers.front, state.collPreview.layers.front)
                    .filter((l) => l.chance >= 100).map((l) => ({ ...l, hidden: false }));
                files.push(['card.png', () => pngBlob(CardLayerKit.composite(CardLayerKit.parts(always, 0, formCtx()), { foil: false, normal: false }).color)]);
            }
        }
        const existing = editing && !editing.data._broken ? editing.data : {};
        managed.floats = depthFloats(existing.floats, is3d);
        const json = cardJson(f, is3d ? '3d' : '2d', existing, managed);
        files.push(['card.json', async () => new Blob([json], { type: 'application/json' })]);
        await ensureCollPreview();
        const thumb = {
            picture: is3d && state.art ? cardCanvas(state.art.still) : null,
            front: state.layers.front, collFront: state.collPreview.layers.front, ctx: formCtx(),
        };
        files.push([THUMB_FILE, () => thumbnail(thumb)]);
        return { f, slug, files, writePicture, writeLayers, is3d, layerSave };
    }

    const PICTURE_FILES = ['card.png', 'card.foil.png', 'card.normal.png', 'card.height.png', 'frames', 'frames.foil', 'frames.normal', 'frames.height'];
    // A 2D card's picture from before layers (it is a layer now)
    const OLD_PICTURE_FILES = ['card.foil.png', 'card.normal.png', 'card.height.png', 'frames', 'frames.foil', 'frames.normal', 'frames.height'];

    // Saves the card opened with Edit pictures & layers into its folder (moved if its rarity or collection changed)
    async function saveOpenedCard(card) {
        const opened = state.editingCard;
        const { f, files, writePicture, writeLayers } = card;
        const collection = f.collection || null;
        const button = $('#save-card');
        button.disabled = true;
        try {
            const broken = await CardLayerKit.unreadable([...state.layers.front, ...state.layers.back], MEDIA_SLOTS.map((s) => state[s]).filter(Boolean));
            if (broken.length) throw new Error(`Its files for ${broken.join(', ')} can't be read any more (changed on disk since the card was opened), so nothing was changed. Close the card, reload this page and open the card again.`);
            let dir = opened.dir;
            if (f.rarity !== opened.rarity || !sameColl(collection, opened.collection)) dir = await moveCard(opened, collection, f.rarity);
            if (writePicture) for (const name of PICTURE_FILES) await dir.removeEntry(name, { recursive: true }).catch(() => {});
            if (writeLayers) for (const name of card.layerSave.clear) await dir.removeEntry(name, { recursive: true }).catch(() => {});
            for (const [i, [name, make]] of files.entries()) {
                if (files.length > 10) setStatus(`Saving ${i + 1} of ${files.length} files…`);
                await writePath(dir, name, await make());
            }
            if (writeLayers) {
                if (!card.is3d) for (const name of OLD_PICTURE_FILES) await dir.removeEntry(name, { recursive: true }).catch(() => {});
                await CardLayerKit.removeFiles(dir, [], card.layerSave.keep);
                card.layerSave.commit();
            }
            toast.ok('Card updated', 'Restart the SPT server to see the change.');
            closeEdit();
            await scanCards();
        } catch (e) {
            toast.err('Could not update the card', e.message);
            setStatus('Not saved: ' + e.message, false);
        } finally {
            button.disabled = false;
        }
    }

    async function writePath(dir, path, blob) {
        const parts = path.split('/');
        for (const part of parts.slice(0, -1)) dir = await getDir(dir, part, true);
        await writeFile(dir, parts[parts.length - 1], blob);
    }

    function setStatus(text, ok) {
        const s = $('#save-status');
        s.hidden = !text;
        s.textContent = text || '';
        s.className = 'facade-status ' + (ok ? 'is-ok' : ok === false ? 'is-error' : '');
    }

    async function saveToFolder() {
        if (!state.data) { toast.err('No folder connected', 'Connect the mod folder, or use Download .zip.'); return; }
        const card = await collectCard();
        if (!card) return;
        if (state.editingCard) return saveOpenedCard(card);
        const { f, slug, files } = card;

        let addon;
        try {
            addon = await CardAddonKit.ensure(state.data, state.addons, $('#f-addon').value);
        } catch (e) {
            toast.err('Could not save the card', e.message);
            return;
        }
        const collFolder = f.collection || DEFAULT_COLLECTION;
        const collDir = await getDir(await getDir(addon.dir, CARDS_FOLDER, true), collFolder, true);
        for (const r of RARITIES) {
            const rdir = await getDir(collDir, r);
            if (rdir && await getDir(rdir, slug)) {
                toast.err(`"${slug}" already exists`, `${collName(f.collection)} has a ${r} card with that folder name. Pick another name.`);
                return;
            }
        }

        const button = $('#save-card');
        button.disabled = true;
        try {
            const rdir = await getDir(collDir, f.rarity, true);
            const cdir = await rdir.getDirectoryHandle(slug, { create: true });
            for (const [i, [name, make]] of files.entries()) {
                if (files.length > 10) setStatus(`Saving ${i + 1} of ${files.length} files…`);
                await writePath(cdir, name, await make());
            }
            const where = `data/${addon.folder}/cards/${collFolder}/${f.rarity}/${slug}/`;
            toast.ok('Card saved', `${where} · restart the SPT server to get it in game.`);
            setStatus(`Saved to ${where}`, true);
            $('#f-name').value = '';
            $('#f-short').value = '';
            $('#f-desc').value = '';
            if (!state.addons.some((a) => a.folder === addon.folder)) await scanAddons();
            await scanCards();
        } catch (e) {
            toast.err('Could not save the card', e.message);
            setStatus('Not saved: ' + e.message, false);
        } finally {
            button.disabled = false;
        }
    }

    async function saveZip() {
        const card = await collectCard();
        if (!card) return;
        const { f, slug, files } = card;
        const path = `${DEFAULT_COLLECTION}/${f.rarity}/${slug}`;
        const entries = [];
        for (const [i, [name, make]] of files.entries()) {
            if (files.length > 10) setStatus(`Packing ${i + 1} of ${files.length} files…`);
            entries.push({ name: `cards/${path}/${name}`, data: new Uint8Array(await (await make()).arrayBuffer()) });
        }
        const zip = `${slugify(f.name)}.zip`;
        download(CardAddonKit.makeZip(entries), zip);
        toast.ok('Card downloaded', `${zip} · import it under Add-ons.`);
        setStatus(`Downloaded ${zip}: import it under Add-ons`, true);
    }

    // The edit window: the card form moved into it, with the card's details, picture and layers. The New card form's
    // work waits aside (state.draft) and comes back when the window closes.
    async function openEdit(card) {
        if (state.editingCard) closeEdit();
        state.draft = {
            fields: Object.fromEntries(['#f-name', '#f-short', '#f-desc', '#f-rarity', '#f-addon', '#f-collection'].map((id) => [id, $(id).value])),
            collHidden: state.collHidden,
            use3d: state.use3d, depthRange: state.depthRange, crop: state.crop, show: state.show,
            art: state.art, depth: state.depth, foil: state.foil, normal: state.normal,
            front: state.layers.front, back: state.layers.back,
            pictureDirty: state.pictureDirty, layersDirty: state.layersDirty, textAlign: state.textAlign,
        };
        for (const slot of MEDIA_SLOTS) state[slot] = null;
        state.crop = { zoom: 1, cx: 0.5, cy: 0.5 };
        state.layers.set([], [], { keep: true });
        state.editingCard = card;

        $('#edit-host').appendChild($('#card-form'));
        $('#edit-modal').appendChild($('.card-form-preview'));
        if (cardView) requestAnimationFrame(() => cardView.resize());
        $('#edit-title').textContent = card.data.name || card.folder;
        $('#save-card').textContent = 'Save changes';
        $('#save-card').classList.replace('fx-lg', 'fx-sm');
        $('#edit-cancel').after($('#save-card'));
        $('#edit-delete').after($('#save-status'));
        $('#save-zip').hidden = true;
        const del = $('#edit-delete');
        del.textContent = 'Delete card';
        delete del.dataset.armed;
        $('#edit-modal').hidden = false;

        const d = card.data;
        $('#f-name').value = d.name || '';
        $('#f-short').value = d.shortName || '';
        $('#f-desc').value = d.description || '';
        state.textAlign = alignOf(d.textAlign);
        $('#f-rarity').value = card.rarity; syncSelect($('#f-rarity'));
        $('#f-addon').value = card.addon;
        $('#f-addon').disabled = true;
        syncSelect($('#f-addon'));
        defaultBack = defaultBackImg = null;
        fillCollectionSelects();
        $('#f-collection').value = card.collection || ''; syncSelect($('#f-collection'));
        state.collHidden = d.collectionLayers === false ? 'all' : new Set((d.hideCollectionLayers || []).filter((f) => typeof f === 'string'));
        state.use3d = cardType(card) === '3d';
        state.depthRange = depthFromFloats(d.floats);
        for (const slot of MEDIA_SLOTS) renderMedia(slot);
        refreshPrices();
        setStatus('Opening the card…');
        try {
            const anim = d.animation || {};
            const fpsOf = (slot) => (anim.slots && anim.slots[slot]) || anim.fps;
            if (has3d()) {
                for (const slot of MEDIA_SLOTS) {
                    const map = MEDIA_MAP[slot];
                    state[slot] = await CardLayerKit.loadMap(card.dir, 'card', map, fpsOf(map), { copy: true }).catch(() => null);
                    renderMedia(slot);
                }
            }
            const layers = d.layers || {};
            let front = await CardLayerKit.load(card.dir, 'front', layers.front);
            const back = await CardLayerKit.load(card.dir, 'back', layers.back);
            // A 2D card from before layers: its card.png is its bottom layer (under the collection's frame)
            if (!d.layers && !has3d()) {
                const fps = { art: fpsOf('art'), mask: fpsOf('mask'), foil: fpsOf('foil'), normal: fpsOf('normal') };
                front = [...await CardLayerKit.load(card.dir, 'front', [{ file: 'card', canBeFoil: true, fps }]), ...front];
            }
            state.layers.set(front, back);
            setStatus('');
        } catch (e) {
            toast.err('Could not open the card\'s pictures', e.message);
        }
        state.pictureDirty = state.layersDirty = false;
        updateFolderHint();
        updateFormVisibility();
        updatePlayback();
        ensureCollPreview().then(() => drawCrop());
    }

    // Closes the edit window: the card form goes back to New card, with its work
    function closeEdit() {
        if (!state.editingCard) { $('#edit-modal').hidden = true; return; }
        $('#edit-modal').hidden = true;
        $('#card-form-home').after($('#card-form'));
        $('#card-form').appendChild($('.card-form-preview'));
        if (cardView) requestAnimationFrame(() => cardView.resize());
        $('#save-card').textContent = 'Save card';
        $('#save-card').classList.replace('fx-sm', 'fx-lg');
        $('#save-zip').before($('#save-status'));
        $('#save-zip').after($('#save-card'));
        $('#save-zip').hidden = false;
        for (const slot of MEDIA_SLOTS) if (state[slot]) state[slot].dispose();
        state.editingCard = null;
        const d = state.draft;
        state.draft = null;
        $('#f-addon').disabled = false;
        defaultBack = defaultBackImg = null;
        if (d) {
            for (const [id, value] of Object.entries(d.fields)) {
                if (id === '#f-collection') fillCollectionSelects();
                $(id).value = value;
                if ($(id).tagName === 'SELECT') syncSelect($(id));
            }
            state.collHidden = d.collHidden;
            Object.assign(state, { crop: d.crop, show: d.show, art: d.art, depth: d.depth, foil: d.foil, normal: d.normal, depthRange: d.depthRange });
            state.layers.set(d.front, d.back);
            state.pictureDirty = d.pictureDirty;
            state.layersDirty = d.layersDirty;
            state.textAlign = d.textAlign;
            set3d(d.use3d);
        }
        for (const slot of MEDIA_SLOTS) renderMedia(slot);
        setStatus('');
        syncZoom();
        refreshPrices();
        updateFolderHint();
        ensureCollPreview().then(() => drawCrop());
    }



    async function copyDir(from, to) {
        for await (const [name, handle] of from.entries()) {
            if (handle.kind === 'directory') await copyDir(handle, await to.getDirectoryHandle(name, { create: true }));
            else await writeFile(to, name, await handle.getFile());
        }
    }

    async function moveCard(card, collection, rarity) {
        const other = findCard(collection, card.folder, card);
        if (other) throw new Error(`${collName(collection)} already has a card called ${card.folder} (${other.rarity})`);
        const collDir = await getDir(card.cards, collection || DEFAULT_COLLECTION, true);
        const target = await getDir(collDir, rarity, true);
        if (await getDir(target, card.folder)) throw new Error(`data/${card.addon}/cards/${collection || DEFAULT_COLLECTION}/${rarity} already has a folder called ${card.folder}`);
        const dir = await target.getDirectoryHandle(card.folder, { create: true });
        await copyDir(card.dir, dir);
        await card.rdir.removeEntry(card.folder, { recursive: true });
        return dir;
    }

    async function duplicateCard() {
        const card = state.editingCard;
        if (!card) return;
        const btn = $('#edit-duplicate');
        btn.disabled = true;
        try {
            const file = await getFile(card.dir, 'card.json');
            const data = JSON.parse(await file.text());
            data.name = `${(data.name || card.folder).trim()}_copy`;
            delete data.idKey;
            const folder = await CardAddonKit.freeName(card.rdir);
            const dir = await card.rdir.getDirectoryHandle(folder, { create: true });
            await copyDir(card.dir, dir);
            await writeFile(dir, 'card.json', new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
            closeEdit();
            await scanCards();
            toast.ok('Card duplicated', `${data.name} · data/${card.addon}/cards/${card.collection || DEFAULT_COLLECTION}/${card.rarity}/${folder}/. Rename it and save.`);
            const copy = state.list.find((c) => c.folder === folder && c.rarity === card.rarity && sameColl(c.collection, card.collection));
            if (copy) await openEdit(copy);
        } catch (e) {
            toast.err('Could not duplicate the card', e.message);
        } finally {
            btn.disabled = false;
        }
    }

    async function deleteCard() {
        const card = state.editingCard;
        const btn = $('#edit-delete');
        if (!card) return;
        if (!btn.dataset.armed) {
            btn.dataset.armed = '1';
            btn.textContent = 'Click again to delete';
            setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = 'Delete card'; } }, 3000);
            return;
        }
        try {
            await card.rdir.removeEntry(card.folder, { recursive: true });
            toast.ok('Card deleted', `${card.data.name || card.folder} is gone. Copies players already have disappear when the server restarts.`);
            closeEdit();
            await scanCards();
        } catch (e) {
            toast.err('Could not delete the card', e.message);
        }
    }

    const STICKER_MAX = 1024;

    const sameName = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
    const isMember = (card, coll) => !!card.collection && sameName(card.collection, coll.folder);
    const isOrphan = (card) => !!card.collection && !state.collections.some((c) => isMember(card, c));

    // A collection's layers (collection.json "layers"; older collections: overlay.png = frame, back.png), over its cards'.
    // Fresh copies for the editor, cached ones for the previews.
    function readCollectionLayers(coll, opts = {}) {
        const layers = coll.data.layers;
        return Promise.all([
            CardLayerKit.load(coll.dir, 'front', layers ? layers.front : [{ file: 'overlay', canBeFoil: false }], COLL_LAYER_DEFAULTS.front, opts),
            CardLayerKit.load(coll.dir, 'back', layers ? layers.back : [{ file: 'back', canBeFoil: false }], COLL_LAYER_DEFAULTS.back, opts),
            legacyTextLayers(coll),
        ]).then(([front, back, text]) => ({ front: [...front, ...text], back }));
    }

    function collectionLayers(coll) {
        if (!coll) return Promise.resolve({ front: [], back: [] });
        if (!state.collLayers.has(coll.folder))
            state.collLayers.set(coll.folder, readCollectionLayers(coll).catch(() => ({ front: [], back: [] })));
        return state.collLayers.get(coll.folder);
    }

    const COLL_LAYER_DEFAULTS = { front: { canBeFoil: false, frame: true }, back: { canBeFoil: false } };

    async function scanCollections() {
        state.collections = [];
        state.collLayers.clear();
        defaultBack = defaultBackImg = null;
        state.collPreview = { folder: null, layers: { front: [], back: [] } };
        for (const addon of state.data ? state.addons : []) {
            const parent = await getDir(addon.dir, CARDS_FOLDER);
            if (!parent) continue;
            for await (const [name, handle] of parent.entries()) {
                if (handle.kind !== 'directory' || isDefault(name) || isRarity(name)) continue;
                const json = await getFile(handle, 'collection.json');
                let data = {};
                if (!json) continue;
                try { data = JSON.parse(await json.text()); } catch { data = {}; }
                data.name = data.name || name;
                state.collections.push({ folder: name, dir: handle, parent, addon: addon.folder, data, stickers: await readStickers(handle, data) });
            }
        }
        state.collections.sort((a, b) => a.data.name.localeCompare(b.data.name));
        fillCollectionSelects();
        renderCardsSide();
        packsChanged('collections');
    }

    function fillCollectionSelects() {
        for (const [sel, addon] of [[$('#f-collection'), formAddon()], [$('#b-collection'), $('#b-addon').value]]) {
            const value = sel.value;
            const own = (c) => (c.addon === addon ? 0 : 1);
            const list = [...state.collections].sort((a, b) => own(a) - own(b) || a.data.name.localeCompare(b.data.name));
            const current = sel.id === 'f-collection' && state.editingCard && state.editingCard.collection;
            sel.innerHTML = ['<option value="">No collection</option>']
                .concat(list.map((c) => `<option value="${escapeHtml(c.folder)}">${escapeHtml(c.data.name)}${c.addon !== addon ? ` · ${escapeHtml(addonName(c.addon))}` : ''}</option>`))
                .concat(current && !list.some((c) => sameName(c.folder, current)) ? [`<option value="${escapeHtml(current)}">Missing collection</option>`] : []).join('');
            sel.value = [...sel.options].some((o) => o.value === value) ? value : '';
            syncSelect(sel);
        }
        if (window.CCBatch) CCBatch.collectionsChanged();
    }

    const BINDER_SIZE = '1 × 2';

    let binderBase = null;
    function getBinderBase() {
        if (binderBase) return binderBase;
        const b = window.CC_BINDER;
        if (b && b.cover) {
            binderBase = { src: b.image, width: b.width, height: b.height, cover: b.cover };
            return binderBase;
        }
        const W = 680, H = 952, cover = { x: 38, y: 20, w: 633, h: 900 };
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const g = c.getContext('2d');
        g.fillStyle = '#0f0f11';
        g.beginPath(); g.roundRect(0, 6, W - 4, H - 12, [6, 34, 34, 6]); g.fill();
        g.fillStyle = '#1d1d20';
        g.beginPath(); g.roundRect(cover.x, cover.y, cover.w, cover.h, [4, 30, 30, 4]); g.fill();
        g.fillStyle = '#29292d';
        g.fillRect(8, 20, 26, H - 40);
        g.fillStyle = 'rgba(255,255,255,.25)';
        g.font = '600 26px system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillText('Binder preview', cover.x + cover.w / 2, H - 60);
        g.font = '400 20px system-ui, sans-serif';
        g.fillText('(build the bundles in Unity for the real one)', cover.x + cover.w / 2, H - 30);
        binderBase = { src: c.toDataURL(), width: W, height: H, cover };
        return binderBase;
    }

    function loadUrl(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Could not load ' + src));
            img.src = src;
        });
    }

    async function drawBinder(canvas, stickers) {
        const base = getBinderBase();
        canvas.width = 340;
        canvas.height = Math.round(340 * base.height / base.width);
        const g = canvas.getContext('2d');
        const k = canvas.width / base.width;
        try { g.drawImage(await loadUrl(base.src), 0, 0, canvas.width, canvas.height); } catch { }
        const cv = base.cover;
        for (const { blob, placement: p } of stickers || []) {
            let bitmap;
            try { bitmap = await createImageBitmap(blob); } catch { continue; }
            g.save();
            g.beginPath();
            g.rect(cv.x * k, cv.y * k, cv.w * k, cv.h * k);
            g.clip();
            g.translate((cv.x + p.x * cv.w) * k, (cv.y + p.y * cv.h) * k);
            g.rotate(p.rotation * Math.PI / 180);
            const w = p.width * cv.w * k, h = p.height * cv.h * k;
            g.drawImage(bitmap, -w / 2, -h / 2, w, h);
            g.restore();
        }
    }

    function openCollection(coll) {
        const data = coll ? structuredClone(coll.data) : {};
        state.coll = {
            source: coll || null,
            data,
            stickers: [],
            selected: -1,
            stickersChanged: false,
            members: new Set(coll ? state.list.filter((c) => isMember(c, coll)).map((c) => c.key) : []),
            layersDirty: !!data.cardText,
            layersLoaded: !coll,
        };
        const opened = state.coll;
        collEditor.set([], []);
        collView.sample = null;
        collView.sampleKey = null;
        drawCollPreview();
        if (coll) readCollectionLayers(coll).then(({ front, back }) => {
            if (state.coll !== opened) return;
            collEditor.set(front, back);
            opened.layersLoaded = true;
            drawCollPreview();
        });
        $('#coll-editor-title').textContent = coll ? coll.data.name : 'New collection';
        if (coll) $('#c-addon').value = coll.addon;
        $('#c-addon').disabled = !!coll;
        syncSelect($('#c-addon'));
        defaultBack = defaultBackImg = null;
        $('#c-name').value = data.name || '';
        $('#c-short').value = data.shortName || '';
        $('#c-desc').value = data.description || '';
        $('#coll-modal').hidden = false;
        $('#coll-editor').scrollTop = 0;
        layoutStage();
        renderStickers();
        if (coll) loadStickers(coll.stickers);
        updateCollFolder();
        renderCollCards();
        $('#c-name').focus();
    }

    function closeCollection() {
        state.coll = null;
        $('#coll-modal').hidden = true;
    }

    function updateCollFolder() {
        const name = $('#c-name').value.trim();
        const src = state.coll && state.coll.source;
        $('#c-folder').innerHTML = src ? `Folder <code>data/${escapeHtml(src.addon)}/cards/${escapeHtml(src.folder)}/</code>` : 'Binder name in game.';
    }

    function stickerFrame() {
        const band = window.CC_BINDER_BAND;
        if (band && band.image)
            return { src: band.image, box: [0, 0, 100, 100], xMin: band.xMin, xMax: band.xMax, yMin: band.yMin, yMax: band.yMax, spine: band.spine || [] };
        const base = getBinderBase();
        return {
            src: base.src, xMin: 0, xMax: 1, yMin: 0, yMax: 1, spine: [],
            box: [base.cover.x / base.width * 100, base.cover.y / base.height * 100, base.cover.w / base.width * 100, base.cover.h / base.height * 100],
        };
    }

    function layoutStage() {
        const frame = stickerFrame();
        $('#binder-img').src = frame.src;
        $('#binder-stage').classList.toggle('is-band', !!window.CC_BINDER_BAND);
        const cover = $('#binder-cover');
        [cover.style.left, cover.style.top, cover.style.width, cover.style.height] = frame.box.map((v) => v + '%');
        for (const el of $$('#binder-stage .band-line')) el.remove();
        for (const x of frame.spine) {
            const line = document.createElement('div');
            line.className = 'band-line';
            line.style.left = ((x - frame.xMin) / (frame.xMax - frame.xMin)) * 100 + '%';
            $('#binder-stage').appendChild(line);
        }
    }

    const STICKER_FILE = /^sticker(_\d+)?\.png$/i;
    const PLACEMENT_DEFAULT = { x: 0.5, y: 0.4, width: 0.6, height: 0.3, rotation: 0 };
    const placementOf = (saved) => {
        const p = Object.assign({}, PLACEMENT_DEFAULT);
        for (const k of Object.keys(PLACEMENT_DEFAULT)) if (saved && typeof saved[k] === 'number') p[k] = saved[k];
        return p;
    };

    async function readStickers(dir, data) {
        const list = [];
        if (Array.isArray(data.stickers)) {
            for (const saved of data.stickers) {
                const file = String((saved && saved.file) || '').split(/[\\/]/).pop();
                const blob = file ? await getFile(dir, file) : null;
                if (blob) list.push({ file, blob, placement: placementOf(saved) });
            }
        } else {
            const blob = await getFile(dir, 'sticker.png');
            if (blob) list.push({ file: 'sticker.png', blob, placement: placementOf(data.sticker) });
        }
        return list;
    }

    async function loadStickers(saved) {
        const coll = state.coll;
        for (const s of saved || []) {
            let img;
            try { img = await loadImage(s.blob); } catch { continue; }
            if (state.coll !== coll) return;
            const p = Object.assign({}, s.placement);
            coll.stickers.push({ file: s.file, label: s.file, blob: s.blob, img, placement: p, hPerW: p.width > 0 ? p.height / p.width : 1 });
        }
        if (coll.selected < 0 && coll.stickers.length) coll.selected = coll.stickers.length - 1;
        renderStickers();
    }

    async function addSticker(file) {
        const coll = state.coll;
        let img;
        try { img = await loadImage(file); } catch (e) { toast.err('Could not open the sticker', e.message); return; }
        const base = getBinderBase();
        const hPerW = (img.naturalHeight / img.naturalWidth) * (base.cover.w / base.cover.h);
        const width = Math.min(0.6, 0.8 / hPerW);
        coll.stickers.push({ file: null, label: file.name || 'New sticker', blob: await stickerPng(img), img, hPerW,
            placement: { x: 0.5, y: 0.4, width, height: width * hPerW, rotation: 0 } });
        coll.selected = coll.stickers.length - 1;
        coll.stickersChanged = true;
        renderStickers();
    }

    function stickerPng(img) {
        const scale = Math.min(1, STICKER_MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const g = canvas.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, canvas.width, canvas.height);
        return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    }

    const selectedSticker = () => (state.coll ? state.coll.stickers[state.coll.selected] : null);

    function selectSticker(index) {
        if (!state.coll || state.coll.selected === index) return;
        state.coll.selected = index;
        renderStickers();
    }

    function renderStickers() {
        const coll = state.coll;
        if (!coll) return;
        const list = $('#sticker-layers');
        list.innerHTML = '';
        for (let i = coll.stickers.length - 1; i >= 0; i--) {
            const s = coll.stickers[i];
            const row = document.createElement('div');
            row.className = 'st-layer' + (i === coll.selected ? ' is-selected' : '');
            row.innerHTML = `<img alt="" src="${s.img.src}"><span class="st-layer-name" title="${escapeHtml(s.label)}">${escapeHtml(s.label)}${i === coll.stickers.length - 1 ? ' (top)' : ''}</span>
                <button type="button" class="facade-iconbtn" data-a="up" title="Move up (on top of the next one)" ${i === coll.stickers.length - 1 ? 'disabled' : ''}>▲</button>
                <button type="button" class="facade-iconbtn" data-a="down" title="Move down" ${i === 0 ? 'disabled' : ''}>▼</button>
                <button type="button" class="facade-iconbtn" data-a="remove" title="Remove">×</button>`;
            row.addEventListener('click', (e) => {
                const a = e.target.closest('button') && e.target.closest('button').dataset.a;
                if (a === 'up' || a === 'down') moveSticker(i, a === 'up' ? 1 : -1);
                else if (a === 'remove') removeSticker(i);
                else selectSticker(i);
            });
            list.appendChild(row);
        }

        const cover = $('#binder-cover');
        cover.innerHTML = '';
        coll.stickers.forEach((s, i) => {
            const el = document.createElement('div');
            el.className = 'sticker' + (i === coll.selected ? ' is-selected' : '');
            el.dataset.index = i;
            el.innerHTML = `<img alt="" draggable="false" src="${s.img.src}"><span class="st-handle st-resize" title="Resize"></span><span class="st-handle st-rotate" title="Turn"></span>`;
            cover.appendChild(el);
        });
        placeStickers();
    }

    function placeStickers() {
        const coll = state.coll;
        if (!coll) return;
        const f = stickerFrame(), fw = f.xMax - f.xMin, fh = f.yMax - f.yMin;
        for (const el of $$('#binder-cover .sticker')) {
            const p = coll.stickers[+el.dataset.index].placement;
            el.style.left = ((p.x - p.width / 2 - f.xMin) / fw) * 100 + '%';
            el.style.top = ((p.y - p.height / 2 - f.yMin) / fh) * 100 + '%';
            el.style.width = (p.width / fw) * 100 + '%';
            el.style.height = (p.height / fh) * 100 + '%';
            el.style.transform = `rotate(${p.rotation}deg)`;
            el.style.zIndex = 1 + +el.dataset.index;
        }
        const sel = selectedSticker();
        $('#sticker-tools').classList.toggle('is-off', !sel);
        if (sel) {
            const size = $('#st-size'), rot = $('#st-rot');
            size.value = sel.placement.width; setRange(size);
            rot.value = sel.placement.rotation; setRange(rot);
        }
        if (binderView) binderView.update();
    }

    function setStickerWidth(sticker, width) {
        const p = sticker.placement;
        const max = Math.min(1.5, 1.5 / sticker.hPerW);
        p.width = Math.min(max, Math.max(0.03, width));
        p.height = p.width * sticker.hPerW;
        placeStickers();
    }

    function moveSticker(index, by) {
        const list = state.coll.stickers, to = index + by;
        if (to < 0 || to >= list.length) return;
        [list[index], list[to]] = [list[to], list[index]];
        if (state.coll.selected === index) state.coll.selected = to;
        else if (state.coll.selected === to) state.coll.selected = index;
        renderStickers();
    }

    function removeSticker(index) {
        state.coll.stickers.splice(index, 1);
        state.coll.stickersChanged = true;
        state.coll.selected = Math.min(state.coll.selected, state.coll.stickers.length - 1);
        renderStickers();
    }

    let binderView = null;
    function showStickerView(view) {
        const want3d = view === '3d';
        for (const b of $$('#st-view button')) b.classList.toggle('fx-on', b.dataset.view === view);
        CardLayerKit.smoothResize($('#binder-3d').closest('.binder-view'), () => {
            $('#binder-stage').hidden = want3d;
            $('#binder-3d').hidden = !want3d;
        });
        if (want3d && !binderView) {
            binderView = window.BinderView && window.BinderView.create($('#binder-3d'), {
                stickers: () => ({ list: state.coll ? state.coll.stickers : [], selected: state.coll ? state.coll.selected : -1 }),
                select: selectSticker,
                changed: placeStickers,
            });
        }
        if (binderView) binderView.update();
    }

    function wireStickerEditor() {
        const stage = $('#binder-stage'), cover = $('#binder-cover');
        let action = null;
        const center = (p) => {
            const r = cover.getBoundingClientRect(), f = stickerFrame();
            const kx = (f.xMax - f.xMin) / r.width, ky = (f.yMax - f.yMin) / r.height;
            return { x: r.left + (p.x - f.xMin) / kx, y: r.top + (p.y - f.yMin) / ky, kx, ky, f };
        };
        cover.addEventListener('pointerdown', (e) => {
            const el = e.target.closest('.sticker');
            if (!state.coll || !el) return;
            e.preventDefault();
            const index = +el.dataset.index;
            selectSticker(index);
            const sticker = state.coll.stickers[index], p = sticker.placement, c = center(p);
            if (e.target.classList.contains('st-resize'))
                action = { kind: 'resize', sticker, d0: Math.hypot(e.clientX - c.x, e.clientY - c.y), w0: p.width };
            else if (e.target.classList.contains('st-rotate'))
                action = { kind: 'rotate', sticker, a0: Math.atan2(e.clientY - c.y, e.clientX - c.x), r0: p.rotation };
            else
                action = { kind: 'move', sticker, x0: e.clientX, y0: e.clientY, px: p.x, py: p.y };
            cover.setPointerCapture(e.pointerId);
            cover.classList.add('is-dragging');
        });
        cover.addEventListener('pointermove', (e) => {
            if (!action) return;
            const p = action.sticker.placement, c = center(p);
            if (action.kind === 'move') {
                const [dx, dy] = axisLock(e.clientX - action.x0, e.clientY - action.y0, e.shiftKey);
                p.x = Math.min(c.f.xMax + 0.2, Math.max(c.f.xMin - 0.2, action.px + dx * c.kx));
                p.y = Math.min(1.2, Math.max(-0.2, action.py + dy * c.ky));
                placeStickers();
            } else if (action.kind === 'resize') {
                setStickerWidth(action.sticker, action.w0 * Math.hypot(e.clientX - c.x, e.clientY - c.y) / Math.max(action.d0, 1));
            } else {
                if (Math.hypot(e.clientX - c.x, e.clientY - c.y) < 16) return;
                const turned = (Math.atan2(e.clientY - c.y, e.clientX - c.x) - action.a0) * 180 / Math.PI;
                let deg = action.r0 + turned;
                if (e.shiftKey) deg = Math.round(deg / 15) * 15;
                p.rotation = Math.round((((deg + 180) % 360) + 360) % 360 - 180);
                placeStickers();
            }
        });
        const end = () => { action = null; cover.classList.remove('is-dragging'); };
        cover.addEventListener('pointerup', end);
        cover.addEventListener('pointercancel', end);

        $('#st-size').addEventListener('input', (e) => { const sel = selectedSticker(); if (sel) setStickerWidth(sel, +e.target.value); });
        $('#st-rot').addEventListener('input', (e) => {
            const sel = selectedSticker();
            if (!sel) return;
            sel.placement.rotation = +e.target.value;
            placeStickers();
        });
        $('#st-center').addEventListener('click', () => {
            const sel = selectedSticker();
            if (!sel) return;
            Object.assign(sel.placement, { x: 0.5, y: 0.5 });
            placeStickers();
        });
        $('#st-straight').addEventListener('click', () => {
            const sel = selectedSticker();
            if (!sel) return;
            sel.placement.rotation = 0;
            placeStickers();
        });
        $('#st-remove').addEventListener('click', () => { if (state.coll && state.coll.selected >= 0) removeSticker(state.coll.selected); });
        wireDrop($('#drop-sticker'), $('#file-sticker'), 'sticker');

        for (const b of $$('#st-view button')) b.addEventListener('click', () => showStickerView(b.dataset.view));
        if (window.CC_BINDER_BAND) {
            const flat = $('#st-view button[data-view="2d"]');
            flat.textContent = 'Flat';
            flat.title = 'The binder unrolled: back | spine | front';
        }
        if (!window.BinderView || !window.BinderView.available()) {
            const b3d = $('#st-view button[data-view="3d"]');
            b3d.disabled = true;
            b3d.title = window.CC_BINDER_MODEL ? 'This browser has no WebGL2' : 'Build the bundles in Unity once for the 3D view';
            const note = $('#st-3d-note');
            note.hidden = false;
            note.textContent = window.CC_BINDER_MODEL ? 'Needs WebGL2.' : 'Needs a Unity build.';
        }
    }

    const TEXT_KEYS = ['name', 'description'];
    const LEGACY_TEXT = {
        name: { x: 0.5, y: 0.045, width: 0.84, height: 0.08, size: 0.055, align: 'center', color: '#FFFFFF' },
        description: { x: 0.5, y: 0.8, width: 0.84, height: 0.15, size: 0.03, align: 'center', color: '#FFFFFF' },
    };
    const TEXT_ALIGNS = CardText.ALIGNS;
    const ALIGN_LABEL = { left: 'Left', center: 'Centre', right: 'Right' };
    const CARD_FONT = CardText.CARD_FONT;
    const FONT_FILE = /^font_(name|description)\.(ttf|otf)$/i;
    const TEXT_ID = /^[A-Za-z0-9_-]{1,40}$/;
    const BOX_HANDLES = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'];
    const HANDLE_TITLES = { n: 'Top edge', s: 'Bottom edge', w: 'Left edge', e: 'Right edge', nw: 'Top left corner', ne: 'Top right corner', sw: 'Bottom left corner', se: 'Bottom right corner', rot: 'Turn it (Shift: 15° steps)' };
    const wrapAngle = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
    const TEXT_MIN = { width: 0.05, height: 0.02 };

    async function legacyTextLayers(coll) {
        const saved = coll && coll.data.cardText;
        if (!saved) return [];
        const layers = [];
        for (const k of TEXT_KEYS) {
            const s = saved[k];
            if (!s || s.show === false) continue;
            const fields = { ...LEGACY_TEXT[k], ...s, value: k === 'name' ? '${name}' : '${description}' };
            if (!(s.height > 0)) fields.height = Math.max(0.02, 1 - fields.y);
            const layer = CardLayerKit.textLayer('front', fields, { canBeFoil: false });
            Object.assign(layer, { id: k, name: k === 'name' ? 'Name' : 'Description', collapsed: true });
            const file = s.font && coll.dir ? await getFile(coll.dir, s.font) : null;
            if (file) await CardLayerKit.setFont(layer.text, file).catch(() => {});
            layers.push(layer);
        }
        return layers;
    }

    const cardVars = ({ name, description, rarity, collection }) => ({
        name, description: description || `${rarity} collectible card.`, rarity,
        'rarity.color': rarityColor(rarity), collection: collection && !isDefault(collection) ? collName(collection) : '',
    });
    const alignOf = (saved) => Object.fromEntries(Object.entries(saved || {}).filter(([k, v]) => TEXT_ID.test(k) && TEXT_ALIGNS.includes(v)));

    function formCtx() {
        return {
            vars: cardVars({ name: $('#f-name').value.trim(), description: $('#f-desc').value.trim(), rarity: $('#f-rarity').value, collection: $('#f-collection').value || null }),
            align: alignOf(state.textAlign),
        };
    }

    const savedCtx = (card) => ({
        vars: cardVars({ name: card.data.name || card.folder, description: card.data.description, rarity: card.rarity, collection: card.collection }),
        align: alignOf(card.data.textAlign),
    });

    function thumbnail({ picture, front, collFront, ctx }) {
        const shown = CardLayerKit.ordered(front.filter((l) => l.chance >= 100), collFront.filter((l) => l.chance >= 100))
            .map((l) => ({ ...l, hidden: false }));
        const parts = [...(picture ? [{ art: picture, canBeFoil: false, frame: false }] : []), ...CardLayerKit.parts(shown, 0, ctx)];
        const full = CardLayerKit.composite(parts, { foil: false, normal: false }).color;
        const small = document.createElement('canvas');
        small.width = Math.round(full.width * THUMB_SCALE);
        small.height = Math.round(full.height * THUMB_SCALE);
        const g = small.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(full, 0, 0, small.width, small.height);
        return pngBlob(small);
    }

    async function refreshThumbs(cards, onProgress) {
        let done = 0;
        const failed = [];
        for (const card of cards) {
            let sample = null;
            try {
                const coll = card.collection ? state.collections.find((c) => sameName(c.folder, card.collection)) : null;
                const allColl = await collectionLayers(coll);
                const collLayers = card.data.collectionLayers === false ? { front: [], back: [] }
                    : withoutHidden(allColl, new Set(card.data.hideCollectionLayers || []));
                sample = await loadSample(card);
                const blob = await thumbnail({
                    picture: sample.is3d && sample.picture ? sample.picture.art : null,
                    front: sample.front, collFront: collLayers.front, ctx: savedCtx(card),
                });
                await writeFile(card.dir, THUMB_FILE, blob);
                card.thumb = blob;
            } catch {
                failed.push(card.data.name || card.folder);
            } finally {
                if (sample) for (const l of [...sample.front, ...sample.back]) for (const m of CardLayerKit.MAPS) if (l.maps[m]) l.maps[m].dispose();
            }
            if (onProgress) onProgress(++done, cards.length);
        }
        if (failed.length) toast.err(`Could not update ${failed.length} card preview${failed.length === 1 ? '' : 's'}`, failed.join(', '));
    }

    const textLabel = (layer, i) => layer.name || `Text ${i + 1}: ${layer.text.value.replace(/\s+/g, ' ').trim().slice(0, 30)}`;

    function renderCardAlign() {
        const coll = state.collPreview.layers;
        const layers = [...coll.front, ...coll.back].filter(CardLayerKit.isText);
        $('#f-align-field').hidden = !layers.length;
        const box = $('#f-align-rows');
        box.innerHTML = '';
        layers.forEach((layer, i) => {
            const own = state.textAlign[layer.id];
            const current = TEXT_ALIGNS.includes(own) ? own : layer.text.align;
            const row = document.createElement('div');
            row.className = 'card-align-row';
            row.innerHTML = `<span title="${escapeHtml(layer.text.value)}">${escapeHtml(textLabel(layer, i))}</span>
                <div class="align-buttons">${TEXT_ALIGNS.map((a) => `<button type="button" class="facade-btn fx-sm${a === current ? ' fx-on' : ''}" data-v="${a}"${a === layer.text.align ? ' title="The collection\'s alignment"' : ''}>${ALIGN_LABEL[a]}</button>`).join('')}</div>`;
            for (const b of $$('button', row)) b.addEventListener('click', () => {
                state.textAlign[layer.id] = b.dataset.v === layer.text.align ? null : b.dataset.v;
                renderCardAlign();
                drawCrop();
            });
            box.appendChild(row);
        });
        const changed = layers.filter((l) => TEXT_ALIGNS.includes(state.textAlign[l.id])).length;
        $('#f-align-note').textContent = changed
            ? 'Own alignment.'
            : 'Collection alignment.';
    }

    function layerOverlay(canvas, layerOf, moved) {
        const wrap = document.createElement('div');
        wrap.className = 'stage-wrap';
        canvas.before(wrap);
        wrap.appendChild(canvas);
        const box = document.createElement('div');
        box.className = 'layer-overlay';
        box.hidden = true;
        for (const h of [...BOX_HANDLES, 'rot']) {
            const handle = document.createElement('span');
            handle.className = `tb-handle tb-${h}`;
            handle.dataset.h = h;
            handle.title = HANDLE_TITLES[h];
            box.appendChild(handle);
        }
        wrap.appendChild(box);
        const toCard = (e) => {
            const r = canvas.getBoundingClientRect();
            return [((e.clientX - r.left) / r.width) * CARD_W, ((e.clientY - r.top) / r.height) * CARD_H];
        };
        let action = null;
        box.addEventListener('pointerdown', (e) => {
            const layer = layerOf(), h = e.target.dataset.h;
            const b = layer && h ? CardLayerKit.layerBox(layer) : null;
            if (!b) return;
            e.preventDefault();
            e.stopPropagation();
            action = { layer, h, b, start: toCard(e), scale: layer.transform.scale };
            e.target.setPointerCapture(e.pointerId);
        });
        box.addEventListener('pointermove', (e) => {
            if (!action) return;
            const { layer, h, b, start } = action, [px, py] = toCard(e);
            const text = CardLayerKit.isText(layer);
            if (h === 'rot') {
                let deg = (Math.atan2(py - b.cy, px - b.cx) * 180) / Math.PI + 90;
                if (e.shiftKey) deg = Math.round(deg / 15) * 15;
                deg = Math.round(wrapAngle(deg) * 10) / 10;
                if (text) layer.text.rotation = deg; else layer.transform.rotation = deg;
            } else if (!text) {
                const from = Math.hypot(start[0] - b.cx, start[1] - b.cy), to = Math.hypot(px - b.cx, py - b.cy);
                layer.transform.scale = Math.min(4, Math.max(0.05, Math.round(((action.scale * to) / Math.max(1, from)) * 1000) / 1000));
            } else {
                const a = (b.rotation * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
                const dx = px - start[0], dy = py - start[1];
                const lx = dx * c + dy * s, ly = -dx * s + dy * c;
                const minW = TEXT_MIN.width * CARD_W, minH = TEXT_MIN.height * CARD_H;
                let left = -b.w / 2, right = b.w / 2, top = -b.h / 2, bottom = b.h / 2;
                if (h.includes('w')) left = Math.min(right - minW, left + lx);
                if (h.includes('e')) right = Math.max(left + minW, right + lx);
                if (h.includes('n')) top = Math.min(bottom - minH, top + ly);
                if (h.includes('s')) bottom = Math.max(top + minH, bottom + ly);
                if (right - left > CARD_W) { if (h.includes('w')) left = right - CARD_W; else right = left + CARD_W; }
                const ox = (left + right) / 2, oy = (top + bottom) / 2;
                const cx = b.cx + ox * c - oy * s, cy = b.cy + ox * s + oy * c;
                const w = right - left, hh = bottom - top;
                Object.assign(layer.text, { x: cx / CARD_W, width: w / CARD_W, y: (cy - hh / 2) / CARD_H, height: hh / CARD_H });
            }
            moved(layer);
        });
        const end = () => { action = null; };
        box.addEventListener('pointerup', end);
        box.addEventListener('pointercancel', end);
        return {
            update(side) {
                const layer = layerOf();
                const b = layer && layer.side === side && !canvas.hidden ? CardLayerKit.layerBox(layer) : null;
                box.hidden = !b;
                if (!b) return;
                box.classList.toggle('is-text', CardLayerKit.isText(layer));
                Object.assign(box.style, {
                    left: ((b.cx - b.w / 2) / CARD_W) * 100 + '%', top: ((b.cy - b.h / 2) / CARD_H) * 100 + '%',
                    width: (b.w / CARD_W) * 100 + '%', height: (b.h / CARD_H) * 100 + '%',
                    transform: `rotate(${b.rotation}deg)`,
                });
            },
        };
    }

    let collEditor = null;
    let collPreviewQueued = false;

    function wireCollectionLayers() {
        collEditor = CardLayerKit.createEditor($('#coll-layers'), {
            sides: {
                front: { defaults: COLL_LAYER_DEFAULTS.front, note: 'Over the cards\' layers.' },
                back: { defaults: COLL_LAYER_DEFAULTS.back, note: 'Every card\'s back.' },
            },
            onChange(what) {
                if (!state.coll) return;
                if (what !== 'preview' && what !== 'side') state.coll.layersDirty = true;
                if (collPreviewQueued) return;
                collPreviewQueued = true;
                requestAnimationFrame(() => { collPreviewQueued = false; drawCollPreview(); });
            },
            onSelect: () => drawCollPreview(),
            onError: (title, body) => toast.err(title, body),
        });
        wireCollPreview();
    }

    function coverFit(canvas, img) {
        const g = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
        const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    }

    // ---------- The collection's card preview: its layers on one of its cards (Preview on), as in game ----------

    const collView = { view: 'place', card3d: null, sample: null, sampleKey: null };

    const cardSized = (img) => {
        const c = CardLayerKit.newCanvas();
        c.getContext('2d').drawImage(img, 0, 0, CARD_W, CARD_H);
        return c;
    };

    // A saved card's pictures: its layers (a pre-layers 2D card's card.png as one), a 3D
    // card's picture and depth map
    async function loadSample(card) {
        const d = card.data, is3d = cardType(card) === '3d', layers = d.layers || {};
        let front = await CardLayerKit.load(card.dir, 'front', layers.front);
        const back = await CardLayerKit.load(card.dir, 'back', layers.back);
        if (!d.layers && !is3d) front = [...await CardLayerKit.load(card.dir, 'front', [{ file: 'card', canBeFoil: true }]), ...front];
        let picture = null;
        if (is3d) {
            const [art, depth] = await Promise.all(['card.png', 'card.height.png'].map((n) => getFile(card.dir, n).then(blobImage)));
            if (art) picture = { art: cardSized(art), depth: depth ? cardSized(depth) : null, foil: null, normal: null };
        }
        return { card, is3d, picture, front, back };
    }

    // The cards to preview on: this collection's (as they are set now), or a blank card
    function fillCollSample() {
        const coll = state.coll;
        const sel = $('#coll-sample');
        const members = coll ? state.list.filter((c) => coll.members.has(c.key)) : [];
        // The card chosen before (none yet for a collection just opened: its first card)
        const keep = collView.sampleKey;
        sel.innerHTML = members.map((c) => `<option value="${escapeHtml(c.key)}">${escapeHtml(c.data.name || c.folder)}</option>`).join('') +
            '<option value="">A blank card</option>';
        sel.value = keep !== null && [...sel.options].some((o) => o.value === keep) ? keep : (members[0] ? members[0].key : '');
        syncSelect(sel);
        setCollSample(sel.value);
    }

    async function setCollSample(key) {
        if (collView.sampleKey === key && (collView.sample || !key)) return drawCollPreview();
        collView.sampleKey = key;
        const card = key ? state.list.find((c) => c.key === key) : null;
        const sample = card ? await loadSample(card).catch(() => null) : null;
        if (collView.sampleKey !== key) return;
        collView.sample = sample;
        drawCollPreview();
    }

    const blankPart = () => {
        const c = CardLayerKit.newCanvas();
        const g = c.getContext('2d');
        g.fillStyle = '#3a3d44';
        g.fillRect(0, 0, CARD_W, CARD_H);
        return { art: c, foil: null, normal: null, canBeFoil: true, frame: false };
    };

    // The front (as layers over a 3D card's picture) and back of the sample card with the collection's layers
    function collStack(side) {
        const s = collView.sample;
        const ctx = s ? savedCtx(s.card) : {
            vars: cardVars({ name: 'Card Name', description: 'The card\'s description goes here. Longer descriptions wrap onto more lines.', rarity: 'Rare', collection: state.coll && state.coll.source ? state.coll.source.folder : null }),
        };
        const sel = collEditor.selected, rare = $('#coll-rare').checked;
        if (side === 'back') return CardLayerKit.parts(CardLayerKit.ordered(everyCopy(s ? s.back : [], null, rare), everyCopy(collEditor.back, sel, rare)), 0, ctx);
        if (!s) return [blankPart(), ...CardLayerKit.parts(everyCopy(collEditor.front, sel, rare), 0, ctx)];
        return CardLayerKit.parts(CardLayerKit.ordered(everyCopy(s.front, null, rare), everyCopy(collEditor.front, sel, rare)), 0, ctx);
    }

    let collPreviewDrawQueued = false;
    function drawCollPreview() {
        if (!collEditor || collPreviewDrawQueued) return;
        collPreviewDrawQueued = true;
        requestAnimationFrame(async () => {
            collPreviewDrawQueued = false;
            const s = collView.sample, holo = $('#coll-holo').checked;
            if (collOverlay) collOverlay.update(collEditor.side);
            const front = collStack('front'), back = collStack('back');
            if (collView.view === '3d') {
                if (!collView.card3d) return;
                collView.card3d.set(await viewInput({
                    is3d: !!(s && s.is3d), picture: s && s.is3d ? s.picture : null, front, back,
                    holo, rarity: s ? s.card.rarity : 'Rare',
                }));
                return;
            }
            const canvas = $('#coll-preview');
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, CARD_W, CARD_H);
            const side = collEditor.side;
            const parts = side === 'back' ? back : [...(s && s.is3d && s.picture ? [{ ...s.picture, canBeFoil: true, frame: false }] : []), ...front];
            if (!parts.length) {
                const img = await defaultBackImage();
                if (img) coverFit(canvas, img);
                else noBack(ctx);
            } else {
                const stack = CardLayerKit.composite(parts, { foil: holo, normal: false });
                ctx.drawImage(stack.color, 0, 0);
                if (holo) drawFoilTint(ctx, stack.foil);
            }
            drawOutline(ctx, collEditor.selected, side);
        });
    }

    function wireCollPreview() {
        for (const b of $$('#coll-view button')) b.addEventListener('click', () => {
            let view = b.dataset.view;
            if (view === '3d' && !collView.card3d) {
                try { collView.card3d = window.CardView.create($('#coll-3d')); } catch (e) { toast.err('No 3D preview', e.message); view = 'place'; }
            }
            collView.view = view;
            for (const x of $$('#coll-view button')) x.classList.toggle('fx-on', x.dataset.view === view);
            CardLayerKit.smoothResize($('#coll-3d').closest('.crop-wrap'), () => {
                $('#coll-preview').hidden = view === '3d';
                $('#coll-3d').hidden = view !== '3d';
            });
            if (collView.card3d) collView.card3d.resize();
            drawCollPreview();
        });
        if (!window.CardView || !window.CardView.available()) $('#coll-view button[data-view="3d"]').disabled = true;
        $('#coll-sample').addEventListener('change', () => setCollSample($('#coll-sample').value));
        $('#coll-holo').addEventListener('change', drawCollPreview);
        $('#coll-rare').addEventListener('change', drawCollPreview);
        const collMoved = (layer) => {
            if (state.coll) state.coll.layersDirty = true;
            collEditor.refreshTransform(layer);
            drawCollPreview();
        };
        wireLayerDrag($('#coll-preview'), () => collEditor && collEditor.selected, collMoved,
            (e) => pickLayer(e, $('#coll-preview'), collEditor, collEditor.side, 0));
        collOverlay = layerOverlay($('#coll-preview'), () => collEditor && collEditor.selected, collMoved);
    }

    const DEFAULT_BACK = 'creator/card_back.png';

    // The card text editor's card: the sample card with the collection's layers (covering its thumbnail), under the texts
    function renderCollCards() {
        const coll = state.coll;
        if (!coll) return;
        const box = $('#c-cards');
        box.innerHTML = '';
        const members = state.list.filter((c) => coll.members.has(c.key));
        for (const card of members) {
            const chip = document.createElement('span');
            chip.className = 'coll-card';
            paintRarity(chip, card.rarity);
            let src = '';
            if (card.thumb || card.art) { src = URL.createObjectURL(card.thumb || card.art); state.urls.push(src); }
            chip.innerHTML = `<img alt="" ${src ? `src="${src}"` : ''}><span>${escapeHtml(card.data.name || card.folder)}</span>
                <button type="button" class="facade-iconbtn" aria-label="Remove from collection">×</button>`;
            chip.querySelector('button').addEventListener('click', () => { coll.members.delete(card.key); renderCollCards(); });
            box.appendChild(chip);
        }
        const others = state.list.filter((c) => !coll.members.has(c.key));
        if (others.length) {
            const sel = document.createElement('select');
            sel.className = 'facade-select';
            sel.innerHTML = '<option value="">Add a card…</option>' + others.map((c) =>
                `<option value="${escapeHtml(c.key)}">${escapeHtml(c.data.name || c.folder)} (${c.rarity}${c.collection ? ', now in ' + escapeHtml(collName(c.collection)) : ''})</option>`).join('');
            sel.addEventListener('change', () => {
                if (!sel.value) return;
                coll.members.add(sel.value);
                renderCollCards();
            });
            box.appendChild(sel);
            enhanceSelect(sel);
        }
        $('#c-count').textContent = members.length;
        $('#c-size-note').textContent = members.length
            ? `${BINDER_SIZE} binder, ${members.length} pocket${members.length === 1 ? '' : 's'}.`
            : 'No cards, no binder.';
        fillCollSample();
    }

    const LEGACY_COLLECTION_FILES = ['overlay.png', 'overlay.foil.png', 'overlay.normal.png', 'frames.overlay', 'back.png', 'back.foil.png', 'back.normal.png', 'frames.back'];

    async function saveCollection() {
        const coll = state.coll;
        if (!coll) return;
        if (!state.data) { toast.err('Connect the mod folder first'); return; }
        if (!coll.layersLoaded) { toast.err('Still opening the collection', 'Wait for its layers to load, then save.'); return; }
        const name = $('#c-name').value.trim();
        if (!name) { toast.err('The collection needs a name'); $('#c-name').focus(); return; }
        const clash = state.collections.find((c) => c !== coll.source && sameName(c.data.name, name));
        if (clash) { toast.err(`"${name}" already exists`, 'Pick another name.'); return; }

        const button = $('#c-save'), label = button.textContent;
        button.disabled = true;
        try {
            const broken = coll.layersDirty ? await CardLayerKit.unreadable([...collEditor.front, ...collEditor.back]) : [];
            if (broken.length) throw new Error(`Its files for ${broken.join(', ')} can't be read any more (changed on disk since the collection was opened), so nothing was changed. Close the collection, reload this page and open it again.`);
            let dir = coll.source ? coll.source.dir : null;
            let folder = coll.source ? coll.source.folder : null;
            if (!dir) {
                const addon = await CardAddonKit.ensure(state.data, state.addons, $('#c-addon').value);
                const cardsDir = await getDir(addon.dir, CARDS_FOLDER, true);
                folder = await CardAddonKit.freeName(cardsDir);
                dir = await cardsDir.getDirectoryHandle(folder, { create: true });
            }
            const moves = [];
            for (const card of state.list) {
                const want = coll.members.has(card.key);
                const was = coll.source ? isMember(card, coll.source) : false;
                if (want && !was) moves.push({ card, to: folder });
                else if (!want && was) moves.push({ card, to: null });
            }
            checkMoves(moves);

            const data = Object.assign({}, coll.data, { name });
            for (const [key, value] of [['shortName', $('#c-short').value.trim()], ['description', $('#c-desc').value.trim()]]) {
                if (value) data[key] = value; else delete data[key];
            }
            const used = new Set(coll.stickers.filter((st) => st.file).map((st) => st.file.toLowerCase()));
            for (const st of coll.stickers) {
                if (st.file) continue;
                let n = 1;
                while (used.has(`sticker_${n}.png`)) n++;
                st.file = `sticker_${n}.png`;
                used.add(st.file);
                st.write = true;
            }
            if (coll.stickers.length) {
                const r = (v) => Math.round(v * 10000) / 10000;
                data.stickers = coll.stickers.map(({ file, placement: p }) =>
                    ({ file, x: r(p.x), y: r(p.y), width: r(p.width), height: r(p.height), rotation: Math.round(p.rotation) }));
            } else {
                delete data.stickers;
            }
            delete data.sticker;
            if (coll.layersDirty) delete data.cardText;
            const usedFonts = new Set(Object.values(data.cardText || {}).map((t) => t && typeof t.font === 'string' && t.font.toLowerCase()).filter(Boolean));
            // Layers: written again when changed (an older collection's overlay.png / back.png become layers then)
            let layerSave = null;
            if (coll.layersDirty) {
                await CardLayerKit.splitAll([...collEditor.front, ...collEditor.back]);
                layerSave = CardLayerKit.files(collEditor.lists(), { incremental: !!coll.source });
                if (layerSave.json.front.length || layerSave.json.back.length) data.layers = layerSave.json; else delete data.layers;
                for (const name of layerSave.clear) await dir.removeEntry(name, { recursive: true }).catch(() => {});
                for (const [name, make] of layerSave.files) await writePath(dir, name, await make());
            }
            await writeFile(dir, 'collection.json', new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
            if (layerSave) {
                await CardLayerKit.removeFiles(dir, LEGACY_COLLECTION_FILES, layerSave.keep);
                layerSave.commit();
            }
            for (const st of coll.stickers) if (st.write) await writeFile(dir, st.file, st.blob);
            const doomed = [];
            for await (const [fileName, handle] of dir.entries())
                if (handle.kind === 'file' && ((STICKER_FILE.test(fileName) && !used.has(fileName.toLowerCase()))
                    || (FONT_FILE.test(fileName) && !usedFonts.has(fileName.toLowerCase()))))
                    doomed.push(fileName);
            for (const fileName of doomed) await dir.removeEntry(fileName).catch(() => {});

            for (const m of moves) await moveCard(m.card, m.to, m.card.rarity);
            if (coll.source) await pruneReferences(coll.source.folder);

            if (!state.addons.some((a) => a.folder === collAddon())) await scanAddons();
            await scanCollections();
            await scanCards();
            const movedOut = new Set(moves.filter((m) => !m.to).map((m) => `${m.card.rarity}/${m.card.folder}`.toLowerCase()));
            const affected = state.list.filter((c) => sameName(c.collection, folder) || (!c.collection && movedOut.has(`${c.rarity}/${c.folder}`.toLowerCase())));
            await refreshThumbs(affected, (done, total) => { button.textContent = `Updating card previews ${done} / ${total}…`; }).catch((e) => toast.err('Could not update the card previews', e.message));
            renderCards();
            toast.ok('Collection saved', `${name}${moves.length ? ` · ${moves.length} card${moves.length === 1 ? '' : 's'} moved` : ''} · restart the SPT server to get the binder in game.`);
            closeCollection();
        } catch (e) {
            toast.err('Could not save the collection', e.message);
        } finally {
            button.disabled = false;
            button.textContent = label;
        }
    }

    async function deleteCollection(coll) {
        if (!coll) return;
        try {
            const moves = state.list.filter((c) => isMember(c, coll)).map((card) => ({ card, to: null }));
            checkMoves(moves);
            for (const m of moves) await moveCard(m.card, null, m.card.rarity);
            await coll.parent.removeEntry(coll.folder, { recursive: true });
            await pruneReferences(coll.folder);
            toast.ok('Collection deleted', `${coll.data.name}: its binder is gone after the server restarts.` +
                (moves.length ? ` Its ${moves.length} card${moves.length === 1 ? '' : 's'} moved to data/${coll.addon}/cards/${DEFAULT_COLLECTION}/ (no collection).` : ''));
            if (state.coll && state.coll.source === coll) closeCollection();
            await scanCollections();
            await scanCards();
            const movedOut = new Set(moves.map((m) => `${m.card.rarity}/${m.card.folder}`.toLowerCase()));
            await refreshThumbs(state.list.filter((c) => !c.collection && movedOut.has(`${c.rarity}/${c.folder}`.toLowerCase())))
                .catch((e) => toast.err('Could not update the card previews', e.message));
            renderCards();
        } catch (e) {
            toast.err('Could not delete the collection', e.message);
            await scanCards();
        }
    }

    async function pruneReferences(folder) {
        const hasCards = async (dir) => {
            for await (const [name, handle] of dir.entries()) {
                if (handle.kind !== 'directory') continue;
                if (await getFile(handle, 'card.json') || await hasCards(handle)) return true;
            }
            return false;
        };
        for (const addon of state.addons) {
            const cards = await getDir(addon.dir, CARDS_FOLDER);
            const dir = cards && await getDir(cards, folder);
            if (!dir || await getFile(dir, 'collection.json') || await hasCards(dir)) continue;
            await cards.removeEntry(folder, { recursive: true }).catch(() => {});
        }
    }

    function checkMoves(moves) {
        const target = new Map(moves.map((m) => [m.card, m.to]));
        const seen = new Map(), clashes = [];
        for (const card of state.list) {
            const to = target.has(card) ? target.get(card) : card.collection;
            const id = `${isDefault(to) ? '' : to.toLowerCase()}/${card.folder.toLowerCase()}`;
            const first = seen.get(id);
            if (!first) seen.set(id, card);
            else if (target.has(card) || target.has(first))
                clashes.push(`${collName(to)} would get two "${card.folder}" cards`);
        }
        if (clashes.length)
            throw new Error(`${clashes.join('; ')}. Card folder names must be unique within a collection: leave one of them out, or delete it.`);
    }

    function wireCollections() {
        $('#c-cancel').addEventListener('click', closeCollection);
        $('#coll-close').addEventListener('click', closeCollection);
        $('#coll-modal').addEventListener('mousedown', (e) => { if (e.target.id === 'coll-modal') closeCollection(); });
        $('#c-save').addEventListener('click', saveCollection);
        document.addEventListener('pointerdown', closeConfirm);
        window.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (confirmEl) closeConfirm();
            else if (!$('#coll-modal').hidden) closeCollection();
        });
        $('#c-name').addEventListener('input', updateCollFolder);
        wireStickerEditor();
    }

    const DEFAULT_BINDER_PRICE = 5000;
    const DEFAULT_FOIL_PERCENT = 10;
    const DEFAULT_FOIL_MULTIPLIER = 2;
    const RETIRED_MODES = ['remove', 'refund', 'keep'];
    const DEFAULT_RETIRED_MODE = 'remove';
    const foilMultiplier = (config) => (config && config.foil && config.foil.priceMultiplier > 0 ? config.foil.priceMultiplier : DEFAULT_FOIL_MULTIPLIER);

    function configRarity(config, rarity) {
        const key = Object.keys(config.rarities || {}).find((k) => sameName(k, rarity));
        return key ? config.rarities[key] : null;
    }

    function renderSettings() {
        const config = state.config;
        $('#s-form').hidden = !config;
        $('#s-empty').hidden = !!config;
        $('#s-empty').innerHTML = !state.data ? 'Connect the <b>Guro-DaCard</b> folder.' : 'data/config.json can\'t be read.';
        setSettingsStatus('');
        if (!config) return;

        const table = $('#s-rarities');
        for (const el of $$(':scope > :not(.rt-head)', table)) el.remove();
        for (const r of RARITIES) {
            const cr = configRarity(config, r) || {};
            const pill = document.createElement('span');
            pill.className = 'facade-pill fx-sm rarity-pill';
            pill.textContent = r;
            paintRarity(pill, r);
            table.append(pill);
            table.insertAdjacentHTML('beforeend',
                `<input type="number" class="facade-input" data-rarity="${r}" data-k="price" min="1" step="500" inputmode="numeric" aria-label="${r} price" value="${cr.price > 0 ? cr.price : RARITY_DEFAULTS[r].price}">` +
                `<input type="number" class="facade-input" data-rarity="${r}" data-k="lootPercent" min="0" max="100" step="0.01" inputmode="decimal" aria-label="${r} spawn chance" value="${cr.lootPercent ?? 0}">`);
        }

        $('#s-binder-price').value = (config.binders && config.binders.price) || DEFAULT_BINDER_PRICE;
        $('#s-geek-cards').checked = !!(config.geek && config.geek.sellCards);
        $('#s-geek-foils').checked = !!(config.geek && config.geek.sellFoilCards);
        $('#s-foil-multiplier').value = foilMultiplier(config);
        $('#s-foil-percent').value = config.foil && config.foil.percent != null ? config.foil.percent : DEFAULT_FOIL_PERCENT;
        $('#s-retired').value = RETIRED_MODES.includes(config.retiredItems) ? config.retiredItems : DEFAULT_RETIRED_MODE;
        syncSelect($('#s-retired'));
    }

    function setSettingsStatus(text, ok) {
        const s = $('#s-status');
        s.hidden = !text;
        s.textContent = text || '';
        s.className = 'facade-status ' + (ok ? 'is-ok' : ok === false ? 'is-error' : '');
    }

    function prettyJson(value, indent = '', used = 0) {
        const inline = (v) => Array.isArray(v) ? (v.length ? `[${v.map(inline).join(', ')}]` : '[]')
            : v && typeof v === 'object' ? (Object.keys(v).length ? `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : '{}')
            : JSON.stringify(v);
        const one = inline(value);
        if (!value || typeof value !== 'object' || (indent && used + one.length <= 170)) return one;
        const pad = indent + '  ';
        if (Array.isArray(value)) return `[\n${value.map((x) => pad + prettyJson(x, pad, pad.length)).join(',\n')}\n${indent}]`;
        return `{\n${Object.entries(value).map(([k, x]) => {
            const key = `${pad}${JSON.stringify(k)}: `;
            return key + prettyJson(x, pad, key.length);
        }).join(',\n')}\n${indent}}`;
    }

    async function saveSettings() {
        if (!state.data) return;
        const file = await getFile(state.data, CONFIG_FILE);
        let config;
        try { config = JSON.parse(await file.text()); } catch (e) { toast.err('config.json could not be read', e.message); return; }

        const values = {};
        for (const input of $$('#s-rarities input')) {
            const v = parseFloat(input.value);
            const r = input.dataset.rarity, k = input.dataset.k;
            if (k === 'price' && !(v >= 1)) { toast.err(`${r} price`, 'Needs a price of at least 1 ₽.'); input.focus(); return; }
            if (k === 'lootPercent' && !(v >= 0 && v <= 100)) { toast.err(`${r} spawn chance`, 'Needs a percentage from 0 to 100.'); input.focus(); return; }
            (values[r] = values[r] || {})[k] = k === 'price' ? Math.round(v) : Math.round(v * 1000) / 1000;
        }
        const binderPrice = parseInt($('#s-binder-price').value, 10);
        if (!(binderPrice >= 1)) { toast.err('Binder price', 'Needs a price of at least 1 ₽.'); $('#s-binder-price').focus(); return; }
        const foilPercent = parseFloat($('#s-foil-percent').value);
        if (!(foilPercent >= 0 && foilPercent <= 100)) { toast.err('Foil chance', 'Needs a percentage from 0 to 100.'); $('#s-foil-percent').focus(); return; }
        const multiplier = parseFloat($('#s-foil-multiplier').value);
        if (!(multiplier > 0)) { toast.err('Foil price', 'Needs a multiplier above 0 (2 = twice the price).'); $('#s-foil-multiplier').focus(); return; }

        config.rarities = config.rarities || {};
        for (const r of RARITIES) {
            const key = Object.keys(config.rarities).find((k) => sameName(k, r)) || r;
            config.rarities[key] = Object.assign(config.rarities[key] || {}, values[r]);
        }
        config.binders = Object.assign(config.binders || {}, { price: binderPrice });
        config.geek = Object.assign(config.geek || {}, { sellCards: $('#s-geek-cards').checked, sellFoilCards: $('#s-geek-foils').checked });
        config.foil = Object.assign(config.foil || {}, { percent: Math.round(foilPercent * 100) / 100, priceMultiplier: Math.round(multiplier * 100) / 100 });
        config.retiredItems = RETIRED_MODES.includes($('#s-retired').value) ? $('#s-retired').value : DEFAULT_RETIRED_MODE;
        delete config.traders;
        delete config.traderSale;
        delete config.binders.traderSale;

        const button = $('#s-save');
        button.disabled = true;
        try {
            await writeFile(state.data, CONFIG_FILE, new Blob([prettyJson(config) + '\n'], { type: 'application/json' }));
            await readConfig();
            refreshPrices();
            renderCardsSide();
            toast.ok('Settings saved', 'Restart the SPT server to use them.');
            setSettingsStatus('Saved to data/config.json', true);
        } catch (e) {
            toast.err('Could not save the settings', e.message);
            setSettingsStatus('Not saved: ' + e.message, false);
        } finally {
            button.disabled = false;
        }
    }

    function wireSettings() {
        $('#s-save').addEventListener('click', saveSettings);
        $('#s-reset').addEventListener('click', renderSettings);
        $('#pane-settings').addEventListener('input', () => setSettingsStatus('Not saved yet'));
    }

    // The tabs are pages: #new, #cards, #collections, #settings (a refresh stays on the tab; Back / Forward move between them)
    const PANES = ['new', 'cards', 'packs', 'addons', 'settings'];
    const paneFromHash = () => (PANES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'new');

    function showPane(name, fromHistory = false) {
        if (!PANES.includes(name)) name = 'new';
        if (!fromHistory && location.hash.slice(1) !== name) history.pushState(null, '', '#' + name);
        for (const item of $$('.nav-item')) item.classList.toggle('active', item.dataset.pane === name);
        for (const pane of $$('.pane')) pane.classList.toggle('active', pane.id === 'pane-' + name);
        if (name === 'cards' && state.data) scanCards();
        if (name === 'packs' && window.CCPacks) window.CCPacks.show();
        if (name === 'addons' && window.CCAddons) window.CCAddons.render();
    }

    function boot() {
        for (const item of $$('.nav-item')) item.addEventListener('click', () => showPane(item.dataset.pane));
        window.addEventListener('popstate', () => showPane(paneFromHash(), true));
        window.addEventListener('hashchange', () => showPane(paneFromHash(), true));

        for (const sel of $$('select.facade-select')) enhanceSelect(sel);
        let textDrawQueued = false;
        const redrawCardText = () => {
            if (textDrawQueued) return;
            textDrawQueued = true;
            requestAnimationFrame(() => { textDrawQueued = false; drawCrop(); });
        };
        $('#f-rarity').addEventListener('change', () => { refreshPrices(); updateFolderHint(); redrawCardText(); });
        $('#f-name').addEventListener('input', () => { updateFolderHint(); redrawCardText(); });
        $('#f-desc').addEventListener('input', redrawCardText);
        $('#f-collection').addEventListener('change', updateFolderHint);
        document.fonts.load(`20px '${CARD_FONT}'`).then(() => {
            drawCrop();
            drawCollPreview();
        }).catch(() => {});

        MEDIA_SLOTS.forEach(wireMedia);
        window.setRange = setRange;
        $('#f-3d').addEventListener('change', (e) => set3d(e.target.checked, true));
        state.layers = CardLayerKit.createEditor($('#card-layers'), {
            collectionBlock: true,
            base: { side: 'front', el: $('#picture-3d') },
            sides: {
                front: { defaults: { canBeFoil: true }, note: 'Chance: per copy.' },
                back: { defaults: { canBeFoil: false }, note: 'None: default back.' },
            },
            onChange(what) {
                if (what !== 'preview' && what !== 'side') state.layersDirty = true;
                updatePlayback();
                drawCrop();
            },
            onSelect: () => drawCrop(),
            onError: (title, body) => toast.err(title, body),
            time: () => playT,
        });
        wireCollectionLayers();
        $('#normal-clear').addEventListener('click', () => clearMedia('normal'));
        $('#f-holo').addEventListener('change', () => drawCrop());
        $('#f-rare').addEventListener('change', () => drawCrop());
        $('#foil-clear').addEventListener('click', () => clearMedia('foil'));
        wireCrop();
        wireDepthRange();
        wirePreview3d();
        $('#save-card').addEventListener('click', saveToFolder);
        $('#save-zip').addEventListener('click', saveZip);

        $('#cards-search').addEventListener('input', renderCards);
        $('#cards-rarity').addEventListener('change', renderCards);
        $('#cards-refresh').addEventListener('click', () => (state.data ? scanCards() : connectFolder()));
        $('#folder-path-copy').addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(pageFolderPath());
                toast.ok('Path copied', 'Paste it into the folder picker\'s address bar.');
            } catch (e) {
                toast.err('Could not copy the path', e.message);
            }
        });

        $('#migrate-run').addEventListener('click', runMigrations);
        $('#f-addon').addEventListener('change', () => {
            defaultBack = defaultBackImg = null;
            fillCollectionSelects();
            updateFolderHint();
            ensureCollPreview().then(() => drawCrop());
        });
        $('#c-addon').addEventListener('change', () => {
            if (state.coll && !state.coll.source) state.coll.members.clear();
            defaultBack = defaultBackImg = null;
            renderCollCards();
            drawCollPreview();
        });
        $('#edit-close').addEventListener('click', closeEdit);
        $('#edit-cancel').addEventListener('click', closeEdit);
        $('#edit-delete').addEventListener('click', deleteCard);
        $('#edit-duplicate').addEventListener('click', duplicateCard);
        wireSettings();
        $('#edit-modal').addEventListener('mousedown', (e) => { if (e.target.id === 'edit-modal') closeEdit(); });
        window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#edit-modal').hidden) closeEdit(); });

        if (!window.showDirectoryPicker) {
            $('#folder-connect').hidden = true;
            $('#folder-note').innerHTML = 'Saves as .zip here. Chrome or Edge save into the game.';
        }
        updateFolderUi();
        set3d(false);
        wireCollections();
        for (const toggle of ['#preview-view', '#st-view', '#coll-view']) {
            const b = $(`${toggle} button[data-view="3d"]`);
            if (b && !b.disabled) b.click();
        }
        if (window.CCPacks) window.CCPacks.init({
            state, toast, getDir, getFile, writeFile, slugify, newFolder, escapeHtml, paintRarity, rarityColor,
            enhanceSelect, setRange, prettyJson, readConfig, collName, addonName, scanAddons, syncSelect, defaultSkinsDir, confirmMenu,
        });
        if (window.CCBatch) window.CCBatch.init({
            state, toast, getDir, writePath, newFolder, enhanceSelect, sameName, collectionLayers, cardVars, cardJson, thumbnail, pngBlob,
            scanCards, scanAddons, fillCollectionSelects, THUMB_FILE,
        });
        if (window.CCAddons) window.CCAddons.init({ state, toast, escapeHtml, download, rescan });
        const pane = paneFromHash();
        history.replaceState(null, '', '#' + pane);
        showPane(pane, true);
        restoreFolder().catch(() => {});
    }

    boot();
})();
