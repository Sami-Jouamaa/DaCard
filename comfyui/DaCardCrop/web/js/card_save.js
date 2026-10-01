const { app } = window.comfyAPI.app;
const { api } = window.comfyAPI.api;

const IMAGE_RE = /^image_\d+$/;
const GALLERY_HEIGHT = 300;

const isImageSlot = (input) => !input.widget && IMAGE_RE.test(input.name);
const imageSlots = (node) => (node.inputs ?? []).filter(isImageSlot);
const slotName = (input) => input.label || input.name;
const INPUT = () => window.LiteGraph?.INPUT ?? 1;

function refreshSlots(node, inputs) {
    if (window.LiteGraph?.vueNodesMode) {
        for (const input of inputs) {
            const index = node.inputs.indexOf(input);
            if (index >= 0) node.inputs[index] = new input.constructor({ ...input }, node);
        }
    }
    node.graph?.trigger?.("node:slot-label:changed", { nodeId: node.id, slotType: INPUT() });
}

function viewUrl(file) {
    const q = new URLSearchParams({ filename: file.filename, type: file.type, subfolder: file.subfolder ?? "" });
    return api.apiURL(`/view?${q}&t=${Date.now()}`);
}

function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
}

function button(text, onClick, primary = false) {
    const b = el("button", `padding:5px 12px;border-radius:4px;border:1px solid #555;cursor:pointer;font:12px sans-serif;
        background:${primary ? "#2d6cdf" : "#333"};color:#eee;`, text);
    b.addEventListener("click", onClick);
    return b;
}

function openModal(title, width = 420) {
    const overlay = el("div", "position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:center;justify-content:center;");
    const panel = el("div", `width:${width}px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;gap:8px;padding:14px;
        background:#222;color:#ddd;border:1px solid #444;border-radius:8px;font:13px sans-serif;box-shadow:0 8px 30px #000;`);
    panel.append(el("div", "font-weight:bold;font-size:14px;", title));
    overlay.append(panel);
    const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey, true); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) close(); });
    document.body.append(overlay);
    return { panel, close };
}

function setSlotName(node, input, value) {
    if (!node.inputs?.includes(input)) return;
    node.graph?.beforeChange?.();
    value = String(value ?? "").trim();
    if (value && value !== input.name) input.label = value; else delete input.label;
    node.graph?.afterChange?.();
    refreshSlots(node, [input]);
    node.setDirtyCanvas(true, true);
}

async function renameSlot(node, input, event) {
    const dialog = app.extensionManager?.dialog;
    if (window.LiteGraph?.vueNodesMode && dialog?.prompt) {
        const value = await dialog.prompt({ title: "Rename image input", message: "Name (goes after the name in the file name):",
            defaultValue: slotName(input), placeholder: input.name });
        if (value != null) setSlotName(node, input, value);
        return;
    }
    if (event && app.canvas?.prompt) {
        app.canvas.prompt("Name", slotName(input), (value) => setSlotName(node, input, value), event);
        return;
    }
    const { panel, close } = openModal(`Rename image input "${slotName(input)}"`, 340);
    const field = el("input", "padding:6px;background:#111;color:#eee;border:1px solid #555;border-radius:4px;font:13px sans-serif;");
    field.value = input.label || "";
    field.placeholder = input.name;
    const apply = () => {
        setSlotName(node, input, field.value);
        close();
    };
    field.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") apply(); if (e.key === "Escape") close(); });
    const row = el("div", "display:flex;justify-content:flex-end;gap:6px;");
    row.append(button("Cancel", close), button("Rename", apply, true));
    panel.append(field, row);
    field.focus();
    field.select();
}

function normalizeInputs(node) {
    if (!node.inputs) return;
    let changed = false;
    let slots = imageSlots(node);
    for (let k = slots.length - 2; k >= 0; k--) {
        if (slots[k].link != null) continue;
        node.removeInput(node.inputs.indexOf(slots[k]));
        changed = true;
    }
    slots = imageSlots(node);
    if (!slots.length || slots[slots.length - 1].link != null) {
        node.addInput(`image_${slots.length + 1}`, "IMAGE");
        changed = true;
    }
    const renamed = [];
    imageSlots(node).forEach((input, k) => {
        const name = `image_${k + 1}`;
        if (input.name === name) return;
        input.name = name;
        if (input.localized_name) input.localized_name = name;
        renamed.push(input);
    });
    if (renamed.length) refreshSlots(node, renamed);
    if (changed || renamed.length) {
        node.setSize([node.size[0], Math.max(node.size[1], node.computeSize()[1])]);
        node.setDirtyCanvas(true, true);
    }
}

