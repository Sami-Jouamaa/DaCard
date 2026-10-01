(function () {
    'use strict';

    if (globalThis.FacadeToast) return;

    const SETTINGS_RECORD = 'settings:notifications';
    const HOST_CLASS = 'facade-toasts';

    const SUCCESS_MS = 4500;
    const OUT_MS = 160;
    const MAX_ON_SCREEN = 6;
    const QUEUE_MAX = 8;

    let allow = null;
    const waiting = [];

    function normalize(rec) {
        const r = rec && typeof rec === 'object' ? rec : {};
        return { error: r.error !== false, success: r.success === true };
    }

    function host() {
        let node = document.querySelector('.' + HOST_CLASS);
        if (!node) {
            node = document.createElement('div');
            node.className = HOST_CLASS;
            (document.body || document.documentElement).appendChild(node);
        }
        return node;
    }

    function dismiss(card) {
        if (!card || card.classList.contains('is-out')) return;
        card.classList.add('is-out');
        setTimeout(() => card.remove(), OUT_MS);
    }

    function trim(node) {
        const live = [...node.children].filter((c) => !c.classList.contains('is-out'));
        while (live.length > MAX_ON_SCREEN) dismiss(live.shift());
    }

    function build(o, tone) {
        const card = document.createElement('div');
        card.className = 'facade-glass facade-toast '
            + (tone === 'success' ? 'fx-green' : 'fx-red');
        card.setAttribute('role', tone === 'success' ? 'status' : 'alert');

        const head = document.createElement('div');
        head.className = 'facade-toast-head';
        const title = document.createElement('span');
        title.className = 'facade-toast-title';
        title.textContent = o.title || (tone === 'success' ? 'Done' : 'Failed');
        head.appendChild(title);

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'facade-iconbtn facade-toast-close';
        close.setAttribute('aria-label', 'Dismiss');
        close.title = 'Dismiss';
        close.textContent = '×';
        close.addEventListener('click', () => dismiss(card));
        head.appendChild(close);
        card.appendChild(head);

        if (o.body) {
            const body = document.createElement('div');
            body.className = 'facade-toast-body';
            body.textContent = o.body;
            card.appendChild(body);
        }
        if (o.note) {
            const note = document.createElement('div');
            note.className = 'facade-toast-note';
            note.textContent = o.note;
            card.appendChild(note);
        }
        if (o.link && o.link.href && o.link.text) {
            const link = document.createElement('a');
            link.className = 'facade-toast-link';
            link.href = o.link.href;
            link.target = '_blank';
            link.rel = 'noopener';
            link.textContent = o.link.text;
            card.appendChild(link);
        }

        const node = host();
        node.appendChild(card);
        trim(node);

        const ms = Number.isFinite(o.timeout) ? o.timeout
            : (tone === 'success' ? SUCCESS_MS : 0);
        if (ms > 0) setTimeout(() => dismiss(card), ms);
        return card;
    }

    function show(opts) {
        const o = opts && typeof opts === 'object' ? opts : {};
        const tone = o.tone === 'success' ? 'success' : 'error';
        if (!allow) {
            if (waiting.length < QUEUE_MAX) waiting.push(Object.assign({}, o, { tone }));
            return null;
        }
        if (!allow[tone]) return null;
        return build(o, tone);
    }

    function flush() {
        const held = waiting.splice(0, waiting.length);
        for (const o of held) show(o);
    }

    const api = {
        show,
        success: (title, body, extra) =>
            show(Object.assign({ title, body }, extra, { tone: 'success' })),
        error: (title, body, extra) =>
            show(Object.assign({ title, body }, extra, { tone: 'error' })),
        enabled: (tone) => !allow || allow[tone === 'success' ? 'success' : 'error'],
        dismissAll: () => {
            const node = document.querySelector('.' + HOST_CLASS);
            if (node) [...node.children].forEach(dismiss);
        },
    };

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes[SETTINGS_RECORD]) {
                allow = normalize(changes[SETTINGS_RECORD].newValue);
            }
        });
        chrome.storage.local.get(SETTINGS_RECORD)
            .then((got) => { allow = normalize(got[SETTINGS_RECORD]); flush(); })
            .catch(() => { allow = normalize(null); flush(); });
    } else {
        allow = normalize(null);
    }

    globalThis.FacadeToast = api;
})();
