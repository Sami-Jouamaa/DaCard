const { app } = window.comfyAPI.app;
const { api } = window.comfyAPI.api;

const VIDEO_RE = /\.(mp4|webm|mov|mkv|avi|m4v)$/i;
const PREVIEW_HEIGHT = 300;

function cropBox(W, H, outW, outH, zoom, ox, oy) {
    const aspect = outW / outH;
    let bw, bh;
    if (W / H > aspect) { bw = H * aspect; bh = H; } else { bw = W; bh = W / aspect; }
    zoom = Math.max(zoom, 1);
    const cw = bw / zoom, ch = bh / zoom;
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    const cx = W / 2 + clamp(ox) * (W - cw) / 2;
    const cy = H / 2 + clamp(oy) * (H - ch) / 2;
    const x0 = Math.min(Math.max(cx - cw / 2, 0), W - cw);
    const y0 = Math.min(Math.max(cy - ch / 2, 0), H - ch);
    return { x: x0, y: y0, w: cw, h: ch };
}

function outputSize(W, H, outW, outH, b, mode) {
    if (mode !== "maintain resolution") return { w: outW, h: outH };
    let w = Math.max(1, Math.min(W, Math.round(b.w)));
    let h = Math.max(1, Math.round(w * outH / outW));
    if (h > H) { h = H; w = Math.max(1, Math.min(W, Math.round(h * outW / outH))); }
    return { w, h };
}

function viewUrl(annotated, defaultType = "input") {
    let name = String(annotated), type = defaultType;
    const m = name.match(/^(.*) \[(input|output|temp)\]$/);
    if (m) { name = m[1]; type = m[2]; }
    const i = name.lastIndexOf("/");
    const subfolder = i >= 0 ? name.slice(0, i) : "";
    const filename = i >= 0 ? name.slice(i + 1) : name;
    const q = new URLSearchParams({ filename, type, subfolder });
    return { url: api.apiURL(`/view?${q}`), isVideo: VIDEO_RE.test(filename) };
}

function getLink(id) {
    const g = app.graph;
    return g.getLink?.(id) ?? (g.links instanceof Map ? g.links.get(id) : g.links?.[id]);
}

