(() => {
    'use strict';

    const DEFAULT_RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
    const RARITY_DEFAULTS = {
        Common: { price: 5000, color: '#B8BCC4', weight: 68 },
        Uncommon: { price: 15000, color: '#4FD65A', weight: 22 },
        Rare: { price: 40000, color: '#3F8CFF', weight: 7 },
        Epic: { price: 100000, color: '#B04FFF', weight: 2 },
        Legendary: { price: 250000, color: '#FFB32E', weight: 1 },
    };
    const NO_RARITY_COLOR = '#8E8E93';
    const RARITY_NAME = /^[\p{L}\p{N}][\p{L}\p{N} _'.-]{0,23}$/u;
    const MAX_RARITIES = 12;
    const HEX_COLOR = /^#[0-9a-f]{6}$/i;
    const DEFAULT_FOIL_TYPES = ['foil'];
    const CARD_W = 490, CARD_H = 684;
    const WINDOW_RECT = [0.031, 0.022, 0.969, 0.978];
    const PREVIEW_SCALE = 0.5;

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

    const state = {
        offline: false,
        data: null,
        cards: null,
        list: [],
        urls: [],
        use3d: false,
        depthRange: null,
        pictureSurface: null,
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
        cardsView: '*',
        pictureDirty: false,                // changed since it was opened: written again when saving
        layersDirty: false,
        textAlign: {},
        collHidden: new Set(),              // the collection's layers (by file) switched off on this card; 'all': every one
        collPreview: { folder: null, layers: { front: [], back: [] } },
        collLayers: new Map(),              // collection folder -> Promise of its layers (for previews)
        collections: [],
        config: null,
        coll: null,
    };

    const toast = {
        ok: (title, body) => window.FacadeToast ? FacadeToast.success(title, body) : console.log(title, body),
        err: (title, body) => window.FacadeToast ? FacadeToast.error(title, body) : console.error(title, body),
    };

    const LOGO_SVG = '<svg class="logo-icon" viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="7" width="15" height="21" rx="2" transform="rotate(-12 10.5 17.5)" fill="none" stroke="currentColor" stroke-width="2.4"/><rect x="13" y="4" width="15" height="21" rx="2" fill="currentColor"/></svg>';
    const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'card';

    function hexToRgbTriple(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        if (!m) return '142, 142, 147';
        const n = parseInt(m[1], 16);
        return `${n >> 16}, ${(n >> 8) & 255}, ${n & 255}`;
    }

    function defaultRarities() {
        const saved = (state.config && state.config.rarities) || {};
        return DEFAULT_RARITIES.map((name) => {
            const key = Object.keys(saved).find((k) => sameName(k, name));
            const r = (key && saved[key]) || {}, d = RARITY_DEFAULTS[name];
            return {
                name,
                color: HEX_COLOR.test(r.color || '') ? r.color.toUpperCase() : d.color,
                price: r.price > 0 ? r.price : d.price,
                weight: Number.isFinite(r.weight) && r.weight >= 0 ? r.weight : d.weight,
            };
        });
    }

    const overviewColl = (id) => (id && state.data ? (state.data.collections || []).find((c) => sameName(c.id, id)) || null : null);

    function raritiesOf(collectionId) {
        const own = overviewColl(collectionId);
        return own && Array.isArray(own.rarities) && own.rarities.length ? own.rarities : defaultRarities();
    }

    function rarityOf(rarity, collectionId) {
        const find = (list) => list.find((r) => sameName(r.name, rarity));
        let hit = find(raritiesOf(collectionId)) || find(defaultRarities());
        for (const c of (state.data && state.data.collections) || []) {
            if (hit) break;
            if (Array.isArray(c.rarities)) hit = find(c.rarities);
        }
        return hit || null;
    }

    function rarityColor(rarity, collectionId) { const r = rarityOf(rarity, collectionId); return r ? r.color : NO_RARITY_COLOR; }
    function rarityPrice(rarity, collectionId) { const r = rarityOf(rarity, collectionId); return r ? r.price : 0; }
    const rarityRank = (rarity, collectionId) => raritiesOf(collectionId).findIndex((r) => sameName(r.name, rarity));

    function rarityNames() {
        const names = [...DEFAULT_RARITIES];
        for (const c of (state.data && state.data.collections) || [])
            for (const r of Array.isArray(c.rarities) ? c.rarities : []) if (!names.some((n) => sameName(n, r.name))) names.push(r.name);
        return names;
    }

    function rarityCounts(list, rarities) {
        const counts = new Map(list.map((r) => [r.name, 0]));
        for (const name of rarities) {
            const hit = list.find((r) => sameName(r.name, name));
            if (hit) counts.set(hit.name, counts.get(hit.name) + 1);
        }
        return counts;
    }

    function rarityOdds(list, counts = null) {
        const weight = (r) => Math.max(0, +r.weight || 0);
        const total = list.reduce((sum, r) => sum + weight(r), 0);
        const live = list.filter((r) => !counts || counts.get(r.name) > 0).reduce((sum, r) => sum + weight(r), 0);
        let acc = 0;
        return list.map((r) => {
            const lo = total > 0 ? (acc / total) * 100 : 0;
            acc += weight(r);
            const count = counts ? counts.get(r.name) || 0 : null;
            const rerolled = !!counts && !count;
            const chance = !rerolled && live > 0 ? weight(r) / live : 0;
            return { ...r, lo, hi: total > 0 ? (acc / total) * 100 : 0, count, rerolled, chance, each: count ? chance / count : 0 };
        });
    }

    const percentText = (v) => `${+v.toFixed(v >= 10 ? 1 : v >= 1 ? 2 : 3)}`;

    function oddsText(o) {
        const range = `${percentText(o.lo)}–${percentText(o.hi)}`;
        if (o.count == null) return `${range} · ${percentText(o.chance * 100)}%`;
        if (o.rerolled) return `${range} · no cards, re-rolled`;
        return `${range} · ${percentText(o.chance * 100)}% · ${o.count} card${o.count === 1 ? '' : 's'} · ${percentText(o.each * 100)}% each`;
    }

    function renderOddsBar(el, odds) {
        el.innerHTML = '';
        for (const o of odds) {
            const share = o.hi - o.lo;
            if (!(share > 0)) continue;
            const seg = document.createElement('div');
            seg.className = 'odds-seg';
            seg.style.width = `${share}%`;
            seg.style.background = o.color;
            seg.title = `${o.name}: ${percentText(o.lo)}–${percentText(o.hi)}`;
            const label = document.createElement('span');
            label.textContent = share >= 9 ? o.name : share >= 3 ? percentText(share) : '';
            seg.appendChild(label);
            el.appendChild(seg);
        }
    }

    function fillRaritySelect(sel, collectionId, fallback) {
        const list = raritiesOf(collectionId);
        const want = sel.value || fallback;
        sel.innerHTML = list.map((r) => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join('');
        const hit = list.find((r) => sameName(r.name, want));
        sel.value = hit ? hit.name : list[0].name;
        syncSelect(sel);
    }

    const fillCardRarity = () => fillRaritySelect($('#f-rarity'), $('#f-collection').value || null);

    function foilChanceOf(collectionId) {
        const own = overviewColl(collectionId);
        if (own && typeof own.foilChance === 'number') return own.foilChance;
        return settingsFoilChance();
    }

    const settingsFoilChance = () => (state.config && state.config.foil && Number.isFinite(state.config.foil.percent) ? state.config.foil.percent : DEFAULT_FOIL_PERCENT);
    const foilTypeList = () => {
        const listed = state.data && Array.isArray(state.data.foilTypes) ? state.data.foilTypes : [];
        return [...listed, ...CardLayerKit.FOIL_TYPES.filter((t) => !listed.some((x) => x.id === t.id))];
    };

    function paintRarity(el, rarity, collectionId) {
        const color = rarityColor(rarity, collectionId);
        el.style.setProperty('--cc-rarity', color);
        el.style.setProperty('--cc-rarity-rgb', hexToRgbTriple(color));
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

    async function getDir(parent, name) {
        try { return await parent.getDirectoryHandle(name); } catch { return null; }
    }
    async function getFile(parent, name) {
        try { return await (await parent.getFileHandle(name)).getFile(); } catch { return null; }
    }

    async function loadOverview() {
        const overview = await DaApi.get('/api/overview');
        state.data = overview;
        state.config = overview.settings || null;
        return overview;
    }

    let rescanning = null;
    async function rescan() {
        if (rescanning) return rescanning;
        rescanning = (async () => {
            try {
                await loadOverview();
                renderSettings();
                await scanCollections();
                await scanCards();
                packsChanged('folder');
                if (window.CCCollections) CCCollections.render();
                await showMigrations();
                showLegacy();
                redrawStale();
            } catch (e) {
                toast.err('Could not load the data', e.message);
            } finally {
                updateFolderUi();
                rescanning = null;
            }
        })();
        return rescanning;
    }

    async function showMigrations() {
        const notes = (state.data && state.data.migrations) || [];
        if (!notes.length) return;
        for (const r of notes) {
            const d = r.details || {};
            const what = d.cards ? `${d.cards} card${d.cards === 1 ? '' : 's'}, ${(d.collections || []).length} collection${(d.collections || []).length === 1 ? '' : 's'}` : '';
            const packs = (Array.isArray(d.packs) ? d.packs : []).map((p) => `${p.name} → ${p.collection || 'no collection'}${p.dropped ? ` (${p.dropped} card${p.dropped === 1 ? '' : 's'} dropped)` : ''}`);
            toast.ok('Data updated', [r.title, what, ...packs, r.by === 'server' ? 'on server start' : ''].filter(Boolean).join(' · '));
            for (const w of (d.warnings || []).slice(0, 5)) toast.err('Update note', w);
        }
        await DaApi.post('/api/migrations/seen').catch(() => {});
        state.data.migrations = [];
    }

    let legacyShown = false;
    function showLegacy() {
        if (legacyShown || !state.data || !state.data.legacyFolder || !window.FacadeToast) return;
        legacyShown = true;
        FacadeToast.success('Old data', 'Pre-2.0 data in _legacy is already imported. You can delete it.', {
            timeout: 0,
            action: { text: 'Open folder', onClick: () => DaApi.post('/api/legacy/open').catch((e) => toast.err('Could not open the folder', e.message)) },
        });
    }

    async function readConfig() {
        await loadOverview().catch(() => {});
        renderSettings();
        packsChanged('config');
    }

    function packsChanged(what) {
        if (window.CCPacks) window.CCPacks.changed(what);
    }

    function updateFolderUi() {
        const pill = $('#folder-pill');
        const on = !!state.data;
        pill.textContent = state.offline ? 'Dashboard stopped' : on ? 'Connected' : 'Loading…';
        pill.className = 'facade-pill fx-sm ' + (state.offline ? 'fx-red' : on ? 'fx-green' : 'fx-grey');
        refreshPrices();
        updateFolderHint();
    }

    const THUMB_FILE = 'thumb.png';
    const THUMB_SCALE = 0.5;

    async function scanCards() {
        const cards = (state.data && state.data.cards) || [];
        const kept = new Map(state.list.map((c) => [c.id, c]));
        state.list = cards.map((c) => {
            const old = kept.get(c.id);
            const fresh = old && old.updated === c.thumb && old.rarity === c.rarity && old.collection === c.collectionId;
            return {
                id: c.id, key: c.id, folder: c.id, collection: c.collectionId, rarity: c.rarity, updated: c.thumb,
                data: fresh && old.doc ? old.data : { name: c.name, shortName: c.shortName, type: c.type, ...(c.animated && { animation: {} }) },
                doc: fresh ? old.doc : null, dir: fresh ? old.dir : null, thumbUrl: c.thumb, stale: !!c.thumbStale,
            };
        });
        const rank = new Map(state.list.map((c) => [c, rarityRank(c.rarity, c.collection)]));
        state.list.sort((a, b) => rank.get(b) - rank.get(a) || (a.data.name || '').localeCompare(b.data.name || '')
            || collName(a.collection).localeCompare(collName(b.collection)));
        fillRarityFilter();
        renderCardsSide();
        renderCards();
        const count = $('#cards-count');
        count.hidden = !state.data;
        count.textContent = state.list.length;
        updateFolderHint();
        packsChanged('cards');
    }

    function fillRarityFilter() {
        const sel = $('#cards-rarity');
        const value = sel.value;
        const names = rarityNames();
        sel.innerHTML = '<option value="">All rarities</option>' + names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
        sel.value = names.find((n) => sameName(n, value)) || '';
        syncSelect(sel);
    }

    async function loadCardDoc(card, fresh = false) {
        if (card.doc && !fresh) return card;
        const doc = await DaApi.get(`/api/cards/${card.id}`);
        card.doc = doc;
        card.data = doc.json;
        card.rarity = doc.rarity;
        card.collection = doc.collectionId;
        card.dir = DaApi.folder(doc);
        return card;
    }

    function cardType(c) { return (c.data.type || '2d').toLowerCase(); }

    const CARDS_PAGE = 120;
    const COLL_CARDS_PAGE = 100;
    const ADD_HITS = 20;

    function renderPager(el, page, pages, onPage) {
        el.innerHTML = '';
        el.hidden = pages <= 1;
        if (pages <= 1) return;
        const add = (label, target, on = false) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'facade-btn fx-sm' + (on ? ' fx-on is-on' : ' fx-grey');
            b.textContent = label;
            b.disabled = target < 0 || target >= pages;
            b.addEventListener('click', () => onPage(target));
            el.appendChild(b);
        };
        const gap = () => {
            const s = document.createElement('span');
            s.className = 'pager-gap';
            s.textContent = '…';
            el.appendChild(s);
        };
        add('‹', page - 1);
        const shown = [...new Set([0, pages - 1, page - 2, page - 1, page, page + 1, page + 2].filter((p) => p >= 0 && p < pages))].sort((a, b) => a - b);
        shown.forEach((p, i) => {
            if (i > 0 && p - shown[i - 1] > 1) gap();
            add(String(p + 1), p, p === page);
        });
        add('›', page + 1);
    }

    function cardSearch({ skip, label, pick, placeholder = 'Add a card: search its name' }) {
        const add = document.createElement('div');
        add.className = 'coll-add';
        add.innerHTML = '<input type="search" class="facade-input" autocomplete="off"><div class="coll-add-hits"></div>';
        const input = add.querySelector('input'), hits = add.querySelector('.coll-add-hits');
        input.placeholder = placeholder;
        input.addEventListener('input', () => {
            hits.innerHTML = '';
            const q = input.value.trim().toLowerCase();
            if (!q) return;
            const found = [];
            for (const c of state.list) {
                if (skip(c) || !((c.data.name || '').toLowerCase().includes(q) || c.id.includes(q))) continue;
                found.push(c);
                if (found.length >= ADD_HITS) break;
            }
            for (const c of found) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'facade-btn fx-sm fx-grey';
                b.textContent = label(c);
                b.addEventListener('click', () => pick(c));
                hits.appendChild(b);
            }
        });
        return add;
    }

    function renderCards() {
        const grid = $('#cards-grid');
        const q = $('#cards-search').value.trim().toLowerCase();
        const rarity = $('#cards-rarity').value;
        const view = state.cardsView;
        const shown = state.list.filter((c) =>
            (view === '*' || sameName(c.collection, view)) &&
            (!rarity || sameName(c.rarity, rarity)) &&
            (!q || (c.data.name || '').toLowerCase().includes(q) || collName(c.collection).toLowerCase().includes(q) || c.id.includes(q)));
        grid.innerHTML = '';
        const pages = Math.max(1, Math.ceil(shown.length / CARDS_PAGE));
        const key = `${view}|${rarity}|${q}`;
        if (state.cardsPageKey !== key) { state.cardsPageKey = key; state.cardsPage = 0; }
        state.cardsPage = Math.min(Math.max(0, state.cardsPage || 0), pages - 1);
        renderPager($('#cards-pager'), state.cardsPage, pages, (p) => {
            state.cardsPage = p;
            renderCards();
            $('#cards-grid').scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
        for (const c of shown.slice(state.cardsPage * CARDS_PAGE, (state.cardsPage + 1) * CARDS_PAGE)) {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'card-tile';
            paintRarity(tile, c.rarity, c.collection);
            const src = c.thumbUrl || '';
            tile.innerHTML = `
                <img alt="" ${src ? `src="${src}"` : ''} loading="lazy">
                <span class="tile-name">${escapeHtml(c.data.name || c.folder)}</span>
                <span class="tile-meta">
                    <span class="facade-pill fx-sm rarity-pill">${escapeHtml(c.rarity)}</span>
                    ${cardType(c) === '3d' ? '<span class="facade-chip fx-purple">3D layer</span>' : ''}
                    ${c.data.animation ? '<span class="facade-chip fx-amber">Animated</span>' : ''}
                </span>
                <span class="tile-coll">${escapeHtml(collName(c.collection))}</span>`;
            tile.addEventListener('click', () => openEdit(c));
            grid.appendChild(tile);
        }
        const empty = $('#cards-empty');
        empty.hidden = shown.length > 0;
        empty.textContent = !state.data ? 'Loading…'
            : state.list.length ? 'No card matches.' : 'No cards yet. Make one under New card.';
    }

    // Cards' left column: All cards, every collection (its binder), No collection
    function renderCardsSide() {
        const side = $('#cards-side');
        side.innerHTML = '';
        const entries = [{ key: '*', name: 'All cards', count: state.list.length }];
        for (const coll of state.collections)
            entries.push({ key: coll.folder, name: coll.data.name, count: state.list.filter((c) => isMember(c, coll)).length, coll });
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
            else if (e.key === '*') thumb.innerHTML = LOGO_SVG;
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
                    confirmMenu(ev.currentTarget, `Delete "${e.coll.data.name}"?`, n ? `Its ${n} card${n === 1 ? '' : 's'} and booster packs are deleted too.` : 'It has no cards.', 'Delete', () => deleteCollection(e.coll));
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

    function collName(folder) {
        const coll = folder ? state.collections.find((c) => sameName(c.folder, folder)) : null;
        return coll ? coll.data.name : folder ? 'Missing collection' : 'No collection';
    }

    const has3d = () => state.use3d;

    const DEPTH_FLOATS = { near: '_nearDepth', far: '_farDepth', back: '_backPlane', strength: '_depthStrength' };
    const DEPTH_GAP = 0.02;
    const DEPTH_MAX = 2;
    const STRENGTH_MAX = 2;
    const round3 = (v) => Math.round(v * 1000) / 1000;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    function depthDefaults() {
        const types = (state.config && state.config.cardTypes) || {};
        const key = Object.keys(types).find((k) => sameName(k, '3d'));
        const floats = (key && types[key] && types[key].floats) || {};
        const material = window.CardView ? CardView.MATERIAL : { nearDepth: 0, farDepth: 1, backPlane: 0, depthStrength: 1 };
        const pick = (k, fallback) => (Number.isFinite(floats[DEPTH_FLOATS[k]]) ? floats[DEPTH_FLOATS[k]] : fallback);
        return {
            near: pick('near', material.nearDepth),
            far: pick('far', material.farDepth),
            back: pick('back', material.backPlane),
            strength: pick('strength', material.depthStrength),
        };
    }

    function depthRange() {
        const d = depthDefaults(), r = state.depthRange || {};
        return Object.fromEntries(Object.keys(d).map((k) => [k, Number.isFinite(r[k]) ? r[k] : d[k]]));
    }

    function depthFromFloats(floats) {
        const f = floats || {};
        const r = Object.fromEntries(Object.entries(DEPTH_FLOATS).filter(([, name]) => Number.isFinite(f[name])).map(([k, name]) => [k, f[name]]));
        return Object.keys(r).length ? { ...depthDefaults(), ...r } : null;
    }

    function depthFloats(existing, is3d) {
        const floats = { ...(existing || {}) };
        for (const name of Object.values(DEPTH_FLOATS)) delete floats[name];
        if (is3d && state.depthRange) {
            const r = depthRange();
            for (const [k, name] of Object.entries(DEPTH_FLOATS)) floats[name] = round3(r[k]);
        }
        return Object.keys(floats).length ? floats : null;
    }

    function showDepthRange() {
        const { near, far, back, strength } = depthRange();
        const box = $('#depth-box');
        const mid = (near + far) / 2, half = (far - near) / 2 * Math.min(strength, 1);
        for (const [name, v] of [['start', near], ['end', far], ['lo', mid - half], ['hi', mid + half]])
            box.style.setProperty(`--${name}`, v / DEPTH_MAX);
        box.style.setProperty('--hatch', strength > 1 ? 1 : 0.55 + 0.45 * strength);
        const percent = Math.round(strength * 100);
        $('#depth-strength').textContent = `${percent}%`;
        $('#depth-strength').setAttribute('aria-valuenow', percent);
        $('#depth-start').setAttribute('aria-valuenow', near.toFixed(2));
        $('#depth-end').setAttribute('aria-valuenow', far.toFixed(2));
        $('#depth-back').value = back;
        $('#depth-back-value').textContent = back.toFixed(2);
        $('#depth-note').textContent = `Start ${near.toFixed(2)} · end ${far.toFixed(2)}` + (state.depthRange ? '' : ' (default)');
        $('#depth-reset').style.visibility = state.depthRange ? '' : 'hidden';
    }

    const SURFACE_FLOATS = { roughness: '_PictureRoughness', metallic: '_PictureMetallic' };
    const surfaceFields = {};

    function surfaceDefault(key) {
        const material = window.CardView ? CardView.MATERIAL : { pictureRoughness: 1, pictureMetallic: 0 };
        return key === 'roughness' ? material.pictureRoughness : material.pictureMetallic;
    }

    function surfaceValue(key) {
        const v = state.pictureSurface && state.pictureSurface[key];
        return Number.isFinite(v) ? v : surfaceDefault(key);
    }

    function surfaceFromFloats(floats) {
        const f = floats || {};
        const r = Object.fromEntries(Object.entries(SURFACE_FLOATS).filter(([, name]) => Number.isFinite(f[name])).map(([k, name]) => [k, f[name]]));
        return Object.keys(r).length ? r : null;
    }

    function surfaceFloats(existing, is3d) {
        const floats = { ...(existing || {}) };
        for (const name of Object.values(SURFACE_FLOATS)) delete floats[name];
        if (is3d && state.pictureSurface)
            for (const [k, name] of Object.entries(SURFACE_FLOATS))
                if (Number.isFinite(state.pictureSurface[k])) floats[name] = round3(state.pictureSurface[k]);
        return Object.keys(floats).length ? floats : null;
    }

    function showSurfaceFields() {
        for (const field of Object.values(surfaceFields)) field.update();
    }

    function wireSurfaceFields() {
        for (const key of Object.keys(SURFACE_FLOATS)) {
            const set = (v) => {
                const next = { ...(state.pictureSurface || {}) };
                if (v === null) delete next[key]; else next[key] = v;
                state.pictureSurface = Object.keys(next).length ? next : null;
                applyDepthMaterial();
            };
            const field = CardLayerKit.scrubField('Value', {
                decimals: 2, min: 0, max: 1, perPixel: 0.005,
                title: 'Without a map (double-click the grip for the default)',
                value: () => surfaceValue(key),
                set: (v) => set(v),
                clear: () => set(null),
                isDefault: () => !(state.pictureSurface && Number.isFinite(state.pictureSurface[key])),
                disabled: () => !!state[key],
            });
            surfaceFields[key] = field;
            $(`#${key}-value`).appendChild(field.el);
        }
    }

    function applyDepthMaterial() {
        const { near, far, back, strength } = depthRange();
        if (cardView) cardView.setMaterial({
            nearDepth: near, farDepth: far, backPlane: back, depthStrength: strength,
            pictureRoughness: surfaceValue('roughness'), pictureMetallic: surfaceValue('metallic'),
        });
    }

    function setDepth(change) {
        state.depthRange = { ...depthRange(), ...change };
        showDepthRange();
        applyDepthMaterial();
    }

    function moveDepth(part, value, from = depthRange()) {
        const { near, far } = from;
        if (part === 'start') setDepth({ near: clamp(value, 0, far - DEPTH_GAP) });
        else if (part === 'end') setDepth({ far: clamp(value, near + DEPTH_GAP, DEPTH_MAX) });
        else {
            const width = far - near, start = clamp(value, 0, DEPTH_MAX - width);
            setDepth({ near: start, far: start + width });
        }
    }

    function dragWith(el, e, move) {
        el.setPointerCapture(e.pointerId);
        const up = () => {
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
            el.removeEventListener('pointercancel', up);
            delete el.dataset.drag;
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
    }

    const arrowStep = (e) => {
        const dir = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
        if (!dir) return 0;
        e.preventDefault();
        return dir * (e.shiftKey ? 0.1 : 0.01);
    };

    function wireDepthRange() {
        const box = $('#depth-box'), strengthEl = $('#depth-strength');
        const depthAt = (y) => {
            const r = box.getBoundingClientRect();
            return clamp((r.bottom - y) / r.height, 0, 1) * DEPTH_MAX;
        };
        box.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const at = depthAt(e.clientY), from = depthRange();
            const touching = (from.far - from.near) / DEPTH_MAX * box.getBoundingClientRect().height < 10;
            let part = e.target.id === 'depth-start' ? 'start' : e.target.id === 'depth-end' ? 'end' : e.target.id === 'depth-band' ? 'band'
                : Math.abs(at - from.near) <= Math.abs(at - from.far) ? 'start' : 'end';
            if (touching && part !== 'band') part = null;
            const offset = part === 'band' ? at - from.near : 0;
            const move = (ev) => {
                if (!part) {
                    if (Math.abs(ev.clientY - e.clientY) < 2) return;
                    part = ev.clientY < e.clientY ? 'end' : 'start';
                    box.dataset.drag = part;
                }
                moveDepth(part, depthAt(ev.clientY) - offset, part === 'band' ? from : depthRange());
            };
            if (part && part !== 'band') move(e);
            if (part) box.dataset.drag = part;
            dragWith(box, e, move);
        });
        for (const [id, part] of [['#depth-start', 'start'], ['#depth-end', 'end'], ['#depth-band', 'band']]) {
            $(id).addEventListener('keydown', (e) => {
                const step = arrowStep(e);
                if (!step) return;
                const r = depthRange();
                moveDepth(part, (part === 'end' ? r.far : r.near) + step);
            });
        }

        const setStrength = (v) => setDepth({ strength: Math.round(clamp(v, 0, STRENGTH_MAX) * 100) / 100 });
        strengthEl.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const x0 = e.clientX, y0 = e.clientY, s0 = depthRange().strength;
            strengthEl.dataset.drag = 'strength';
            dragWith(strengthEl, e, (ev) => setStrength(s0 + ((ev.clientX - x0) - (ev.clientY - y0)) * 0.005));
        });
        strengthEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            setStrength(1);
        });
        strengthEl.addEventListener('keydown', (e) => {
            const step = arrowStep(e);
            if (step) setStrength(depthRange().strength + step);
        });

        $('#depth-back').addEventListener('input', (e) => setDepth({ back: +e.target.value }));
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
        $('#roughness-clear').hidden = !state.roughness;
        $('#normal-gl').closest('label').hidden = !state.normal;
        $('#normal-gl').checked = !!(state.normal && state.normal.openGL);
        $('#metallic-clear').hidden = !state.metallic;
        showDepthRange();
        showSurfaceFields();
        const depthView = is3d && !!state.art && !!state.depth;
        if (!depthView) state.show = 'art';
        for (const b of $$('#crop-toggle button')) b.classList.toggle('fx-on', b.dataset.show === state.show);
        $('#crop-toggle').hidden = !depthView || preview3d();
        drawCrop();
    }

    const roubles = (n) => `${Math.round(n).toLocaleString('en-US')} ₽`;
    const priceNote = (rarity, collectionId) => `${roubles(rarityPrice(rarity, collectionId))} · Foil: up to ×2`;

    function refreshPrices() {
        const rarity = $('#f-rarity').value, coll = $('#f-collection').value || null;
        $('#f-price').textContent = priceNote(rarity, coll);
        paintRarity($('#crop'), rarity, coll);
        paintRarity($('#card-3d'), rarity, coll);
        refresh3d();
    }

    const newFolder = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

    function updateFolderHint() {
        const hint = $('#f-folder');
        const editing = state.editingCard;
        const coll = $('#f-collection').value;
        hint.textContent = !state.collections.length ? 'Make a collection first (Collections).'
            : editing ? `Card ${editing.id} in ${collName(coll)}` : `New card in ${collName(coll)}`;
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
            normal: state.normal ? normalCanvas(frameOf(state.normal)) : null,
            canBeFoil: true, frame: false,
        }];
    }

    // The card's layers, the collection's over them, the card's layers marked over the collection
    const everyCopy = (layers, selected = null, rare = false) => (rare ? layers : layers.filter((l) => l.chance >= 100 || l === selected || (!!selected && !!l.variants && l.variants.includes(selected))));

    function stackParts(side) {
        const coll = state.collPreview.layers;
        return CardLayerKit.parts(CardLayerKit.ordered(state.layers[side], everyCopy(coll[side], null, $('#f-rare').checked)), playT, formCtx());
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
        cardFoilPick();
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
            if (holo) drawFoilTint(ctx, stack.foil, cardFoilPick());
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
        const rare = editor === state.layers || $('#coll-rare').checked;
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
            if (!layer || CardLayerKit.isText(layer) || !CardLayerKit.shapeOf(layer)) return;
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

    const FOIL_HUES = ['#ff4d6d', '#ffd24d', '#5dff8a', '#4dd2ff', '#b44dff', '#ff4d6d'];
    const SPEC_K1 = [3.54585104, 2.93225262, 2.41593945], SPEC_O1 = [0.69549072, 0.49228336, 0.27699880], SPEC_Y1 = [0.02312639, 0.15225084, 0.52607955];
    const SPEC_K2 = [3.90307140, 3.21182957, 3.96587128], SPEC_O2 = [0.11748627, 0.86755042, 0.66077860], SPEC_Y2 = [0.84897130, 0.88445281, 0.73949448];
    const TAU = Math.PI * 2;
    const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const fract = (v) => v - Math.floor(v);
    const stepAt = (edge, v) => (v >= edge ? 1 : 0);

    function dcHash(x, y) {
        let qx = fract(x * 123.34), qy = fract(y * 456.21);
        const d = qx * (qx + 45.32) + qy * (qy + 45.32);
        qx += d; qy += d;
        return fract(qx * qy);
    }

    function addSpectral(out, x, k) {
        for (let i = 0; i < 3; i++) {
            const a = SPEC_K1[i] * (x - SPEC_O1[i]), b = SPEC_K2[i] * (x - SPEC_O2[i]);
            out[i] += k * (sat(1 - a * a - SPEC_Y1[i]) + sat(1 - b * b - SPEC_Y2[i]));
        }
    }
    const addSpec = (out, t, k) => addSpectral(out, fract(t), k);

    function foilPatternAt(type, ux, uy, fw, out) {
        const px = ux - 0.5, py = (uy - 0.5) * 1.397;
        const vl = Math.hypot(px, py, 2), ll = Math.hypot(0.7 - px, 1.4 - py, 2);
        const Vx = -px / vl, Vy = -py / vl, Vz = 2 / vl, Lx = (0.7 - px) / ll, Ly = (1.4 - py) / ll, Lz = 2 / ll;
        const hx = Lx + Vx, hy = Ly + Vy, hl = Math.hypot(hx + 1e-5, hy + 1e-5);
        const nhx = (hx + 1e-5) / hl, nhy = (hy + 1e-5) / hl;
        const spot = 0.55 + 0.75 * Math.pow(sat((Lz + Vz) / Math.hypot(Lx + Vx, Ly + Vy, Lz + Vz)), 12);
        const col = [0, 0, 0];
        let glint = 0, dx = 0.866, dy = 0.5, gate = 1, sheen = 0, grating = true;
        if (type === 11) {
            const qx = ux * 9, qy = uy * 12.573, bx = Math.floor(qx), by = Math.floor(qy);
            let d1 = 8, ix = bx, iy = by;
            for (let j = -1; j <= 1; j++)
                for (let i = -1; i <= 1; i++) {
                    const nx = bx + i, ny = by + j;
                    const d = Math.hypot(qx - (nx + 0.1 + 0.8 * dcHash(nx, ny + 3.3)), qy - (ny + 0.1 + 0.8 * dcHash(nx + 5.7, ny)));
                    if (d < d1) { d1 = d; ix = nx; iy = ny; }
                }
            const turn = dcHash(ix + 1.7, iy + 9.2) * TAU;
            dx = Math.cos(turn); dy = Math.sin(turn);
            gate = 0.45 + 0.55 * dcHash(ix + 6.6, iy + 2.2);
            sheen = 0.25;
        } else if (type === 10) {
            grating = false;
            const nx = ux * 7, ny = uy * 9.779, ix = Math.floor(nx), iy = Math.floor(ny);
            let fx = fract(nx), fy = fract(ny);
            fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
            const lerp = (a, b, t) => a + (b - a) * t;
            const dens = 0.45 + 0.3 * lerp(lerp(dcHash(ix, iy), dcHash(ix + 1, iy), fx), lerp(dcHash(ix, iy + 1), dcHash(ix + 1, iy + 1), fx), fy);
            const ppx = ux, ppy = uy * 1.397;
            for (let k = 0; k < 3; k++) {
                const s = [113, 139, 167][k], an = [0.31, 1.13, 2.07][k];
                const qx = (Math.cos(an) * ppx - Math.sin(an) * ppy) * s + 0.37 * k, qy = (Math.sin(an) * ppx + Math.cos(an) * ppy) * s + 0.61 * k;
                const cx = Math.floor(qx) + 41.3 * k, cy = Math.floor(qy) + 27.1 * k;
                const rad = 0.0026 * s * (0.85 + 0.3 * dcHash(cx + 7.7, cy + 3.3));
                const ox = (dcHash(cx + 1.3, cy) - 0.5) * (1 - 2 * rad), oy = (dcHash(cx, cy + 2.9) - 0.5) * (1 - 2 * rad);
                const d = Math.hypot(fract(qx) - 0.5 - ox, fract(qy) - 0.5 - oy);
                const turn = dcHash(cx + 4.1, cy + 2.3) * TAU;
                const tw = Math.pow(sat(Math.cos(turn) * nhx + Math.sin(turn) * nhy), 3);
                const dotMask = sat((rad - d) / Math.max(fw * s * 1.5, 0.05) + 0.5) * stepAt(1 - dens, dcHash(cx, cy));
                if (dotMask > 0) addSpec(col, ux * 0.35 + uy * 0.75 + dcHash(cx + 8.8, cy) * 0.15, dotMask * (0.45 + 1.1 * tw) * 1.7);
                glint += dotMask * tw * tw * tw * 0.45;
            }
        } else if (type === 9) {
            grating = false;
            const ph = Math.hypot(px + 0.45, py - 1) * 2.4;
            addSpec(col, ph, (0.6 + 0.4 * Math.cos(TAU * ph * 0.5)) * 1.6);
            glint = Math.pow(sat(1 - Math.abs(fract(ph * 0.5) - 0.5) * 8), 3) * 0.5;
        } else if (type === 8) {
            grating = false;
            const ph = (px * 0.8 + py * 0.6) * 1.4;
            const band = Math.pow(0.5 + 0.5 * Math.cos(TAU * ph), 3);
            const band2 = Math.pow(0.5 + 0.5 * Math.cos(TAU * (ph * 2.7 + 0.3)), 10) * 0.6;
            addSpec(col, ph * 0.8 + py * 0.25, (band + band2) * 2);
            glint = Math.pow(band, 6) * 0.5;
        } else if (type === 7) {
            const qx = ux * 8, qy = uy * 11.176;
            const bx = fract(qx + 0.5) - 0.5, by = fract(qy + 0.5) - 0.5;
            const inB = Math.hypot(bx, by) < 0.5;
            const fx = inB ? bx : fract(qx) - 0.5, fy = inB ? by : fract(qy) - 0.5;
            const d = Math.hypot(fx, fy);
            const rings = 0.5 + 0.5 * Math.cos(d * TAU * 9);
            dx = fx / Math.max(d, 1e-4); dy = fy / Math.max(d, 1e-4);
            gate = 0.45 + 0.55 * rings;
            sheen = 0.35;
        } else if (type === 5 || type === 6) {
            const cells = type === 6 ? 12 : 10;
            const qx = ux * cells, qy = uy * cells * 1.397, cx = Math.floor(qx), cy = Math.floor(qy), fx = fract(qx) - 0.5, fy = fract(qy) - 0.5;
            if (type === 5) {
                const sec = Math.floor(fract(Math.atan2(fy, fx) / TAU + dcHash(cx, cy)) * 7);
                const turn = dcHash(cx + sec * 3.7, cy + sec * 1.9) * TAU;
                dx = Math.cos(turn); dy = Math.sin(turn);
                gate = 0.55 + 0.45 * dcHash(cx + sec * 5.3 + 1.1, cy + 2.2);
                sheen = 0.25;
            } else {
                const l = Math.hypot(fx + 1e-5, fy + 1e-5);
                dx = (fx + 1e-5) / l; dy = (fy + 1e-5) / l;
                gate = 0.65 + 0.35 * sat(Math.max(Math.abs(fx), Math.abs(fy)) * 2.5);
            }
        } else if (type === 4) {
            grating = false;
            const layers = [[6, 0.35, 0.18, 0.4, 2.8], [20, 0.55, 0.14, 0.34, 2.5], [64, 0.7, 0.16, 0.36, 2.4]];
            layers.forEach(([s, prob, r0, r1, br], k) => {
                const qx = ux * s, qy = uy * s * 1.397;
                const cx = Math.floor(qx) + 31.7 * k, cy = Math.floor(qy) + 17.9 * k;
                const r = r0 + (r1 - r0) * dcHash(cx + 3.1, cy + 7.7);
                const ox = (dcHash(cx + 11.3, cy) - 0.5) * (1 - 2 * r), oy = (dcHash(cx, cy + 5.9) - 0.5) * (1 - 2 * r);
                const d = Math.hypot(fract(qx) - 0.5 - ox, fract(qy) - 0.5 - oy);
                const disc = sat((r - d) / Math.max(fw * s * 1.5, 0.02) + 0.5 * sat((fw * s * 1.5) / r - 1)) * stepAt(1 - prob, dcHash(cx, cy));
                if (disc > 0) addSpec(col, dcHash(cx + 2.7, cy + 1.3) + uy * 0.6, disc * (0.7 + 0.3 * Math.cos((d / Math.max(r, 1e-3)) * 4)) * br);
                if (k === 2) glint = disc * stepAt(0.7, dcHash(cx + 9.1, cy + 4.4)) * 0.5;
            });
            for (const [sx, sy, w] of [[0.25, 0.55, 0.6], [-0.3, -0.2, 0.5]]) {
                const ex = px - sx, ey = py - sy, sr = Math.hypot(ex, ey) + 1e-4;
                const swirl = Math.pow(sat(Math.sin(Math.atan2(ey, ex) * 2 - Math.log(sr) * 7)), 8) * sat(1 - sr * 5);
                if (swirl > 0) addSpec(col, sr * 3, swirl * w);
            }
        } else if (type === 3) {
            const cx = Math.floor(ux * 60), cy = Math.floor(uy * 83.8);
            const turn = dcHash(cx, cy) * TAU;
            gate = stepAt(0.4, dcHash(cx + 17.13, cy + 17.13));
            dx = Math.cos(turn); dy = Math.sin(turn);
            sheen = 0.2;
        } else if (type === 2) {
            const l = Math.hypot(px + 1e-5, py + 1e-5);
            dx = (px + 1e-5) / l; dy = (py + 1e-5) / l;
        }
        if (grating) {
            const g = Math.abs(hx * dx + hy * dy);
            const diff = [0, 0, 0];
            for (let n = 1; n <= 8; n++) {
                const w = (g * 1600) / n;
                if (w >= 400 && w <= 700) addSpectral(diff, (w - 400) / 300, 1);
            }
            const shine = sheen * gate * Math.pow(sat((dx * nhx + dy * nhy) * 0.5 + 0.5), 16);
            for (let i = 0; i < 3; i++) col[i] = sat(diff[i]) * gate + shine;
            glint = Math.pow(sat(1 - g * 4), 4) * gate;
        }
        out[0] = col[0] * spot; out[1] = col[1] * spot; out[2] = col[2] * spot; out[3] = glint * spot;
    }

    function bands(g, repeats) {
        for (let k = 0; k < repeats; k++)
            FOIL_HUES.forEach((c, i) => g.addColorStop((k + i / (FOIL_HUES.length - 1)) / repeats, c));
        return g;
    }

    const foilPatterns = new Map();
    function foilPattern(index) {
        if (!foilPatterns.has(index)) {
            if (index === 0) {
                const g = CardLayerKit.newCanvas().getContext('2d', { willReadFrequently: true });
                g.fillStyle = bands(g.createLinearGradient(0, 0, CARD_W, CARD_H), 1);
                g.fillRect(0, 0, CARD_W, CARD_H);
                foilPatterns.set(index, g.getImageData(0, 0, CARD_W, CARD_H).data);
            } else {
                const data = new Float32Array(CARD_W * CARD_H * 4), px = [0, 0, 0, 0];
                for (let y = 0; y < CARD_H; y++)
                    for (let x = 0; x < CARD_W; x++) {
                        foilPatternAt(index, (x + 0.5) / CARD_W, 1 - (y + 0.5) / CARD_H, 1 / CARD_W, px);
                        data.set(px, (y * CARD_W + x) * 4);
                    }
                foilPatterns.set(index, data);
            }
        }
        return foilPatterns.get(index);
    }

    const FOIL_STRENGTH = 0.6, ART_GLOW = 0.6;

    function drawFoilTint(ctx, foil, type = 'foil') {
        const ids = CardLayerKit.FOIL_TYPES.map((t) => t.id);
        const pick = Math.max(0, ids.indexOf(type));
        const src = foil.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, CARD_W, CARD_H).data;
        const image = ctx.getImageData(0, 0, CARD_W, CARD_H), d = image.data;
        const metalOf = sat(FOIL_STRENGTH * 1.5);
        for (let i = 0; i < d.length; i += 4) {
            const area = src[i] / 255;
            if (!area) continue;
            const code = Math.round(src[i + 2] / CardLayerKit.FOIL_CODE_STEP);
            const k = code > 0 && code <= ids.length ? code - 1 : pick;
            const p = foilPattern(k);
            if (k === 0) {
                const a = 0.55 * area;
                for (let c = 0; c < 3; c++) d[i + c] += (p[i + c] - d[i + c]) * a;
                continue;
            }
            const b = [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
            const luma = 0.299 * b[0] + 0.587 * b[1] + 0.114 * b[2];
            const lit = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2] + p[i + 3];
            const metal = area * metalOf * sat(lit * 2.5), boost = k === 3 ? 1.4 : 1;
            for (let c = 0; c < 3; c++) {
                const tint = sat(0.35 + p[i + c] * 0.6 + b[c] * 0.3);
                const albedo = b[c] * (1 - ART_GLOW);
                const color = albedo + (tint * 0.6 - albedo) * metal + b[c] * ART_GLOW;
                const holo = (p[i + c] * (0.3 + 0.7 * luma) * boost + p[i + 3] * 0.25) * FOIL_STRENGTH * area;
                d[i + c] = sat(color + holo) * 255;
            }
        }
        ctx.putImageData(image, 0, 0);
    }

    const MEDIA_SLOTS = ['art', 'depth', 'foil', 'normal', 'roughness', 'metallic'];
    const MEDIA_MAP = { art: 'art', depth: 'height', foil: 'foil', normal: 'normal', roughness: 'roughness', metallic: 'metallic' };
    const MEDIA_EMPTY = {
        art: 'PNG, JPG, WebP · MP4, WebM, GIF',
        depth: 'white = near, black = far',
        foil: 'No mask: all foil',
        normal: 'No normal map',
        roughness: 'No roughness map',
        metallic: 'No metallic map',
    };
    const MEDIA_WHAT = { art: 'picture', depth: 'depth map', foil: 'foil mask', normal: 'normal map', roughness: 'roughness map', metallic: 'metallic map' };
    const greyCanvas = (img) => CardLayerKit.toGrey(cardCanvas(img));
    const normalCanvas = (img) => CardLayerKit.asOpenGL(state.normal, cardCanvas(img));
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
        if (slot === 'foil') { $('#f-holo').checked = true; showFoilPicks(); }
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
            const folder = state.coll ? (state.coll.source && state.coll.source.folder) : $('#f-collection').value;
            const coll = state.collections.find((c) => sameName(c.folder, folder));
            const back = coll && coll.doc && coll.doc.json.defaultBack;
            const file = back && back.file ? await getFile(coll.dir, `${back.file}.png`) : null;
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
        paintRarity($('#card-3d'), $('#f-rarity').value, $('#f-collection').value || null);
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
                    normal: state.normal ? normalCanvas(frameOf(state.normal)) : null,
                    roughness: state.roughness ? greyCanvas(frameOf(state.roughness)) : null,
                    metallic: state.metallic ? greyCanvas(frameOf(state.metallic)) : null,
                } : null,
                front: stackParts('front'), back: backParts,
                holo: $('#f-holo').checked, foilType: cardFoilPick(),
                rarity: $('#f-rarity').value, collection: $('#f-collection').value || null,
            }));
        });
    }

    // What the 3D view draws (CardView.set): the picture (3D: behind the window) and the stacked layers, like the game
    async function viewInput({ is3d, picture, front, back, holo, foilType, rarity, collection }) {
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
            pictureRoughness: is3d && picture ? picture.roughness : null,
            pictureMetallic: is3d && picture ? picture.metallic : null,
            foilMask: picture ? picture.foil || white : null,
            overlay: f.color, layerFoil: f.foil, layerNormal: f.normal, layerSurface: f.surface,
            back: back.length ? b.color : await defaultBackImage(),
            backFoil: b.foil, backNormal: b.normal, backSurface: b.surface,
            type: is3d ? '3d' : '2d', foil: holo, foilType,
            rarityColor: rarityColor(rarity, collection),
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
            fillCardRarity();
            refreshPrices();
            state.layers.render();
            ensureCollPreview().then(() => drawCrop());
        });
    }

    async function collectCard() {
        const f = readForm();
        const is3d = has3d();
        const editing = state.editingCard;
        if (!f.name) { toast.err('The card needs a name'); $('#f-name').focus(); return null; }
        if (!f.collection) { toast.err('Pick a collection', 'Every card belongs to a collection. Make one under Collections.'); return null; }
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

        // [path, () => Promise<Blob>]: frames are rendered one at a time while saving
        const grey = (img) => pngBlob(greyCanvas(img));
        const render = { art: canvasBlob, depth: canvasBlob, foil: (img) => pngBlob(maskOf(img)), normal: (img) => pngBlob(normalCanvas(img)), roughness: grey, metallic: grey };
        const names = {
            art: ['card.png', 'frames'], depth: ['card.height.png', 'frames.height'], foil: ['card.foil.png', 'frames.foil'], normal: ['card.normal.png', 'frames.normal'],
            roughness: ['card.roughness.png', 'frames.roughness'], metallic: ['card.metallic.png', 'frames.metallic'],
        };
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
            if (!is3d) managed.animation = null;
        }
        const existing = editing && !editing.data._broken ? editing.data : {};
        managed.floats = surfaceFloats(depthFloats(existing.floats, is3d), is3d);
        const json = JSON.parse(cardJson(f, is3d ? '3d' : '2d', existing, managed));
        await ensureCollPreview();
        const thumb = {
            picture: is3d && state.art ? cardCanvas(state.art.still) : null,
            front: state.layers.front, collFront: state.collPreview.layers.front, ctx: formCtx(),
        };
        files.push([THUMB_FILE, () => thumbnail(thumb)]);
        return { f, json, files, writePicture, writeLayers, is3d, layerSave };
    }

    async function renderFiles(files, task) {
        const out = [];
        for (const [i, [name, make]] of files.entries()) {
            if (files.length > 10) setStatus(`Preparing ${i + 1} of ${files.length} files…`);
            if (task) task.progress(i, files.length + 1, `Preparing ${i + 1} of ${files.length} files`);
            out.push([name, await make()]);
        }
        if (task) task.progress(files.length, files.length + 1, 'Uploading');
        return out;
    }

    const startTask = (title) => (window.CCStatus ? CCStatus.task(title) : { progress() {}, finish() {} });

    async function saveOpenedCard(card) {
        const opened = state.editingCard;
        const { f, json, files, writePicture, writeLayers } = card;
        const button = $('#save-card');
        button.disabled = true;
        try {
            const broken = await CardLayerKit.unreadable([...state.layers.front, ...state.layers.back], MEDIA_SLOTS.map((s) => state[s]).filter(Boolean));
            if (broken.length) throw new Error(`Its files for ${broken.join(', ')} can't be read any more, so nothing was changed. Close the card and open it again.`);
            const keep = writeLayers ? [...card.layerSave.keep] : [];
            const task = startTask(`Saving ${f.name}`);
            try {
                const blobs = await renderFiles(files, task);
                setStatus('Saving…');
                await DaApi.upload('PUT', `/api/cards/${opened.id}`, {
                    collectionId: f.collection, rarity: f.rarity, json, keep, keepAll: { picture: !writePicture, layers: !writeLayers },
                }, blobs);
                task.finish();
            } catch (e) {
                task.finish(e.message);
                throw e;
            }
            if (writeLayers) card.layerSave.commit();
            toast.ok('Card updated', 'Restart the SPT server to see the change.');
            closeEdit();
            await rescan();
        } catch (e) {
            toast.err('Could not update the card', e.message);
            setStatus('Not saved: ' + e.message, false);
        } finally {
            button.disabled = false;
        }
    }

    function setStatus(text, ok) {
        const s = $('#save-status');
        s.hidden = !text;
        s.textContent = text || '';
        s.className = 'facade-status ' + (ok ? 'is-ok' : ok === false ? 'is-error' : '');
    }

    async function saveToFolder() {
        if (!state.data) { toast.err('Not connected', 'Start "DaCard Dashboard.bat".'); return; }
        const card = await collectCard();
        if (!card) return;
        if (state.editingCard) return saveOpenedCard(card);
        const { f, json, files } = card;
        const button = $('#save-card');
        button.disabled = true;
        const task = startTask(`Saving ${f.name}`);
        try {
            const blobs = await renderFiles(files, task);
            setStatus('Saving…');
            const result = await DaApi.upload('POST', '/api/cards', { collectionId: f.collection, rarity: f.rarity, json }, blobs);
            task.finish();
            toast.ok('Card saved', `${f.name} in ${collName(f.collection)} · restart the SPT server to get it in game.`);
            setStatus(`Saved ${f.name}`, true);
            $('#f-name').value = '';
            $('#f-short').value = '';
            $('#f-desc').value = '';
            await rescan();
            return result;
        } catch (e) {
            task.finish(e.message);
            toast.err('Could not save the card', e.message);
            setStatus('Not saved: ' + e.message, false);
        } finally {
            button.disabled = false;
        }
    }

    // The edit window: the card form moved into it, with the card's details, picture and layers. The New card form's
    // work waits aside (state.draft) and comes back when the window closes.
    async function openEdit(card) {
        if (state.editingCard) closeEdit();
        state.draft = {
            fields: Object.fromEntries(['#f-name', '#f-short', '#f-desc', '#f-collection', '#f-rarity'].map((id) => [id, $(id).value])),
            collHidden: state.collHidden,
            use3d: state.use3d, depthRange: state.depthRange, pictureSurface: state.pictureSurface, crop: state.crop, show: state.show,
            art: state.art, depth: state.depth, foil: state.foil, normal: state.normal, roughness: state.roughness, metallic: state.metallic,
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
        $('#edit-title').textContent = card.data.name || '';
        $('#save-card').textContent = 'Save changes';
        $('#save-card').classList.replace('fx-lg', 'fx-sm');
        $('#edit-cancel').after($('#save-card'));
        $('#edit-delete').after($('#save-status'));
        const del = $('#edit-delete');
        del.textContent = 'Delete card';
        delete del.dataset.armed;
        $('#edit-modal').hidden = false;

        setStatus('Opening the card…');
        try {
            await loadCardDoc(card, true);
        } catch (e) {
            toast.err('Could not open the card', e.message);
            closeEdit();
            return;
        }
        if (state.editingCard !== card) return;
        $('#edit-title').textContent = card.data.name || card.id;
        const d = card.data;
        $('#f-name').value = d.name || '';
        $('#f-short').value = d.shortName || '';
        $('#f-desc').value = d.description || '';
        state.textAlign = alignOf(d.textAlign);
        defaultBack = defaultBackImg = null;
        fillCollectionSelects();
        $('#f-collection').value = card.collection || ''; syncSelect($('#f-collection'));
        $('#f-rarity').value = '';
        fillRaritySelect($('#f-rarity'), card.collection, card.rarity);
        state.collHidden = d.collectionLayers === false ? 'all' : new Set((d.hideCollectionLayers || []).filter((f) => typeof f === 'string'));
        state.use3d = cardType(card) === '3d';
        state.depthRange = depthFromFloats(d.floats);
        state.pictureSurface = surfaceFromFloats(d.floats);
        for (const slot of MEDIA_SLOTS) renderMedia(slot);
        refreshPrices();
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
        $('#card-form .save-bar').append($('#save-status'), $('#save-card'));
        for (const slot of MEDIA_SLOTS) if (state[slot]) state[slot].dispose();
        state.editingCard = null;
        const d = state.draft;
        state.draft = null;
        defaultBack = defaultBackImg = null;
        if (d) {
            for (const [id, value] of Object.entries(d.fields)) {
                if (id === '#f-collection') fillCollectionSelects();
                if (id === '#f-rarity') fillCardRarity();
                if (id !== '#f-rarity' || [...$(id).options].some((o) => o.value === value)) $(id).value = value;
                if ($(id).tagName === 'SELECT') syncSelect($(id));
            }
            state.collHidden = d.collHidden;
            Object.assign(state, { crop: d.crop, show: d.show, art: d.art, depth: d.depth, foil: d.foil, normal: d.normal, roughness: d.roughness, metallic: d.metallic, depthRange: d.depthRange, pictureSurface: d.pictureSurface });
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



    async function duplicateCard() {
        const card = state.editingCard;
        if (!card) return;
        const btn = $('#edit-duplicate');
        btn.disabled = true;
        try {
            const result = await DaApi.post(`/api/cards/${card.id}/duplicate`);
            closeEdit();
            await rescan();
            toast.ok('Card duplicated', 'Rename it and save.');
            const copy = state.list.find((c) => c.id === result.id);
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
            await DaApi.del(`/api/cards/${card.id}`);
            toast.ok('Card deleted', `${card.data.name || 'The card'} is gone. Copies players already have disappear when the server restarts.`);
            closeEdit();
            await rescan();
        } catch (e) {
            toast.err('Could not delete the card', e.message);
        }
    }

    const STICKER_MAX = 1024;

    const sameName = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
    const isMember = (card, coll) => !!card.collection && sameName(card.collection, coll.folder);

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
        state.collLayers.clear();
        defaultBack = defaultBackImg = null;
        state.collPreview = { folder: null, layers: { front: [], back: [] } };
        const list = (state.data && state.data.collections) || [];
        const docs = await Promise.all(list.map((c) => DaApi.get(`/api/collections/${c.id}`).catch(() => null)));
        const collections = [];
        for (const [i, c] of list.entries()) {
            const doc = docs[i];
            if (!doc) continue;
            const dir = DaApi.folder(doc);
            const data = { ...doc.json, name: doc.json.name || c.name };
            collections.push({ id: c.id, folder: c.id, dir, doc, data, thumbUrl: c.thumb, stickers: await readStickers(dir, data) });
        }
        state.collections = collections.sort((a, b) => a.data.name.localeCompare(b.data.name));
        fillCollectionSelects();
        renderCardsSide();
        packsChanged('collections');
    }

    function fillCollectionSelects() {
        for (const sel of [$('#f-collection'), $('#b-collection')]) {
            const value = sel.value;
            const list = [...state.collections].sort((a, b) => a.data.name.localeCompare(b.data.name));
            sel.innerHTML = list.length
                ? list.map((c) => `<option value="${escapeHtml(c.folder)}">${escapeHtml(c.data.name)}</option>`).join('')
                : '<option value="">No collection yet</option>';
            sel.value = [...sel.options].some((o) => o.value === value) ? value : (list[0] ? list[0].folder : '');
            syncSelect(sel);
        }
        fillCardRarity();
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

    let rarityUid = 0;
    const rarityRow = (r, from = null) => ({ uid: ++rarityUid, name: r.name, color: HEX_COLOR.test(r.color || '') ? r.color.toUpperCase() : '#FFFFFF', price: r.price, weight: r.weight, from });
    const collRarityList = () => (state.coll && state.coll.own ? state.coll.rows : defaultRarities());
    const collOwnCards = () => (state.coll && state.coll.source ? state.list.filter((c) => isMember(c, state.coll.source)) : []);
    const collAddedCards = () => (state.coll ? state.list.filter((c) => state.coll.members.has(c.key) && !(state.coll.source && isMember(c, state.coll.source))) : []);

    function blankRarity() {
        const list = state.coll ? collRarityList() : defaultRarities();
        return ((list.find((r) => sameName(r.name, 'Rare')) || list[0]) || { name: 'Rare' }).name;
    }

    function collOrphans() {
        const coll = state.coll, list = collRarityList();
        const renamed = coll.own ? coll.rows.filter((r) => r.from) : [];
        const out = new Map();
        for (const c of collOwnCards()) {
            if (list.some((r) => sameName(r.name, c.rarity)) || renamed.some((r) => sameName(r.from, c.rarity))) continue;
            const key = [...out.keys()].find((k) => sameName(k, c.rarity)) ?? c.rarity;
            out.set(key, (out.get(key) || 0) + 1);
        }
        return out;
    }

    function orphanTarget(name) {
        const list = collRarityList().filter((r) => r.name.trim());
        const key = Object.keys(state.coll.moveTo).find((k) => sameName(k, name));
        const hit = key ? list.find((r) => sameName(r.name, state.coll.moveTo[key])) : null;
        return (hit || list[0] || { name: '' }).name;
    }

    function landing(card, own) {
        const list = collRarityList();
        const hit = list.find((r) => sameName(r.name, card.rarity));
        if (hit) return hit.name;
        if (own && state.coll.own) {
            const row = state.coll.rows.find((r) => r.from && sameName(r.from, card.rarity));
            if (row) return row.name;
        }
        return own ? orphanTarget(card.rarity) : (list[0] || { name: '' }).name;
    }

    function collRarityOdds() {
        const list = collRarityList();
        const names = [...collOwnCards().map((c) => landing(c, true)), ...collAddedCards().map((c) => landing(c, false))];
        return rarityOdds(list, rarityCounts(list, names));
    }

    function openCollRarities(data) {
        const coll = state.coll;
        coll.own = Array.isArray(data.rarities) && data.rarities.length > 0;
        coll.rows = coll.own ? data.rarities.map((r) => rarityRow(r, r.name)) : null;
        coll.moveTo = {};
        coll.foilTypes = new Set(Array.isArray(data.foilTypes) && data.foilTypes.length ? data.foilTypes : DEFAULT_FOIL_TYPES);
        $('#c-foil-chance').value = typeof data.foilChance === 'number' ? data.foilChance : '';
        $('#c-foil-chance').placeholder = settingsFoilChance();
        renderCollRarities();
        renderCollFoilTypes();
    }

    function renderCollRarities() {
        const coll = state.coll;
        if (!coll) return;
        $('#c-own-rarities').checked = coll.own;
        const table = $('#c-rarities');
        table.classList.toggle('is-own', coll.own);
        table.innerHTML = coll.own
            ? '<span class="rt-head">Name</span><span class="rt-head">Colour</span><span class="rt-head">Price ₽</span><span class="rt-head">Chance</span><span class="rt-head">Odds</span><span></span>'
            : '<span class="rt-head">Rarity</span><span class="rt-head">Price ₽</span><span class="rt-head">Chance</span><span class="rt-head">Odds</span>';
        collRarityList().forEach((r, i) => {
            if (!coll.own) {
                const pill = document.createElement('span');
                pill.className = 'facade-pill fx-sm rarity-pill';
                pill.textContent = r.name;
                paintRarity(pill, r.name, null);
                table.append(pill);
                table.insertAdjacentHTML('beforeend', `<span>${roubles(r.price)}</span><span>${percentText(r.weight)}</span><span class="odds-note" data-odds="${i}"></span>`);
                return;
            }
            const rows = coll.rows;
            const name = document.createElement('input');
            name.type = 'text';
            name.className = 'facade-input';
            name.maxLength = 24;
            name.value = r.name;
            name.setAttribute('aria-label', 'Rarity name');
            name.addEventListener('input', () => { r.name = name.value.trim(); paintCollOdds(); });
            const color = document.createElement('input');
            color.type = 'color';
            color.className = 'rarity-color';
            color.value = r.color.toLowerCase();
            color.setAttribute('aria-label', 'Rarity colour');
            color.addEventListener('input', () => { r.color = color.value.toUpperCase(); paintCollOdds(); });
            const number = (key, attrs, label) => {
                const input = document.createElement('input');
                input.type = 'number';
                input.className = 'facade-input';
                Object.assign(input, attrs);
                input.value = r[key];
                input.setAttribute('aria-label', label);
                input.addEventListener('input', () => { const v = parseFloat(input.value); r[key] = Number.isFinite(v) ? v : NaN; paintCollOdds(); });
                return input;
            };
            const odds = document.createElement('span');
            odds.className = 'odds-note';
            odds.dataset.odds = i;
            const actions = document.createElement('span');
            actions.className = 'rarity-row-actions';
            actions.innerHTML = `<button type="button" class="facade-iconbtn" data-a="up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>`
                + `<button type="button" class="facade-iconbtn" data-a="down" title="Move down" ${i === rows.length - 1 ? 'disabled' : ''}>↓</button>`
                + `<button type="button" class="facade-iconbtn" data-a="remove" title="Remove" ${rows.length === 1 ? 'disabled' : ''}>×</button>`;
            actions.addEventListener('click', (e) => {
                const a = e.target.closest('button') && e.target.closest('button').dataset.a;
                if (a === 'up' || a === 'down') {
                    const to = i + (a === 'up' ? -1 : 1);
                    [rows[i], rows[to]] = [rows[to], rows[i]];
                } else if (a === 'remove') rows.splice(i, 1);
                else return;
                renderCollRarities();
            });
            table.append(name, color, number('price', { min: 0, step: 500, inputMode: 'numeric' }, 'Price'), number('weight', { min: 0, step: 0.1, inputMode: 'decimal' }, 'Chance'), odds, actions);
        });
        $('#c-rarity-actions').hidden = !coll.own;
        $('#c-rarity-add').disabled = coll.own && coll.rows.length >= MAX_RARITIES;
        paintCollOdds();
    }

    function paintCollOdds() {
        const odds = collRarityOdds();
        renderOddsBar($('#c-rarity-bar'), odds);
        odds.forEach((o, i) => {
            const el = $(`#c-rarities [data-odds="${i}"]`);
            if (el) el.textContent = oddsText(o);
        });
        renderCollMoves();
    }

    function renderCollMoves() {
        const box = $('#c-rarity-moves');
        const orphans = collOrphans();
        const list = collRarityList().filter((r) => r.name.trim());
        box.hidden = !orphans.size || !list.length;
        box.innerHTML = '';
        if (box.hidden) return;
        for (const [name, n] of orphans) {
            const row = document.createElement('div');
            row.className = 'rarity-move';
            const what = document.createElement('span');
            what.textContent = `${name}: ${n} card${n === 1 ? '' : 's'} to`;
            const sel = document.createElement('select');
            sel.className = 'facade-select';
            sel.setAttribute('aria-label', `New rarity of the ${name} cards`);
            sel.innerHTML = list.map((r) => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join('');
            sel.value = orphanTarget(name);
            sel.addEventListener('change', () => { state.coll.moveTo[name] = sel.value; paintCollOdds(); });
            row.append(what, sel);
            box.appendChild(row);
            enhanceSelect(sel);
        }
    }

    function renderCollFoilTypes() {
        const coll = state.coll;
        const box = $('#c-foil-types');
        box.innerHTML = '';
        for (const t of foilTypeList()) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip-toggle';
            chip.textContent = t.name;
            chip.setAttribute('aria-pressed', coll.foilTypes.has(t.id));
            chip.addEventListener('click', () => {
                if (coll.foilTypes.has(t.id)) { if (coll.foilTypes.size > 1) coll.foilTypes.delete(t.id); }
                else coll.foilTypes.add(t.id);
                renderCollFoilTypes();
                drawCollPreview();
            });
            box.appendChild(chip);
        }
    }

    function collRarityData() {
        const coll = state.coll;
        const moves = {};
        let rarities = null;
        if (coll.own) {
            if (!coll.rows.length || coll.rows.length > MAX_RARITIES) throw new Error(`1 to ${MAX_RARITIES} rarities.`);
            const seen = new Set();
            rarities = coll.rows.map((r) => {
                const name = r.name.trim();
                if (!RARITY_NAME.test(name)) throw new Error(`"${name}": letters, numbers, spaces, up to 24.`);
                if (seen.has(name.toLowerCase())) throw new Error(`Two rarities are called "${name}".`);
                seen.add(name.toLowerCase());
                if (!HEX_COLOR.test(r.color)) throw new Error(`${name}: pick a colour.`);
                if (!(r.price >= 0)) throw new Error(`${name}: price 0 or more.`);
                if (!(r.weight >= 0)) throw new Error(`${name}: chance 0 or more.`);
                return { name, color: r.color.toUpperCase(), price: Math.round(r.price), weight: Math.round(r.weight * 1000) / 1000 };
            });
            if (!rarities.some((r) => r.weight > 0)) throw new Error('One rarity needs a chance above 0.');
            for (const r of coll.rows)
                if (r.from && !rarities.some((x) => sameName(x.name, r.from))) moves[r.from] = r.name.trim();
        }
        for (const name of collOrphans().keys()) moves[name] = orphanTarget(name);
        return { rarities, moves };
    }

    function collFoilData() {
        const text = $('#c-foil-chance').value.trim();
        const v = parseFloat(text);
        if (text && !(v >= 0 && v <= 100)) throw new Error('Foil chance: 0 to 100.');
        const types = foilTypeList().map((t) => t.id).filter((id) => state.coll.foilTypes.has(id));
        return { foilChance: text ? Math.round(v * 1000) / 1000 : null, foilTypes: types.length && types.join() !== DEFAULT_FOIL_TYPES.join() ? types : null };
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
            opened.previewKey = previewKey(collEditor.front);
            opened.layersLoaded = true;
            drawCollPreview();
        });
        $('#coll-editor-title').textContent = coll ? coll.data.name : 'New collection';
        defaultBack = defaultBackImg = null;
        $('#c-name').value = data.name || '';
        $('#c-short').value = data.shortName || '';
        $('#c-desc').value = data.description || '';
        openCollRarities(data);
        $('#coll-modal').hidden = false;
        $('#coll-editor').scrollTop = 0;
        layoutStage();
        renderStickers();
        if (coll) loadStickers(coll.stickers);
        updateCollFolder();
        renderCollCards();
        $('#c-name').focus();
    }

    const shownFoilLayers = (lists) => lists.flat().filter((l) => !l.hidden).map(CardLayerKit.shownLayer).filter((l) => l && l.canBeFoil && CardLayerKit.hasContent(l));

    function syncFoilPick(sel, typeIds, layers, random) {
        const all = foilTypeList();
        const allowed = all.filter((t) => typeIds.includes(t.id));
        if (!allowed.length) allowed.push(all[0]);
        const overrides = [...new Set(layers.filter((l) => l.foilType).map((l) => l.foilType))];
        const anyRandom = random || layers.some((l) => !l.foilType);
        const label = !anyRandom && overrides.length
            ? (overrides.length === 1 ? (all.find((t) => t.id === overrides[0]) || { name: overrides[0] }).name : 'Per layer') : null;
        const pick = allowed.some((t) => t.id === sel.dataset.pick) ? sel.dataset.pick : allowed[0].id;
        const key = JSON.stringify([allowed.map((t) => t.id), pick, label, anyRandom]);
        if (sel.dataset.key === key) return pick;
        sel.dataset.key = key;
        sel.dataset.pick = pick;
        sel.innerHTML = label ? `<option value="">${escapeHtml(label)}</option>`
            : allowed.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');
        sel.value = label ? '' : pick;
        sel.disabled = !anyRandom;
        const button = sel.closest('.facade-dd') && sel.closest('.facade-dd').querySelector('button.facade-select');
        if (button) {
            button.disabled = !anyRandom;
            button.title = anyRandom ? 'Foil type of random layers' : 'Set per layer';
        }
        syncSelect(sel);
        return pick;
    }

    function cardFoilPick() {
        const own = overviewColl($('#f-collection').value || null);
        const coll = state.collPreview.layers, rare = $('#f-rare').checked;
        const layers = state.layers ? shownFoilLayers([state.layers.front, state.layers.back, everyCopy(coll.front, null, rare), everyCopy(coll.back, null, rare)]) : [];
        return syncFoilPick($('#f-foil-type'), (own && own.foilTypes) || DEFAULT_FOIL_TYPES, layers, has3d() && !!state.art);
    }

    function collFoilPick() {
        const s = collView.sample, rare = $('#coll-rare').checked;
        const layers = shownFoilLayers([everyCopy(s ? s.front : [], null, rare), everyCopy(s ? s.back : [], null, rare),
            everyCopy(collEditor.front, collEditor.selected, rare), everyCopy(collEditor.back, collEditor.selected, rare)]);
        return syncFoilPick($('#coll-foil-type'), state.coll && state.coll.foilTypes ? [...state.coll.foilTypes] : DEFAULT_FOIL_TYPES, layers, !s || !!(s.is3d && s.picture));
    }

    function showFoilPicks() {
        for (const [box, sel] of [['#f-holo', '#f-foil-type'], ['#coll-holo', '#coll-foil-type']])
            $(sel).closest('.foil-pick').hidden = !$(box).checked;
    }

    function closeCollection() {
        state.coll = null;
        $('#coll-modal').hidden = true;
    }

    function updateCollFolder() {
        const src = state.coll && state.coll.source;
        $('#c-folder').textContent = src ? `Binder ${src.id}` : 'Binder name in game.';
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
        'rarity.color': rarityColor(rarity, collection), collection: collection ? collName(collection) : '',
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
        const shown = CardLayerKit.ordered(front, collFront.filter((l) => l.chance >= 100))
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

    const previewIds = new WeakMap();
    let previewSeq = 0;
    const previewId = (media) => {
        if (!media) return null;
        if (!previewIds.has(media)) previewIds.set(media, ++previewSeq);
        return previewIds.get(media);
    };
    const pictureKey = (l) => ({ file: l.file, transform: l.transform, art: previewId(l.maps.art), mask: previewId(l.maps.mask) });
    const previewKey = (front) => JSON.stringify(front.filter((l) => l.chance >= 100 && CardLayerKit.hasContent(l)).map((l) => (CardLayerKit.isText(l)
        ? { id: l.id, text: { ...l.text, font: previewId(l.text.font) } }
        : CardLayerKit.isVariant(l) ? { file: l.file, variants: l.variants.map((v) => ({ ...pictureKey(v), chance: v.chance })) } : pictureKey(l))));

    const staleTried = new Set();
    let redrawing = null;
    function redrawStale() {
        if (redrawing) return;
        const stale = state.list.filter((c) => c.stale && !staleTried.has(c.id));
        if (!stale.length) return;
        for (const c of stale) staleTried.add(c.id);
        redrawing = (async () => {
            const task = startTask('Updating card previews');
            try {
                await refreshThumbs(stale, (done, total) => task.progress(done, total, `${done} of ${total}`));
            } finally {
                task.finish();
            }
            redrawing = null;
            await rescan();
        })().catch(() => { redrawing = null; });
    }

    async function refreshThumbs(cards, onProgress) {
        let done = 0;
        const failed = [];
        for (const card of cards) {
            let sample = null;
            try {
                await loadCardDoc(card);
                const coll = card.collection ? state.collections.find((c) => sameName(c.folder, card.collection)) : null;
                const allColl = await collectionLayers(coll);
                const collLayers = card.data.collectionLayers === false ? { front: [], back: [] }
                    : withoutHidden(allColl, new Set(card.data.hideCollectionLayers || []));
                sample = await loadSample(card);
                const blob = await thumbnail({
                    picture: sample.is3d && sample.picture ? sample.picture.art : null,
                    front: sample.front, collFront: collLayers.front, ctx: savedCtx(card),
                });
                await DaApi.request('PUT', `/api/cards/${card.id}/thumb`, blob);
            } catch {
                failed.push(card.data.name || card.id);
            } finally {
                if (sample) for (const l of [...sample.front, ...sample.back]) CardLayerKit.dispose(l);
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
            foilTypes: foilTypeList,
            foilDefault: () => {
                const v = parseFloat($('#c-foil-chance').value);
                return v >= 0 && v <= 100 ? v : settingsFoilChance();
            },
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
        await loadCardDoc(card);
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
        sel.innerHTML = members.map((c) => `<option value="${escapeHtml(c.key)}">${escapeHtml(c.data.name || c.id)}</option>`).join('') +
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
            vars: cardVars({ name: 'Card Name', description: 'The card\'s description goes here. Longer descriptions wrap onto more lines.', rarity: blankRarity(), collection: state.coll && state.coll.source ? state.coll.source.folder : null }),
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
            const s = collView.sample, holo = $('#coll-holo').checked, foilType = collFoilPick();
            if (collOverlay) collOverlay.update(collEditor.side);
            const front = collStack('front'), back = collStack('back');
            if (collView.view === '3d') {
                if (!collView.card3d) return;
                collView.card3d.set(await viewInput({
                    is3d: !!(s && s.is3d), picture: s && s.is3d ? s.picture : null, front, back,
                    holo, foilType, rarity: s ? s.card.rarity : blankRarity(),
                    collection: s ? s.card.collection : state.coll && state.coll.source ? state.coll.source.id : null,
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
                if (holo) drawFoilTint(ctx, stack.foil, foilType);
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
        $('#coll-holo').addEventListener('change', () => { showFoilPicks(); drawCollPreview(); });
        $('#coll-foil-type').addEventListener('change', (e) => { if (e.target.value) e.target.dataset.pick = e.target.value; drawCollPreview(); });
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
        const pages = Math.max(1, Math.ceil(members.length / COLL_CARDS_PAGE));
        coll.page = Math.min(Math.max(0, coll.page || 0), pages - 1);
        for (const card of members.slice(coll.page * COLL_CARDS_PAGE, (coll.page + 1) * COLL_CARDS_PAGE)) {
            const chip = document.createElement('span');
            chip.className = 'coll-card';
            paintRarity(chip, card.rarity, card.collection);
            const src = card.thumbUrl || '';
            const added = !coll.source || !isMember(card, coll.source);
            chip.innerHTML = `<img alt="" ${src ? `src="${src}"` : ''}><span>${escapeHtml(card.data.name || card.id)}</span>` +
                (added ? '<button type="button" class="facade-iconbtn" aria-label="Leave it where it was">×</button>' : '');
            if (added) chip.querySelector('button').addEventListener('click', () => { coll.members.delete(card.key); renderCollCards(); paintCollOdds(); });
            box.appendChild(chip);
        }
        const pager = document.createElement('div');
        pager.className = 'pager';
        renderPager(pager, coll.page, pages, (p) => { coll.page = p; renderCollCards(); });
        box.appendChild(pager);
        if (state.list.length > members.length)
            box.appendChild(cardSearch({
                skip: (c) => coll.members.has(c.key),
                label: (c) => `${c.data.name || c.id} (${c.rarity}, now in ${collName(c.collection)})`,
                pick: (c) => { coll.members.add(c.key); renderCollCards(); paintCollOdds(); },
            }));
        $('#c-count').textContent = members.length;
        $('#c-size-note').textContent = members.length
            ? `${BINDER_SIZE} binder, ${members.length} pocket${members.length === 1 ? '' : 's'}.`
            : 'No cards, no binder.';
        fillCollSample();
    }

    async function saveCollection() {
        const coll = state.coll;
        if (!coll) return;
        if (!state.data) { toast.err('Not connected', 'Start "DaCard Dashboard.bat".'); return; }
        if (!coll.layersLoaded) { toast.err('Still opening the collection', 'Wait for its layers to load, then save.'); return; }
        const name = $('#c-name').value.trim();
        if (!name) { toast.err('The collection needs a name'); $('#c-name').focus(); return; }
        const clash = state.collections.find((c) => c !== coll.source && sameName(c.data.name, name));
        if (clash) { toast.err(`"${name}" already exists`, 'Pick another name.'); return; }
        let rarityData, foilData;
        try {
            rarityData = collRarityData();
            foilData = collFoilData();
        } catch (e) {
            toast.err('Can\'t save yet', e.message);
            return;
        }

        const button = $('#c-save'), label = button.textContent;
        button.disabled = true;
        try {
            const broken = coll.layersDirty ? await CardLayerKit.unreadable([...collEditor.front, ...collEditor.back]) : [];
            if (broken.length) throw new Error(`Its files for ${broken.join(', ')} can't be read any more, so nothing was changed. Close the collection and open it again.`);
            const moves = state.list.filter((card) => coll.members.has(card.key) && !(coll.source && isMember(card, coll.source)));

            const data = Object.assign({}, coll.data, { name });
            for (const [key, value] of [['shortName', $('#c-short').value.trim()], ['description', $('#c-desc').value.trim()]]) {
                if (value) data[key] = value; else delete data[key];
            }
            for (const [key, value] of [['rarities', rarityData.rarities], ['foilChance', foilData.foilChance], ['foilTypes', foilData.foilTypes]]) {
                if (value != null) data[key] = value; else delete data[key];
            }
            if (Object.keys(rarityData.moves).length) data.rarityMoves = rarityData.moves; else delete data.rarityMoves;
            const raritiesChanged = JSON.stringify((coll.source && coll.source.data.rarities) || null) !== JSON.stringify(rarityData.rarities);
            const files = [];
            const keep = new Set();
            for (const st of coll.stickers) {
                if (st.file && !st.write) { keep.add(st.file.toLowerCase()); continue; }
                st.file = `${newFolder()}.png`;
                st.write = true;
                files.push([st.file, async () => st.blob]);
            }
            const r = (v) => Math.round(v * 10000) / 10000;
            data.stickers = coll.stickers.map(({ file, placement: p }) =>
                ({ file, x: r(p.x), y: r(p.y), width: r(p.width), height: r(p.height), rotation: Math.round(p.rotation) }));
            delete data.sticker;
            if (coll.layersDirty) delete data.cardText;
            let layerSave = null;
            if (coll.layersDirty) {
                await CardLayerKit.splitAll([...collEditor.front, ...collEditor.back]);
                layerSave = CardLayerKit.files(collEditor.lists(), { incremental: !!coll.source });
                data.layers = layerSave.json;
                files.push(...layerSave.files);
                for (const kept of layerSave.keep) keep.add(kept);
            } else if (coll.source) {
                for (const kept of Object.keys((coll.source.doc && coll.source.doc.files) || {})) keep.add(kept.toLowerCase());
                for (const kept of Object.keys((coll.source.doc && coll.source.doc.folders) || {})) keep.add(kept.toLowerCase());
            }
            const blobs = [];
            for (const [i, [fileName, make]] of files.entries()) {
                if (files.length > 10) button.textContent = `Preparing ${i + 1} / ${files.length}…`;
                blobs.push([fileName, await make()]);
            }
            button.textContent = 'Saving…';
            const result = coll.source
                ? await DaApi.upload('PUT', `/api/collections/${coll.source.id}`, { json: data, keep: [...keep] }, blobs)
                : await DaApi.upload('POST', '/api/collections', { json: data, keep: [] }, blobs);
            if (layerSave) layerSave.commit();
            for (const w of (result && result.warnings) || []) (/ moved: /.test(w) ? toast.ok('Rarity changed', w) : toast.err('Collection note', w));
            const previewChanged = !coll.source || !!coll.data.cardText || coll.source.data.name !== name || raritiesChanged || Object.keys(rarityData.moves).length > 0
                || (!!layerSave && previewKey(collEditor.front) !== coll.previewKey);
            for (const [i, card] of moves.entries()) {
                button.textContent = `Moving cards ${i + 1} / ${moves.length}…`;
                await DaApi.post(`/api/cards/${card.id}/move`, { collectionId: result.id });
            }
            await rescan();
            const moved = new Set(moves.map((c) => c.id));
            const affected = state.list.filter((c) => sameName(c.collection, result.id) && (previewChanged || moved.has(c.id)));
            if (affected.length) {
                const task = startTask(`Updating ${name}'s card previews`);
                await refreshThumbs(affected, (done, total) => {
                    button.textContent = `Updating card previews ${done} / ${total}…`;
                    task.progress(done, total, `${done} of ${total}`);
                }).catch((e) => toast.err('Could not update the card previews', e.message));
                task.finish();
                await rescan();
            }
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
            await DaApi.del(`/api/collections/${coll.id}`);
            toast.ok('Collection deleted', `${coll.data.name} and its cards are gone after the server restarts.`);
            if (state.coll && state.coll.source === coll) closeCollection();
            await rescan();
        } catch (e) {
            toast.err('Could not delete the collection', e.message);
        }
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
        $('#c-own-rarities').addEventListener('change', (e) => {
            const coll = state.coll;
            if (!coll) return;
            coll.own = e.target.checked;
            if (coll.own && !coll.rows) coll.rows = defaultRarities().map((r) => rarityRow(r, r.name));
            renderCollRarities();
        });
        $('#c-rarity-add').addEventListener('click', () => {
            const coll = state.coll;
            if (!coll || !coll.own || coll.rows.length >= MAX_RARITIES) return;
            let name = 'New rarity', n = 1;
            while (coll.rows.some((r) => sameName(r.name, name))) name = `New rarity ${++n}`;
            coll.rows.push(rarityRow({ name, color: '#FFFFFF', price: 10000, weight: 1 }));
            renderCollRarities();
            const inputs = $$('#c-rarities input[type="text"]');
            if (inputs.length) inputs[inputs.length - 1].select();
        });
        $('#c-foil-chance').addEventListener('change', () => collEditor.render());
        wireStickerEditor();
    }

    const DEFAULT_BINDER_PRICE = 5000;
    const DEFAULT_FOIL_PERCENT = 10;
    const DEFAULT_CARD_PERCENT = 3.7;
    const RETIRED_MODES = ['remove', 'refund'];
    const DEFAULT_RETIRED_MODE = 'remove';

    function renderSettings() {
        const config = state.config;
        $('#s-form').hidden = !config;
        $('#s-empty').hidden = !!config;
        $('#s-empty').textContent = !state.data ? 'Loading…' : 'The settings can\'t be read.';
        setSettingsStatus('');
        if (!config) return;

        const table = $('#s-rarities');
        for (const el of $$(':scope > :not(.rt-head)', table)) el.remove();
        for (const r of defaultRarities()) {
            const pill = document.createElement('span');
            pill.className = 'facade-pill fx-sm rarity-pill';
            pill.textContent = r.name;
            paintRarity(pill, r.name, null);
            table.append(pill);
            table.insertAdjacentHTML('beforeend',
                `<input type="number" class="facade-input" data-rarity="${r.name}" data-k="price" min="1" step="500" inputmode="numeric" aria-label="${r.name} price" value="${r.price}">` +
                `<input type="number" class="facade-input" data-rarity="${r.name}" data-k="weight" min="0" step="0.1" inputmode="decimal" aria-label="${r.name} chance" value="${r.weight}">` +
                `<span class="odds-note" data-range="${r.name}"></span>`);
        }
        paintSettingsOdds();

        $('#s-loot-percent').value = config.loot && Number.isFinite(config.loot.cardPercent) ? config.loot.cardPercent : DEFAULT_CARD_PERCENT;
        $('#s-binder-price').value = (config.binders && config.binders.price) || DEFAULT_BINDER_PRICE;
        $('#s-geek-cards').checked = !!(config.geek && config.geek.sellCards);
        $('#s-foil-percent').value = settingsFoilChance();
        $('#s-retired').value = RETIRED_MODES.includes(config.retiredItems) ? config.retiredItems : DEFAULT_RETIRED_MODE;
        syncSelect($('#s-retired'));
    }

    function settingsRarities() {
        return defaultRarities().map((r) => {
            const v = parseFloat(($(`#s-rarities input[data-k="weight"][data-rarity="${r.name}"]`) || {}).value);
            return { ...r, weight: v >= 0 ? v : 0 };
        });
    }

    function paintSettingsOdds() {
        const odds = rarityOdds(settingsRarities());
        renderOddsBar($('#s-rarity-bar'), odds);
        for (const o of odds) {
            const el = $(`#s-rarities [data-range="${o.name}"]`);
            if (el) el.textContent = oddsText(o);
        }
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
        if (!state.data || !state.config) return;
        const config = structuredClone(state.config);

        const values = {};
        for (const input of $$('#s-rarities input')) {
            const v = parseFloat(input.value);
            const r = input.dataset.rarity, k = input.dataset.k;
            if (k === 'price' && !(v >= 1)) { toast.err(`${r} price`, 'Needs a price of at least 1 ₽.'); input.focus(); return; }
            if (k === 'weight' && !(v >= 0)) { toast.err(`${r} chance`, 'Needs 0 or more.'); input.focus(); return; }
            (values[r] = values[r] || {})[k] = k === 'price' ? Math.round(v) : Math.round(v * 1000) / 1000;
        }
        if (!Object.values(values).some((v) => v.weight > 0)) { toast.err('Rarity chances', 'One needs a chance above 0.'); return; }
        const cardPercent = parseFloat($('#s-loot-percent').value);
        if (!(cardPercent >= 0 && cardPercent <= 100)) { toast.err('Card chance', 'Needs a percentage from 0 to 100.'); $('#s-loot-percent').focus(); return; }
        const binderPrice = parseInt($('#s-binder-price').value, 10);
        if (!(binderPrice >= 1)) { toast.err('Binder price', 'Needs a price of at least 1 ₽.'); $('#s-binder-price').focus(); return; }
        const foilPercent = parseFloat($('#s-foil-percent').value);
        if (!(foilPercent >= 0 && foilPercent <= 100)) { toast.err('Foil chance', 'Needs a percentage from 0 to 100.'); $('#s-foil-percent').focus(); return; }

        config.rarities = config.rarities || {};
        for (const r of DEFAULT_RARITIES) {
            const key = Object.keys(config.rarities).find((k) => sameName(k, r)) || r;
            config.rarities[key] = Object.assign(config.rarities[key] || {}, values[r]);
        }
        config.loot = Object.assign(config.loot || {}, { cardPercent: Math.round(cardPercent * 1000) / 1000 });
        config.binders = Object.assign(config.binders || {}, { price: binderPrice });
        config.geek = Object.assign(config.geek || {}, { sellCards: $('#s-geek-cards').checked });
        config.foil = Object.assign(config.foil || {}, { percent: Math.round(foilPercent * 100) / 100 });
        config.retiredItems = RETIRED_MODES.includes($('#s-retired').value) ? $('#s-retired').value : DEFAULT_RETIRED_MODE;

        const button = $('#s-save');
        button.disabled = true;
        try {
            await DaApi.put('/api/settings', {
                rarities: config.rarities, loot: config.loot, binders: config.binders, geek: config.geek, foil: config.foil, retiredItems: config.retiredItems,
            });
            await readConfig();
            fillCardRarity();
            refreshPrices();
            renderCardsSide();
            renderCards();
            toast.ok('Settings saved', 'Restart the SPT server to use them.');
            setSettingsStatus('Saved', true);
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
        $('#pane-settings').addEventListener('input', (e) => {
            setSettingsStatus('Not saved yet');
            if (e.target.dataset.k === 'weight') paintSettingsOdds();
        });
    }

    // The tabs are pages: #new, #cards, #collections, #settings (a refresh stays on the tab; Back / Forward move between them)
    const PANES = ['new', 'cards', 'collections', 'packs', 'settings'];
    const paneFromHash = () => (PANES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'new');

    function showPane(name, fromHistory = false) {
        if (!PANES.includes(name)) name = 'new';
        if (!fromHistory && location.hash.slice(1) !== name) history.pushState(null, '', '#' + name);
        for (const item of $$('.nav-item')) item.classList.toggle('active', item.dataset.pane === name);
        for (const pane of $$('.pane')) pane.classList.toggle('active', pane.id === 'pane-' + name);
        if (name === 'packs' && window.CCPacks) window.CCPacks.show();
        if (name === 'collections' && window.CCCollections) window.CCCollections.render();
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
        wireSurfaceFields();
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
            foilTypes: foilTypeList,
            foilDefault: () => foilChanceOf($('#f-collection').value || null),
        });
        wireCollectionLayers();
        $('#normal-clear').addEventListener('click', () => clearMedia('normal'));
        $('#roughness-clear').addEventListener('click', () => clearMedia('roughness'));
        $('#normal-gl').addEventListener('change', (e) => {
            if (!state.normal) return;
            state.normal.openGL = e.target.checked;
            state.pictureDirty = true;
            updateFormVisibility();
        });
        $('#metallic-clear').addEventListener('click', () => clearMedia('metallic'));
        $('#f-holo').addEventListener('change', () => { showFoilPicks(); drawCrop(); });
        $('#f-foil-type').addEventListener('change', (e) => { if (e.target.value) e.target.dataset.pick = e.target.value; drawCrop(); });
        $('#f-rare').addEventListener('change', () => drawCrop());
        $('#foil-clear').addEventListener('click', () => clearMedia('foil'));
        wireCrop();
        wireDepthRange();
        wirePreview3d();
        $('#save-card').addEventListener('click', saveToFolder);

        $('#cards-search').addEventListener('input', renderCards);
        $('#cards-rarity').addEventListener('change', renderCards);
        $('#cards-refresh').addEventListener('click', () => rescan());
        $('#f-collection').addEventListener('change', () => {
            defaultBack = defaultBackImg = null;
            ensureCollPreview().then(() => drawCrop());
        });
        $('#edit-close').addEventListener('click', closeEdit);
        $('#edit-cancel').addEventListener('click', closeEdit);
        $('#edit-delete').addEventListener('click', deleteCard);
        $('#edit-duplicate').addEventListener('click', duplicateCard);
        wireSettings();
        $('#edit-modal').addEventListener('mousedown', (e) => { if (e.target.id === 'edit-modal') closeEdit(); });
        window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#edit-modal').hidden) closeEdit(); });

        updateFolderUi();
        set3d(false);
        wireCollections();
        for (const toggle of ['#preview-view', '#st-view', '#coll-view']) {
            const b = $(`${toggle} button[data-view="3d"]`);
            if (b && !b.disabled) b.click();
        }
        const shared = {
            state, toast, getDir, getFile, slugify, newFolder, escapeHtml, paintRarity, rarityColor, enhanceSelect, setRange, prettyJson,
            raritiesOf, rarityOf, rarityOdds, rarityCounts, oddsText, renderOddsBar, fillRaritySelect, percentText,
            readConfig, collName, syncSelect, confirmMenu, rescan, download, sameName, collectionLayers, cardVars, cardJson, thumbnail, pngBlob,
            fillCollectionSelects, openCollection, deleteCollection, isMember, THUMB_FILE, cardSearch, renderPager,
        };
        if (window.CCPacks) window.CCPacks.init(shared);
        if (window.CCBatch) window.CCBatch.init(shared);
        if (window.CCCollections) window.CCCollections.init(shared);
        if (window.CCStatus) window.CCStatus.init({ state, toast, rescan, updateFolderUi, download });
        const pane = paneFromHash();
        history.replaceState(null, '', '#' + pane);
        showPane(pane, true);
    }

    boot();
})();
