(() => {
    'use strict';

    const CARD_W = 490, CARD_H = 684;
    const CARD_FONT = 'Bw Modelica ExtraBold';
    const TEXT_FONT = `'${CARD_FONT}', 'Liberation Sans', Arial, 'Helvetica Neue', sans-serif`;
    const DEFAULT_FACE = { family: CARD_FONT, ascent: 0.98, descent: 0.22, gap: 0 };
    const ALIGNS = ['left', 'center', 'right'];
    const VALIGNS = ['top', 'middle', 'bottom'];
    const VARIABLES = [
        { key: 'name', label: 'Name', insert: '${name}', title: 'The card\'s name, in the player\'s language' },
        { key: 'description', label: 'Description', insert: '${description}', title: 'The card\'s description, in the player\'s language' },
        { key: 'rarity', label: 'Rarity', insert: '${rarity}', title: 'The card\'s rarity' },
        { key: 'rarity.colored', label: 'Rarity (coloured)', insert: '<color=${rarity.color}>${rarity}</color>', title: 'The rarity, in the rarity\'s colour' },
        { key: 'collection', label: 'Collection', insert: '${collection}', title: 'The card\'s collection' },
    ];

    const defaults = () => ({ value: '${name}', x: 0.5, y: 0.05, width: 0.84, height: 0.1, size: 0.05, align: 'center', valign: 'top', color: '#FFFFFF', opacity: 1, uppercase: false, autoSize: false, rotation: 0, font: null, fontName: '', face: null });

    function fontMetrics(buffer) {
        const v = new DataView(buffer);
        const tag = buffer.byteLength >= 12 ? v.getUint32(0) : 0;
        if (tag === 0x74746366) throw new Error('Font collections (.ttc) are not supported: pick a single TTF or OTF font.');
        if (![0x00010000, 0x4f54544f, 0x74727565].includes(tag)) throw new Error('Not a TTF or OTF font.');
        const tables = {};
        for (let i = 0, n = v.getUint16(4); i < n; i++)
            tables[String.fromCharCode(...new Uint8Array(buffer, 12 + 16 * i, 4))] = v.getUint32(12 + 16 * i + 8);
        if (tables.head == null || tables.hhea == null) throw new Error('Not a TTF or OTF font.');
        const em = v.getUint16(tables.head + 18);
        let ascent = v.getInt16(tables.hhea + 4), descent = -v.getInt16(tables.hhea + 6), gap = v.getInt16(tables.hhea + 8);
        const os2 = tables['OS/2'];
        if (!ascent && !descent && os2 != null) [ascent, descent, gap] = [v.getInt16(os2 + 68), -v.getInt16(os2 + 70), v.getInt16(os2 + 72)];
        return { ascent: ascent / em, descent: descent / em, gap: Math.max(0, gap) / em };
    }

    let faceCount = 0;
    const faces = new WeakMap();
    function loadFace(blob) {
        if (!faces.has(blob)) faces.set(blob, (async () => {
            const buffer = await blob.arrayBuffer();
            const metrics = fontMetrics(buffer);
            const family = `DaCard Font ${++faceCount}`;
            const face = new FontFace(family, buffer);
            await face.load();
            document.fonts.add(face);
            return { family, ...metrics };
        })());
        return faces.get(blob);
    }

    const expand = (value, vars) => String(value ?? '').replace(/\$\{\s*([a-z.]+)\s*\}/gi, (m, key) => (vars && vars[key.toLowerCase()] != null ? String(vars[key.toLowerCase()]) : m));

    const colorOf = (value, vars) => {
        const c = String(value || '').trim();
        if (/^rarity$/i.test(c)) return (vars && vars['rarity.color']) || '#FFFFFF';
        if (/^#?[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c)) return c.startsWith('#') ? c : '#' + c;
        if (/^#?[0-9a-f]{3}$/i.test(c)) return c.startsWith('#') ? c : '#' + c;
        return /^[a-z]+$/i.test(c) ? c : null;
    };

    function colored(text, base, vars, upper = false) {
        const plain = [], colors = [], stack = [base];
        const re = /<color=["']?([^>"']*)["']?>|<\/color>/gi;
        let last = 0, m;
        const add = (s) => {
            for (const ch of s) {
                const u = upper ? ch.toUpperCase() : ch;
                plain.push(u.length === 1 ? u : ch);
                colors.push(stack[stack.length - 1]);
            }
        };
        while ((m = re.exec(text))) {
            add(text.slice(last, m.index));
            if (m[0][1] === '/') { if (stack.length > 1) stack.pop(); }
            else stack.push(colorOf(m[1], vars) || stack[stack.length - 1]);
            last = re.lastIndex;
        }
        add(text.slice(last));
        return { text: plain.join(''), chars: plain, colors };
    }

    function wrapRanges(g, chars, width) {
        const text = chars.join('');
        const lines = [];
        const fits = (a, b) => g.measureText(chars.slice(a, b).join('').trimEnd()).width <= width;
        let start = 0;
        for (const para of text.split('\n')) {
            const count = [...para].length, end = start + count;
            let lineStart = start, i = start;
            for (const word of para.match(/\s*\S+\s*|\s+/g) || []) {
                const wEnd = i + [...word].length;
                if (fits(lineStart, wEnd)) { i = wEnd; continue; }
                if (i > lineStart) { lines.push([lineStart, i]); lineStart = i; }
                while (!fits(lineStart, wEnd)) {
                    let n = lineStart + 1;
                    while (n < wEnd && fits(lineStart, n + 1)) n++;
                    lines.push([lineStart, n]);
                    lineStart = n;
                }
                i = wEnd;
            }
            lines.push([lineStart, end]);
            start = end + 1;
        }
        return lines;
    }

    function layout(style, H = CARD_H) {
        const face = style.face || DEFAULT_FACE, line = style.size * H;
        const size = line / (face.ascent + face.descent), step = size * (face.ascent + face.descent + face.gap);
        const box = style.height * H;
        return {
            face, line, size, step,
            font: `${size}px '${face.family}', ${TEXT_FONT}`,
            lines: box + 1e-3 >= line ? Math.floor((box - line) / step + 1e-3) + 1 : 0,
        };
    }

    const MIN_FIT = 0.2;

    function fittedLayout(g, style, chars, width, H) {
        const at = (size) => {
            const L = layout({ ...style, size }, H);
            g.font = L.font;
            return L;
        };
        const fits = (size) => {
            const L = at(size);
            return L.lines > 0 && wrapRanges(g, chars, width).length <= L.lines;
        };
        if (!style.autoSize || fits(style.size)) return at(style.size);
        let lo = style.size * MIN_FIT, hi = style.size;
        if (fits(lo))
            for (let i = 0; i < 12; i++) {
                const mid = (lo + hi) / 2;
                if (fits(mid)) lo = mid; else hi = mid;
            }
        return at(lo);
    }

    function draw(g, style, vars, W = CARD_W, H = CARD_H) {
        const value = expand(style.value, vars);
        if (!value.trim()) return false;
        const width = style.width * W, left = (style.x - style.width / 2) * W;
        const align = ALIGNS.includes(style.align) ? style.align : 'center';
        const { chars, colors } = colored(value, colorOf(style.color, vars) || '#FFFFFF', vars, !!style.uppercase);
        g.save();
        g.globalAlpha = Math.min(1, Math.max(0, style.opacity ?? 1));
        if (style.rotation) {
            const cx = style.x * W, cy = (style.y + style.height / 2) * H;
            g.translate(cx, cy);
            g.rotate(style.rotation * Math.PI / 180);
            g.translate(-cx, -cy);
        }
        const L = fittedLayout(g, style, chars, width, H);
        g.textBaseline = 'alphabetic';
        g.textAlign = 'left';
        const lines = wrapRanges(g, chars, width).slice(0, L.lines);
        const spare = Math.max(0, style.height * H - (lines.length ? (lines.length - 1) * L.step + L.line : 0));
        const top = style.valign === 'bottom' ? spare : style.valign === 'middle' ? spare / 2 : 0;
        lines.forEach(([a, b], row) => {
            const shown = chars.slice(a, b).join('').trimEnd();
            const end = a + [...shown].length;
            const total = g.measureText(shown).width;
            let x = align === 'left' ? left : align === 'right' ? left + width - total : left + (width - total) / 2;
            const y = style.y * H + top + row * L.step + L.face.ascent * L.size;
            for (let i = a; i < end;) {
                let j = i + 1;
                while (j < end && colors[j] === colors[i]) j++;
                const piece = chars.slice(i, j).join('');
                g.fillStyle = colors[i];
                g.fillText(piece, x, y);
                x += g.measureText(piece).width;
                i = j;
            }
        });
        g.restore();
        return lines.length > 0;
    }

    function render(style, vars, W = CARD_W, H = CARD_H) {
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        return draw(canvas.getContext('2d'), style, vars, W, H) ? canvas : null;
    }

    function box(style) {
        const cx = style.x * CARD_W, cy = (style.y + style.height / 2) * CARD_H;
        const w = style.width * CARD_W, h = style.height * CARD_H;
        const a = (style.rotation || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
            const x = u * w / 2, y = v * h / 2;
            return [cx + c * x - s * y, cy + s * x + c * y];
        });
    }

    function contains(style, px, py) {
        const cx = style.x * CARD_W, cy = (style.y + style.height / 2) * CARD_H;
        const a = -(style.rotation || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        const dx = px - cx, dy = py - cy;
        const x = c * dx - s * dy, y = s * dx + c * dy;
        return Math.abs(x) <= style.width * CARD_W / 2 && Math.abs(y) <= style.height * CARD_H / 2;
    }

    window.CardText = { CARD_FONT, TEXT_FONT, DEFAULT_FACE, ALIGNS, VALIGNS, VARIABLES, defaults, fontMetrics, loadFace, expand, layout, draw, render, box, contains };
})();