function setupCropper(node) {
    const widget = (name) => node.widgets?.find((w) => w.name === name);

    const root = document.createElement("div");
    root.style.cssText = "width:100%;height:100%;position:relative;background:#111;border-radius:6px;overflow:hidden;";
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:100%;height:100%;display:block;cursor:grab;touch-action:none;";
    const hint = document.createElement("div");
    hint.style.cssText = "position:absolute;left:6px;bottom:4px;font:11px sans-serif;color:#aaa;pointer-events:none;text-shadow:0 0 3px #000;";
    root.append(canvas, hint);

    node.addDOMWidget("crop_preview", "div", root, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => PREVIEW_HEIGHT,
        getHeight: () => PREVIEW_HEIGHT,
    });
    node.setSize([Math.max(node.size[0], 340), node.computeSize()[1]]);

    let media = null;
    let mediaUrl = null;
    let view = null;

    function resolveSource() {
        for (const name of ["video", "image"]) {
            const input = node.inputs?.find((i) => i.name === name);
            if (input?.link == null) continue;
            const link = getLink(input.link);
            const origin = link && app.graph.getNodeById(link.origin_id);
            const w = origin?.widgets?.find((w) => ["file", "video", "image"].includes(w.name) && typeof w.value === "string" && w.value);
            if (w) return viewUrl(w.value);
            if (node._ccExecutedSource) return node._ccExecutedSource;
            return null;
        }
        const file = widget("file")?.value;
        if (file && file !== "(none)") return viewUrl(file);
        return node._ccExecutedSource ?? null;
    }

    function loadSource() {
        const src = resolveSource();
        const url = src?.url ?? null;
        if (url === mediaUrl) return;
        mediaUrl = url;
        media = null;
        if (!src) { draw(); return; }
        if (src.isVideo) {
            const v = document.createElement("video");
            v.muted = true; v.preload = "auto"; v.crossOrigin = "anonymous";
            v.addEventListener("loadeddata", () => { v.currentTime = Math.min(0.05, v.duration || 0); });
            v.addEventListener("seeked", () => { if (mediaUrl === url) { media = v; draw(); } });
            v.src = url;
        } else {
            const img = new Image();
            img.onload = () => { if (mediaUrl === url) { media = img; draw(); } };
            img.src = url;
        }
        draw();
    }

    function values() {
        return {
            zoom: widget("zoom")?.value ?? 1,
            ox: widget("offset_x")?.value ?? 0,
            oy: widget("offset_y")?.value ?? 0,
            outW: widget("width")?.value ?? 490,
            outH: widget("height")?.value ?? 684,
            mode: widget("mode")?.value ?? "resize",
        };
    }

    function draw() {
        const dpr = window.devicePixelRatio || 1;
        const cw = Math.max(1, root.clientWidth), ch = Math.max(1, root.clientHeight);
        if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
            canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
        }
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cw, ch);
        const { zoom, ox, oy, outW, outH, mode } = values();

        if (!media) {
            view = null;
            ctx.fillStyle = "#777"; ctx.font = "12px sans-serif"; ctx.textAlign = "center";
            ctx.fillText(mediaUrl ? "loading…" : "pick a file or connect Load Image / Load Video", cw / 2, ch / 2);
            hint.textContent = "";
            return;
        }
        const W = media.videoWidth || media.naturalWidth, H = media.videoHeight || media.naturalHeight;
        const s = Math.min(cw / W, ch / H);
        const dx = (cw - W * s) / 2, dy = (ch - H * s) / 2;
        view = { s, dx, dy, W, H };
        ctx.drawImage(media, dx, dy, W * s, H * s);

        const b = cropBox(W, H, outW, outH, zoom, ox, oy);
        const rx = dx + b.x * s, ry = dy + b.y * s, rw = b.w * s, rh = b.h * s;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.beginPath();
        ctx.rect(dx, dy, W * s, H * s);
        ctx.rect(rx, ry, rw, rh);
        ctx.fill("evenodd");
        ctx.strokeStyle = "#ffcf40"; ctx.lineWidth = 1.5;
        ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
        ctx.strokeStyle = "rgba(255,207,64,0.25)"; ctx.lineWidth = 1;
        for (let i = 1; i < 3; i++) {
            ctx.beginPath(); ctx.moveTo(rx + rw * i / 3, ry); ctx.lineTo(rx + rw * i / 3, ry + rh); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(rx, ry + rh * i / 3); ctx.lineTo(rx + rw, ry + rh * i / 3); ctx.stroke();
        }
        const out = outputSize(W, H, outW, outH, b, mode);
        hint.textContent = `${W}×${H} → ${out.w}×${out.h}  zoom ${zoom.toFixed(2)}  ·  drag · scroll · dbl-click resets`;
    }

    function setWidget(name, value) {
        const w = widget(name);
        if (!w) return;
        w.value = value;
        w.callback?.(value);
    }

    let drag = null;
    canvas.addEventListener("pointerdown", (e) => {
        if (!view || e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        canvas.setPointerCapture(e.pointerId);
        const { zoom, ox, oy, outW, outH } = values();
        drag = { x: e.clientX, y: e.clientY, ox, oy, b: cropBox(view.W, view.H, outW, outH, zoom, ox, oy) };
        canvas.style.cursor = "grabbing";
    });
    canvas.addEventListener("pointermove", (e) => {
        if (!drag || !view) return;
        e.preventDefault(); e.stopPropagation();
        const scale = canvas.getBoundingClientRect().width / root.clientWidth || 1;
        const dxSrc = (e.clientX - drag.x) / scale / view.s;
        const dySrc = (e.clientY - drag.y) / scale / view.s;
        const spanX = (view.W - drag.b.w) / 2, spanY = (view.H - drag.b.h) / 2;
        if (spanX > 0.5) setWidget("offset_x", Math.max(-1, Math.min(1, +(drag.ox + dxSrc / spanX).toFixed(3))));
        if (spanY > 0.5) setWidget("offset_y", Math.max(-1, Math.min(1, +(drag.oy + dySrc / spanY).toFixed(3))));
        draw();
        app.graph.setDirtyCanvas(true, false);
    });
    const endDrag = (e) => {
        if (!drag) return;
        drag = null; canvas.style.cursor = "grab";
        try { canvas.releasePointerCapture(e.pointerId); } catch { }
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    canvas.addEventListener("wheel", (e) => {
        if (!view) return;
        e.preventDefault(); e.stopPropagation();
        const { zoom } = values();
        const next = Math.max(1, Math.min(8, zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06)));
        setWidget("zoom", +next.toFixed(3));
        draw();
        app.graph.setDirtyCanvas(true, false);
    }, { passive: false });

    canvas.addEventListener("dblclick", (e) => {
        e.preventDefault(); e.stopPropagation();
        setWidget("zoom", 1); setWidget("offset_x", 0); setWidget("offset_y", 0);
        draw();
        app.graph.setDirtyCanvas(true, false);
    });

    for (const name of ["mode", "zoom", "offset_x", "offset_y", "width", "height", "file"]) {
        const w = widget(name);
        if (!w) continue;
        const cb = w.callback;
        w.callback = function () {
            const r = cb?.apply(this, arguments);
            if (name === "file") loadSource(); else draw();
            return r;
        };
    }

    new ResizeObserver(() => draw()).observe(root);

    const timer = setInterval(() => {
        if (!node.graph) return;
        loadSource();
    }, 800);
    const onRemoved = node.onRemoved;
    node.onRemoved = function () {
        clearInterval(timer);
        return onRemoved?.apply(this, arguments);
    };

    node._ccRefresh = () => { mediaUrl = null; loadSource(); };
    loadSource();
}

app.registerExtension({
    name: "DaCardCrop.CardCropper",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "DaCardCrop") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated?.apply(this, arguments);
            setupCropper(this);
            return r;
        };

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (output) {
            const r = onExecuted?.apply(this, arguments);
            const src = output?.cc_source?.[0];
            if (src) {
                this._ccExecutedSource = viewUrl(src.subfolder ? `${src.subfolder}/${src.filename} [${src.type}]` : `${src.filename} [${src.type}]`);
                this._ccRefresh?.();
            }
            return r;
        };
    },
});
