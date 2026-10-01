(() => {
    'use strict';

    // A card map's source: one image, an image sequence, or a video / GIF that is split into frames.
    // Frames are kept compressed (Blob) or shared (a GIF's decoded frames) and decoded when drawn.

    const CARD_W = 490, CARD_H = 684;
    const MAX_FRAMES = 600;         // the server reads frame_000 .. frame_999, and every frame is a texture in game
    const HEAVY_FRAMES = 240;
    const DEFAULT_FPS = 12;
    const MAX_FPS = 60;
    const CACHE = 24;               // decoded frames kept for the preview
    const MAX_SCALE = 2;            // split video frames keep at most 2x the card's resolution (enough to zoom in)

    const isGif = (f) => f.type === 'image/gif' || /\.gif$/i.test(f.name);
    const isVideo = (f) => f.type.startsWith('video/') || /\.(mp4|m4v|webm|mov|mkv|ogv)$/i.test(f.name);
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    const clampFps = (fps) => Math.min(MAX_FPS, Math.max(1, Math.round(+fps || DEFAULT_FPS)));

    const size = (src) => ({
        w: src.naturalWidth || src.videoWidth || src.width,
        h: src.naturalHeight || src.videoHeight || src.height,
    });

    async function decode(blob) {
        try {
            return await createImageBitmap(blob);
        } catch {
            throw new Error(`${blob.name || 'A frame'} is not an image this browser can read`);
        }
    }

    function seek(video, t) {
        return new Promise((resolve) => {
            const done = () => { clearTimeout(timer); resolve(); };
            const timer = setTimeout(done, 3000);
            video.addEventListener('seeked', done, { once: true });
            video.currentTime = t;
        });
    }

    // What a drop of these files most likely is
    function kindOf(files) {
        if (files.length > 1) return 'sequence';
        return files[0] && (isGif(files[0]) || isVideo(files[0])) ? 'video' : 'image';
    }

    class Media {
        constructor(kind, name) {
            this.kind = kind;           // 'image' | 'sequence' | 'video' (video or GIF)
            this.name = name;
            this.fps = DEFAULT_FPS;
            this.frames = null;         // per frame a Blob or an ImageBitmap; a sequence's files, a video's once split
            this.still = null;          // the first frame, decoded
            this.video = null;
            this.url = null;
            this.gif = null;            // { frames: ImageBitmap[], times: start of each in seconds }
            this.duration = 0;
            this.cache = new Map();
            this.pending = new Set();
            this.shown = null;
        }

        get animated() { return this.kind !== 'image'; }
        get split() { return !!this.frames; }
        get count() { return this.frames ? this.frames.length : 1; }
        get width() { return size(this.still).w; }
        get height() { return size(this.still).h; }
        get isGif() { return !!this.gif; }
        // Frames that splitting at the current fps makes
        get splitCount() { return Math.max(1, Math.round(this.duration * this.fps)); }

        info() {
            if (this.kind === 'image') return '';
            const heavy = (n) => (n > HEAVY_FRAMES ? ` Heavy in game: every frame is a texture (${HEAVY_FRAMES} or fewer is kinder).` : '');
            if (this.kind === 'sequence')
                return `${this.count} frames · ${(this.count / this.fps).toFixed(1)} s a loop.${heavy(this.count)}`;
            if (this.frames)
                return `Split into ${this.count} frames · ${(this.count / this.fps).toFixed(1)} s a loop.${heavy(this.count)}`;
            const n = this.splitCount;
            const tooMany = n > MAX_FRAMES ? ` That's over the limit of ${MAX_FRAMES}: lower the FPS or use a shorter clip.` : heavy(n);
            return `${this.duration.toFixed(1)} s. Split frames makes ${n} frames (the card is saved from those).${tooMany}`;
        }

        setFps(fps) {
            this.fps = clampFps(fps);
            // Split frames are sampled at the old rate: split again
            if (this.kind === 'video' && this.frames) {
                this.frames = null;
                this.clearCache();
            }
        }

        async openGif(file) {
            if (!window.ImageDecoder) throw new Error('Reading GIFs needs Chrome or Edge.');
            const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' });
            try {
                await decoder.tracks.ready;
                await decoder.completed;
                const count = decoder.tracks.selectedTrack.frameCount;
                const frames = [], times = [];
                let t = 0;
                for (let i = 0; i < count; i++) {
                    const { image } = await decoder.decode({ frameIndex: i });
                    frames.push(await createImageBitmap(image));
                    times.push(t);
                    const d = (image.duration || 0) / 1e6;
                    t += d > 0.011 ? d : 0.1;   // like browsers: GIF delays of 0 or 10 ms play as 100 ms
                    image.close();
                }
                this.gif = { frames, times };
                this.duration = t;
                this.still = frames[0];
                this.fps = clampFps(count / t);
            } finally {
                decoder.close();
            }
        }

        async openVideo(file) {
            this.url = URL.createObjectURL(file);
            const video = document.createElement('video');
            video.muted = true;
            video.loop = true;
            video.playsInline = true;
            video.preload = 'auto';
            await new Promise((resolve, reject) => {
                video.onloadeddata = resolve;
                video.onerror = () => reject(new Error('Not a video this browser can play (MP4 or WebM work)'));
                video.src = this.url;
            });
            if (!Number.isFinite(video.duration) || video.duration <= 0)
                throw new Error('The video has no length this browser can read. Save it again as MP4 or WebM.');
            this.video = video;
            this.duration = video.duration;
            this.still = await createImageBitmap(video);
        }

        gifFrameAt(t) {
            const { frames, times } = this.gif;
            let i = frames.length - 1;
            while (i > 0 && times[i] > t) i--;
            return frames[i];
        }

        async splitFrames(onProgress) {
            if (this.kind !== 'video') return;
            const count = this.splitCount;
            if (count > MAX_FRAMES)
                throw new Error(`${count} frames at ${this.fps} fps: at most ${MAX_FRAMES}. Lower the FPS or use a shorter clip.`);
            const frames = [];
            if (this.gif) {
                for (let i = 0; i < count; i++) frames.push(this.gifFrameAt(i / this.fps));
            } else {
                const video = this.video;
                video.pause();
                const { w, h } = size(video);
                const scale = Math.min(1, MAX_SCALE / Math.min(w / CARD_W, h / CARD_H));
                const canvas = new OffscreenCanvas(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
                const ctx = canvas.getContext('2d');
                for (let i = 0; i < count; i++) {
                    await seek(video, Math.min(i / this.fps, this.duration - 0.001));
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    frames.push(await canvas.convertToBlob({ type: 'image/webp', quality: 0.95 }));
                    if (onProgress) onProgress(i + 1, count);
                }
            }
            this.clearCache();
            this.frames = frames;
        }

        // For the preview: the frame at t seconds (never waits; a frame still decoding shows the one before)
        frameAt(t) {
            if (this.kind === 'image') return this.still;
            if (!this.frames) {
                if (this.gif) return this.gifFrameAt(t % this.duration);
                if (this.video.paused) this.video.play().catch(() => {});
                return this.video.readyState >= 2 ? this.video : this.still;
            }
            return this.cached(this.frameIndex(t));
        }

        frameIndex(t) {
            const n = this.frames.length;
            return ((Math.floor(Math.max(0, t) * this.fps) % n) + n) % n;
        }

        // Changes when frameAt(t) shows something else
        frameKey(t) {
            if (this.kind === 'image') return 0;
            if (!this.frames) return this.gif ? this.gifFrameAt(t % this.duration) : this.video.currentTime;
            const i = this.frameIndex(t);
            return this.frames[i] instanceof Blob && !this.cache.has(i) ? -1 : i;
        }

        cached(i) {
            const frame = this.frames[i];
            if (!(frame instanceof Blob)) return (this.shown = frame);
            const hit = this.cache.get(i);
            if (hit) return (this.shown = hit);
            if (!this.pending.has(i)) {
                this.pending.add(i);
                const frames = this.frames;
                createImageBitmap(frame).then((bitmap) => {
                    this.pending.delete(i);
                    if (frames !== this.frames) { bitmap.close(); return; }
                    this.cache.set(i, bitmap);
                    for (const [key, old] of this.cache) {
                        if (this.cache.size <= CACHE) break;
                        if (old === this.shown) continue;
                        old.close();
                        this.cache.delete(key);
                    }
                }).catch(() => this.pending.delete(i));
            }
            return this.shown || this.still;
        }

        // For saving: runs fn on frame i, decoded
        async withFrame(i, fn) {
            if (!this.frames) return fn(this.still);
            const frame = this.frames[i];
            if (!(frame instanceof Blob)) return fn(frame);
            const bitmap = await decode(frame);
            try {
                return await fn(bitmap);
            } finally {
                bitmap.close();
            }
        }

        pause() {
            if (this.video && !this.video.paused) this.video.pause();
        }

        clearCache() {
            for (const bitmap of this.cache.values()) if (bitmap !== this.shown) bitmap.close();
            this.cache.clear();
            this.pending.clear();
            this.shown = null;
        }

        dispose() {
            this.pause();
            this.clearCache();
            if (this.gif) for (const f of this.gif.frames) f.close();
            if (this.still && this.still.close && !this.gif) this.still.close();
            if (this.url) URL.revokeObjectURL(this.url);
        }
    }

    async function open(kind, fileList) {
        const files = [...fileList];
        if (!files.length) return null;
        if (kind === 'sequence' && files.length > 1) {
            files.sort(byName);
            if (files.length > MAX_FRAMES) throw new Error(`${files.length} frames: at most ${MAX_FRAMES}.`);
            const media = new Media('sequence', `${files[0].name} … ${files[files.length - 1].name}`);
            media.still = await decode(files[0]);
            media.frames = files;
            return media;
        }
        const file = files[0];
        if (kind === 'video') {
            const media = new Media('video', file.name);
            if (isGif(file)) await media.openGif(file);
            else await media.openVideo(file);
            return media;
        }
        const media = new Media('image', file.name);
        media.still = await decode(file);
        return media;
    }

    const PICK_KINDS = {
        image: { label: 'Image', title: 'Upload an image' },
        sequence: { label: 'Image Sequence', title: 'Upload an image sequence (choose all of its frames)' },
        video: { label: 'Video/GIF', title: 'Upload a video or a GIF' },
    };
    let pickMenu = null;

    function closePickMenu() {
        if (!pickMenu || !pickMenu.classList.contains('is-shown')) return;
        pickMenu.classList.remove('is-shown');
        pickMenu.anchor.setAttribute('aria-expanded', 'false');
        pickMenu.anchor = null;
    }

    function pickMenuEl() {
        if (pickMenu) return pickMenu;
        pickMenu = document.createElement('div');
        pickMenu.className = 'facade-menu fx-float pick-menu';
        pickMenu.setAttribute('role', 'menu');
        pickMenu.addEventListener('keydown', (e) => {
            const items = [...pickMenu.querySelectorAll('.facade-menu-item')];
            const i = items.indexOf(document.activeElement);
            if (e.key === 'Escape' || e.key === 'Tab') {
                const anchor = pickMenu.anchor;
                e.preventDefault();
                e.stopPropagation();
                closePickMenu();
                if (anchor) anchor.focus();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
            }
        });
        document.addEventListener('pointerdown', (e) => {
            if (pickMenu.anchor && !pickMenu.contains(e.target) && !pickMenu.anchor.contains(e.target)) closePickMenu();
        }, true);
        document.addEventListener('scroll', () => { if (pickMenu.anchor) placePickMenu(); }, true);
        window.addEventListener('resize', closePickMenu);
        document.body.appendChild(pickMenu);
        return pickMenu;
    }

    function openPickMenu(anchor, current, choose, kinds) {
        const menu = pickMenuEl();
        closePickMenu();
        menu.textContent = '';
        for (const [kind, { label }] of Object.entries(kinds)) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'facade-menu-item' + (kind === current ? ' is-active' : '');
            item.setAttribute('role', 'menuitemradio');
            item.setAttribute('aria-checked', String(kind === current));
            item.textContent = label;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                closePickMenu();
                choose(kind);
                anchor.focus();
            });
            menu.appendChild(item);
        }
        menu.anchor = anchor;
        anchor.setAttribute('aria-expanded', 'true');
        menu.style.top = '-9999px';
        menu.classList.add('is-shown');
        placePickMenu();
        (menu.querySelector('.is-active') || menu.firstChild).focus({ preventScroll: true });
    }

    function placePickMenu() {
        const menu = pickMenu, box = menu.anchor.parentElement.getBoundingClientRect();
        if (!box.width || box.bottom < 0 || box.top > window.innerHeight) { closePickMenu(); return; }
        const h = menu.offsetHeight;
        const above = window.innerHeight - box.bottom - 3 < h && box.top - 3 > h;
        menu.style.left = `${Math.max(4, Math.min(box.left, window.innerWidth - menu.offsetWidth - 4))}px`;
        menu.style.minWidth = `${box.width}px`;
        menu.style.top = `${above ? box.top - 3 - h : box.bottom + 3}px`;
    }

    function picker(host, onPick, kinds = PICK_KINDS, menuLabel = 'Choose what to upload') {
        host.innerHTML = `<button type="button" class="facade-btn fx-sm pick-main"></button><button type="button" class="facade-btn fx-sm pick-more" aria-haspopup="menu" aria-expanded="false" aria-label="${menuLabel}" title="${menuLabel}">▾</button>`;
        const main = host.querySelector('.pick-main'), more = host.querySelector('.pick-more');
        let kind = Object.keys(kinds)[0];
        const set = (k) => {
            kind = k;
            main.textContent = kinds[k].label;
            main.title = kinds[k].title;
        };
        set(kind);
        main.addEventListener('click', (e) => { e.stopPropagation(); onPick(kind); });
        more.addEventListener('click', (e) => {
            e.stopPropagation();
            if (pickMenu && pickMenu.anchor === more) closePickMenu();
            else openPickMenu(more, kind, set, kinds);
        });
        more.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowDown' || (pickMenu && pickMenu.anchor === more)) return;
            e.preventDefault();
            openPickMenu(more, kind, set, kinds);
        });
        return {
            get kind() { return kind; },
            set kind(k) { if (kinds[k]) set(k); },
        };
    }

    window.CardMedia = { open, kindOf, size, picker, MAX_FPS };
})();
