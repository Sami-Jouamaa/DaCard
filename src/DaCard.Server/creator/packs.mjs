(() => {
    'use strict';

    const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
    const DEFAULT_WEIGHTS = { Common: 68, Uncommon: 22, Rare: 7, Epic: 2, Legendary: 1 };
    const DEFAULT_PRICE = 25000, DEFAULT_COUNT = 3, MAX_COUNT = 10, DEFAULT_LOOT = 0.5;
    const DEFAULT_COLLECTION = '_Default';
    const PACKS = 'packs', SKINS = 'skins';
    const PACK_FILE = 'pack.json', SKIN_FILE = 'skin.json', THUMB_FILE = 'thumb.png';
    const MAPS = ['albedo', 'normal', 'metallic', 'roughness', 'ao'];
    const MAP_LABEL = { albedo: 'Albedo', normal: 'Normal map', metallic: 'Metallic', roughness: 'Roughness', ao: 'Ambient occlusion' };
    const MAP_NOTE = { albedo: 'The colours (required)', normal: 'OpenGL: green up', metallic: 'White = metal', roughness: 'White = rough, black = glossy', ao: 'Mixed AO' };
    const MAP_FILE = /^(albedo|normal|metallic|roughness|ao)\.png$/i;
    const LAYER_FILE = /^layer_[A-Za-z0-9]+(\.(metallic|roughness|normal|foil|normalmask|mask))?(\.mask)?\.png$/i;
    const HASH_LAYER = /^(layer_[0-9a-f]{10})$/i;
    const newLayerStem = () => 'layer_' + Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('');
    const LAYER_KEYS = ['art', 'normal', 'roughness', 'metallic', 'mask'];
    const LAYER_SUFFIX = { normal: '.normal', roughness: '.roughness', metallic: '.metallic', mask: '.mask' };
    const LAYER_MAP_LABEL = { art: 'Albedo', normal: 'Normal', roughness: 'Roughness', metallic: 'Metallic', mask: 'Mask' };
    const LAYER_MAP_EMPTY = { art: 'Required', normal: 'None', roughness: 'Default', metallic: 'None', mask: 'Albedo alpha' };
    const TEXT_KEYS = ['normal', 'roughness', 'metallic'];
    const TEXT_W = 1024, TEXT_LINE = 256;
    const LAYER_KINDS = {
        image: { label: 'Image layer', title: 'Add a picture layer' },
        text: { label: 'Text layer', title: 'Add a text layer' },
    };
    const FONT_FILE = /^layer_[A-Za-z0-9]+\.(ttf|otf)$/i;
    const textDefaults = () => ({ value: '${name}', color: '#FFFFFF', align: 'center', uppercase: false, lines: 1, font: null, fontName: '', face: null });
    const MAX_SIDE = 2048;
    const PREVIEW_SIZE = 1024, SAVE_SIZE = 2048;
    const FACE_LABEL = { front: 'Front', back: 'Back', texture: 'Whole texture' };
    const LOOKS = ['preset', 'layers', 'textures'];
    const THUMB_H = 360;
    const ODDS_PACK = 3;

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

    let app = null;
    let nextUid = 1;
    const ps = {
        packs: [],
        skins: [],
        weights: { ...DEFAULT_WEIGHTS },
        edit: null,
        view: '3d',
        view3d: null,
        template: null,
        templateFull: {},
        show: 'albedo',
        urls: [],
        editUrls: [],
    };

    const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
    const newCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
    const pngBlob = (c) => new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the picture'))), 'image/png'));
    const loadUrl = (src) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not load ' + String(src).slice(0, 60)));
        img.src = src;
    });
    const sizeOf = (img) => ({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });
    const lower = (s) => String(s || '').trim().toLowerCase();
    const collKey = (card) => lower(card.collection || DEFAULT_COLLECTION);
    const geo = () => (window.PackGL ? PackGL.geo() : null);
    const aspect = () => (geo() ? geo().aspect : 0.64);
    const roubles = (n) => `${Math.round(n).toLocaleString('en-US')} ₽`;

    function objectUrl(blob, list = ps.urls) {
        const url = URL.createObjectURL(blob);
        list.push(url);
        return url;
    }

    function setStatus(el, text, ok) {
        el.hidden = !text;
        el.textContent = text || '';
        el.className = 'facade-status ' + (ok ? 'is-ok' : ok === false ? 'is-error' : '');
    }

    function templatePreview() {
        if (ps.template) return ps.template;
        const previews = (window.CC_PACK_MODEL && window.CC_PACK_MODEL.previews) || {};
        ps.template = Promise.all(MAPS.map((m) => (previews[m] ? loadUrl(previews[m]).catch(() => null) : Promise.resolve(null))))
            .then((imgs) => Object.fromEntries(MAPS.map((m, i) => [m, imgs[i]])));
        return ps.template;
    }

    async function fileAt(dir, path) {
        const parts = path.split('/').filter(Boolean);
        for (const part of parts.slice(0, -1)) {
            dir = await app.getDir(dir, part);
            if (!dir) return null;
        }
        return app.getFile(dir, parts[parts.length - 1]);
    }

    async function templateFull(map) {
        if (!ps.templateFull[map]) {
            ps.templateFull[map] = (async () => {
                const path = window.CC_PACK_MODEL && window.CC_PACK_MODEL.files && window.CC_PACK_MODEL.files[map];
                const file = app.state.root && path ? await fileAt(app.state.root, path) : null;
                if (file) {
                    try { return await createImageBitmap(file); } catch { }
                }
                return (await templatePreview())[map];
            })();
        }
        return ps.templateFull[map];
    }

    async function readPicture(file, { maxSide = MAX_SIDE, flipGreen = false } = {}) {
        const bitmap = await createImageBitmap(file);
        const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        if (k === 1 && !flipGreen && file.type === 'image/png') return { blob: file, img: bitmap, name: file.name || '' };
        const c = newCanvas(bitmap.width * k, bitmap.height * k);
        const ctx = c.getContext('2d', { willReadFrequently: flipGreen });
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, c.width, c.height);
        if (flipGreen) {
            const data = ctx.getImageData(0, 0, c.width, c.height);
            for (let i = 1; i < data.data.length; i += 4) data.data[i] = 255 - data.data[i];
            ctx.putImageData(data, 0, 0);
        }
        bitmap.close && bitmap.close();
        const blob = await pngBlob(c);
        return { blob, img: await createImageBitmap(blob), name: file.name || '' };
    }

    function placedRect(layer, W, H) {
        const { w, h } = sizeOf(layer.img);
        const k = Math.min(W / w, H / h) * layer.scale;
        return { w: w * k, h: h * k, cx: layer.x * W, cy: layer.y * H, rot: layer.rotation * Math.PI / 180 };
    }

    function drawPlaced(ctx, layer, W, H, source = layer.img) {
        const r = placedRect(layer, W, H);
        ctx.save();
        ctx.imageSmoothingQuality = 'high';
        ctx.translate(r.cx, r.cy);
        ctx.rotate(r.rot);
        ctx.drawImage(source, -r.w / 2, -r.h / 2, r.w, r.h);
        ctx.restore();
    }

    function corners(layer, W, H) {
        const r = placedRect(layer, W, H), c = Math.cos(r.rot), s = Math.sin(r.rot);
        return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
            const x = u * r.w / 2, y = v * r.h / 2;
            return [r.cx + c * x - s * y, r.cy + s * x + c * y];
        });
    }

    function hits(layer, px, py, W, H) {
        const r = placedRect(layer, W, H), c = Math.cos(-r.rot), s = Math.sin(-r.rot);
        const dx = px - r.cx, dy = py - r.cy;
        const x = c * dx - s * dy, y = s * dx + c * dy;
        return Math.abs(x) <= r.w / 2 && Math.abs(y) <= r.h / 2;
    }

    function faceSize(face, S) {
        if (face === 'texture') return { W: S, H: S };
        const H = Math.round(S * 0.8);
        return { W: Math.round(H * aspect()), H };
    }

    function fillScale(layer) {
        const { W, H } = faceSize(layer.face, 1000);
        const { w, h } = sizeOf(layer.img);
        return Math.max(W / w, H / h) / Math.min(W / w, H / h);
    }

    function valueCanvas(img, value, asAlpha = false) {
        const { w, h } = sizeOf(img);
        const c = newCanvas(w, h);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const data = ctx.getImageData(0, 0, c.width, c.height), px = data.data;
        let transparent = false;
        for (let i = 3; i < px.length; i += 4) if (px[i] < 250) { transparent = true; break; }
        for (let i = 0; i < px.length; i += 4) {
            const v = (transparent ? px[i + 3] : 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
            if (asAlpha) { px[i] = px[i + 1] = px[i + 2] = 255; px[i + 3] = Math.round(v * 255); }
            else { px[i] = px[i + 1] = px[i + 2] = Math.round(value(v) * 255); px[i + 3] = 255; }
        }
        ctx.putImageData(data, 0, 0);
        return c;
    }

    function derive(key, picture) {
        if (key === 'metallic' || key === 'roughness') picture.value = valueCanvas(picture.img, (v) => v);
        if (key === 'mask') picture.alpha = valueCanvas(picture.img, null, true);
        return picture;
    }


    function rotateNormals(canvas, degrees) {
        if (!degrees) return canvas;
        const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height), px = data.data;
        for (let i = 0; i < px.length; i += 4) {
            if (!px[i + 3]) continue;
            const x = px[i] / 127.5 - 1, y = px[i + 1] / 127.5 - 1;
            px[i] = Math.round(((x * c + y * s) + 1) * 127.5);
            px[i + 1] = Math.round(((-x * s + y * c) + 1) * 127.5);
        }
        ctx.putImageData(data, 0, 0);
        return canvas;
    }

    function strengthened(picture, strength) {
        if (strength === 1) return picture.img;
        if (picture.scaled && picture.scaled.strength === strength) return picture.scaled.canvas;
        const { w, h } = sizeOf(picture.img);
        const c = newCanvas(w, h);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(picture.img, 0, 0, c.width, c.height);
        const data = ctx.getImageData(0, 0, c.width, c.height), px = data.data;
        for (let i = 0; i < px.length; i += 4) {
            const x = (px[i] / 127.5 - 1) * strength, y = (px[i + 1] / 127.5 - 1) * strength;
            const z = Math.max(0, px[i + 2] / 127.5 - 1);
            const l = Math.hypot(x, y, z) || 1;
            px[i] = Math.round((x / l + 1) * 127.5);
            px[i + 1] = Math.round((y / l + 1) * 127.5);
            px[i + 2] = Math.round((z / l + 1) * 127.5);
        }
        ctx.putImageData(data, 0, 0);
        picture.scaled = { strength, canvas: c };
        return c;
    }

    const touchesMetal = (layer) => !!layer.metallic;
    const touchesRough = (layer) => !!layer.roughness;

    function layerMaps(layer, S) {
        const key = [S, layer.face, layer.x, layer.y, layer.scale, layer.rotation, layer.uid, layer.version, layer.normalStrength].join('|');
        if (layer.cache && layer.cache.key === key) return layer.cache.maps;
        const { W, H } = faceSize(layer.face, S);
        const placed = (source) => {
            const c = newCanvas(W, H);
            drawPlaced(c.getContext('2d'), layer, W, H, source);
            return c;
        };
        const artAlpha = placed(layer.img);
        const maskAlpha = layer.mask ? placed(layer.mask.alpha) : null;
        const cut = (paint, byArt) => {
            const c = newCanvas(W, H), g = c.getContext('2d');
            paint(g);
            g.globalCompositeOperation = 'destination-in';
            if (byArt) g.drawImage(artAlpha, 0, 0);
            if (maskAlpha) g.drawImage(maskAlpha, 0, 0);
            return c;
        };
        const image = (source) => (g) => drawPlaced(g, layer, W, H, source);
        const albedo = maskAlpha ? cut(image(layer.img), false) : artAlpha;
        const metal = layer.metallic ? cut(image(layer.metallic.value), true) : null;
        const rough = layer.roughness ? cut(image(layer.roughness.value), true) : null;
        const normal = layer.normal ? cut(image(strengthened(layer.normal, layer.normalStrength)), true) : null;
        const toAtlas = (c, isNormal = false) => {
            if (!c) return null;
            if (layer.face === 'texture') return isNormal ? rotateNormals(c, layer.rotation) : c;
            return PackGL.projector().faceToAtlas(layer.face, c, S, isNormal ? { rotation: layer.rotation } : null);
        };
        const maps = { albedo: toAtlas(albedo), metallic: toAtlas(metal), roughness: toAtlas(rough), normal: toAtlas(normal, true) };
        if (S === PREVIEW_SIZE) layer.cache = { key, maps };
        return maps;
    }

    function composite(S, base, layers) {
        const out = {}, ctx = {};
        for (const m of MAPS) {
            const c = newCanvas(S, S), g = c.getContext('2d');
            g.imageSmoothingQuality = 'high';
            if (base[m]) g.drawImage(base[m], 0, 0, S, S);
            out[m] = c;
            ctx[m] = g;
        }
        for (const layer of layers) {
            if (layer.hidden || !layer.img) continue;
            const maps = layerMaps(layer, S);
            for (const m of ['albedo', 'metallic', 'roughness', 'normal']) {
                if (!maps[m]) continue;
                ctx[m].globalAlpha = layer.opacity;
                ctx[m].drawImage(maps[m], 0, 0);
                ctx[m].globalAlpha = 1;
            }
        }
        return out;
    }

    function renderFront(albedo, height = THUMB_H) {
        const p = window.PackGL && PackGL.projector();
        if (!p || !albedo) return null;
        return p.atlasToFace('front', albedo, Math.round(height * aspect()), height);
    }

    async function mapsIn(dir) {
        const maps = {};
        for (const m of MAPS) {
            const f = await app.getFile(dir, m + '.png');
            if (f) maps[m] = f;
        }
        return maps;
    }

    async function scan() {
        ps.urls.forEach(URL.revokeObjectURL);
        ps.urls = [];
        const packs = [], skins = [];
        for (const addon of app.state.data ? app.state.addons || [] : []) {
            const pdir = await app.getDir(addon.dir, PACKS);
            for await (const [folder, handle] of pdir ? pdir.entries() : []) {
                if (handle.kind !== 'directory') continue;
                const json = await app.getFile(handle, PACK_FILE);
                if (!json) continue;
                let data;
                try { data = JSON.parse(await json.text()); } catch { data = { name: folder, _broken: true }; }
                data.name = data.name || folder;
                packs.push({ folder, dir: handle, parent: pdir, addon: addon.folder, data, thumb: await app.getFile(handle, THUMB_FILE) });
            }
            const sdir = await app.getDir(addon.dir, SKINS);
            for await (const [folder, handle] of sdir ? sdir.entries() : []) {
                if (handle.kind !== 'directory') continue;
                const json = await app.getFile(handle, SKIN_FILE);
                let data = {};
                if (json) try { data = JSON.parse(await json.text()); } catch { data = {}; }
                data.name = data.name || folder;
                skins.push({ folder, dir: handle, parent: sdir, addon: addon.folder, data, maps: await mapsIn(handle), thumb: await app.getFile(handle, THUMB_FILE), images: {} });
            }
        }
        packs.sort((a, b) => a.data.name.localeCompare(b.data.name));
        const ddir = app.state.data ? await app.defaultSkinsDir() : null;
        for await (const [folder, handle] of ddir ? ddir.entries() : []) {
            if (handle.kind !== 'directory') continue;
            const json = await app.getFile(handle, SKIN_FILE);
            let data = {};
            if (json) try { data = JSON.parse(await json.text()); } catch { data = {}; }
            data.name = data.name || folder;
            skins.push({ folder, dir: handle, addon: null, data, maps: await mapsIn(handle), thumb: await app.getFile(handle, THUMB_FILE), images: {} });
        }
        skins.sort((a, b) => (!a.addon === !b.addon ? a.data.name.localeCompare(b.data.name) : a.addon ? 1 : -1));
        ps.packs = packs;
        ps.skins = skins;
        app.state.packs = packs;
        app.state.skins = skins;
        if (ps.edit && ps.edit.source && !packs.some((p) => p.addon === ps.edit.source.addon && p.folder === ps.edit.source.folder)) closePack();
        if (window.CCAddons) window.CCAddons.render();
        const count = $('#packs-count');
        count.hidden = !app.state.data;
        count.textContent = packs.length;
        renderList();
        if (ps.edit && ps.edit.look === 'preset') renderSkins();
        if (ps.edit && ps.edit.look === 'layers') renderBases();
    }

    function renderList() {
        const grid = $('#pk-grid');
        grid.innerHTML = '';
        for (const pack of ps.packs) {
            const d = pack.data;
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'coll-tile pack-tile';
            const pic = document.createElement('div');
            pic.className = 'pack-thumb';
            if (pack.thumb) {
                const img = document.createElement('img');
                img.alt = '';
                img.src = objectUrl(pack.thumb);
                pic.appendChild(img);
            } else {
                templatePreview().then((t) => { const c = renderFront(t.albedo, 240); if (c) pic.appendChild(c); });
            }
            tile.appendChild(pic);
            const where = [d.purchasable !== false ? 'Geek' : null, d.lootPercent > 0 ? `${round(d.lootPercent)}% in raid` : null].filter(Boolean).join(' · ') || 'Not sold, not found';
            tile.insertAdjacentHTML('beforeend', `
                <span class="tile-name">${app.escapeHtml(d.name)}</span>
                <span class="tile-coll">${d.cardCount || DEFAULT_COUNT} cards · ${roubles(d.price > 0 ? d.price : DEFAULT_PRICE)}</span>
                <span class="tile-coll">${where} · ${poolOf(selectionOf(d)).length} card${poolOf(selectionOf(d)).length === 1 ? '' : 's'} in it</span>`);
            tile.addEventListener('click', () => openPack(pack));
            grid.appendChild(tile);
        }
        const empty = $('#pk-empty');
        empty.hidden = ps.packs.length > 0;
        empty.innerHTML = !app.state.data ? 'Connect the mod folder to see your booster packs.'
            : !app.state.data ? 'Connect the <b>Guro-DaCard</b> folder.'
            : 'No booster packs yet. Make one with New booster pack.';
    }

    function readWeights() {
        const config = app.state.config;
        const packs = config && config.packs;
        const weights = { ...DEFAULT_WEIGHTS };
        if (packs && packs.rarityWeights) {
            for (const r of RARITIES) {
                const key = Object.keys(packs.rarityWeights).find((k) => lower(k) === lower(r));
                if (key != null && packs.rarityWeights[key] >= 0) weights[r] = +packs.rarityWeights[key];
            }
        }
        ps.weights = normalised(weights);
    }

    function normalised(weights) {
        const total = RARITIES.reduce((s, r) => s + Math.max(0, weights[r] || 0), 0);
        if (!(total > 0)) return Object.fromEntries(RARITIES.map((r) => [r, 100 / RARITIES.length]));
        return Object.fromEntries(RARITIES.map((r) => [r, Math.max(0, weights[r] || 0) * 100 / total]));
    }

    function odds(rarities, n) {
        const present = RARITIES.filter((r) => rarities.includes(r));
        const total = present.reduce((s, r) => s + Math.max(0, ps.weights[r] || 0), 0);
        return present.map((r) => {
            const p = total > 0 ? Math.max(0, ps.weights[r] || 0) / total : 1 / present.length;
            const perPack = 1 - Math.pow(1 - p, n);
            return { rarity: r, perCard: p, perPack, oneIn: perPack > 0 ? 1 / perPack : Infinity };
        });
    }

    const oneInText = (o) => (!isFinite(o.oneIn) ? 'never' : o.perPack >= 0.995 ? 'in every pack'
        : o.oneIn < 1.5 ? `in ${Math.round(o.perPack * 100)}% of packs` : `about 1 in ${Math.round(o.oneIn).toLocaleString('en-US')} packs`);

    function renderOdds() {
        const bar = $('#pk-odds-bar');
        if (!bar.children.length) {
            RARITIES.forEach((r) => {
                const seg = document.createElement('div');
                seg.className = 'odds-seg';
                seg.dataset.rarity = r;
                seg.style.background = app.rarityColor(r);
                seg.innerHTML = '<span></span>';
                bar.appendChild(seg);
            });
            RARITIES.slice(0, -1).forEach((_, k) => {
                const handle = document.createElement('div');
                handle.className = 'odds-handle';
                handle.dataset.k = k;
                handle.title = `Drag: ${RARITIES[k]} / ${RARITIES[k + 1]}`;
                bar.appendChild(handle);
                wireOddsHandle(handle, k);
            });
            const table = $('#pk-odds-table');
            for (const r of RARITIES) {
                const pill = document.createElement('span');
                pill.className = 'facade-pill fx-sm rarity-pill';
                pill.textContent = r;
                app.paintRarity(pill, r);
                table.append(pill);
                table.insertAdjacentHTML('beforeend',
                    `<input type="number" class="facade-input" data-rarity="${r}" min="0" max="100" step="0.1" inputmode="decimal" aria-label="${r} chance per card">` +
                    `<span class="odds-note" data-note="${r}"></span>`);
            }
            $('#pk-odds-n').textContent = ODDS_PACK;
            for (const input of $$('#pk-odds-table input')) input.addEventListener('input', () => setWeight(input.dataset.rarity, parseFloat(input.value), input));
        }
        paintOdds();
    }

    function paintOdds(except = null) {
        const bar = $('#pk-odds-bar');
        let acc = 0;
        for (const seg of $$('.odds-seg', bar)) {
            const r = seg.dataset.rarity, w = ps.weights[r];
            seg.style.width = w + '%';
            seg.querySelector('span').textContent = w >= 7 ? `${r} ${round(w, 1)}%` : w >= 2.5 ? `${round(w, 1)}` : '';
            seg.title = `${r}: ${round(w, 2)}%`;
        }
        $$('.odds-handle', bar).forEach((h, k) => {
            acc = RARITIES.slice(0, k + 1).reduce((s, r) => s + ps.weights[r], 0);
            h.style.left = acc + '%';
        });
        const table = odds(RARITIES, ODDS_PACK);
        for (const o of table) {
            const input = $(`#pk-odds-table input[data-rarity="${o.rarity}"]`);
            if (input !== except) input.value = round(ps.weights[o.rarity], 2);
            $(`#pk-odds-table [data-note="${o.rarity}"]`).textContent = oneInText(o);
        }
        if (ps.edit) renderPool();
    }

    function setWeight(rarity, value, input) {
        if (!(value >= 0)) return;
        value = Math.min(100, value);
        const others = RARITIES.filter((r) => r !== rarity);
        const rest = 100 - value, sum = others.reduce((s, r) => s + ps.weights[r], 0);
        for (const r of others) ps.weights[r] = sum > 0 ? ps.weights[r] * rest / sum : rest / others.length;
        ps.weights[rarity] = value;
        setStatus($('#pk-odds-status'), 'Not saved yet');
        paintOdds(input);
    }

    function wireOddsHandle(handle, k) {
        let drag = null;
        handle.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            handle.setPointerCapture(e.pointerId);
            const before = RARITIES.slice(0, k).reduce((s, r) => s + ps.weights[r], 0);
            drag = { lo: before, hi: before + ps.weights[RARITIES[k]] + ps.weights[RARITIES[k + 1]] };
            handle.classList.add('is-dragging');
        });
        handle.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const rect = $('#pk-odds-bar').getBoundingClientRect();
            const span = drag.hi - drag.lo;
            const p = ((e.clientX - rect.left) / rect.width) * 100;
            const left = Math.min(span, Math.max(0, Math.round((p - drag.lo) / 0.5) * 0.5));
            ps.weights[RARITIES[k]] = round(left, 2);
            ps.weights[RARITIES[k + 1]] = round(span - left, 2);
            setStatus($('#pk-odds-status'), 'Not saved yet');
            paintOdds();
        });
        const end = () => { drag = null; handle.classList.remove('is-dragging'); };
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
    }

    async function saveOdds() {
        if (!app.state.data) { app.toast.err('Connect the Guro-DaCard folder first', 'The chances are saved in its data/config.json.'); return; }
        const file = await app.getFile(app.state.data, 'config.json');
        let config;
        try { config = JSON.parse(await file.text()); } catch (e) { app.toast.err('config.json could not be read', e.message); return; }
        const weights = normalised(ps.weights);
        config.packs = Object.assign(config.packs || {}, {
            rarityWeights: Object.fromEntries(RARITIES.map((r) => [r, round(weights[r], 3)])),
        });
        const button = $('#pk-odds-save');
        button.disabled = true;
        try {
            await app.writeFile(app.state.data, 'config.json', new Blob([app.prettyJson(config) + '\n'], { type: 'application/json' }));
            await app.readConfig();
            setStatus($('#pk-odds-status'), 'Saved to data/config.json', true);
            app.toast.ok('Pack chances saved', 'Restart the SPT server to use them.');
        } catch (e) {
            setStatus($('#pk-odds-status'), 'Not saved: ' + e.message, false);
            app.toast.err('Could not save the chances', e.message);
        } finally {
            button.disabled = false;
        }
    }

    function selectionOf(data) {
        const c = data.cards || {};
        return {
            all: !!c.all,
            collections: new Set((c.collections || []).map(lower)),
            cards: new Set((c.cards || []).map((k) => lower(k).replace(/\\/g, '/'))),
            rarities: new Set((c.rarities || []).filter((r) => RARITIES.some((x) => lower(x) === lower(r))).map((r) => RARITIES.find((x) => lower(x) === lower(r)))),
        };
    }

    const lockedAddon = () => (ps.edit && (ps.edit.source || ps.edit.template) ? (ps.edit.source || ps.edit.template).addon : null);
    const editAddon = () => lockedAddon() || $('#pk-addon').value;

    function poolOf(sel) {
        const filter = sel.rarities.size > 0 && sel.rarities.size < RARITIES.length ? sel.rarities : null;
        const addon = editAddon();
        const chosen = (c) => (sel.all && c.addon === addon)
            || (c.collection ? sel.collections.has(lower(c.collection)) : sel.collections.has(lower(DEFAULT_COLLECTION)) && c.addon === addon)
            || sel.cards.has(lower(c.key));
        return (app.state.list || []).filter((c) => chosen(c) && (!filter || filter.has(c.rarity)));
    }

    function fillAddons() {
        const sel = $('#pk-addon');
        const addons = app.state.addons || [];
        const value = sel.value;
        sel.innerHTML = addons.length
            ? addons.map((a) => `<option value="${app.escapeHtml(a.folder)}">${app.escapeHtml(a.name)}</option>`).join('')
            : '<option value="">My Addon (new)</option>';
        if ([...sel.options].some((o) => o.value === value)) sel.value = value;
        if (lockedAddon()) sel.value = lockedAddon();
        sel.disabled = !!lockedAddon();
        app.syncSelect(sel);
    }

    function renderCardChoice() {
        const e = ps.edit;
        if (!e) return;
        const sel = e.cards;
        $('#pk-all').checked = sel.all;
        $('#pk-colls-field').classList.toggle('is-off', sel.all);
        $('#pk-singles-field').classList.toggle('is-off', sel.all);

        const colls = $('#pk-colls');
        colls.innerHTML = '';
        const options = [...app.state.collections.map((c) => ({ key: lower(c.folder), folder: c.folder, name: c.data.name })),
            { key: lower(DEFAULT_COLLECTION), folder: DEFAULT_COLLECTION, name: 'No collection' }];
        for (const o of options) {
            const count = (app.state.list || []).filter((c) => collKey(c) === o.key && (c.collection || c.addon === editAddon())).length;
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip-toggle';
            chip.setAttribute('aria-pressed', sel.collections.has(o.key));
            chip.innerHTML = `${app.escapeHtml(o.name)} <small>${count}</small>`;
            chip.addEventListener('click', () => {
                if (sel.collections.has(o.key)) sel.collections.delete(o.key); else sel.collections.add(o.key);
                e.collFolders.set(o.key, o.folder);
                renderCardChoice();
            });
            e.collFolders.set(o.key, o.folder);
            colls.appendChild(chip);
        }

        const singles = $('#pk-singles');
        singles.innerHTML = '';
        const byKey = new Map((app.state.list || []).map((c) => [lower(c.key), c]));
        for (const key of sel.cards) {
            const card = byKey.get(key);
            const chip = document.createElement('span');
            chip.className = 'coll-card';
            if (card) {
                app.paintRarity(chip, card.rarity);
                let src = '';
                if (card.thumb || card.art) src = objectUrl(card.thumb || card.art, ps.editUrls);
                chip.innerHTML = `<img alt="" ${src ? `src="${src}"` : ''}><span>${app.escapeHtml(card.data.name || card.folder)}</span>`;
            } else {
                chip.innerHTML = `<span>${app.escapeHtml(e.cardKeys.get(key) || key)} (missing)</span>`;
            }
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'facade-iconbtn';
            remove.setAttribute('aria-label', 'Remove from the pack');
            remove.textContent = '×';
            remove.addEventListener('click', () => { sel.cards.delete(key); renderCardChoice(); });
            chip.appendChild(remove);
            singles.appendChild(chip);
        }
        const others = (app.state.list || []).filter((c) => !sel.cards.has(lower(c.key)));
        if (others.length) {
            const pick = document.createElement('select');
            pick.className = 'facade-select';
            pick.innerHTML = '<option value="">Add a card…</option>' + others.map((c) =>
                `<option value="${app.escapeHtml(c.key)}">${app.escapeHtml(c.data.name || c.folder)} (${c.rarity}, ${app.escapeHtml(app.collName(c.collection))})</option>`).join('');
            pick.addEventListener('change', () => {
                if (!pick.value) return;
                sel.cards.add(lower(pick.value));
                e.cardKeys.set(lower(pick.value), pick.value);
                renderCardChoice();
            });
            singles.appendChild(pick);
            app.enhanceSelect(pick);
        }

        const rarities = $('#pk-rarities');
        rarities.innerHTML = '';
        for (const r of RARITIES) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip-toggle is-rarity';
            app.paintRarity(chip, r);
            const on = sel.rarities.size === 0 || sel.rarities.has(r);
            chip.setAttribute('aria-pressed', on);
            chip.textContent = r;
            chip.addEventListener('click', () => {
                if (sel.rarities.size === 0) RARITIES.forEach((x) => sel.rarities.add(x));
                if (sel.rarities.has(r)) sel.rarities.delete(r); else sel.rarities.add(r);
                if (sel.rarities.size === RARITIES.length) sel.rarities.clear();
                if (sel.rarities.size === 0 && !on) sel.rarities.clear();
                renderCardChoice();
            });
            rarities.appendChild(chip);
        }
        renderPool();
    }

    function cardCount() {
        const n = parseInt($('#pk-count').value, 10);
        return n >= 1 ? Math.min(MAX_COUNT, n) : DEFAULT_COUNT;
    }

    function renderPool() {
        const e = ps.edit;
        if (!e) return;
        const pool = poolOf(e.cards);
        $('#pk-pool-count').textContent = pool.length;
        const box = $('#pk-pool');
        if (!pool.length) {
            box.innerHTML = '<p class="pack-pool-empty">No cards match.</p>';
            return;
        }
        const n = cardCount();
        const rows = odds(pool.map((c) => c.rarity), n).map((o) => {
            const count = pool.filter((c) => c.rarity === o.rarity).length;
            return `<span class="facade-pill fx-sm rarity-pill" style="--cc-rarity-rgb:${rgb(app.rarityColor(o.rarity))}">${o.rarity}</span>` +
                `<span>${count} card${count === 1 ? '' : 's'}</span><span>${round(o.perCard * 100, 2)}% of cards</span><span>${oneInText(o)}</span>`;
        }).join('');
        box.innerHTML = `<div class="pool-table"><span class="rt-head">Rarity</span><span class="rt-head">In the pack</span><span class="rt-head">Each card</span><span class="rt-head">A pack of ${n} has one</span>${rows}</div>`;
    }

    function rgb(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        if (!m) return '142, 142, 147';
        const v = parseInt(m[1], 16);
        return `${v >> 16}, ${(v >> 8) & 255}, ${v & 255}`;
    }

    function lookOf(data, hasMaps) {
        if (LOOKS.includes(data.look)) return data.look;
        if (data.skin) return 'preset';
        if (Array.isArray(data.layers) && data.layers.length) return 'layers';
        return hasMaps ? 'textures' : 'preset';
    }

    async function openPack(pack, template = null) {
        if (!app.state.data) { app.toast.err('Connect the Guro-DaCard folder first'); return; }
        const data = pack ? structuredClone(pack.data) : template ? structuredClone(template.data) : {};
        const hasMaps = pack ? Object.keys(await mapsIn(pack.dir)).length > 0 : false;
        ps.editUrls.forEach(URL.revokeObjectURL);
        ps.editUrls = [];
        const e = ps.edit = {
            source: pack || null,
            template,
            data,
            look: template ? (Array.isArray(data.layers) ? 'layers' : 'textures') : lookOf(data, hasMaps),
            skin: data.skin || null,
            base: data.base || null,
            layers: [],
            selected: null,
            maps: {},
            cards: selectionOf(data),
            collFolders: new Map(),
            cardKeys: new Map((data.cards && data.cards.cards || []).map((k) => [lower(k).replace(/\\/g, '/'), k])),
            loading: !!(pack || template),
        };
        $('#pk-editor').classList.toggle('is-template', !!template);
        $('#pk-save').textContent = template ? 'Save template' : 'Save booster pack';
        if (!pack) e.cards.all = true;
        for (const c of (data.cards && data.cards.collections) || []) e.collFolders.set(lower(c), c);

        fillAddons();
        $('#pk-title').textContent = template ? `Template: ${data.name}` : pack ? data.name : 'New booster pack';
        $('#pk-name').value = data.name || '';
        $('#pk-short').value = data.shortName || '';
        $('#pk-desc').value = data.description || '';
        $('#pk-count').value = data.cardCount >= 1 ? data.cardCount : DEFAULT_COUNT;
        $('#pk-price').value = data.price > 0 ? data.price : DEFAULT_PRICE;
        $('#pk-buy').checked = data.purchasable !== false;
        $('#pk-loot').checked = data.lootPercent > 0;
        $('#pk-loot-percent').value = data.lootPercent > 0 ? data.lootPercent : DEFAULT_LOOT;
        $('#pk-normal-dx').checked = false;
        $('#pk-skin-name').value = '';
        const del = $('#pk-delete');
        del.hidden = !pack || !!template;
        delete del.dataset.armed;
        del.textContent = 'Delete pack';
        updateLootRow();
        updateFolder();

        $('#packs-list-view').hidden = true;
        $('#pk-editor').hidden = false;
        setView('3d');
        renderLook();
        renderCardChoice();
        refresh();
        $('#pk-name').focus();

        if (!pack && !template) return;
        const dir = pack ? pack.dir : template.dir;
        try {
            if (e.look === 'layers') e.layers = await readLayers(dir, data.layers);
            if (e.look === 'textures') {
                const maps = await mapsIn(dir);
                for (const [m, file] of Object.entries(maps)) e.maps[m] = { blob: file, img: await createImageBitmap(file), name: file.name };
            }
        } catch (err) {
            app.toast.err('Could not read all of the pack\'s pictures', err.message);
        }
        if (ps.edit !== e) return;
        for (const layer of e.layers) if (isText(layer)) renderText(layer);
        e.loading = false;
        renderLook();
        refresh();
    }

    async function fileFrom(dir, name, copy) {
        const file = await app.getFile(dir, name);
        return file && copy ? new File([await file.arrayBuffer()], file.name, { type: file.type }) : file;
    }

    async function readLayers(dir, list, copy = false) {
        const out = [];
        for (const saved of Array.isArray(list) ? list : []) {
            if (!saved || typeof saved.file !== 'string') continue;
            const stem = saved.file.replace(/\.png$/i, '');
            const own = (layer) => {
                for (const k of ['name', 'face', 'x', 'y', 'scale', 'rotation', 'opacity', 'hidden', 'normalStrength']) if (saved[k] !== undefined) layer[k] = saved[k];
                layer.name = typeof saved.name === 'string' ? saved.name : layer.name;
                layer.file = copy ? null : stem;
            };
            if (saved.text && typeof saved.text === 'object') {
                const layer = newLayer({ kind: 'text', text: { ...textDefaults(), ...saved.text, font: null, fontName: '', face: null } });
                own(layer);
                if (typeof saved.text.font === 'string' && FONT_FILE.test(saved.text.font)) {
                    const font = await fileFrom(dir, saved.text.font, copy);
                    if (font) await setTextFont(layer, font).catch(() => {});
                }
                for (const key of TEXT_KEYS) {
                    const extra = await fileFrom(dir, `${stem}${LAYER_SUFFIX[key]}.png`, copy);
                    layer[key] = extra ? derive(key, await readPicture(extra)) : null;
                }
                out.push(layer);
                continue;
            }
            const file = await fileFrom(dir, `${stem}.png`, copy);
            if (!file) continue;
            const layer = newLayer({ ...(await readPicture(file)), name: '' });
            own(layer);
            for (const key of LAYER_KEYS.slice(1)) {
                const extra = await fileFrom(dir, `${stem}${LAYER_SUFFIX[key]}.png`, copy);
                layer[key] = extra ? derive(key, await readPicture(extra)) : null;
            }
            out.push(layer);
        }
        return out;
    }

    async function writeLayers(dir, layers) {
        const entries = [], keepLayers = new Set(), keepFonts = new Set(), stems = new Set();
        for (const layer of layers) {
            const own = HASH_LAYER.exec(layer.file || '');
            let stem = own && !stems.has(own[1].toLowerCase()) ? own[1].toLowerCase() : null;
            while (!stem || stems.has(stem)) stem = newLayerStem();
            stems.add(stem);
            layer.file = stem;
            const entry = {
                file: stem, name: layer.name || undefined, face: layer.face,
                x: round(layer.x, 4), y: round(layer.y, 4), scale: round(layer.scale, 4), rotation: Math.round(layer.rotation),
                opacity: round(layer.opacity, 3), hidden: layer.hidden || undefined,
                normalStrength: layer.normalStrength !== 1 ? round(layer.normalStrength, 2) : undefined,
            };
            if (isText(layer)) {
                const t = layer.text;
                entry.text = { value: t.value, color: t.color, align: t.align, lines: t.lines };
                if (t.uppercase) entry.text.uppercase = true;
                if (t.font) {
                    entry.text.font = `${stem}${(t.fontName.match(/\.(ttf|otf)$/i) || ['.ttf'])[0].toLowerCase()}`;
                    await app.writeFile(dir, entry.text.font, t.font);
                    keepFonts.add(entry.text.font.toLowerCase());
                }
            } else {
                await app.writeFile(dir, `${stem}.png`, layer.blob);
                keepLayers.add(`${stem}.png`);
            }
            for (const key of isText(layer) ? TEXT_KEYS : LAYER_KEYS.slice(1)) {
                if (!layer[key]) continue;
                await app.writeFile(dir, `${stem}${LAYER_SUFFIX[key]}.png`, layer[key].blob);
                keepLayers.add(`${stem}${LAYER_SUFFIX[key]}.png`);
            }
            entries.push(JSON.parse(JSON.stringify(entry)));
        }
        return { entries, keepLayers, keepFonts };
    }

    const sameSkin = (a, b) => !!a && !!b && a.addon === b.addon && lower(a.folder) === lower(b.folder);

    async function openTemplate(skin) {
        await openPack(null, skin);
    }

    function editSkin(skin, anchor) {
        if (ps.edit && !ps.edit.template) {
            app.confirmMenu(anchor, `Edit "${skin.data.name}"?`, 'Unsaved pack changes are lost.', 'Edit', () => openTemplate(skin));
            return;
        }
        openTemplate(skin);
    }

    function deleteSkin(skin, anchor) {
        const uses = (p, key) => typeof p.data[key] === 'string' && lower(p.data[key]) === lower(skin.folder);
        const users = ps.packs.filter((p) => uses(p, 'skin') || uses(p, 'base'));
        const presets = users.filter((p) => uses(p, 'skin')).length;
        const fallback = ps.skins.find((x) => !x.addon && lower(x.folder) === CardAddonKit.FALLBACK_SKIN);
        const note = users.length
            ? `${users.length} pack${users.length === 1 ? ' uses' : 's use'} it.${presets ? ` Preset packs switch to ${fallback ? fallback.data.name : 'the default skin'}.` : ''}`
            : 'No pack uses it.';
        app.confirmMenu(anchor, `Delete "${skin.data.name}"?`, note, 'Delete', async () => {
            try {
                await skin.parent.removeEntry(skin.folder, { recursive: true });
                if (ps.edit && sameSkin(ps.edit.template, skin)) closePack();
                app.toast.ok('Preset deleted', skin.data.name);
                await scan();
            } catch (err) {
                app.toast.err('Could not delete the preset', err.message);
            }
        });
    }

    async function pickBase(folder) {
        const e = ps.edit;
        const skin = folder ? ps.skins.find((x) => lower(x.folder) === lower(folder)) : null;
        if (!(skin && skin.addon && Array.isArray(skin.data.layers) && skin.data.layers.length)) {
            e.base = folder;
            renderBases();
            refresh();
            return;
        }
        e.loading = true;
        renderLayers();
        try {
            const copied = await readLayers(skin.dir, skin.data.layers, true);
            for (const layer of copied) if (isText(layer)) renderText(layer);
            e.layers = [...copied, ...e.layers];
            e.base = typeof skin.data.base === 'string' && skin.data.base ? skin.data.base : null;
            app.toast.ok('Template layers copied', `${copied.length} from ${skin.data.name}`);
        } catch (err) {
            app.toast.err('Could not copy the template\'s layers', err.message);
        }
        if (ps.edit !== e) return;
        e.loading = false;
        renderBases();
        renderLayers();
        refresh();
    }

    function closePack() {
        $('#pk-editor').classList.remove('is-template');
        ps.edit = null;
        ps.editUrls.forEach(URL.revokeObjectURL);
        ps.editUrls = [];
        $('#pk-editor').hidden = true;
        $('#packs-list-view').hidden = false;
    }

    function updateFolder() {
        const e = ps.edit;
        $('#pk-folder').innerHTML = e && e.template ? `Folder <code>data/${app.escapeHtml(e.template.addon)}/${SKINS}/${app.escapeHtml(e.template.folder)}/</code>`
            : e && e.source ? `Folder <code>data/${app.escapeHtml(e.source.addon)}/${PACKS}/${app.escapeHtml(e.source.folder)}/</code>`
            : 'Name in game.';
    }

    function updateLootRow() {
        const on = $('#pk-loot').checked;
        $('#pk-loot-row').classList.toggle('is-off', !on);
        $('#pk-loot-percent').disabled = !on;
    }

    function setLook(look) {
        if (!ps.edit || !LOOKS.includes(look)) return;
        ps.edit.look = look;
        renderLook();
        refresh();
    }

    function renderLook() {
        const e = ps.edit;
        if (!e) return;
        for (const tile of $$('.look-choice .look-tile')) {
            const on = tile.dataset.look === e.look;
            tile.classList.toggle('is-on', on);
            tile.setAttribute('aria-checked', on);
        }
        $('#pk-look-preset').hidden = e.look !== 'preset';
        $('#pk-look-layers').hidden = e.look !== 'layers';
        $('#pk-look-textures').hidden = e.look !== 'textures';
        if (e.look === 'preset') renderSkins();
        if (e.look === 'layers') { renderBases(); renderLayers(); }
        if (e.look === 'textures') renderMaps();
    }

    function skinOf(folder) {
        if (!folder) return null;
        return ps.skins.find((s) => lower(s.folder) === lower(folder))
            || ps.skins.find((s) => !s.addon && lower(s.folder) === CardAddonKit.FALLBACK_SKIN) || null;
    }

    async function skinImage(skin, map) {
        if (!skin || !skin.maps[map]) return null;
        if (!skin.images[map]) skin.images[map] = createImageBitmap(skin.maps[map]).catch(() => null);
        return skin.images[map];
    }

    function renderSkinGrid(grid, selected, pick, plainName) {
        grid.innerHTML = '';
        const self = ps.edit && ps.edit.template;
        const options = [{ folder: null, data: { name: plainName }, maps: {} }, ...ps.skins.filter((x) => !sameSkin(x, self))];
        for (const skin of options) {
            const tile = document.createElement('div');
            tile.tabIndex = 0;
            tile.setAttribute('role', 'button');
            tile.className = 'skin-tile';
            tile.classList.toggle('is-on', lower(skin.folder) === lower(selected));
            const pic = document.createElement('div');
            pic.className = 'pack-thumb';
            tile.appendChild(pic);
            tile.insertAdjacentHTML('beforeend', `<span class="tile-name">${app.escapeHtml(skin.data.name)}</span>`);
            if (skin.thumb) {
                const img = document.createElement('img');
                img.alt = '';
                img.src = objectUrl(skin.thumb, ps.editUrls);
                pic.appendChild(img);
            } else {
                (async () => {
                    const albedo = (await skinImage(skin, 'albedo')) || (await templatePreview()).albedo;
                    const c = renderFront(albedo, 200);
                    if (c) pic.appendChild(c);
                })();
            }
            if (skin.addon) {
                const actions = document.createElement('span');
                actions.className = 'skin-actions';
                actions.innerHTML = '<button type="button" class="facade-iconbtn" data-act="edit" title="Edit preset" aria-label="Edit preset">✎</button><button type="button" class="facade-iconbtn skin-delete" data-act="delete" title="Delete preset" aria-label="Delete preset">×</button>';
                actions.querySelector('[data-act="edit"]').addEventListener('click', (ev) => { ev.stopPropagation(); editSkin(skin, ev.currentTarget); });
                actions.querySelector('[data-act="delete"]').addEventListener('click', (ev) => { ev.stopPropagation(); deleteSkin(skin, ev.currentTarget); });
                tile.appendChild(actions);
            }
            tile.addEventListener('click', () => pick(skin.folder));
            tile.addEventListener('keydown', (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === tile) { ev.preventDefault(); pick(skin.folder); } });
            grid.appendChild(tile);
        }
        if (selected && !ps.skins.some((s) => lower(s.folder) === lower(selected))) {
            const fallback = skinOf(selected);
            grid.insertAdjacentHTML('afterbegin', `<p class="pack-pool-empty">"${app.escapeHtml(selected)}" isn't installed: ${fallback ? `uses ${app.escapeHtml(fallback.data.name)}` : 'uses the plain template'} until it is.</p>`);
        }
    }

    function renderSkins() {
        const e = ps.edit;
        renderSkinGrid($('#pk-skins'), e.skin, (folder) => { e.skin = folder; renderSkins(); refresh(); }, 'Plain template');
    }

    function renderBases() {
        const e = ps.edit;
        renderSkinGrid($('#pk-bases'), e.base, (folder) => pickBase(folder), 'Template');
    }

    function newLayer(values) {
        return Object.assign({
            uid: nextUid++, kind: 'image', text: null, name: '', face: 'front', x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, hidden: false,
            img: null, blob: null, file: null, mask: null, metallic: null, roughness: null, normal: null, normalStrength: 1, version: 0, cache: null,
        }, values, { uid: nextUid++, version: 0, cache: null });
    }

    const isText = (layer) => layer.kind === 'text';

    function textVars() {
        return { name: $('#pk-name').value.trim(), shortname: $('#pk-short').value.trim(), description: $('#pk-desc').value.trim() };
    }

    function renderText(layer) {
        const t = layer.text;
        const lines = Math.min(6, Math.max(1, Math.round(t.lines || 1)));
        const c = newCanvas(TEXT_W, TEXT_LINE * lines);
        CardText.draw(c.getContext('2d'), {
            value: t.value, x: 0.5, y: 0, width: 1, height: 1, size: 0.85 / lines, align: t.align, valign: 'middle',
            color: t.color, opacity: 1, uppercase: t.uppercase, autoSize: true, rotation: 0, face: t.face,
        }, textVars(), c.width, c.height);
        layer.img = c;
        layer.version++;
        layer.cache = null;
    }

    function rerenderTexts() {
        const e = ps.edit;
        if (!e) return;
        let any = false;
        for (const layer of e.layers) if (isText(layer)) { renderText(layer); any = true; }
        if (any) refresh();
    }

    function addTextLayer() {
        const e = ps.edit;
        if (!e) return;
        const face = ps.view === 'back' ? 'back' : ps.view === 'texture' ? 'texture' : 'front';
        const layer = newLayer({ kind: 'text', text: textDefaults(), name: 'Text', face, scale: 0.8 });
        renderText(layer);
        e.layers.push(layer);
        e.selected = layer.uid;
        renderLayers();
        refresh();
    }

    async function setTextFont(layer, file) {
        const copy = new File([await file.arrayBuffer()], file.name, { type: file.type });
        Object.assign(layer.text, { font: copy, fontName: file.name, face: await CardText.loadFace(copy) });
    }

    async function addLayers(files) {
        const e = ps.edit;
        if (!e) return;
        const face = ps.view === 'back' ? 'back' : ps.view === 'texture' ? 'texture' : 'front';
        for (const file of files) {
            if (!file.type.startsWith('image/')) continue;
            try {
                const picture = await readPicture(file);
                const layer = newLayer({ ...picture, file: null, face, name: (file.name || 'Picture').replace(/\.[^.]+$/, '').slice(0, 60) });
                e.layers.push(layer);
                e.selected = layer.uid;
            } catch (err) {
                app.toast.err(`Could not read ${file.name}`, err.message);
            }
        }
        renderLayers();
        refresh();
    }

    const selectedLayer = () => (ps.edit ? ps.edit.layers.find((l) => l.uid === ps.edit.selected) || null : null);

    function selectLayer(uid, follow = true) {
        const e = ps.edit;
        e.selected = uid;
        const layer = selectedLayer();
        if (follow && layer && ps.view !== '3d' && ps.view !== layer.face) setView(layer.face);
        for (const card of $$('#pk-layers .pack-layer')) card.classList.toggle('is-selected', +card.dataset.uid === uid);
        refresh();
    }

    function layerChanged(layer) {
        layer.cache = null;
        refresh();
    }

    function renderLayers() {
        const e = ps.edit;
        const box = $('#pk-layers');
        box.innerHTML = '';
        if (e.loading) { box.innerHTML = '<div class="layer-empty">Opening the pack\'s layers…</div>'; return; }
        if (!e.layers.length) { box.innerHTML = '<div class="layer-empty">No layers yet.</div>'; return; }
        [...e.layers].reverse().forEach((layer) => {
            const i = e.layers.indexOf(layer);
            const card = document.createElement('div');
            card.className = 'pack-layer';
            card.dataset.uid = layer.uid;
            card.classList.toggle('is-selected', layer.uid === e.selected);
            card.classList.toggle('is-hidden', layer.hidden);
            card.innerHTML = `
                <div class="pl-head">
                    ${isText(layer) ? '<span class="layer-thumb layer-thumb-text" aria-hidden="true">T</span>' : '<img class="layer-thumb" alt="">'}
                    <input type="text" class="facade-input layer-name" maxlength="60" placeholder="${isText(layer) ? 'Text' : 'Picture'} ${i + 1}">
                    <select class="facade-select pl-face">${Object.entries(FACE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
                    <span class="spacer"></span>
                    <button type="button" class="facade-iconbtn" data-act="up" aria-label="Move up" title="Move up (over the next one)"${i === e.layers.length - 1 ? ' disabled' : ''}>▲</button>
                    <button type="button" class="facade-iconbtn" data-act="down" aria-label="Move down" title="Move down"${i === 0 ? ' disabled' : ''}>▼</button>
                    <button type="button" class="facade-btn fx-sm fx-grey" data-act="hide">${layer.hidden ? 'Show' : 'Hide'}</button>
                    <button type="button" class="facade-iconbtn" data-act="remove" aria-label="Remove layer" title="Remove">×</button>
                </div>
                <div class="layer-maps"></div>
                <div class="layer-transform">
                    <label class="range-row"><span>Size</span><input type="range" class="facade-range" data-k="scale" min="0.05" max="4" step="0.005"><output></output></label>
                    <label class="range-row"><span>Turn</span><input type="range" class="facade-range" data-k="rotation" min="-180" max="180" step="1"><output></output></label>
                    <label class="range-row"><span>Opacity</span><input type="range" class="facade-range" data-k="opacity" min="0" max="1" step="0.01"><output></output></label>
                    <label class="range-row" title="How strongly the layer's normal map bends the light: 0 = flat, 100% = as drawn"><span>Normal strength</span><input type="range" class="facade-range" data-k="normalStrength" min="0" max="3" step="0.05"${layer.normal ? '' : ' disabled'}><output></output></label>
                    <div class="guide-actions">
                        <button type="button" class="facade-btn fx-sm fx-grey" data-act="center">Centre</button>
                        <button type="button" class="facade-btn fx-sm fx-grey" data-act="fill">Fill the side</button>
                        <button type="button" class="facade-btn fx-sm fx-grey" data-act="straight">Straighten</button>
                    </div>
                </div>`;
            if (!isText(layer)) card.querySelector('.layer-thumb').src = objectUrl(layer.blob, ps.editUrls);
            const mapsBox = card.querySelector('.layer-maps');
            if (isText(layer)) mapsBox.before(textBlock(layer));
            for (const key of isText(layer) ? TEXT_KEYS : LAYER_KEYS) mapsBox.appendChild(layerMapCell(layer, key));
            const name = card.querySelector('.layer-name');
            name.value = layer.name;
            name.addEventListener('input', () => { layer.name = name.value; });
            const face = card.querySelector('.pl-face');
            face.value = layer.face;
            face.addEventListener('change', () => {
                layer.face = face.value;
                layer.x = 0.5; layer.y = 0.5;
                layerChanged(layer);
                selectLayer(layer.uid);
            });
            app.enhanceSelect(face);
            const outputs = {
                scale: (v) => `${Math.round(v * 100)}%`, rotation: (v) => `${Math.round(v)}°`, opacity: (v) => `${Math.round(v * 100)}%`, normalStrength: (v) => `${Math.round(v * 100)}%`,
            };
            for (const range of $$('input[type="range"]', card)) {
                const k = range.dataset.k, out = range.nextElementSibling;
                range.value = layer[k];
                out.textContent = outputs[k](layer[k]);
                app.setRange(range);
                range.addEventListener('input', () => {
                    layer[k] = parseFloat(range.value);
                    out.textContent = outputs[k](layer[k]);
                    app.setRange(range);
                    if (k !== 'opacity') layer.cache = null;
                    if (e.selected !== layer.uid) selectLayer(layer.uid);
                    refresh();
                });
            }
            card.addEventListener('pointerdown', (ev) => {
                if (e.selected !== layer.uid && !ev.target.closest('button, select, .cc-select')) selectLayer(layer.uid);
            });
            card.addEventListener('click', (ev) => {
                const act = ev.target.closest('[data-act]');
                if (!act) return;
                const at = e.layers.indexOf(layer);
                switch (act.dataset.act) {
                    case 'up': if (at < e.layers.length - 1) { e.layers.splice(at, 1); e.layers.splice(at + 1, 0, layer); } break;
                    case 'down': if (at > 0) { e.layers.splice(at, 1); e.layers.splice(at - 1, 0, layer); } break;
                    case 'hide': layer.hidden = !layer.hidden; break;
                    case 'remove': e.layers.splice(at, 1); if (e.selected === layer.uid) e.selected = null; break;
                    case 'center': layer.x = 0.5; layer.y = 0.5; layer.cache = null; break;
                    case 'fill': layer.x = 0.5; layer.y = 0.5; layer.rotation = 0; layer.scale = round(fillScale(layer), 3); layer.cache = null; break;
                    case 'straight': layer.rotation = 0; layer.cache = null; break;
                }
                renderLayers();
                refresh();
            });
            box.appendChild(card);
        });
    }

    function textBlock(layer) {
        const t = layer.text;
        const box = document.createElement('div');
        box.className = 'layer-text pl-text';
        box.innerHTML = `
            <label class="text-value"><span>Text</span><textarea class="facade-input" rows="2" spellcheck="false" data-x="value"></textarea></label>
            <div class="style-row">
                <div class="align-buttons">${CardText.ALIGNS.map((a) => `<button type="button" class="facade-btn fx-sm" data-align="${a}">${{ left: 'Left', center: 'Centre', right: 'Right' }[a]}</button>`).join('')}</div>
                <label class="color-pick"><span>Colour</span><input type="color" data-x="color"></label>
                <label class="pl-lines"><span>Lines</span><input type="number" class="facade-input" min="1" max="6" step="1" data-x="lines"></label>
                <label class="facade-check-row"><input type="checkbox" class="facade-switch" data-x="uppercase"><span>Uppercase</span></label>
            </div>
            <div class="font-row">
                <span>Font</span>
                <button type="button" class="facade-btn fx-sm font-pick" data-x="font"></button>
                <button type="button" class="facade-iconbtn" data-x="font-clear" title="Default font">×</button>
                <input type="file" data-x="font-file" accept=".ttf,.otf,font/ttf,font/otf" hidden>
            </div>
            <small class="field-note">\${name} \${shortName} \${description}</small>`;
        const value = $('[data-x="value"]', box), color = $('[data-x="color"]', box), lines = $('[data-x="lines"]', box), upper = $('[data-x="uppercase"]', box);
        const show = () => {
            value.value = t.value;
            color.value = /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#ffffff';
            lines.value = t.lines;
            upper.checked = !!t.uppercase;
            for (const b of $$('[data-align]', box)) b.classList.toggle('fx-on', b.dataset.align === t.align);
            $('[data-x="font"]', box).textContent = t.font ? t.fontName || 'Custom font' : 'Bw Modelica (default)';
            $('[data-x="font-clear"]', box).hidden = !t.font;
        };
        const changed = () => { renderText(layer); show(); refresh(); };
        value.addEventListener('input', () => { t.value = value.value; changed(); });
        color.addEventListener('input', () => { t.color = color.value.toUpperCase(); changed(); });
        lines.addEventListener('change', () => { t.lines = Math.min(6, Math.max(1, Math.round(+lines.value || 1))); changed(); });
        upper.addEventListener('change', () => { t.uppercase = upper.checked; changed(); });
        for (const b of $$('[data-align]', box)) b.addEventListener('click', () => { t.align = b.dataset.align; changed(); });
        const fontInput = $('[data-x="font-file"]', box);
        $('[data-x="font"]', box).addEventListener('click', () => fontInput.click());
        fontInput.addEventListener('change', async () => {
            const file = fontInput.files[0];
            fontInput.value = '';
            if (!file) return;
            try {
                await setTextFont(layer, file);
                changed();
            } catch (err) {
                app.toast.err(`Could not use ${file.name}`, err.message);
            }
        });
        $('[data-x="font-clear"]', box).addEventListener('click', () => { Object.assign(t, { font: null, fontName: '', face: null }); changed(); });
        show();
        return box;
    }

    function layerMapCell(layer, key) {
        const picture = key === 'art' ? (layer.img ? { blob: layer.blob, name: layer.name } : null) : layer[key];
        const cell = document.createElement('div');
        cell.className = 'layer-media';
        cell.innerHTML = `
            <div class="drop drop-sm${picture ? ' has-file' : ''}" tabindex="0">
                <b>${LAYER_MAP_LABEL[key]}</b>
                ${picture ? '<img class="media-thumb" alt="">' : ''}
                <small class="media-name">${picture ? app.escapeHtml(key === 'art' ? 'Click to replace' : picture.name || key) : LAYER_MAP_EMPTY[key]}</small>
            </div>
            <input type="file" accept="image/*" hidden>
            ${picture && key !== 'art' ? '<button type="button" class="facade-btn fx-sm fx-grey">Remove</button>' : ''}`;
        if (picture) cell.querySelector('.media-thumb').src = objectUrl(picture.blob, ps.editUrls);
        const drop = cell.querySelector('.drop'), input = cell.querySelector('input');
        const take = async (file) => {
            if (!file || !file.type.startsWith('image/')) return;
            try {
                const read = await readPicture(file);
                if (key === 'art') { layer.img = read.img; layer.blob = read.blob; } else layer[key] = derive(key, read);
                layer.version++;
            } catch (err) {
                app.toast.err(`Could not read ${file.name}`, err.message);
            }
            renderLayers();
            refresh();
        };
        drop.addEventListener('click', () => input.click());
        drop.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); input.click(); } });
        input.addEventListener('change', () => { take(input.files[0]); input.value = ''; });
        drop.addEventListener('dragover', (ev) => { ev.preventDefault(); drop.classList.add('is-over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
        drop.addEventListener('drop', (ev) => { ev.preventDefault(); drop.classList.remove('is-over'); take(ev.dataTransfer.files[0]); });
        const clear = cell.querySelector('button');
        if (clear) clear.addEventListener('click', () => { layer[key] = null; layer.version++; renderLayers(); refresh(); });
        return cell;
    }

    function renderMaps() {
        const e = ps.edit;
        const box = $('#pk-maps');
        box.innerHTML = '';
        for (const m of MAPS) {
            const map = e.maps[m];
            const cell = document.createElement('div');
            cell.className = 'pack-map';
            cell.innerHTML = `
                <div class="drop drop-sm${map ? ' has-file' : ''}" tabindex="0">
                    <b>${MAP_LABEL[m]}</b>
                    <span>${MAP_NOTE[m]}</span>
                    ${map ? '<img class="map-thumb" alt="">' : ''}
                    <small>${map ? app.escapeHtml(map.name || m + '.png') : e.loading ? 'Opening…' : 'The template\'s'}</small>
                </div>
                <input type="file" accept="image/*" hidden>
                ${map ? '<button type="button" class="facade-btn fx-sm fx-grey">Use the template\'s</button>' : ''}`;
            if (map) cell.querySelector('.map-thumb').src = objectUrl(map.blob, ps.editUrls);
            const drop = cell.querySelector('.drop'), input = cell.querySelector('input');
            const take = async (file) => {
                if (!file || !file.type.startsWith('image/')) return;
                try {
                    e.maps[m] = await readPicture(file, { flipGreen: m === 'normal' && $('#pk-normal-dx').checked });
                } catch (err) {
                    app.toast.err(`Could not read ${file.name}`, err.message);
                }
                renderMaps();
                refresh();
            };
            drop.addEventListener('click', () => input.click());
            drop.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); input.click(); } });
            input.addEventListener('change', () => { take(input.files[0]); input.value = ''; });
            drop.addEventListener('dragover', (ev) => { ev.preventDefault(); drop.classList.add('is-over'); });
            drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
            drop.addEventListener('drop', (ev) => { ev.preventDefault(); drop.classList.remove('is-over'); take(ev.dataTransfer.files[0]); });
            const clear = cell.querySelector('button');
            if (clear) clear.addEventListener('click', () => { delete e.maps[m]; renderMaps(); refresh(); });
            box.appendChild(cell);
        }
    }

    async function flipNormal() {
        const e = ps.edit;
        const map = e && e.maps.normal;
        if (!map) return;
        e.maps.normal = await readPicture(map.blob, { flipGreen: true });
        renderMaps();
        refresh();
    }

    async function baseMaps(folder, full) {
        const skin = skinOf(folder);
        const template = await templatePreview();
        const out = {};
        for (const m of MAPS) out[m] = (await skinImage(skin, m)) || (full ? await templateFull(m) : template[m]);
        return out;
    }

    function layerMapsToWrite(e) {
        const skin = skinOf(e.base);
        const shown = e.layers.filter((l) => !l.hidden && l.img);
        const has = (m) => !!(skin && skin.maps[m]);
        return MAPS.filter((m) => m === 'albedo' || (m === 'normal' && (shown.some((l) => l.normal) || has(m)))
            || (m === 'metallic' && (shown.some(touchesMetal) || has(m))) || (m === 'roughness' && (shown.some(touchesRough) || has(m)))
            || (m === 'ao' && has(m)));
    }

    async function currentTextures(S = PREVIEW_SIZE) {
        const e = ps.edit;
        const template = await templatePreview();
        const out = { albedo: null, normal: null, metallic: null, roughness: null, ao: null };
        if (e.look === 'layers') {
            return composite(S, await baseMaps(e.base, S === SAVE_SIZE), e.layers);
        } else if (e.look === 'textures') {
            for (const m of MAPS) out[m] = e.maps[m] ? e.maps[m].img : null;
        } else {
            const skin = skinOf(e.skin);
            for (const m of MAPS) out[m] = await skinImage(skin, m);
        }
        return out;
    }

    let refreshQueued = false, refreshRunning = false, refreshAgain = false;
    function refresh() {
        if (refreshQueued) return;
        refreshQueued = true;
        requestAnimationFrame(async () => {
            refreshQueued = false;
            if (refreshRunning) { refreshAgain = true; return; }
            refreshRunning = true;
            try { await draw(); } catch (err) { console.error(err); }
            refreshRunning = false;
            if (refreshAgain) { refreshAgain = false; refresh(); }
        });
    }

    async function draw() {
        const e = ps.edit;
        if (!e) return;
        const note = $('#pk-preview-note');
        if (!window.PackGL || !PackGL.available()) {
            note.textContent = 'No preview: no model or WebGL 2.';
            return;
        }
        const tex = await currentTextures();
        const template = await templatePreview();
        const albedo = tex[ps.show] || template[ps.show];
        if (ps.view === '3d') {
            if (!ps.view3d) ps.view3d = PackGL.view($('#pk-3d'));
            if (!ps.view3d) { note.textContent = 'No WebGL 2.'; return; }
            for (const m of MAPS) ps.view3d.setTexture(m, tex[m]);
            note.textContent = 'Drag to turn, scroll to zoom.';
            return;
        }
        const canvas = $('#pk-2d');
        const dpr = window.devicePixelRatio || 1;
        const cssW = canvas.clientWidth || 300, cssH = canvas.clientHeight || 300;
        const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
        if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, W, H);
        if (!albedo) return;
        if (ps.view === 'texture') {
            ctx.drawImage(albedo, 0, 0, W, H);
            drawWireframe(ctx, W, H);
        } else {
            ctx.drawImage(PackGL.projector().atlasToFace(ps.view, albedo, W, H), 0, 0);
        }
        const layer = e.look === 'layers' ? selectedLayer() : null;
        if (layer && layer.face === ps.view && !layer.hidden) {
            const pts = corners(layer, W, H);
            ctx.save();
            ctx.setLineDash([6 * dpr, 4 * dpr]);
            ctx.lineWidth = 1.5 * dpr;
            ctx.strokeStyle = 'rgba(80, 160, 255, .95)';
            ctx.beginPath();
            pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.closePath();
            ctx.stroke();
            ctx.restore();
        }
        note.textContent = e.look !== 'layers' ? '' : 'Drag to move, double-click to fill.';
    }

    let wireframe = null;
    function drawWireframe(ctx, W, H) {
        const g = geo();
        if (!g) return;
        if (!wireframe) {
            wireframe = new Path2D();
            for (let k = 0; k < g.I.length; k += 3) {
                const p = [g.I[k], g.I[k + 1], g.I[k + 2]].map((i) => [g.UV[i * 2], 1 - g.UV[i * 2 + 1]]);
                wireframe.moveTo(p[0][0], p[0][1]);
                wireframe.lineTo(p[1][0], p[1][1]);
                wireframe.lineTo(p[2][0], p[2][1]);
                wireframe.closePath();
            }
        }
        ctx.save();
        ctx.scale(W, H);
        ctx.lineWidth = 1 / W;
        ctx.strokeStyle = 'rgba(255, 255, 255, .12)';
        ctx.stroke(wireframe);
        ctx.restore();
    }

    function setView(view) {
        ps.view = view;
        for (const b of $$('#pk-view button')) b.classList.toggle('fx-on', b.dataset.view === view);
        const flat = view !== '3d';
        $('#pk-2d').hidden = !flat;
        $('#pk-3d').hidden = flat;
        $('#pk-show').hidden = !flat;
        $('#pk-2d').classList.toggle('is-texture', view === 'texture');
        $('#pk-2d').style.aspectRatio = view === 'texture' ? '1 / 1' : `${aspect()}`;
        if (!flat && ps.view3d) ps.view3d.update();
        refresh();
    }

    function wirePreview() {
        for (const b of $$('#pk-view button')) b.addEventListener('click', () => setView(b.dataset.view));
        for (const b of $$('#pk-show button')) b.addEventListener('click', () => {
            ps.show = b.dataset.show;
            for (const x of $$('#pk-show button')) x.classList.toggle('fx-on', x === b);
            refresh();
        });
        const canvas = $('#pk-2d');
        let drag = null;
        const point = (ev) => {
            const r = canvas.getBoundingClientRect();
            return { x: ev.clientX - r.left, y: ev.clientY - r.top, W: r.width, H: r.height };
        };
        const onFace = () => (ps.edit ? ps.edit.layers.filter((l) => l.face === ps.view && !l.hidden && l.img) : []);
        canvas.addEventListener('pointerdown', (ev) => {
            const e = ps.edit;
            if (!e || e.look !== 'layers') return;
            const p = point(ev);
            const layers = onFace();
            const current = selectedLayer();
            const hit = current && current.face === ps.view && hits(current, p.x, p.y, p.W, p.H) ? current
                : [...layers].reverse().find((l) => hits(l, p.x, p.y, p.W, p.H));
            if (!hit) { if (e.selected != null) { e.selected = null; renderLayers(); refresh(); } return; }
            if (e.selected !== hit.uid) { e.selected = hit.uid; renderLayers(); }
            drag = { layer: hit, x0: p.x, y0: p.y, lx: hit.x, ly: hit.y };
            canvas.setPointerCapture(ev.pointerId);
            canvas.classList.add('is-dragging');
            refresh();
        });
        canvas.addEventListener('pointermove', (ev) => {
            const p = point(ev);
            if (!drag) {
                const e = ps.edit;
                canvas.style.cursor = e && e.look === 'layers' && onFace().some((l) => hits(l, p.x, p.y, p.W, p.H)) ? 'grab' : 'default';
                return;
            }
            let dx = (p.x - drag.x0) / p.W, dy = (p.y - drag.y0) / p.H;
            if (ev.shiftKey) { if (Math.abs(dx * p.W) >= Math.abs(dy * p.H)) dy = 0; else dx = 0; }
            drag.layer.x = Math.min(1.5, Math.max(-0.5, drag.lx + dx));
            drag.layer.y = Math.min(1.5, Math.max(-0.5, drag.ly + dy));
            drag.layer.cache = null;
            refresh();
        });
        const end = () => { drag = null; canvas.classList.remove('is-dragging'); };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        canvas.addEventListener('dblclick', () => {
            const layer = selectedLayer();
            if (!layer || layer.face !== ps.view) return;
            Object.assign(layer, { x: 0.5, y: 0.5, rotation: 0, scale: round(fillScale(layer), 3) });
            layerChanged(layer);
            renderLayers();
        });
        new ResizeObserver(() => refresh()).observe(canvas);
    }

    async function removeFiles(dir, test, keep = new Set()) {
        const doomed = [];
        for await (const [name, handle] of dir.entries())
            if (handle.kind === 'file' && test.test(name) && !keep.has(name.toLowerCase())) doomed.push(name);
        for (const name of doomed) await dir.removeEntry(name).catch(() => {});
    }

    async function thumbOf(albedo) {
        const c = renderFront(albedo || (await templatePreview()).albedo, THUMB_H);
        return c ? pngBlob(c) : null;
    }

    function readPackForm() {
        const e = ps.edit;
        const name = $('#pk-name').value.trim();
        if (!name) throw Object.assign(new Error('The pack needs a name'), { field: '#pk-name' });
        const count = parseInt($('#pk-count').value, 10);
        if (!(count >= 1 && count <= MAX_COUNT)) throw Object.assign(new Error(`Cards per pack: 1 to ${MAX_COUNT}`), { field: '#pk-count' });
        const price = parseInt($('#pk-price').value, 10);
        if (!(price >= 1)) throw Object.assign(new Error('Price: at least 1 ₽'), { field: '#pk-price' });
        const loot = $('#pk-loot').checked ? parseFloat($('#pk-loot-percent').value) : 0;
        if ($('#pk-loot').checked && !(loot > 0 && loot <= 100)) throw Object.assign(new Error('Found in raid: a chance above 0 and up to 100%'), { field: '#pk-loot-percent' });
        if (!poolOf(e.cards).length) throw new Error('No card matches the pack\'s card choice.');
        if (e.look === 'textures' && !e.maps.albedo) throw new Error('Own textures need at least the albedo map.');
        return { name, count, price, loot };
    }

    function cardsJson(sel) {
        const e = ps.edit;
        const json = { all: sel.all };
        const collections = [...sel.collections].map((k) => e.collFolders.get(k) || k);
        const cards = [...sel.cards].map((k) => {
            const card = (app.state.list || []).find((c) => lower(c.key) === k);
            return card ? card.key : e.cardKeys.get(k) || k;
        });
        if (collections.length) json.collections = collections;
        if (cards.length) json.cards = cards;
        if (sel.rarities.size > 0 && sel.rarities.size < RARITIES.length) json.rarities = RARITIES.filter((r) => sel.rarities.has(r));
        return json;
    }

    async function savePack() {
        const e = ps.edit;
        if (!e) return;
        if (!app.state.data) { app.toast.err('Connect the Guro-DaCard folder first'); return; }
        if (e.loading) { app.toast.err('Still opening the pack', 'Wait for its pictures to load, then save.'); return; }
        let form;
        try { form = readPackForm(); } catch (err) { app.toast.err('Can\'t save yet', err.message); if (err.field) $(err.field).focus(); return; }

        const clash = ps.packs.find((p) => p !== e.source && lower(p.data.name) === lower(form.name));
        if (clash) { app.toast.err(`"${form.name}" already exists`, 'Pick another name.'); return; }

        const button = $('#pk-save'), label = button.textContent;
        button.disabled = true;
        button.textContent = 'Saving…';
        try {
            let dir = e.source ? e.source.dir : null;
            if (!dir) {
                const addon = await CardAddonKit.ensure(app.state.data, app.state.addons || [], $('#pk-addon').value);
                const packsDir = await app.getDir(addon.dir, PACKS, true);
                dir = await packsDir.getDirectoryHandle(await CardAddonKit.freeName(packsDir), { create: true });
                if (!(app.state.addons || []).some((a) => a.folder === addon.folder)) await app.scanAddons();
            }
            const data = Object.assign({}, e.data, {
                name: form.name,
                look: e.look,
                cardCount: form.count,
                price: form.price,
                purchasable: $('#pk-buy').checked,
                lootPercent: round(form.loot, 3),
                cards: cardsJson(e.cards),
            });
            for (const [key, value] of [['shortName', $('#pk-short').value.trim()], ['description', $('#pk-desc').value.trim()]]) {
                if (value) data[key] = value; else delete data[key];
            }
            delete data.skin;
            delete data.layers;
            delete data.base;

            const keepLayers = new Set(), keepMaps = new Set(), keepFonts = new Set();
            let albedoForThumb = null;
            if (e.look === 'preset') {
                if (e.skin) data.skin = e.skin;
                const skin = skinOf(e.skin);
                albedoForThumb = await skinImage(skin, 'albedo');
            } else if (e.look === 'layers') {
                if (e.base) data.base = e.base;
                const written = await writeLayers(dir, e.layers);
                data.layers = written.entries;
                written.keepLayers.forEach((n) => keepLayers.add(n));
                written.keepFonts.forEach((n) => keepFonts.add(n));
                const tex = await currentTextures(SAVE_SIZE);
                for (const m of layerMapsToWrite(e)) {
                    await app.writeFile(dir, `${m}.png`, await pngBlob(tex[m]));
                    keepMaps.add(`${m}.png`);
                }
                albedoForThumb = tex.albedo;
            } else {
                for (const m of MAPS) {
                    if (!e.maps[m]) continue;
                    await app.writeFile(dir, `${m}.png`, e.maps[m].blob);
                    keepMaps.add(`${m}.png`);
                }
                albedoForThumb = e.maps.albedo.img;
            }
            await removeFiles(dir, LAYER_FILE, keepLayers);
            await removeFiles(dir, FONT_FILE, keepFonts);
            await removeFiles(dir, MAP_FILE, keepMaps);
            const thumb = await thumbOf(albedoForThumb);
            if (thumb) await app.writeFile(dir, THUMB_FILE, thumb);
            await app.writeFile(dir, PACK_FILE, new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));

            app.toast.ok('Booster pack saved', `${form.name} · restart the SPT server to get it in game.`);
            closePack();
            await scan();
        } catch (err) {
            app.toast.err('Could not save the booster pack', err.message);
        } finally {
            button.disabled = false;
            button.textContent = label;
        }
    }

    async function deletePack() {
        const e = ps.edit;
        const btn = $('#pk-delete');
        if (!e || !e.source) return;
        if (!btn.dataset.armed) {
            btn.dataset.armed = '1';
            btn.textContent = 'Click again to delete';
            setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = 'Delete pack'; } }, 3000);
            return;
        }
        try {
            await e.source.parent.removeEntry(e.source.folder, { recursive: true });
            app.toast.ok('Booster pack deleted', `${e.source.data.name} is gone after the server restarts. Packs players already have stop working then.`);
            closePack();
            await scan();
        } catch (err) {
            app.toast.err('Could not delete the booster pack', err.message);
        }
    }

    async function saveSkin() {
        const e = ps.edit;
        if (!e || !app.state.data) return;
        const name = $('#pk-skin-name').value.trim();
        if (!name) { app.toast.err('The preset needs a name'); $('#pk-skin-name').focus(); return; }
        if (ps.skins.some((s) => lower(s.data.name) === lower(name))) { app.toast.err(`A preset "${name}" already exists`, 'Pick another name.'); return; }
        if (e.look === 'textures' && !e.maps.albedo) { app.toast.err('No albedo map yet', 'Add the textures first.'); return; }
        const button = $('#pk-skin-save');
        button.disabled = true;
        try {
            const addon = await CardAddonKit.ensure(app.state.data, app.state.addons || [], editAddon());
            const skinsDir = await app.getDir(addon.dir, SKINS, true);
            const folder = await CardAddonKit.freeName(skinsDir);
            const dir = await skinsDir.getDirectoryHandle(folder, { create: true });
            const info = { name };
            let albedo = null;
            if (e.look === 'layers') {
                const tex = await currentTextures(SAVE_SIZE);
                for (const m of layerMapsToWrite(e)) await app.writeFile(dir, `${m}.png`, await pngBlob(tex[m]));
                albedo = tex.albedo;
                const copies = await Promise.all(e.layers.map(async (l) => ({ ...l, file: null })));
                info.layers = (await writeLayers(dir, copies)).entries;
                if (e.base) info.base = e.base;
            } else if (e.look === 'textures') {
                for (const m of MAPS) if (e.maps[m]) await app.writeFile(dir, `${m}.png`, e.maps[m].blob);
                albedo = e.maps.albedo.img;
            } else {
                const skin = skinOf(e.skin);
                if (skin) await CardAddonKit.copyInto(skin.dir, dir);
                const source = skin && skin.data && typeof skin.data === 'object' ? skin.data : {};
                if (Array.isArray(source.layers)) info.layers = source.layers;
                if (typeof source.base === 'string') info.base = source.base;
                albedo = await skinImage(skin, 'albedo');
            }
            const thumb = await thumbOf(albedo);
            if (thumb) await app.writeFile(dir, THUMB_FILE, thumb);
            await app.writeFile(dir, SKIN_FILE, new Blob([JSON.stringify(info, null, 2) + '\n'], { type: 'application/json' }));
            $('#pk-skin-name').value = '';
            await scan();
            app.toast.ok('Preset saved', `${name} · data/${addon.folder}/skins/${folder}/`);
        } catch (err) {
            app.toast.err('Could not save the preset', err.message);
        } finally {
            button.disabled = false;
        }
    }

    async function saveTemplate() {
        const e = ps.edit, skin = e && e.template;
        if (!skin) return;
        if (e.loading) { app.toast.err('Still opening the template', 'Wait for its pictures to load, then save.'); return; }
        const name = $('#pk-name').value.trim();
        if (!name) { app.toast.err('The template needs a name'); $('#pk-name').focus(); return; }
        if (ps.skins.some((x) => !sameSkin(x, skin) && lower(x.data.name) === lower(name))) { app.toast.err(`A preset "${name}" already exists`, 'Pick another name.'); return; }
        if (e.look === 'textures' && !e.maps.albedo) { app.toast.err('No albedo map yet', 'Add the textures first.'); return; }
        const button = $('#pk-save'), label = button.textContent;
        button.disabled = true;
        button.textContent = 'Saving…';
        try {
            const dir = skin.dir;
            const info = { ...e.data, name };
            delete info.layers;
            delete info.base;
            const keepLayers = new Set(), keepFonts = new Set(), keepMaps = new Set();
            let albedo;
            if (e.look === 'layers') {
                const written = await writeLayers(dir, e.layers);
                info.layers = written.entries;
                written.keepLayers.forEach((n) => keepLayers.add(n));
                written.keepFonts.forEach((n) => keepFonts.add(n));
                if (e.base) info.base = e.base;
                const tex = await currentTextures(SAVE_SIZE);
                for (const m of layerMapsToWrite(e)) {
                    await app.writeFile(dir, `${m}.png`, await pngBlob(tex[m]));
                    keepMaps.add(`${m}.png`);
                }
                albedo = tex.albedo;
            } else {
                for (const m of MAPS) {
                    if (!e.maps[m]) continue;
                    await app.writeFile(dir, `${m}.png`, e.maps[m].blob);
                    keepMaps.add(`${m}.png`);
                }
                albedo = e.maps.albedo.img;
            }
            await removeFiles(dir, LAYER_FILE, keepLayers);
            await removeFiles(dir, FONT_FILE, keepFonts);
            await removeFiles(dir, MAP_FILE, keepMaps);
            const thumb = await thumbOf(albedo);
            if (thumb) await app.writeFile(dir, THUMB_FILE, thumb);
            await app.writeFile(dir, SKIN_FILE, new Blob([JSON.stringify(info, null, 2) + '\n'], { type: 'application/json' }));
            app.toast.ok('Template saved', `${name} · packs using it as their preset show the change after a server restart.`);
            closePack();
            await scan();
        } catch (err) {
            app.toast.err('Could not save the template', err.message);
        } finally {
            button.disabled = false;
            button.textContent = label;
        }
    }

    function wire() {
        $('#pk-new').addEventListener('click', () => {
            if (!app.state.data) { app.toast.err('Connect the mod folder first'); return; }
            openPack(null);
        });
        $('#pk-cancel').addEventListener('click', closePack);
        $('#pk-save').addEventListener('click', () => (ps.edit && ps.edit.template ? saveTemplate() : savePack()));
        $('#pk-delete').addEventListener('click', deletePack);
        $('#pk-skin-save').addEventListener('click', saveSkin);
        $('#pk-name').addEventListener('input', updateFolder);
        $('#pk-count').addEventListener('input', renderPool);
        $('#pk-loot').addEventListener('change', updateLootRow);
        $('#pk-all').addEventListener('change', () => { if (ps.edit) { ps.edit.cards.all = $('#pk-all').checked; renderCardChoice(); } });
        $('#pk-addon').addEventListener('change', () => { if (ps.edit) renderCardChoice(); });
        $('#pk-normal-dx').addEventListener('change', () => { if (ps.edit && ps.edit.maps.normal) flipNormal(); });
        for (const tile of $$('.look-choice .look-tile')) tile.addEventListener('click', () => setLook(tile.dataset.look));

        const input = $('#pk-layer-file'), panel = $('#pk-look-layers');
        CardMedia.picker($('#pk-layer-add'), (kind) => (kind === 'text' ? addTextLayer() : input.click()), LAYER_KINDS, 'Choose the layer type');
        input.addEventListener('change', () => { addLayers([...input.files]); input.value = ''; });
        panel.addEventListener('dragover', (ev) => { if ([...ev.dataTransfer.items].some((i) => i.type.startsWith('image/'))) ev.preventDefault(); });
        panel.addEventListener('drop', (ev) => {
            const files = [...ev.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
            if (!files.length || ev.target.closest('.layer-media')) return;
            ev.preventDefault();
            addLayers(files);
        });
        for (const id of ['#pk-name', '#pk-short', '#pk-desc']) $(id).addEventListener('input', rerenderTexts);

        $('#pk-odds-save').addEventListener('click', saveOdds);
        $('#pk-odds-reset').addEventListener('click', () => { readWeights(); renderOdds(); setStatus($('#pk-odds-status'), ''); });
        wirePreview();
    }

    window.CCPacks = {
        init(helpers) {
            app = helpers;
            readWeights();
            wire();
            renderOdds();
            renderList();
        },
        show() {
            if (!app) return;
            closePack();
            if (app.state.data) scan();
        },
        changed(what) {
            if (!app) return;
            if (what === 'config') {
                readWeights();
                renderOdds();
                return;
            }
            if (what === 'folder') { scan(); return; }
            if (what === 'addons') { fillAddons(); return; }
            renderList();
            if (ps.edit) renderCardChoice();
        },
    };
})();
