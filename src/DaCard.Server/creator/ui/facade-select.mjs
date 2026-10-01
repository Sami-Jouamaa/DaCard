(function () {
    'use strict';

    if (globalThis.FacadeSelect) return;

    const MENU_OPEN = 'is-open';
    const DATA_FLAG = 'data-facade-select';
    const FLAT = 'fx-nobackdrop';

    let flattened = null;

    function unflatten() {
        if (!flattened) return;
        flattened.classList.remove(FLAT);
        flattened = null;
    }

    function flattenAbove(node) {
        unflatten();
        for (let el = node.parentElement; el; el = el.parentElement) {
            const cs = getComputedStyle(el);
            const bf = cs.backdropFilter || cs.webkitBackdropFilter;
            if (bf && bf !== 'none') {
                el.classList.add(FLAT);
                flattened = el;
                return;
            }
        }
    }

    function closeAll() {
        for (const m of document.querySelectorAll('.facade-menu.' + MENU_OPEN)) {
            m.classList.remove(MENU_OPEN);
        }
        unflatten();
    }

    function attachHighlight(menu) {
        const pill = document.createElement('div');
        pill.className = 'facade-menu-hl';
        menu.appendChild(pill);
        let active = false;

        const moveTo = (item) => {
            const x = item.offsetLeft - menu.clientLeft;
            const y = item.offsetTop - menu.clientTop;
            const w = item.offsetWidth + 'px';
            const h = item.offsetHeight + 'px';
            if (!active) {
                pill.style.transition = 'none';
                pill.style.transform = `translate(${x}px, ${y}px)`;
                pill.style.width = w;
                pill.style.height = h;
                void pill.offsetWidth;
                pill.style.transition = '';
                pill.style.opacity = '1';
                active = true;
            } else {
                pill.style.transform = `translate(${x}px, ${y}px)`;
                pill.style.width = w;
                pill.style.height = h;
            }
        };

        menu.addEventListener('mouseover', (e) => {
            const item = e.target.closest('.facade-menu-item');
            if (item && !item.classList.contains('is-disabled')) moveTo(item);
        });
        menu.addEventListener('mouseleave', () => {
            if (api.hold) return;
            pill.style.opacity = '0';
            active = false;
        });

        const api = {
            el: pill,
            hold: false,
            moveTo,
            reset() { pill.style.opacity = '0'; active = false; api.hold = false; },
        };
        return api;
    }

    const labelOf = (opt) => opt.textContent.trim() || '—';
    const isSub = (opt) => /^ /.test(opt.textContent.replace(/^[ \t\r\n]+/, ''));

    const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

    function findMatch(labels, buffer, from, cycle) {
        const q = fold(cycle ? buffer[0] : buffer);
        const n = labels.length;
        const start = cycle ? from + 1 : Math.max(from, 0);
        for (let i = 0; i < n; i++) {
            const idx = (start + i + n) % n;
            if (fold(labels[idx]).startsWith(q)) return idx;
        }
        return -1;
    }

    function icoSpec(cfg, opt) {
        if (typeof cfg.icon !== 'function' || !opt) return null;
        const got = cfg.icon(opt);
        if (!got) return null;
        if (typeof got === 'string') return { slot: got };
        return got.slot ? got : null;
    }

    function makeIco(spec) {
        const span = document.createElement('span');
        span.className = 'facade-menu-ico fx-ico-' + spec.slot;
        if (spec.color) span.style.color = spec.color;
        return span;
    }

    function fill(host, spec, text) {
        if (!spec) { host.textContent = text; return; }
        host.textContent = '';
        host.appendChild(makeIco(spec));
        const label = document.createElement('span');
        label.textContent = text;
        host.appendChild(label);
    }

    function enhance(select, opts) {
        if (!select || select.tagName !== 'SELECT') return null;
        if (select.hasAttribute(DATA_FLAG)) {
            if (select.facadeSync) select.facadeSync();
            return select.facadeDropdown || null;
        }
        const cfg = opts || {};
        select.setAttribute(DATA_FLAG, '1');
        select.classList.add('facade-select-native');

        const dd = document.createElement('div');
        dd.className = 'facade-dd' + (cfg.wrapClass ? ' ' + cfg.wrapClass : '');

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'facade-select ' + (cfg.buttonClass || 'fx-light');

        const host = cfg.menuHost || null;

        const menu = document.createElement('div');
        menu.className = 'facade-menu facade-glass facade-scroll fx-nogutter'
            + (host ? ' fx-float' : '')
            + (cfg.menuClass ? ' ' + cfg.menuClass : '');
        const hl = attachHighlight(menu);

        const sizer = document.createElement('div');
        sizer.className = 'facade-select facade-dd-sizer ' + (cfg.buttonClass || 'fx-light');
        sizer.setAttribute('aria-hidden', 'true');

        const syncWidth = () => {
            sizer.textContent = '';
            for (const opt of select.options) {
                const line = document.createElement('span');
                fill(line, icoSpec(cfg, opt), labelOf(opt));
                if (opt.style.fontFamily) line.style.fontFamily = opt.style.fontFamily;
                sizer.appendChild(line);
            }
        };

        const syncLabel = () => {
            const opt = select.selectedOptions[0];
            fill(btn, opt ? icoSpec(cfg, opt) : null,
                opt ? labelOf(opt) : (cfg.placeholder || '—'));
            btn.style.fontFamily = (opt && opt.style.fontFamily) || '';
        };
        select.facadeSync = () => { syncLabel(); syncWidth(); };

        let rows = [];
        let activeIdx = -1;

        const rebuild = () => {
            menu.textContent = '';
            rows = [];
            activeIdx = -1;
            const addOption = (opt, sub) => {
                const item = document.createElement('div');
                item.className = 'facade-menu-item';
                if (sub || isSub(opt)) item.classList.add('is-sub');
                if (opt.disabled) item.classList.add('is-disabled');
                if (opt.value === select.value) item.classList.add('is-active');
                fill(item, icoSpec(cfg, opt), labelOf(opt));
                if (opt.style.fontFamily) item.style.fontFamily = opt.style.fontFamily;
                item.addEventListener('click', () => {
                    if (opt.disabled) return;
                    closeAll();
                    if (select.value !== opt.value) {
                        select.value = opt.value;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    syncLabel();
                });
                menu.appendChild(item);
                if (!opt.disabled) rows.push({ item, opt });
            };
            for (const child of [...select.children]) {
                if (child.tagName === 'OPTGROUP') {
                    const cap = document.createElement('div');
                    cap.className = 'facade-menu-group';
                    cap.textContent = child.label;
                    menu.appendChild(cap);
                    for (const opt of child.children) {
                        if (opt.tagName === 'OPTION') addOption(opt, true);
                    }
                } else if (child.tagName === 'OPTION') {
                    addOption(child, false);
                }
            }
            menu.appendChild(hl.el);
        };

        menu.addEventListener('click', (e) => e.preventDefault());

        const GAP = 3;
        const place = () => {
            const box = btn.getBoundingClientRect();
            const height = menu.offsetHeight;
            const room = window.innerHeight - box.bottom - GAP;
            const above = room < height && box.top - GAP > height;
            menu.style.left = box.left + 'px';
            menu.style.minWidth = box.width + 'px';
            menu.style.top = (above ? box.top - GAP - height : box.bottom + GAP) + 'px';
        };

        const isOpen = () => menu.classList.contains(MENU_OPEN);

        const TYPE_WINDOW = 800;
        let buffer = '';
        let typedAt = 0;

        const open = () => {
            syncLabel();
            rebuild();
            hl.reset();
            buffer = '';
            if (host) menu.style.top = '-9999px';
            if (!host) flattenAbove(menu);
            menu.classList.add(MENU_OPEN);
            if (host) place();
            activeIdx = rows.findIndex((r) => r.item.classList.contains('is-active'));
        };

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const wasOpen = isOpen();
            closeAll();
            if (!wasOpen) open();
        });

        const goTo = (i) => {
            const row = rows[i];
            if (!row) return;
            activeIdx = i;
            hl.hold = true;
            hl.moveTo(row.item);
            const top = row.item.offsetTop - menu.clientTop;
            const bottom = top + row.item.offsetHeight;
            if (top < menu.scrollTop) menu.scrollTop = top;
            else if (bottom > menu.scrollTop + menu.clientHeight) {
                menu.scrollTop = bottom - menu.clientHeight;
            }
        };

        const step = (delta) => {
            if (!rows.length) return;
            let i = (activeIdx < 0 ? -1 : activeIdx) + delta;
            if (i < 0) i = rows.length - 1;
            if (i >= rows.length) i = 0;
            goTo(i);
        };

        const take = () => {
            if (rows[activeIdx]) rows[activeIdx].item.click();
            else closeAll();
        };

        const typeAhead = (ch) => {
            const now = Date.now();
            buffer = now - typedAt > TYPE_WINDOW ? ch : buffer + ch;
            typedAt = now;
            const cycle = [...buffer].every((c) => c === buffer[0]);

            const opts = isOpen()
                ? rows.map((r) => r.opt)
                : [...select.options].filter((o) => !o.disabled);
            if (!opts.length) return;
            const from = isOpen() ? activeIdx : opts.indexOf(select.selectedOptions[0]);
            const hit = findMatch(opts.map(labelOf), buffer, from, cycle);
            if (hit < 0) return;
            if (isOpen()) goTo(hit);
            else if (select.value !== opts[hit].value) {
                select.value = opts[hit].value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                syncLabel();
            }
        };

        btn.addEventListener('keydown', (e) => {
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            const k = e.key;

            const eat = () => { e.preventDefault(); e.stopPropagation(); };

            if (k === 'Tab') { closeAll(); return; }

            if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End') {
                eat();
                if (!isOpen()) { closeAll(); open(); return; }
                if (k === 'Home') goTo(0);
                else if (k === 'End') goTo(rows.length - 1);
                else step(k === 'ArrowDown' ? 1 : -1);
                return;
            }

            if (k === 'Enter' || k === ' ') {
                const midWord = k === ' ' && Date.now() - typedAt <= TYPE_WINDOW && buffer;
                if (midWord) { eat(); typeAhead(' '); return; }
                if (isOpen()) { eat(); take(); }
                return;
            }

            if (k === 'Backspace') {
                if (!buffer) return;
                eat();
                buffer = buffer.slice(0, -1);
                typedAt = Date.now();
                return;
            }

            if (k.length === 1) { eat(); typeAhead(k); }
        });

        menu.addEventListener('mouseover', (e) => {
            const item = e.target.closest('.facade-menu-item');
            if (!item) return;
            const i = rows.findIndex((r) => r.item === item);
            if (i >= 0) { activeIdx = i; hl.hold = false; }
        });

        select.addEventListener('change', syncLabel);
        dd.append(sizer, btn);
        if (host) host.appendChild(menu); else dd.appendChild(menu);
        select.before(dd);
        dd.appendChild(select);
        syncLabel();
        syncWidth();

        select.facadeDropdown = dd;
        return dd;
    }

    function sync(select) {
        if (select && select.facadeSync) select.facadeSync();
    }
    function syncAll(root) {
        for (const s of (root || document).querySelectorAll('select[' + DATA_FLAG + ']')) {
            if (s.facadeSync) s.facadeSync();
        }
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.facade-dd, .facade-menu')) closeAll();
    }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAll();
    }, true);
    document.addEventListener('scroll', () => {
        for (const m of document.querySelectorAll('.facade-menu.fx-float.' + MENU_OPEN)) {
            m.classList.remove(MENU_OPEN);
        }
    }, true);

    globalThis.FacadeSelect = { enhance, sync, syncAll, closeAll };
})();