function onVueSlotDblClick(e) {
    if (!window.LiteGraph?.vueNodesMode) return;
    const key = e.target.closest?.(".lg-slot--input")?.querySelector("[data-slot-key]")?.getAttribute("data-slot-key");
    const m = key?.match(/^(.+)-in-(\d+)$/);
    if (!m) return;
    const node = (app.canvas?.graph ?? app.graph)?.getNodeById(m[1]);
    const input = node?.inputs?.[Number(m[2])];
    if (node?.comfyClass !== "DaCardSave" || !input || !isImageSlot(input)) return;
    e.preventDefault();
    e.stopPropagation();
    renameSlot(node, input, e);
}

function setupGallery(node) {
    const root = el("div", "width:100%;height:100%;overflow:auto;background:#111;border-radius:6px;box-sizing:border-box;padding:6px;font:11px sans-serif;color:#aaa;");
    node.addDOMWidget("save_preview", "div", root, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => GALLERY_HEIGHT,
        getHeight: () => GALLERY_HEIGHT,
    });

    function show(images, folder) {
        root.replaceChildren();
        if (!images?.length) {
            root.append(el("div", "padding:8px;color:#777;text-align:center;", "connect images and run the workflow"));
            return;
        }
        if (folder) root.append(el("div", "padding:0 2px 6px;color:#8c8;word-break:break-all;", `saved to ${folder}`));
        const grid = el("div", "display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px;");
        for (const image of images) {
            const card = el("div", "display:flex;flex-direction:column;gap:3px;background:#1a1a1a;border-radius:4px;padding:4px;");
            const img = el("img", "width:100%;aspect-ratio:490/684;object-fit:contain;background:#000;border-radius:3px;cursor:zoom-in;");
            img.src = viewUrl(image);
            img.addEventListener("click", () => window.open(img.src, "_blank"));
            card.append(img, el("div", "color:#eee;font-weight:bold;word-break:break-all;", image.name));
            if (image.file) card.append(el("div", "word-break:break-all;", image.file));
            card.append(el("div", "color:#777;", `${image.size}${image.frames > 1 ? ` · ${image.frames} frames` : ""}`));
            grid.append(card);
        }
        root.append(grid);
    }

    node._csShow = show;
    show(null);
}

function setupNode(node) {
    setupGallery(node);
    normalizeInputs(node);
    node.setSize([Math.max(node.size[0], 340), node.computeSize()[1]]);
}

app.registerExtension({
    name: "DaCardCrop.CardSave",
    setup() {
        document.addEventListener("dblclick", onVueSlotDblClick, true);
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "DaCardSave") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated?.apply(this, arguments);
            setupNode(this);
            return r;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const r = onConfigure?.apply(this, arguments);
            setTimeout(() => normalizeInputs(this), 0);
            return r;
        };

        const onConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (type) {
            const r = onConnectionsChange?.apply(this, arguments);
            if (type === INPUT()) setTimeout(() => normalizeInputs(this), 0);
            return r;
        };

        const onInputDblClick = nodeType.prototype.onInputDblClick;
        nodeType.prototype.onInputDblClick = function (slot, event) {
            const r = onInputDblClick?.apply(this, arguments);
            const input = this.inputs?.[slot];
            if (input && isImageSlot(input)) renameSlot(this, input, event);
            return r;
        };

        const onDblClick = nodeType.prototype.onDblClick;
        nodeType.prototype.onDblClick = function (event, pos) {
            const r = onDblClick?.apply(this, arguments);
            if (pos?.[1] >= 0 && pos[0] < this.size[0] / 2) {
                const input = imageSlots(this).find((input) => {
                    const [, y] = this.getInputPos(this.inputs.indexOf(input));
                    return Math.abs(y - this.pos[1] - pos[1]) <= 10;
                });
                if (input) renameSlot(this, input, event);
            }
            return r;
        };

        const getExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
            const r = getExtraMenuOptions?.apply(this, arguments);
            const items = imageSlots(this).filter((input) => input.link != null)
                .map((input) => ({ content: `Rename image input "${slotName(input)}"`, callback: () => renameSlot(this, input) }));
            if (!items.length) return r;
            if (Array.isArray(r)) return [...items, ...r];
            options?.unshift?.(...items, null);
            return r;
        };

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (output) {
            const r = onExecuted?.apply(this, arguments);
            this._csShow?.(output?.cs_images, output?.cs_folder?.[0]);
            return r;
        };
    },
});
