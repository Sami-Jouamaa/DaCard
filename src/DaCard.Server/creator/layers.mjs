(() => {
    'use strict';

    // Card layers: pictures stacked on a card (front and back lists, bottom first), each with an art, an optional foil
    // area and normal map (image, image sequence or video / GIF: CardMedia), a chance (% of copies that show it: rolled
    // per copy in game), Can Be Foil and a transform (centre, scale, turn). A card's layers sit under its collection's
    // layers, or over them ("over"). Used by the card form and the collection editor. Files, as the server reads them:
    // <file>.png, <file>.foil.png, <file>.normal.png, frames.<file>[.foil|.normal]/frame_000.png ... (the pictures as they
    // are: the game places them with the transform, like the preview here).

    const CARD_W = 490, CARD_H = 684;
    const MAX_SIDE = 1600;          // saved pictures are at most this big (a layer can be scaled up on the card)
    const MAPS = ['art', 'foil', 'normal', 'normalmask'];
    const MAP_LABEL = { art: 'Picture', foil: 'Foil area', normal: 'Normal map', normalmask: 'Normal mask' };
    const MAP_EMPTY = { art: 'Required', foil: 'None: foil on all of it', normal: 'None: flat', normalmask: 'None: normal map on all of it' };
    // Masks (white = yes): the foil area, and where the normal map shows
    const IS_MASK = { foil: true, normalmask: true };
    const KIND_LABEL = { image: 'Image', sequence: 'Image sequence', video: 'Video', gif: 'GIF' };
    const PICK = {
        image: { accept: 'image/png,image/jpeg,image/webp,image/bmp,image/avif', multiple: false },
        sequence: { accept: 'image/*', multiple: true },
        video: { accept: 'video/*,image/gif,.gif', multiple: false },
    };
    const LAYER_NAME = String.raw`((front|back)_\d+|layer_[0-9a-f]{10})`;
    const LAYER_FILE = new RegExp(String.raw`^${LAYER_NAME}(\.(foil|normal|normalmask))?\.png$`, 'i');
    const LAYER_FRAMES = new RegExp(String.raw`^frames\.${LAYER_NAME}(\.(foil|normal|normalmask))?$`, 'i');
    const LAYER_FONT = new RegExp(String.raw`^${LAYER_NAME}\.(ttf|otf)$`, 'i');
    const IDENTITY = { x: 0.5, y: 0.5, scale: 1, rotation: 0 };
    const MAX_NAME = 60;
    const LAYER_KINDS = {
        image: { label: 'Image layer', title: 'Add a layer with a picture (image, image sequence, video or GIF)' },
        text: { label: 'Text layer', title: 'Add a layer of text (it can show the card\'s name, description, rarity…)' },
    };
    const TEXT_ID = /^[A-Za-z0-9_-]{1,40}$/;

    let nextUid = 1;
    const newTextId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const isText = (l) => l.kind === 'text';
    const hasContent = (l) => (isText(l) ? !!l.text : !!l.maps.art);

    // Runs change(), then animates el from its size before to its size after, instead of snapping
    function smoothResize(el, change, duration = 220) {
        if (!el || !el.isConnected || !el.getClientRects().length || matchMedia('(prefers-reduced-motion: reduce)').matches) {
            change();
            return;
        }
        const before = el.getBoundingClientRect();
        change();
        const after = el.getBoundingClientRect();
        if (Math.abs(before.width - after.width) < 1 && Math.abs(before.height - after.height) < 1) return;
        if (el._resizeAnim) el._resizeAnim.cancel();
        const overflow = el.style.overflow;
        el.style.overflow = 'hidden';
        const anim = el.animate([
            { width: `${before.width}px`, height: `${before.height}px` },
            { width: `${after.width}px`, height: `${after.height}px` },
        ], { duration, easing: 'cubic-bezier(.2, .7, .3, 1)' });
        el._resizeAnim = anim;
        const done = () => { if (el._resizeAnim === anim) { el.style.overflow = overflow; el._resizeAnim = null; } };
        anim.onfinish = done;
        anim.oncancel = done;
    }

    function newLayer(side, defaults = {}, kind = 'image') {
        return {
            uid: nextUid++, side, kind,
            id: kind === 'text' ? newTextId() : null,
            text: kind === 'text' ? CardText.defaults() : null,
            chance: 100,
            price: 0,
            canBeFoil: defaults.canBeFoil ?? side === 'front',
            frame: kind !== 'text' && !!defaults.frame,
            over: false,
            maps: { art: null, foil: null, normal: null, normalmask: null },
            transform: { ...IDENTITY },
            hidden: false,
            name: '',
            collapsed: false,
            saved: null,
        };
    }

    const savedState = (layer) => ({ ...layer.maps, font: layer.text ? layer.text.font : null });
    const STABLE_FILE = new RegExp(`^${LAYER_NAME}$`, 'i');
    const newLayerFile = () => 'layer_' + Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('');

    const newCanvas = (w = CARD_W, h = CARD_H) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        return c;
    };

    // ---------- Placing a picture on the card ----------

    // Size in card pixels at the layer's scale: scale 1 fits the picture inside the card
    function placedSize(size, t) {
        const k = Math.min(CARD_W / size.w, CARD_H / size.h) * t.scale;
        return { w: size.w * k, h: size.h * k };
    }

    // img drawn as a picture of `size` (the layer's art size: its maps are stretched to it), placed by the transform
    function drawPlaced(img, t, size, canvas = newCanvas()) {
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const p = placedSize(size, t);
        ctx.save();
        ctx.translate(t.x * CARD_W, t.y * CARD_H);
        ctx.rotate(t.rotation * Math.PI / 180);
        ctx.drawImage(img, -p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
        return canvas;
    }

    function layerBox(layer) {
        if (isText(layer)) {
            const t = layer.text;
            return { cx: t.x * CARD_W, cy: (t.y + t.height / 2) * CARD_H, w: t.width * CARD_W, h: t.height * CARD_H, rotation: t.rotation || 0 };
        }
        const art = layer.maps.art;
        if (!art) return null;
        const t = layer.transform, p = placedSize({ w: art.width, h: art.height }, t);
        return { cx: t.x * CARD_W, cy: t.y * CARD_H, w: p.w, h: p.h, rotation: t.rotation };
    }

    // The placed picture's outline (for the preview): corners in card pixels
    function outline(layer) {
        if (isText(layer)) return CardText.box(layer.text);
        const art = layer.maps.art;
        if (!art) return null;
        const t = layer.transform, p = placedSize({ w: art.width, h: art.height }, t);
        const a = t.rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
            const x = u * p.w / 2, y = v * p.h / 2;
            return [t.x * CARD_W + c * x - s * y, t.y * CARD_H + s * x + c * y];
        });
    }

    function drawNatural(img, size) {
        const canvas = newCanvas(Math.max(1, Math.round(size.w)), Math.max(1, Math.round(size.h)));
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas;
    }

    // A foil area as saved: opaque grey, white = foil. From its transparency if it has any, else its brightness.
    function toMask(canvas, preview = false) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
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

    const artSize = (layer) => ({ w: layer.maps.art.width, h: layer.maps.art.height });

    // The scale that just covers the card (scale 1 fits inside it)
    function fillScale(layer) {
        if (!layer.maps.art) return 1;
        const { w, h } = artSize(layer);
        return Math.max(CARD_W / w, CARD_H / h) / Math.min(CARD_W / w, CARD_H / h);
    }

    // One map of a layer at time t (seconds), placed on the card
    function mapCanvas(layer, map, t) {
        const media = layer.maps[map];
        if (!media || !layer.maps.art) return null;
        const size = artSize(layer), img = media.frameAt(t);
        if (IS_MASK[map]) return drawPlaced(toMask(drawNatural(img, size)), layer.transform, size);
        return drawPlaced(img, layer.transform, size);
    }

    // Bottom to top: the card's layers, the collection's, the card's layers marked over them
    const ordered = (card, coll = []) => [...card.filter((l) => !l.over), ...coll, ...card.filter((l) => l.over)];

    const textStyle = (layer, ctx = {}) => {
        const align = ctx.align && ctx.align[layer.id];
        return CardText.ALIGNS.includes(align) ? { ...layer.text, align } : layer.text;
    };

    // What the preview stacks: [{ art, foil, normal, canBeFoil, frame, turn }] (card-sized canvases)
    function parts(layers, t, ctx = {}) {
        return layers.filter((l) => hasContent(l) && !l.hidden).map((l) => {
            if (isText(l)) {
                const art = CardText.render(textStyle(l, ctx), ctx.vars || {});
                return art && { art, foil: null, normal: null, normalMask: null, canBeFoil: l.canBeFoil, frame: l.frame, turn: 0 };
            }
            return {
                art: mapCanvas(l, 'art', t), foil: mapCanvas(l, 'foil', t), normal: mapCanvas(l, 'normal', t), normalMask: mapCanvas(l, 'normalmask', t),
                canBeFoil: l.canBeFoil, frame: l.frame, turn: l.transform.rotation * Math.PI / 180,
            };
        }).filter(Boolean);
    }

    // The same stack the client builds on the GPU (CardLayers.cs / CardLayerComposite.shader): colour (straight alpha),
    // foil (R: foil, G: frame glow) and normal map (flat where nothing covers; turned with its layer).
    // opts.foil / opts.normal false: skip those (the colour is cheap, they are per-pixel work)
    function composite(list, opts = {}) {
        const color = newCanvas(), foil = newCanvas(), normal = newCanvas();
        const cg = color.getContext('2d');
        for (const p of list) cg.drawImage(p.art, 0, 0);
        const wantFoil = opts.foil !== false, wantNormal = opts.normal !== false;
        if (!wantFoil && !wantNormal) return { color, foil: null, normal: null };
        const fg = foil.getContext('2d', { willReadFrequently: true }), ng = normal.getContext('2d', { willReadFrequently: true });
        const fImg = fg.createImageData(CARD_W, CARD_H), nImg = ng.createImageData(CARD_W, CARD_H);
        const fd = fImg.data, nd = nImg.data;
        for (let i = 0; i < fd.length; i += 4) { fd[i + 3] = 255; nd[i] = 128; nd[i + 1] = 128; nd[i + 2] = 255; nd[i + 3] = 255; }
        const read = (c) => (c ? c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, CARD_W, CARD_H).data : null);
        for (const p of list) {
            const a = read(p.art), m = read(p.foil), n = wantNormal ? read(p.normal) : null, nm = n ? read(p.normalMask) : null;
            const frameValue = p.frame ? 255 : 0;
            const c = Math.cos(p.turn || 0), s = Math.sin(p.turn || 0);
            for (let i = 0; i < fd.length; i += 4) {
                const al = a[i + 3] / 255;
                if (al === 0) continue;
                const f = p.canBeFoil ? (m ? m[i] : 255) : 0;
                fd[i] += (f - fd[i]) * al;
                fd[i + 1] += (frameValue - fd[i + 1]) * al;
                if (!wantNormal) continue;
                let nx = 0, ny = 0, nz = 255;
                if (n) {
                    // Its normal mask: flat where it is black
                    const k = nm ? nm[i] / 255 : 1;
                    const x = (n[i] / 127.5 - 1) * k, y = (n[i + 1] / 127.5 - 1) * k;
                    nx = (c * x + s * y) * 127.5; ny = (-s * x + c * y) * 127.5; nz = 255 + (n[i + 2] - 255) * k;
                }
                nd[i] += (nx + 127.5 - nd[i]) * al;
                nd[i + 1] += (ny + 127.5 - nd[i + 1]) * al;
                nd[i + 2] += (nz - nd[i + 2]) * al;
            }
        }
        fg.putImageData(fImg, 0, 0);
        ng.putImageData(nImg, 0, 0);
        return { color, foil: wantFoil ? foil : null, normal: wantNormal ? normal : null };
    }

    function hitTest(layers, x, y, t = 0) {
        for (let i = layers.length - 1; i >= 0; i--) {
            const l = layers[i];
            if (l.hidden || !hasContent(l)) continue;
            if (isText(l)) {
                if (CardText.contains(l.text, x, y)) return l;
                continue;
            }
            if (x < 0 || y < 0 || x >= CARD_W || y >= CARD_H) continue;
            const c = mapCanvas(l, 'art', t);
            if (c && c.getContext('2d', { willReadFrequently: true }).getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3] > 16) return l;
        }
        return null;
    }

    const mediaOf = (layers) => layers.flatMap((l) => (isText(l) ? [] : MAPS.map((m) => l.maps[m]).filter(Boolean)));

    async function unreadable(layers, extra = []) {
        const broken = new Set();
        const check = async (blob, what) => {
            try { await blob.slice(0, 1).arrayBuffer(); } catch { broken.add(what); }
        };
        for (const layer of layers) {
            const what = layer.name || (isText(layer) ? 'a text layer' : (layer.maps.art && layer.maps.art.name) || 'a layer');
            if (isText(layer)) { if (layer.text.font) await check(layer.text.font, what); continue; }
            for (const media of MAPS.map((m) => layer.maps[m]).filter((media, i) => media && !(layer.saved && layer.saved[MAPS[i]] === media)))
                for (const frame of media.frames || []) if (frame instanceof Blob) await check(frame, what);
        }
        for (const media of extra)
            for (const frame of media.frames || []) if (frame instanceof Blob) await check(frame, media.name);
        return [...broken];
    }
    const animated = (layers) => mediaOf(layers).some((m) => m.animated);

    // Videos / GIFs not split yet
    async function splitAll(layers, onProgress) {
        for (const media of mediaOf(layers))
            if (media.kind === 'video' && !media.split) await media.splitFrames(onProgress);
    }

    // ---------- Files ----------

    const framesFolder = (file, map) => {
        const base = file === 'card' ? 'frames' : 'frames.' + file;
        return map === 'art' ? base : base + '.' + map;
    };
    const mapFile = (file, map) => (map === 'art' ? `${file}.png` : `${file}.${map}.png`);
    const pngBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const capped = (size) => {
        const k = Math.min(1, MAX_SIDE / Math.max(size.w, size.h));
        return { w: size.w * k, h: size.h * k };
    };
    const isIdentity = (t) => Math.abs(t.x - 0.5) < 1e-4 && Math.abs(t.y - 0.5) < 1e-4 && Math.abs(t.scale - 1) < 1e-4 && Math.abs(t.rotation) < 1e-3;
    const round = (v, d = 10000) => Math.round(v * d) / d;

    // Files for these layer lists: [[path, () => Promise<Blob>]] (rendered one at a time while saving) and the json lists
    function files(lists, opts = {}) {
        const out = [], json = {}, keep = new Set(), clear = new Set(), placed = [];
        const used = new Set(['front', 'back'].flatMap((side) => (lists[side] || []).filter(hasContent)
            .filter((l) => !!opts.incremental && !!l.saved && typeof l.file === 'string' && STABLE_FILE.test(l.file)).map((l) => l.file)));
        for (const side of ['front', 'back']) {
            json[side] = [];
            // Saved bottom first, as the game stacks them (the "over" ones among them)
            const list = (lists[side] || []).filter(hasContent);
            const stable = (l) => !!opts.incremental && !!l.saved && typeof l.file === 'string' && STABLE_FILE.test(l.file);
            list.forEach((layer) => {
                const kept = stable(layer);
                let file = kept ? layer.file : newLayerFile();
                while (!kept && used.has(file)) file = newLayerFile();
                used.add(file);
                const saved = kept ? layer.saved : {};
                placed.push([layer, file]);
                const entry = { file, ...(layer.name && { name: layer.name }), chance: layer.chance, canBeFoil: layer.canBeFoil };
                if (layer.price > 0) entry.price = layer.price;
                if (layer.over) entry.over = true;
                if (isText(layer)) {
                    const t = layer.text;
                    entry.id = layer.id;
                    entry.text = { value: t.value, x: round(t.x), y: round(t.y), width: round(t.width), height: round(t.height), size: round(t.size), align: t.align, color: t.color };
                    if (CardText.VALIGNS.includes(t.valign) && t.valign !== 'top') entry.text.valign = t.valign;
                    if (t.opacity < 1) entry.text.opacity = round(t.opacity, 1000);
                    if (t.uppercase) entry.text.uppercase = true;
                    if (t.autoSize) entry.text.autoSize = true;
                    if (t.rotation) entry.text.rotation = round(t.rotation, 100);
                    if (t.font) {
                        entry.text.font = `${file}${(t.fontName.match(/\.(ttf|otf)$/i) || ['.ttf'])[0].toLowerCase()}`;
                        if (t.font === saved.font) keep.add(entry.text.font.toLowerCase());
                        else out.push([entry.text.font, async () => t.font]);
                    }
                    json[side].push(entry);
                    return;
                }
                const t = layer.transform;
                if (!isIdentity(t)) entry.transform = { x: round(t.x), y: round(t.y), scale: round(t.scale), rotation: round(t.rotation, 100) };
                const size = capped(artSize(layer));
                const fps = {};
                for (const map of MAPS) {
                    const media = layer.maps[map];
                    if (!media) continue;
                    const animated = media.animated && media.count > 1;
                    if (animated) fps[map] = media.fps;
                    if (media === saved[map]) {
                        keep.add(mapFile(file, map).toLowerCase());
                        if (animated) keep.add(framesFolder(file, map).toLowerCase());
                        continue;
                    }
                    if (kept) clear.add(framesFolder(file, map));
                    // The picture as it is (its maps at its size); the game places it with the transform
                    const render = (img) => pngBlob(IS_MASK[map] ? toMask(drawNatural(img, size)) : drawNatural(img, size));
                    out.push([mapFile(file, map), () => media.withFrame(0, render)]);
                    if (animated) {
                        for (let f = 0; f < media.count; f++)
                            out.push([`${framesFolder(file, map)}/frame_${String(f).padStart(3, '0')}.png`, () => media.withFrame(f, render)]);
                    }
                }
                if (Object.keys(fps).length) entry.fps = fps;
                json[side].push(entry);
            });
        }
        for (const [path] of out) keep.add(path.split('/')[0].toLowerCase());
        const commit = () => {
            for (const [layer, file] of placed) {
                layer.file = file;
                layer.saved = savedState(layer);
            }
        };
        return { files: out, json, keep, clear: [...clear], commit };
    }

    // Layer files no layer uses any more (keep: the names the saved layers use)
    async function removeFiles(dir, alsoNames = [], keep = new Set()) {
        const doomed = [];
        for await (const [name, handle] of dir.entries()) {
            if (keep.has(name.toLowerCase())) continue;
            if (handle.kind === 'file' && (LAYER_FILE.test(name) || LAYER_FONT.test(name) || alsoNames.includes(name))) doomed.push([name, false]);
            if (handle.kind === 'directory' && (LAYER_FRAMES.test(name) || alsoNames.includes(name))) doomed.push([name, true]);
        }
        for (const [name, recursive] of doomed) await dir.removeEntry(name, { recursive }).catch(() => {});
    }

    async function getHandle(dir, name, kind) {
        try { return kind === 'directory' ? await dir.getDirectoryHandle(name) : await dir.getFileHandle(name); } catch { return null; }
    }

    // One map from disk: its frames folder (an image sequence) or its picture
    const inMemory = async (file) => new File([await file.arrayBuffer()], file.name, { type: file.type, lastModified: file.lastModified });

    async function loadMap(dir, file, map, fps, opts = {}) {
        const read = async (handle) => (opts.copy ? inMemory(await handle.getFile()) : handle.getFile());
        const frames = await getHandle(dir, framesFolder(file, map), 'directory');
        if (frames) {
            const list = [];
            for await (const [name, handle] of frames.entries())
                if (handle.kind === 'file' && /^frame_\d+\.png$/i.test(name)) list.push(await read(handle));
            if (list.length > 1) {
                const media = await CardMedia.open('sequence', list);
                media.fps = fps || 12;
                return media;
            }
        }
        const handle = await getHandle(dir, mapFile(file, map), 'file');
        return handle ? CardMedia.open('image', [await read(handle)]) : null;
    }

    // entries: card.json / collection.json layer list entries ({ file, chance, canBeFoil, over, transform, fps })
    async function load(dir, side, entries, defaults = {}, opts = {}) {
        const layers = [];
        for (const entry of entries || []) {
            if (!entry || !/^[A-Za-z0-9_.-]+$/.test(entry.file || '')) continue;
            const layer = newLayer(side, defaults, entry.text ? 'text' : 'image');
            layer.file = entry.file;
            if (entry.text) {
                if (TEXT_ID.test(entry.id || '')) layer.id = entry.id;
                Object.assign(layer.text, textFields(entry.text));
                if (entry.text.font && /^[A-Za-z0-9_.-]+$/.test(entry.text.font)) {
                    const handle = await getHandle(dir, entry.text.font, 'file');
                    if (handle) await setFont(layer.text, await handle.getFile()).catch(() => {});
                }
            }
            if (typeof entry.name === 'string') layer.name = entry.name.trim().slice(0, MAX_NAME);
            layer.collapsed = true;
            if (entry.chance != null) layer.chance = entry.chance;
            if (entry.price > 0) layer.price = Math.round(entry.price);
            if (entry.canBeFoil != null) layer.canBeFoil = !!entry.canBeFoil;
            layer.over = !!entry.over;
            if (entry.transform) layer.transform = { ...IDENTITY, ...entry.transform };
            if (!isText(layer))
                for (const map of MAPS)
                    layer.maps[map] = await loadMap(dir, entry.file, map, entry.fps && entry.fps[map], opts).catch(() => null);
            layer.saved = savedState(layer);
            if (hasContent(layer)) layers.push(layer);
        }
        return layers;
    }

    function textFields(saved) {
        const t = {};
        for (const k of ['x', 'y', 'width', 'height', 'size']) if (typeof saved[k] === 'number' && Number.isFinite(saved[k])) t[k] = saved[k];
        if (typeof saved.value === 'string') t.value = saved.value;
        if (CardText.ALIGNS.includes(saved.align)) t.align = saved.align;
        if (CardText.VALIGNS.includes(saved.valign)) t.valign = saved.valign;
        if (typeof saved.color === 'string') t.color = saved.color;
        if (typeof saved.opacity === 'number' && Number.isFinite(saved.opacity)) t.opacity = Math.min(1, Math.max(0, saved.opacity));
        t.uppercase = saved.uppercase === true;
        t.autoSize = saved.autoSize === true;
        if (typeof saved.rotation === 'number' && Number.isFinite(saved.rotation)) t.rotation = saved.rotation;
        return t;
    }

    async function setFont(text, file) {
        const copy = new File([await file.arrayBuffer()], file.name, { type: file.type });
        const face = await CardText.loadFace(copy);
        Object.assign(text, { font: copy, fontName: file.name, face });
    }

    function textLayer(side, fields, defaults = {}) {
        const layer = newLayer(side, defaults, 'text');
        Object.assign(layer.text, textFields(fields));
        return layer;
    }

    // ---------- Editor ----------

    // opts: { sides: { front: { defaults, note }, back: {...} }, collectionBlock: bool, onChange(what, layer), onSelect(layer), onError }
    function createEditor(root, opts) {
        const lists = { front: [], back: [] };
        let side = 'front', selected = null;
        let collection = null;      // { name, front, back } shown in the lists (card editor)

        root.classList.add('layers-editor');
        root.innerHTML = `
            <div class="layers-head">
                <div class="view-toggle layer-tabs">
                    <button type="button" class="facade-btn fx-sm fx-on" data-side="front">Front <span class="layer-count"></span></button>
                    <button type="button" class="facade-btn fx-sm" data-side="back">Back <span class="layer-count"></span></button>
                </div>
                <span class="spacer"></span>
                <button type="button" class="facade-btn fx-sm fx-grey" data-fold-all></button>
                <div class="media-pick layer-add"></div>
            </div>
            <small class="field-note layer-note"></small>
            <div class="layer-list"></div>`;
        const listEl = root.querySelector('.layer-list');
        const dropMarker = document.createElement('div');
        dropMarker.className = 'layer-drop-marker';
        let dragging = null;

        const isSlot = (el) => el.classList.contains('layer-card') || el.classList.contains('layer-coll');
        const baseEl = opts.base ? opts.base.el : null;

        listEl.addEventListener('dragover', (e) => {
            if (!dragging) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const slots = [...listEl.children].filter((el) => el !== dragging.card && isSlot(el));
            const before = slots.find((el) => {
                const r = el.getBoundingClientRect();
                return e.clientY < r.top + r.height / 2;
            });
            const end = before || (baseEl && baseEl.parentNode === listEl ? baseEl : null);
            if (end) { if (dropMarker.nextElementSibling !== end) listEl.insertBefore(dropMarker, end); }
            else if (listEl.lastElementChild !== dropMarker) listEl.appendChild(dropMarker);
        });

        listEl.addEventListener('drop', (e) => {
            if (!dragging) return;
            e.preventDefault();
            const moved = dragging.layer;
            if (!dropMarker.isConnected) return;
            const byUid = new Map(lists[side].map((l) => [String(l.uid), l]));
            const shown = [];
            for (const el of listEl.children) {
                if (el === dropMarker) shown.push(moved);
                else if (el === dragging.card) continue;
                else if (el.classList.contains('layer-coll')) shown.push('coll');
                else if (el.classList.contains('layer-card') && byUid.has(el.dataset.uid)) shown.push(byUid.get(el.dataset.uid));
            }
            dropMarker.remove();
            const oldOrder = lists[side], oldOver = oldOrder.map((l) => l.over);
            const cut = shown.indexOf('coll');
            const above = cut < 0 ? shown : shown.slice(0, cut), below = cut < 0 ? [] : shown.slice(cut + 1);
            if (opts.collectionBlock) {
                for (const l of above) l.over = true;
                for (const l of below) l.over = false;
            }
            const next = [...below.reverse(), ...above.reverse()];
            lists[side] = next;
            if (next.length === oldOrder.length && next.every((l, i) => l === oldOrder[i] && l.over === oldOver[i])) return;
            render();
            changed('layers', moved);
        });
        const foldAll = root.querySelector('[data-fold-all]');

        const changed = (what = 'layers', layer = null) => { if (opts.onChange) opts.onChange(what, layer); };

        const clock = opts.time || (() => performance.now() / 1000);
        const thumbs = new Set();
        let thumbFrame = 0;

        function thumb(canvas, source, layer) {
            const th = { canvas, source, layer, key: undefined };
            thumbs.add(th);
            drawThumb(th);
            return th;
        }

        function drawThumb(th) {
            const media = th.source(), c = th.canvas, g = c.getContext('2d');
            const t = clock();
            g.clearRect(0, 0, c.width, c.height);
            th.key = media ? media.frameKey(t) : null;
            if (!media) return;
            const img = media.frameAt(t);
            const { w, h } = CardMedia.size(img);
            if (w && h) {
                const k = Math.min(c.width / w, c.height / h);
                g.imageSmoothingQuality = 'high';
                g.drawImage(img, (c.width - w * k) / 2, (c.height - h * k) / 2, w * k, h * k);
            }
            if (media.animated && !thumbFrame) thumbFrame = requestAnimationFrame(tickThumbs);
        }

        function tickThumbs() {
            thumbFrame = 0;
            const visible = !document.hidden && root.getClientRects().length > 0;
            let playing = false;
            for (const th of thumbs) {
                if (!th.canvas.isConnected) { thumbs.delete(th); continue; }
                const media = th.source();
                if (!media || !media.animated) continue;
                playing = true;
                if (visible && th.canvas.getClientRects().length && media.frameKey(clock()) !== th.key) drawThumb(th);
            }
            if (playing && !thumbFrame) thumbFrame = requestAnimationFrame(tickThumbs);
        }

        function showFoldAll() {
            const list = lists[side];
            foldAll.hidden = !list.length;
            foldAll.textContent = list.some((l) => !l.collapsed) ? 'Collapse all' : 'Expand all';
        }

        function setCollapsed(layers, collapsed) {
            smoothResize(listEl, () => {
                for (const layer of layers) {
                    layer.collapsed = collapsed;
                    const card = listEl.querySelector(`.layer-card[data-uid="${layer.uid}"]`);
                    if (!card) continue;
                    card.classList.toggle('is-collapsed', collapsed);
                    const fold = card.querySelector('[data-act="fold"]');
                    fold.setAttribute('aria-expanded', String(!collapsed));
                    fold.title = collapsed ? 'Expand' : 'Collapse';
                }
                showFoldAll();
            });
        }

        function summary(layer) {
            const bits = [];
            if (isText(layer)) bits.push(`"${layer.text.value.replace(/\s+/g, ' ').trim()}"`);
            if (layer.chance < 100) bits.push(`${layer.chance}%`);
            if (layer.chance < 100 && layer.price > 0) bits.push(`${layer.price.toLocaleString()} ₽`);
            return bits.join(' · ');
        }

        // The ones under the collection first, then those over it, each in their order
        const normalise = (s) => { lists[s] = [...lists[s].filter((l) => !l.over), ...lists[s].filter((l) => l.over)]; };

        function select(layer, how = {}) {
            if (layer && layer.side !== side) { side = layer.side; render(); }
            selected = layer;
            for (const el of listEl.querySelectorAll('.layer-card')) el.classList.toggle('is-selected', !!layer && +el.dataset.uid === layer.uid);
            if (how.reveal && layer) {
                const card = listEl.querySelector(`.layer-card[data-uid="${layer.uid}"]`);
                if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
            if (opts.onSelect) opts.onSelect(layer);
        }

        function render() {
            smoothResize(listEl, renderNow);
        }

        function renderNow() {
            for (const b of root.querySelectorAll('.layer-tabs button')) {
                b.classList.toggle('fx-on', b.dataset.side === side);
                b.querySelector('.layer-count').textContent = lists[b.dataset.side].length ? `(${lists[b.dataset.side].length})` : '';
            }
            root.querySelector('.layer-note').textContent = (opts.sides[side] && opts.sides[side].note) || '';
            listEl.innerHTML = '';
            thumbs.clear();
            normalise(side);
            showFoldAll();
            const list = lists[side];
            const over = list.filter((l) => l.over), under = list.filter((l) => !l.over);
            const withBase = !!baseEl && opts.base.side === side;
            if (!list.length && !opts.collectionBlock && !withBase) {
                const empty = document.createElement('div');
                empty.className = 'layer-empty';
                empty.textContent = 'No layers. Add layer to stack a picture on this side.';
                listEl.appendChild(empty);
            }
            // Top of the stack first, like the binder stickers
            for (let i = over.length - 1; i >= 0; i--) listEl.appendChild(layerCard(over[i]));
            if (opts.collectionBlock) listEl.appendChild(collectionBlock());
            for (let i = under.length - 1; i >= 0; i--) listEl.appendChild(layerCard(under[i]));
            if (withBase) listEl.appendChild(baseEl);
            else if (baseEl) baseEl.remove();
        }

        // The collection's layers, between the card's: each can be switched off on this card
        function collectionBlock() {
            const box = document.createElement('div');
            box.className = 'layer-coll';
            const layers = collection ? collection[side] || [] : [];
            const all = collection ? [...(collection.front || []), ...(collection.back || [])] : [];
            const isOn = (layer) => !collection.isOn || collection.isOn(layer);
            const onCount = all.filter(isOn).length;
            const toggle = collection && collection.toggle;
            box.innerHTML = `<div class="layer-coll-head"><b>${collection ? escapeHtml(collection.name) : 'No collection'}</b>
                <small>${!collection ? 'No collection layers' : !all.length ? 'Collection layers (none)' : `Collection layers · ${onCount} of ${all.length} on this card`}</small></div>`;
            if (toggle && all.length) {
                const row = document.createElement('label');
                row.className = 'facade-check-row layer-coll-all';
                row.title = 'All of the collection\'s layers, front and back, on this card';
                row.innerHTML = '<input type="checkbox" class="facade-switch"><span>All on this card</span>';
                const input = row.querySelector('input');
                input.checked = onCount === all.length;
                input.indeterminate = onCount > 0 && onCount < all.length;
                input.addEventListener('change', () => toggle(all, input.checked));
                box.appendChild(row);
            }
            for (let i = layers.length - 1; i >= 0; i--) {
                const layer = layers[i];
                const on = isOn(layer);
                const row = document.createElement('label');
                row.className = 'layer-coll-row' + (on ? '' : ' is-hidden');
                const what = isText(layer) ? `Text: ${layer.text.value}` : layer.maps.art ? layer.maps.art.name : '';
                row.innerHTML = `<span>${layer.name ? escapeHtml(layer.name) : `Layer ${i + 1}`}${layer.chance < 100 ? ` · ${layer.chance}%` : ''}${what ? ` · ${escapeHtml(what)}` : ''}</span>` +
                    (toggle ? '<input type="checkbox" class="facade-switch" title="On this card">' : '');
                if (toggle) {
                    const input = row.querySelector('input');
                    input.checked = on;
                    input.addEventListener('change', () => toggle([layer], input.checked));
                }
                box.appendChild(row);
            }
            return box;
        }

        function layerCard(layer) {
            const list = lists[layer.side];
            const index = list.indexOf(layer);
            const top = index === list.length - 1, bottom = index === 0;
            const card = document.createElement('div');
            card.className = 'layer-card' + (isText(layer) ? ' is-text' : '') + (layer === selected ? ' is-selected' : '') + (layer.hidden ? ' is-hidden' : '') + (layer.collapsed ? ' is-collapsed' : '');
            card.dataset.uid = layer.uid;
            const t = layer.transform;
            card.innerHTML = `
                <div class="layer-head">
                    <span class="layer-grip" title="Drag to move this layer up or down the stack" aria-hidden="true"></span>
                    <button type="button" class="facade-iconbtn layer-fold" data-act="fold" aria-expanded="${!layer.collapsed}" title="${layer.collapsed ? 'Expand' : 'Collapse'}"></button>
                    ${isText(layer) ? '<span class="layer-thumb layer-thumb-text" aria-hidden="true">T</span>' : '<canvas class="layer-thumb" width="96" height="96"></canvas>'}
                    <input type="text" class="facade-input layer-name" maxlength="${MAX_NAME}" spellcheck="false" autocomplete="off" placeholder="Layer ${index + 1}" aria-label="Layer name" title="Layer name (click to rename)" value="${escapeHtml(layer.name)}">
                    ${opts.collectionBlock && layer.over ? '<small class="layer-tag">Over the collection</small>' : ''}
                    <small class="layer-summary"></small>
                    <span class="spacer"></span>
                    <button type="button" class="facade-iconbtn" data-act="eye" title="${layer.hidden ? 'Show in the preview' : 'Hide in the preview (to see the card without it)'}">${layer.hidden ? '◌' : '◉'}</button>
                    <button type="button" class="facade-iconbtn" data-act="up" title="Move up" ${top && (!opts.collectionBlock || layer.over) ? 'disabled' : ''}>↑</button>
                    <button type="button" class="facade-iconbtn" data-act="down" title="Move down" ${bottom && (!opts.collectionBlock || !layer.over) ? 'disabled' : ''}>↓</button>
                    <button type="button" class="facade-iconbtn" data-act="remove" title="Remove this layer">×</button>
                </div>
                <div class="layer-body">
                    <div class="layer-props">
                        <label class="layer-chance" title="% of copies of the card that show this layer (rolled per copy in game)"><span>Chance</span><input type="number" class="facade-input" min="0" max="100" step="0.1" inputmode="decimal" value="${layer.chance}"><span>%</span></label>
                        <label class="layer-chance layer-price" title="A layer under 100% chance is a sticker on the copies that roll it: this is what it adds to the copy's price (in roubles)."><span>Sticker</span><input type="number" class="facade-input" min="0" max="100000000" step="100" inputmode="numeric" value="${layer.price}"><span>₽</span></label>
                        <label class="facade-check-row" title="The foil version puts its foil on this layer (inside its foil area). Off: never foil, and it covers the foil under it."><input type="checkbox" class="facade-switch" data-k="foil" ${layer.canBeFoil ? 'checked' : ''}><span>Can Be Foil</span></label>
                    </div>
                    ${isText(layer) ? '<div class="layer-text"></div>' : `<div class="layer-maps"></div>
                    <div class="layer-transform">
                        <label class="range-row"><span>Size</span><input type="range" class="facade-range" data-t="scale" min="0.05" max="4" step="0.01" value="${t.scale}"><output>${Math.round(t.scale * 100)}%</output></label>
                        <label class="range-row"><span>Turn</span><input type="range" class="facade-range" data-t="rotation" min="-180" max="180" step="1" value="${t.rotation}"><output>${Math.round(t.rotation)}°</output></label>
                        <div class="guide-actions">
                            <button type="button" class="facade-btn fx-sm fx-grey" data-tr="centre" title="Put it in the middle of the card">Centre</button>
                            <button type="button" class="facade-btn fx-sm fx-grey" data-tr="straight" title="No turn">Straighten</button>
                            <button type="button" class="facade-btn fx-sm fx-grey" data-tr="fit" title="Just cover the card, in the middle, straight">Fill the card</button>
                        </div>
                    </div>`}
                </div>`;
            if (isText(layer)) textBlock(card.querySelector('.layer-text'), layer);
            else {
                const maps = card.querySelector('.layer-maps');
                for (const map of MAPS) maps.appendChild(mediaBlock(layer, map));
                thumb(card.querySelector('.layer-thumb'), () => layer.maps.art, layer);
            }
            for (const input of card.querySelectorAll('.facade-range')) window.setRange && window.setRange(input);
            const summaryEl = card.querySelector('.layer-summary');
            const showSummary = () => { summaryEl.textContent = summary(layer); };
            showSummary();

            card.addEventListener('pointerdown', () => { if (selected !== layer) select(layer); });
            card.querySelector('.layer-head').addEventListener('pointerdown', (e) => {
                if (e.button === 0 && !e.target.closest('button, input, textarea')) card.draggable = true;
            });
            card.addEventListener('pointerup', () => { if (!dragging) card.draggable = false; });
            card.addEventListener('dragstart', (e) => {
                if (!card.draggable || e.target !== card) return;
                dragging = { layer, card };
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', layer.name || 'layer');
                requestAnimationFrame(() => card.classList.add('is-dragging'));
            });
            card.addEventListener('dragend', () => {
                card.draggable = false;
                card.classList.remove('is-dragging');
                dropMarker.remove();
                dragging = null;
            });
            card.querySelector('[data-act="fold"]').addEventListener('click', () => setCollapsed([layer], !layer.collapsed));
            card.querySelector('.layer-head').addEventListener('dblclick', (e) => {
                if (!e.target.closest('button, input')) setCollapsed([layer], !layer.collapsed);
            });
            const name = card.querySelector('.layer-name');
            name.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') name.blur();
                if (e.key === 'Escape') { name.value = layer.name; name.blur(); }
            });
            name.addEventListener('change', () => {
                const value = name.value.trim().slice(0, MAX_NAME);
                name.value = value;
                if (value === layer.name) return;
                layer.name = value;
                changed('name', layer);
            });
            const price = card.querySelector('.layer-price input');
            price.addEventListener('change', () => {
                const v = parseFloat(price.value);
                layer.price = v > 0 ? Math.round(v) : 0;
                price.value = layer.price;
                showSummary();
                changed('price', layer);
            });
            const chance = card.querySelector('.layer-chance input');
            chance.addEventListener('change', () => {
                const v = parseFloat(chance.value);
                layer.chance = Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v * 10) / 10)) : 100;
                chance.value = layer.chance;
                showSummary();
                changed('chance', layer);
            });
            card.querySelector('[data-k="foil"]').addEventListener('change', (e) => { layer.canBeFoil = e.target.checked; changed('layers', layer); });
            card.querySelector('[data-act="eye"]').addEventListener('click', () => { layer.hidden = !layer.hidden; render(); changed('preview', layer); });
            card.querySelector('[data-act="up"]').addEventListener('click', () => move(layer, true));
            card.querySelector('[data-act="down"]').addEventListener('click', () => move(layer, false));
            card.querySelector('[data-act="remove"]').addEventListener('click', () => {
                const l = lists[layer.side];
                l.splice(l.indexOf(layer), 1);
                for (const m of MAPS) if (layer.maps[m]) layer.maps[m].dispose();
                if (selected === layer) select(null);
                render();
                changed('layers', layer);
            });
            for (const input of card.querySelectorAll('[data-t]')) input.addEventListener('input', () => {
                layer.transform[input.dataset.t] = +input.value;
                showTransform(card, layer);
                changed('transform', layer);
            });
            for (const b of card.querySelectorAll('[data-tr]')) b.addEventListener('click', () => {
                const tr = layer.transform;
                if (b.dataset.tr === 'centre') Object.assign(tr, { x: 0.5, y: 0.5 });
                if (b.dataset.tr === 'straight') tr.rotation = 0;
                // Fill: in the middle, straight, just covering the card
                if (b.dataset.tr === 'fit') Object.assign(tr, IDENTITY, { scale: fillScale(layer) });
                showTransform(card, layer);
                changed('transform', layer);
            });
            return card;
        }

        function showTransform(card, layer) {
            const t = layer.transform;
            for (const input of card.querySelectorAll('[data-t]')) {
                input.value = t[input.dataset.t];
                if (window.setRange) window.setRange(input);
            }
            const out = card.querySelectorAll('.layer-transform output');
            out[0].textContent = `${Math.round(t.scale * 100)}%`;
            out[1].textContent = `${Math.round(t.rotation)}°`;
        }

        // Up / down in the stack; past the collection's layers (card editor) it goes under or over them
        function move(layer, up) {
            const s = layer.side;
            normalise(s);
            const list = lists[s];
            const group = list.filter((l) => l.over === layer.over);
            const i = group.indexOf(layer);
            const other = up ? group[i + 1] : group[i - 1];
            if (other) {
                const a = list.indexOf(layer), b = list.indexOf(other);
                [list[a], list[b]] = [list[b], list[a]];
            } else if (opts.collectionBlock && up !== layer.over) {
                // past the collection block: the top of those under it, or the bottom of those over it
                layer.over = up;
                list.splice(list.indexOf(layer), 1);
                list.splice(list.filter((l) => !l.over).length, 0, layer);
            } else {
                return;
            }
            render();
            changed('layers', layer);
        }

        const ALIGN_LABEL = { left: 'Left', center: 'Centre', right: 'Right' };
        const VALIGN_LABEL = { top: 'Top', middle: 'Middle', bottom: 'Bottom' };

        function textBlock(box, layer) {
            const t = layer.text;
            box.innerHTML = `
                <label class="text-value"><span>Text</span><textarea class="facade-input" rows="2" spellcheck="false" data-x="value"></textarea></label>
                <div class="text-vars"><span>Insert</span>${CardText.VARIABLES.map((v, i) => `<button type="button" class="facade-btn fx-sm fx-grey" data-var="${i}" title="${escapeHtml(v.title)}">${escapeHtml(v.label)}</button>`).join('')}</div>
                <label class="range-row"><span>Font size</span><input type="range" class="facade-range" data-x="size" min="0.015" max="0.2" step="0.001"><output data-v="size"></output></label>
                <label class="range-row"><span>Width</span><input type="range" class="facade-range" data-x="width" min="0.05" max="1" step="0.01"><output data-v="width"></output></label>
                <label class="range-row"><span>Height</span><input type="range" class="facade-range" data-x="height" min="0.02" max="1" step="0.005"><output data-v="height"></output></label>
                <label class="range-row"><span>Opacity</span><input type="range" class="facade-range" data-x="opacity" min="0" max="1" step="0.01"><output data-v="opacity"></output></label>
                <label class="range-row"><span>Turn</span><input type="range" class="facade-range" data-x="rotation" min="-180" max="180" step="1"><output data-v="rotation"></output></label>
                <div class="style-row">
                    <div class="align-buttons">${CardText.ALIGNS.map((a) => `<button type="button" class="facade-btn fx-sm" data-align="${a}">${ALIGN_LABEL[a]}</button>`).join('')}</div>
                    <div class="align-buttons">${CardText.VALIGNS.map((a) => `<button type="button" class="facade-btn fx-sm" data-valign="${a}" title="Where the lines sit in the text box">${VALIGN_LABEL[a]}</button>`).join('')}</div>
                    <label class="color-pick"><span>Colour</span><input type="color" data-x="color"></label>
                    <label class="facade-check-row" title="The card's rarity colour (Settings > Rarities)"><input type="checkbox" class="facade-switch" data-x="rarity"><span>Rarity colour</span></label>
                    <label class="facade-check-row" title="Show the text in capital letters (the name, description… too)"><input type="checkbox" class="facade-switch" data-x="uppercase"><span>Uppercase</span></label>
                    <label class="facade-check-row" title="Make the text smaller when it doesn't fit its box at its size (down to a fifth of it)"><input type="checkbox" class="facade-switch" data-x="autoSize"><span>Shrink to fit</span></label>
                </div>
                <div class="font-row">
                    <span>Font</span>
                    <button type="button" class="facade-btn fx-sm font-pick" data-x="font"></button>
                    <button type="button" class="facade-iconbtn" data-x="font-clear" title="Back to the default font">×</button>
                    <input type="file" data-x="font-file" accept=".ttf,.otf,font/ttf,font/otf" hidden>
                </div>
                <div class="guide-actions">
                    <button type="button" class="facade-btn fx-sm fx-grey" data-x="centre" title="Centre the box across the card">Centre across</button>
                </div>
                <small class="field-note">\${name} \${description} \${rarity} \${rarity.color} \${collection} · &lt;color=#FF0000&gt;red&lt;/color&gt;</small>`;
            const value = box.querySelector('[data-x="value"]');
            value.value = t.value;
            let lastColor = /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#FFFFFF';
            const edited = (what = 'text') => { showText(box, layer); changed(what, layer); };
            value.addEventListener('input', () => { t.value = value.value; edited(); });
            for (const b of box.querySelectorAll('[data-var]')) b.addEventListener('click', () => {
                const v = CardText.VARIABLES[+b.dataset.var];
                value.focus();
                value.setRangeText(v.insert, value.selectionStart, value.selectionEnd, 'end');
                t.value = value.value;
                edited();
            });
            for (const key of ['size', 'width', 'height', 'opacity', 'rotation']) box.querySelector(`[data-x="${key}"]`).addEventListener('input', (e) => {
                t[key] = +e.target.value;
                if (key === 'height') t.height = Math.min(t.height, 1 - t.y);
                if (key === 'width') t.width = Math.min(t.width, 1);
                edited(key === 'opacity' ? 'text' : 'transform');
            });
            for (const b of box.querySelectorAll('[data-align]')) b.addEventListener('click', () => { t.align = b.dataset.align; edited(); });
            for (const b of box.querySelectorAll('[data-valign]')) b.addEventListener('click', () => { t.valign = b.dataset.valign; edited(); });
            box.querySelector('[data-x="color"]').addEventListener('input', (e) => { t.color = lastColor = e.target.value.toUpperCase(); edited(); });
            box.querySelector('[data-x="rarity"]').addEventListener('change', (e) => { t.color = e.target.checked ? 'rarity' : lastColor; edited(); });
            box.querySelector('[data-x="uppercase"]').addEventListener('change', (e) => { t.uppercase = e.target.checked; edited(); });
            box.querySelector('[data-x="autoSize"]').addEventListener('change', (e) => { t.autoSize = e.target.checked; edited(); });
            box.querySelector('[data-x="centre"]').addEventListener('click', () => { t.x = 0.5; edited('transform'); });
            const fontInput = box.querySelector('[data-x="font-file"]');
            box.querySelector('[data-x="font"]').addEventListener('click', () => fontInput.click());
            fontInput.addEventListener('change', async () => {
                const file = fontInput.files[0];
                fontInput.value = '';
                if (!file) return;
                try {
                    await setFont(t, file);
                    edited();
                } catch (e) {
                    if (opts.onError) opts.onError(`Could not use ${file.name}`, e.message);
                }
            });
            box.querySelector('[data-x="font-clear"]').addEventListener('click', () => {
                Object.assign(t, { font: null, fontName: '', face: null });
                edited();
            });
            showText(box, layer);
        }

        function showText(box, layer) {
            const t = layer.text;
            for (const key of ['size', 'width', 'height', 'opacity', 'rotation']) {
                const input = box.querySelector(`[data-x="${key}"]`);
                input.value = t[key] ?? (key === 'rotation' ? 0 : 1);
                if (window.setRange) window.setRange(input);
            }
            box.querySelector('[data-v="size"]').textContent = Math.round(CardText.layout(t, CARD_H).size) + ' px';
            box.querySelector('[data-v="width"]').textContent = Math.round(t.width * 100) + ' %';
            box.querySelector('[data-v="height"]').textContent = Math.round(t.height * 100) + ' %';
            box.querySelector('[data-v="opacity"]').textContent = Math.round((t.opacity ?? 1) * 100) + ' %';
            box.querySelector('[data-v="rotation"]').textContent = Math.round(t.rotation || 0) + '°';
            box.querySelector('[data-x="uppercase"]').checked = !!t.uppercase;
            box.querySelector('[data-x="autoSize"]').checked = !!t.autoSize;
            const rarity = t.color === 'rarity';
            box.querySelector('[data-x="rarity"]').checked = rarity;
            const color = box.querySelector('[data-x="color"]');
            color.disabled = rarity;
            if (!rarity && /^#[0-9a-f]{6}$/i.test(t.color)) color.value = t.color;
            for (const b of box.querySelectorAll('[data-align]')) b.classList.toggle('fx-on', b.dataset.align === t.align);
            for (const b of box.querySelectorAll('[data-valign]')) b.classList.toggle('fx-on', b.dataset.valign === (t.valign || 'top'));
            box.querySelector('[data-x="font"]').textContent = t.font ? t.fontName || 'Custom font' : 'Bw Modelica (default)';
            box.querySelector('[data-x="font-clear"]').hidden = !t.font;
            const card = box.closest('.layer-card');
            if (card) card.querySelector('.layer-summary').textContent = summary(layer);
        }

        function mediaBlock(layer, map) {
            const box = document.createElement('div');
            box.className = 'media layer-media';
            box.innerHTML = `
                <div class="drop drop-sm">
                    <b>${MAP_LABEL[map]}</b>
                    <canvas class="media-thumb" width="240" height="160" hidden></canvas>
                    <div class="media-pick"></div>
                    <small class="media-name"></small>
                </div>
                <div class="media-anim" hidden>
                    <label class="media-fps-row"><span>FPS</span><input type="number" class="facade-input media-fps" min="1" max="60" step="1" inputmode="numeric"></label>
                    <button type="button" class="facade-btn fx-sm media-split">Split frames</button>
                    <button type="button" class="facade-btn fx-sm fx-grey media-clear">Remove</button>
                    <small class="field-note media-info"></small>
                </div>
                <div class="guide-actions media-actions"><button type="button" class="facade-btn fx-sm fx-grey media-clear">Remove</button></div>
                <input type="file" class="media-file" hidden>`;
            const zone = box.querySelector('.drop'), input = box.querySelector('.media-file');
            const preview = box.querySelector('.media-thumb');
            const pick = (kind) => {
                input.accept = PICK[kind].accept;
                input.multiple = PICK[kind].multiple;
                input.dataset.kind = kind;
                input.click();
            };
            const picker = CardMedia.picker(box.querySelector('.media-pick'), pick);

            const show = () => {
                const media = layer.maps[map];
                box.querySelector('.media-name').textContent = media
                    ? `${KIND_LABEL[media.isGif ? 'gif' : media.kind]} · ${media.name}` : MAP_EMPTY[map];
                box.querySelector('.media-name').title = media ? media.name : '';
                zone.classList.toggle('has-file', !!media);
                if (media) picker.kind = media.kind;
                preview.hidden = !media;
                const anim = box.querySelector('.media-anim');
                anim.hidden = !media || !media.animated;
                box.querySelector('.media-actions').hidden = !media || media.animated;
                if (anim.hidden) return;
                box.querySelector('.media-fps').value = media.fps;
                const split = box.querySelector('.media-split');
                split.hidden = media.kind !== 'video';
                split.disabled = media.split;
                split.textContent = media.split ? 'Frames split' : 'Split frames';
                box.querySelector('.media-info').textContent = media.info();
            };
            const refresh = () => {
                show();
                for (const th of thumbs) if (th.layer === layer) drawThumb(th);
            };
            thumb(preview, () => layer.maps[map], layer);

            const set = async (kind, list) => {
                if (!list.length) return;
                let media;
                try {
                    media = await CardMedia.open(kind, list);
                } catch (e) {
                    if (opts.onError) opts.onError(`Could not open ${list[0].name}`, e.message);
                    return;
                }
                const old = layer.maps[map];
                layer.maps[map] = media;
                if (old) old.dispose();
                refresh();
                select(layer);
                changed('media', layer);
            };

            zone.addEventListener('click', (e) => { if (!e.target.closest('button')) pick(picker.kind); });
            input.addEventListener('change', () => { set(input.dataset.kind, [...input.files]); input.value = ''; });
            zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
            zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                zone.classList.remove('is-over');
                const list = [...e.dataTransfer.files];
                set(CardMedia.kindOf(list), list);
            });
            box.querySelector('.media-fps').addEventListener('change', async (e) => {
                const media = layer.maps[map];
                if (!media) return;
                const wasSplit = media.split;
                media.setFps(e.target.value);
                if (wasSplit && media.isGif) await media.splitFrames();
                refresh();
                changed('media', layer);
            });
            box.querySelector('.media-split').addEventListener('click', async (e) => {
                const media = layer.maps[map];
                if (!media) return;
                e.target.disabled = true;
                try {
                    await media.splitFrames((done, total) => { box.querySelector('.media-info').textContent = `Splitting: frame ${done} of ${total}…`; });
                } catch (err) {
                    if (opts.onError) opts.onError(`Could not split the ${MAP_LABEL[map].toLowerCase()}`, err.message);
                }
                refresh();
                changed('media', layer);
            });
            for (const b of box.querySelectorAll('.media-clear')) b.addEventListener('click', () => {
                if (layer.maps[map]) layer.maps[map].dispose();
                layer.maps[map] = null;
                refresh();
                changed('media', layer);
            });
            show();
            return box;
        }

        for (const b of root.querySelectorAll('.layer-tabs button'))
            b.addEventListener('click', () => { side = b.dataset.side; render(); changed('side'); });
        foldAll.addEventListener('click', () => setCollapsed(lists[side], lists[side].some((l) => !l.collapsed)));
        CardMedia.picker(root.querySelector('.layer-add'), (kind) => {
            const layer = newLayer(side, opts.sides[side] && opts.sides[side].defaults, kind);
            if (kind === 'text') layer.canBeFoil = false;
            lists[side].push(layer);
            render();
            select(layer);
            changed('layers', layer);
        }, LAYER_KINDS, 'Choose the layer type');

        render();
        return {
            get front() { return lists.front; },
            get back() { return lists.back; },
            get side() { return side; },
            get selected() { return selected; },
            lists: () => ({ front: ordered(lists.front), back: ordered(lists.back) }),
            // opts.keep: the lists shown before stay usable (their media isn't released)
            set(front, back, setOpts = {}) {
                if (!setOpts.keep)
                    for (const l of [...lists.front, ...lists.back]) for (const m of MAPS) if (l.maps[m] && !front.includes(l) && !back.includes(l)) l.maps[m].dispose();
                lists.front = front || [];
                lists.back = back || [];
                selected = null;
                render();
            },
            setCollection(value) { collection = value; render(); },
            // The selected layer's transform changed outside (dragged in the preview)
            refreshTransform(layer) {
                const card = listEl.querySelector(`.layer-card[data-uid="${layer.uid}"]`);
                if (!card) return;
                if (isText(layer)) showText(card.querySelector('.layer-text'), layer);
                else showTransform(card, layer);
            },
            showSide(s) { side = s; render(); },
            select,
            render,
        };
    }

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    window.CardLayerKit = {
        CARD_W, CARD_H, MAPS, IDENTITY,
        newLayer, textLayer, setFont, isText, hasContent, unreadable, createEditor, load, loadMap, files, removeFiles, splitAll, smoothResize,
        ordered, parts, composite, animated, mediaOf, outline, layerBox, fillScale, hitTest,
        drawPlaced, drawNatural, toMask, newCanvas, cropRect, drawCropped,
    };

    function drawCropped(img, crop, canvas = newCanvas()) {
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const r = cropRect(img, crop);
        ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, CARD_W, CARD_H);
        return canvas;
    }

    // The 3D picture's crop (cover fit, then zoom and centre): kept for a 3D card's picture behind the window
    function cropRect(img, crop) {
        const { w: iw, h: ih } = CardMedia.size(img);
        const scale = Math.max(CARD_W / iw, CARD_H / ih) * crop.zoom;
        const sw = CARD_W / scale, sh = CARD_H / scale;
        const cx = Math.min(Math.max(crop.cx * iw, sw / 2), iw - sw / 2);
        const cy = Math.min(Math.max(crop.cy * ih, sh / 2), ih - sh / 2);
        crop.cx = cx / iw; crop.cy = cy / ih;
        return { sx: cx - sw / 2, sy: cy - sh / 2, sw, sh, scale };
    }
})();
