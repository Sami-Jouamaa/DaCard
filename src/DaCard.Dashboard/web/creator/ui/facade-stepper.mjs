(() => {
    'use strict';

    if (globalThis.FacadeStepper) return;

    const SVG_NS = 'http://www.w3.org/2000/svg';

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function checkIcon() {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'fstep-check');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', 'M5 13l4 4L19 7');
        path.setAttribute('pathLength', '1');
        svg.appendChild(path);
        return svg;
    }

    function create(host, options) {
        const opts = options || {};
        const steps = Array.isArray(opts.steps) ? opts.steps.slice() : [];
        const total = steps.length;
        if (!host || !total) return null;

        const backText = opts.backText || 'Back';
        const nextText = opts.nextText || 'Continue';
        const completeText = opts.completeText || 'Complete';
        const noJump = opts.disableStepIndicators === true;

        let current = Math.min(Math.max(1, opts.initialStep || 1), total + 1);
        const panes = new Map();
        let showing = null;
        let leaving = null;
        let leaveTimer = null;
        let watcher = null;

        const outer = el('div', 'facade-stepper');
        if (opts.width) outer.style.setProperty('--fstep-width', opts.width);
        const frame = el('div', 'fstep-frame');
        if (opts.label) {
            frame.setAttribute('role', 'group');
            frame.setAttribute('aria-label', opts.label);
        }
        const row = el('div', 'fstep-row');
        const content = el('div', 'fstep-content');
        const foot = el('div', 'fstep-foot');
        const nav = el('div', 'fstep-nav');
        foot.appendChild(nav);
        frame.append(row, content, foot);
        outer.appendChild(frame);

        const back = el('button', 'facade-btn fstep-back', backText);
        back.type = 'button';
        const next = el('button', 'facade-btn fstep-next', nextText);
        next.type = 'button';
        nav.append(back, next);

        const dots = [];
        const lines = [];
        for (let i = 1; i <= total; i++) {
            const dot = el('button', 'fstep-dot');
            dot.type = 'button';
            dot.disabled = noJump;
            dot.setAttribute('aria-label', 'Step ' + i + ' of ' + total);
            const inner = el('div', 'fstep-dot-inner');
            dot.appendChild(inner);
            dot.addEventListener('click', () => go(i));
            row.appendChild(dot);
            dots.push({ dot, inner, state: null });
            if (i < total) {
                const line = el('div', 'fstep-line');
                line.appendChild(el('div', 'fstep-line-fill'));
                row.appendChild(line);
                lines.push(line);
            }
        }

        const MIN_LINE = 8;

        function fitRow() {
            if (!lines.length || !row.clientWidth) return;
            row.classList.remove('is-wrapped');
            if (lines[0].getBoundingClientRect().width < MIN_LINE) {
                row.classList.add('is-wrapped');
            }
        }

        function paintRow() {
            for (let i = 0; i < total; i++) {
                const step = i + 1;
                const state = current === step ? 'active'
                    : current < step ? 'todo' : 'done';
                const entry = dots[i];
                entry.dot.classList.toggle('is-active', state === 'active');
                entry.dot.classList.toggle('is-done', state === 'done');
                if (state === 'active') entry.dot.setAttribute('aria-current', 'step');
                else entry.dot.removeAttribute('aria-current');
                if (entry.state === state) continue;
                entry.state = state;
                entry.inner.textContent = '';
                if (state === 'done') {
                    const tick = checkIcon();
                    entry.inner.appendChild(tick);
                    requestAnimationFrame(() => tick.classList.add('is-drawn'));
                } else if (state === 'active') {
                    entry.inner.appendChild(el('div', 'fstep-live'));
                } else {
                    entry.inner.appendChild(el('span', 'fstep-num', String(step)));
                }
            }
            for (let i = 0; i < lines.length; i++) {
                lines[i].classList.toggle('is-done', current > i + 1);
            }
        }

        function paintFooter() {
            const done = current > total;
            foot.hidden = done;
            if (done) return;
            back.hidden = current === 1;
            nav.classList.toggle('is-spread', current !== 1);
            next.textContent = current === total ? completeText : nextText;
        }

        function paneFor(index) {
            let pane = panes.get(index);
            if (pane) return pane;
            pane = el('div', 'fstep-pane');
            pane.tabIndex = -1;
            panes.set(index, pane);
            const step = steps[index - 1];
            try {
                if (step && typeof step.render === 'function') step.render(pane, api);
            } catch (e) {
                pane.appendChild(el('p', 'fstep-error',
                    'This step could not be drawn: ' + ((e && e.message) || e)));
            }
            return pane;
        }

        function measure(pane) {
            return pane ? pane.offsetHeight : 0;
        }

        function watch(pane) {
            if (watcher) { watcher.disconnect(); watcher = null; }
            if (!pane || typeof ResizeObserver !== 'function') return;
            watcher = new ResizeObserver(() => {
                if (showing !== pane) return;
                content.style.height = measure(pane) + 'px';
            });
            watcher.observe(pane);
        }

        function finishLeave() {
            if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
            if (!leaving) return;
            leaving.classList.remove('is-out-fwd', 'is-out-back');
            if (leaving.parentNode === content) content.removeChild(leaving);
            leaving = null;
        }

        function slide(index, dir, immediate) {
            finishLeave();

            const incoming = index >= 1 && index <= total ? paneFor(index) : null;
            const outgoing = showing;

            if (outgoing && outgoing !== incoming) {
                outgoing.classList.remove('is-in-fwd', 'is-in-back');
                outgoing.classList.add(dir >= 0 ? 'is-out-fwd' : 'is-out-back');
                leaving = outgoing;
                leaveTimer = setTimeout(finishLeave, 700);
                outgoing.addEventListener('transitionend', function once(e) {
                    if (e.target !== outgoing || e.propertyName !== 'transform') return;
                    outgoing.removeEventListener('transitionend', once);
                    if (leaving === outgoing) finishLeave();
                }, { once: false });
            }

            showing = incoming;
            if (!incoming) {
                content.style.height = '0px';
                watch(null);
                return;
            }

            if (incoming.parentNode !== content) {
                incoming.classList.add(dir >= 0 ? 'is-in-fwd' : 'is-in-back');
                content.appendChild(incoming);
                void incoming.offsetWidth;
            }
            const h = measure(incoming);
            if (immediate) {
                const was = content.style.transition;
                content.style.transition = 'none';
                content.style.height = h + 'px';
                incoming.classList.remove('is-in-fwd', 'is-in-back');
                void content.offsetHeight;
                content.style.transition = was;
            } else {
                content.style.height = h + 'px';
                requestAnimationFrame(() => {
                    incoming.classList.remove('is-in-fwd', 'is-in-back', 'is-out-fwd', 'is-out-back');
                });
            }
            watch(incoming);
        }

        function go(step) {
            const target = Math.min(Math.max(1, step), total + 1);
            if (target === current && (showing || target > total)) return;
            const dir = target >= current ? 1 : -1;
            current = target;
            paintRow();
            paintFooter();
            slide(target, dir, false);
            if (showing) showing.focus({ preventScroll: true });
            if (target > total) {
                if (typeof opts.onFinalStepCompleted === 'function') opts.onFinalStepCompleted();
            } else if (typeof opts.onStepChange === 'function') {
                opts.onStepChange(target);
            }
        }

        back.addEventListener('click', () => { if (current > 1) go(current - 1); });
        next.addEventListener('click', () => go(current + 1));

        const onResize = () => { fitRow(); api.resize(); };

        const api = {
            el: outer,
            total,
            go: (n) => go(n),
            current: () => current,
            resize: () => { if (showing) content.style.height = measure(showing) + 'px'; },
            destroy: () => {
                finishLeave();
                window.removeEventListener('resize', onResize);
                if (watcher) { watcher.disconnect(); watcher = null; }
                outer.remove();
            },
        };

        window.addEventListener('resize', onResize);

        host.appendChild(outer);
        paintRow();
        paintFooter();
        fitRow();
        slide(current, 1, true);
        if (current <= total && typeof opts.onStepChange === 'function') opts.onStepChange(current);
        return api;
    }

    globalThis.FacadeStepper = { create };
})();
