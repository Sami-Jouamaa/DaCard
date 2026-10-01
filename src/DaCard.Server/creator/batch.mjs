(() => {
    'use strict';

    const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
    const DEFAULT_RARITY = 'Rare';
    const DEFAULT_COLLECTION = '_Default', CARDS_FOLDER = 'cards';
    const PREVIEW_W = 172, PREVIEW_H = 240;
    const SHORT_MAX = 24;
    const IMAGE_FILE = /\.(png|jpe?g|webp|bmp|avif)$/i;

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

    let app = null;
    const rows = [];
    let coll = { folder: null, all: { front: [], back: [] } };
    let saving = false;

    const isImage = (file) => !!file && (/^image\//.test(file.type) ? !/gif/i.test(file.type) : IMAGE_FILE.test(file.name));
    const nameFromFile = (file) => file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    const collFront = () => ($('#b-coll-layers').checked ? coll.all.front : []);

    function readRow(row) {
        const name = $('.b-name', row.el).value.trim();
        return {
            name,
            shortName: name.slice(0, SHORT_MAX).trim(),
            description: $('.b-desc', row.el).value.trim(),
            rarity: $('.b-rarity', row.el).value,
        };
    }

    const ctxOf = (f) => ({ vars: app.cardVars({ ...f, collection: $('#b-collection').value || null }), align: {} });

    function shown(row) {
        const own = row.layer ? [row.layer] : [];
        return CardLayerKit.ordered(own, collFront()).filter((l) => l.chance >= 100).map((l) => ({ ...l, hidden: false }));
    }

    function draw(row) {
        const canvas = $('.batch-preview', row.el);
        const g = canvas.getContext('2d');
        g.clearRect(0, 0, PREVIEW_W, PREVIEW_H);
        const parts = CardLayerKit.parts(shown(row), 0, ctxOf(readRow(row)));
        if (parts.length) {
            const full = CardLayerKit.composite(parts, { foil: false, normal: false }).color;
            g.imageSmoothingEnabled = true;
            g.imageSmoothingQuality = 'high';
            g.drawImage(full, 0, 0, PREVIEW_W, PREVIEW_H);
        }
        canvas.classList.toggle('is-empty', !row.layer);
        if (row.layer) return;
        g.fillStyle = 'rgba(255,255,255,.55)';
        g.font = '600 28px system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillText('Image', PREVIEW_W / 2, PREVIEW_H / 2 + 10);
    }

    let queued = new Set();
    function redraw(row) {
        if (!queued.size) requestAnimationFrame(() => { const list = [...queued]; queued = new Set(); list.forEach(draw); });
        queued.add(row);
    }
    const redrawAll = () => rows.forEach(redraw);

    async function setImage(row, file) {
        if (!isImage(file)) { app.toast.err('Images only', 'PNG, JPG or WebP.'); return; }
        let media;
        try {
            media = await CardMedia.open('image', [file]);
        } catch (e) {
            app.toast.err(`Could not open ${file.name}`, e.message);
            return;
        }
        if (row.layer) row.layer.maps.art.dispose();
        const layer = CardLayerKit.newLayer('front', { canBeFoil: true }, 'image');
        layer.maps.art = media;
        layer.transform.scale = CardLayerKit.fillScale(layer);
        row.layer = layer;
        const name = $('.b-name', row.el);
        if (!name.value.trim()) name.value = nameFromFile(file);
        redraw(row);
    }

    function addRow(defaults = {}) {
        const el = document.createElement('div');
        el.className = 'batch-row';
        el.innerHTML = `<canvas class="batch-preview" width="${PREVIEW_W}" height="${PREVIEW_H}" title="Click or drop an image"></canvas>
            <input type="file" class="batch-file" accept="image/png,image/jpeg,image/webp,image/bmp,image/avif" hidden>
            <input type="text" class="facade-input b-name" maxlength="80" autocomplete="off" placeholder="Name">
            <select class="facade-select b-rarity">${RARITIES.map((r) => `<option${r === (defaults.rarity || DEFAULT_RARITY) ? ' selected' : ''}>${r}</option>`).join('')}</select>
            <textarea class="facade-input b-desc" rows="3" placeholder="Description"></textarea>
            <button type="button" class="facade-btn fx-sm fx-grey batch-remove" title="Remove">×</button>`;
        const row = { el, layer: null };
        rows.push(row);
        $('#b-rows').appendChild(el);
        app.enhanceSelect($('.b-rarity', el));
        const canvas = $('.batch-preview', el), input = $('.batch-file', el);
        canvas.addEventListener('click', () => input.click());
        input.addEventListener('change', () => { if (input.files[0]) setImage(row, input.files[0]); input.value = ''; });
        canvas.addEventListener('dragover', (e) => { e.preventDefault(); canvas.classList.add('is-over'); });
        canvas.addEventListener('dragleave', () => canvas.classList.remove('is-over'));
        canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            canvas.classList.remove('is-over');
            const files = [...e.dataTransfer.files];
            if (files[0]) setImage(row, files[0]);
            addImages(files.slice(1), readRow(row).rarity);
        });
        for (const sel of ['.b-name', '.b-desc']) $(sel, el).addEventListener('input', () => redraw(row));
        $('.b-rarity', el).addEventListener('change', () => redraw(row));
        $('.batch-remove', el).addEventListener('click', () => removeRow(row));
        updateCount();
        draw(row);
        return row;
    }

    function addImages(files, rarity) {
        const images = [...files].filter(isImage);
        if (images.length < files.length) app.toast.err('Images only', `${files.length - images.length} skipped: PNG, JPG or WebP.`);
        const last = rows[rows.length - 1];
        rarity = rarity || (last ? readRow(last).rarity : DEFAULT_RARITY);
        for (const file of images) {
            const row = rows.find((r) => !r.layer && !r.pending && !readRow(r).name) || addRow({ rarity });
            row.pending = true;
            setImage(row, file).finally(() => { row.pending = false; });
        }
    }

    const hasFiles = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const dropActive = () => !$('#batch').hidden && $('#pane-new').classList.contains('active') && $('#edit-modal').hidden;
    let dropTimer = 0;

    function showDrop(on) {
        const el = $('#batch-drop');
        if (on) {
            const r = $('#batch').getBoundingClientRect();
            const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, window.innerHeight);
            Object.assign(el.style, { left: `${r.left}px`, width: `${r.width}px`, top: `${top}px`, height: `${Math.max(0, bottom - top)}px` });
        }
        el.classList.toggle('is-on', on);
    }

    function wireDrop() {
        const el = document.createElement('div');
        el.id = 'batch-drop';
        el.innerHTML = '<b>Drop images</b><span>One card each</span>';
        document.body.appendChild(el);
        document.addEventListener('dragover', (e) => {
            if (!hasFiles(e) || !dropActive()) return;
            e.preventDefault();
            showDrop(!(e.target.closest && e.target.closest('.batch-preview')));
            clearTimeout(dropTimer);
            dropTimer = setTimeout(() => showDrop(false), 150);
        });
        document.addEventListener('drop', (e) => {
            if (!hasFiles(e) || !dropActive()) return;
            e.preventDefault();
            clearTimeout(dropTimer);
            showDrop(false);
            addImages(e.dataTransfer.files);
        });
    }

    function removeRow(row) {
        if (row.layer) row.layer.maps.art.dispose();
        rows.splice(rows.indexOf(row), 1);
        row.el.remove();
        if (!rows.length) addRow();
        updateCount();
    }

    function updateCount() {
        $('#b-count').textContent = rows.length;
        for (const r of rows) $('.batch-remove', r.el).disabled = rows.length === 1;
    }

    async function loadCollection() {
        const folder = $('#b-collection').value || null;
        const found = folder ? app.state.collections.find((c) => app.sameName(c.folder, folder)) : null;
        const all = await app.collectionLayers(found);
        if (($('#b-collection').value || null) !== folder) return;
        coll = { folder, all };
        $('#b-coll-layers').disabled = !folder;
        redrawAll();
    }

    function hiddenFiles() {
        if ($('#b-coll-layers').checked) return [];
        return [...coll.all.front, ...coll.all.back].map((l) => l.file).filter((f) => typeof f === 'string');
    }

    function setStatus(text, ok) {
        const s = $('#b-status');
        s.hidden = !text;
        s.textContent = text || '';
        s.className = 'facade-status ' + (ok ? 'is-ok' : ok === false ? 'is-error' : '');
    }

    function cardFiles(row, f) {
        const save = CardLayerKit.files({ front: [row.layer], back: [] });
        const files = [...save.files];
        const ctx = ctxOf(f);
        files.push(['card.png', () => app.pngBlob(CardLayerKit.composite(CardLayerKit.parts(shown(row), 0, ctx), { foil: false, normal: false }).color)]);
        const json = app.cardJson({ ...f, collection: $('#b-collection').value, hideCollectionLayers: hiddenFiles(), textAlign: {} }, '2d', {},
            { layers: save.json, animation: null, floats: null });
        files.push(['card.json', async () => new Blob([json], { type: 'application/json' })]);
        files.push([app.THUMB_FILE, () => app.thumbnail({ picture: null, front: [row.layer], collFront: collFront(), ctx })]);
        return files;
    }

    async function save() {
        if (saving) return;
        if (!app.state.data) { app.toast.err('No folder connected', 'Connect the mod folder first.'); return; }
        const list = rows.filter((r) => r.layer || readRow(r).name);
        if (!list.length) { app.toast.err('No cards yet', 'Add an image and a name.'); return; }
        for (const r of list) {
            const n = rows.indexOf(r) + 1;
            if (!readRow(r).name) { app.toast.err(`Card ${n} needs a name`); $('.b-name', r.el).focus(); return; }
            if (!r.layer) { app.toast.err(`Card ${n} needs an image`); return; }
        }
        let addon;
        try {
            addon = await CardAddonKit.ensure(app.state.data, app.state.addons, $('#b-addon').value);
        } catch (e) {
            app.toast.err('Could not save the cards', e.message);
            return;
        }
        saving = true;
        const button = $('#b-save');
        button.disabled = true;
        const collFolder = $('#b-collection').value || DEFAULT_COLLECTION;
        const saved = [];
        try {
            const collDir = await app.getDir(await app.getDir(addon.dir, CARDS_FOLDER, true), collFolder, true);
            for (const [i, r] of list.entries()) {
                setStatus(`Saving card ${i + 1} of ${list.length}…`);
                const f = readRow(r);
                const rdir = await app.getDir(collDir, f.rarity, true);
                let slug = app.newFolder();
                while (await app.getDir(rdir, slug)) slug = app.newFolder();
                const cdir = await rdir.getDirectoryHandle(slug, { create: true });
                for (const [name, make] of cardFiles(r, f)) await app.writePath(cdir, name, await make());
                saved.push(r);
            }
            app.toast.ok(`${saved.length} card${saved.length === 1 ? '' : 's'} saved`, 'Restart the SPT server to get them in game.');
            setStatus(`Saved ${saved.length} to data/${addon.folder}/cards/${collFolder}/`, true);
        } catch (e) {
            app.toast.err('Could not save every card', `${saved.length} of ${list.length} saved. ${e.message}`);
            setStatus('Not saved: ' + e.message, false);
        } finally {
            for (const r of saved) removeRow(r);
            saving = false;
            button.disabled = false;
            if (!app.state.addons.some((a) => a.folder === addon.folder)) await app.scanAddons();
            await app.scanCards();
        }
    }

    function setMode(mode) {
        const batch = mode === 'batch';
        $('#pane-new').classList.toggle('is-batch', batch);
        $('#batch').hidden = !batch;
        for (const b of $$('#new-mode button')) b.classList.toggle('fx-on', b.dataset.mode === mode);
        try { localStorage.setItem('dacard.newMode', mode); } catch { }
        if (batch) redrawAll();
    }

    function init(helpers) {
        app = helpers;
        for (const b of $$('#new-mode button')) b.addEventListener('click', () => setMode(b.dataset.mode));
        $('#b-add').addEventListener('click', () => {
            const last = rows[rows.length - 1];
            const row = addRow({ rarity: last ? readRow(last).rarity : DEFAULT_RARITY });
            $('.b-name', row.el).focus();
        });
        wireDrop();
        $('#b-addon').addEventListener('change', () => { app.fillCollectionSelects(); loadCollection(); });
        $('#b-collection').addEventListener('change', loadCollection);
        $('#b-coll-layers').addEventListener('change', redrawAll);
        $('#b-save').addEventListener('click', save);
        addRow();
        let mode = 'single';
        try { mode = localStorage.getItem('dacard.newMode') === 'batch' ? 'batch' : 'single'; } catch { }
        setMode(mode);
    }

    window.CCBatch = { init, collectionsChanged: () => { if (app) loadCollection(); } };
})();
