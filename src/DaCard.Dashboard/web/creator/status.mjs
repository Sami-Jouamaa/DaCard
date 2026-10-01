(() => {
    'use strict';

    const $ = (sel, root = document) => root.querySelector(sel);
    let app = null;
    let booted = false;
    const jobs = new Map();
    const mine = new Map();
    const finishedShown = new Set();

    const percent = (job) => (job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : null);

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function renderBar() {
        const list = $('#jobs-list');
        const shown = [...jobs.values()].filter((j) => j.kind !== 'upgrade' || booted)
            .filter((j) => j.status === 'running' || j.status === 'queued' || (j.status === 'failed' && Date.now() - (j.finished || 0) < 15000));
        $('#jobs-bar').hidden = !shown.length;
        list.innerHTML = '';
        for (const job of shown) {
            const row = document.createElement('div');
            const p = percent(job);
            row.className = 'job-row' + (job.status === 'failed' ? ' is-failed' : '');
            const note = job.status === 'failed' ? job.error : job.status === 'queued' ? 'Waiting…' : `${job.message || ''}${p !== null ? ` · ${p}%` : ''}`;
            row.innerHTML = `<b title="${escapeHtml(job.title)}">${escapeHtml(job.title)}</b>
                <div class="progress${p === null && job.status !== 'failed' ? ' is-waiting' : ''}"><div class="progress-fill" style="width:${job.status === 'failed' ? 100 : p ?? 0}%"></div></div>
                <small title="${escapeHtml(note)}">${escapeHtml(note)}</small>`;
            list.appendChild(row);
        }
    }

    function renderBoot(job) {
        const overlay = $('#boot-overlay');
        if (booted) {
            overlay.hidden = true;
            return;
        }
        overlay.hidden = false;
        if (!job) return;
        const p = percent(job);
        $('#boot-fill').style.width = `${p ?? 0}%`;
        $('#boot-fill').parentElement.classList.toggle('is-waiting', p === null);
        $('#boot-title').textContent = job.status === 'failed' ? 'Could not start DaCard' : 'Starting DaCard';
        $('#boot-note').textContent = job.status === 'failed' ? job.error : `${job.message || 'Checking the data'}${p !== null ? ` · ${p}%` : ''}`;
    }

    function finished(job) {
        if (finishedShown.has(job.id)) return;
        finishedShown.add(job.id);
        const own = mine.get(job.id);
        if (job.status === 'failed') {
            if (own) app.toast.err(own.failTitle || `${job.title} failed`, job.error);
            return;
        }
        if (!own) return;
        if (job.kind === 'export' && job.result && job.result.file) {
            const a = document.createElement('a');
            a.href = `/api/downloads/${encodeURIComponent(job.result.file)}`;
            a.download = job.result.name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            app.toast.ok('Collection exported', `${job.result.name} · ${(job.result.size / 1048576).toFixed(1)} MB`);
        }
        if (job.kind === 'import' && job.result) {
            const r = job.result;
            const what = r.kind === 'collection'
                ? `${r.name}: ${r.cards} card${r.cards === 1 ? '' : 's'}${r.replaced ? ' (replaced)' : ''}`
                : `${(r.collections || []).map((c) => c.name).join(', ') || 'Nothing new'}: ${r.cards} card${r.cards === 1 ? '' : 's'}`;
            app.toast.ok('Collection imported', `${what} · restart the SPT server to get it in game.`);
            for (const w of (r.warnings || []).slice(0, 5)) app.toast.err('Import note', w);
        }
        if (own.done) own.done(job);
    }

    function update(job) {
        if (!job) return;
        jobs.set(job.id, job);
        if (job.kind === 'upgrade') renderBoot(job);
        if (job.status === 'done' || job.status === 'failed') {
            finished(job);
            setTimeout(renderBar, 15500);
        }
        renderBar();
    }

    function ready() {
        if (booted) return;
        booted = true;
        renderBoot(null);
        app.rescan();
    }

    function track(job, options = {}) {
        if (!job || !job.id) return;
        mine.set(job.id, options);
        update(job);
    }

    let changeTimer = null;
    function changed() {
        clearTimeout(changeTimer);
        changeTimer = setTimeout(() => app.rescan(), 600);
    }

    let localId = 0;
    function task(title) {
        const id = `local-${++localId}`;
        const job = { id, kind: 'local', title, status: 'running', done: 0, total: 0, message: '', started: Date.now() };
        jobs.set(id, job);
        renderBar();
        return {
            progress(done, total, message) {
                Object.assign(job, { done, total, message: message || job.message });
                renderBar();
            },
            finish(error) {
                if (error) Object.assign(job, { status: 'failed', error, finished: Date.now() });
                else jobs.delete(id);
                renderBar();
                if (error) setTimeout(() => { jobs.delete(id); renderBar(); }, 15500);
            },
        };
    }

    function init(deps) {
        app = deps;
        renderBoot(null);
        DaApi.on('hello', (hello) => {
            for (const job of (hello && hello.jobs) || []) update(job);
            if (hello && hello.ready) ready();
            else if (hello && hello.error) renderBoot({ status: 'failed', error: hello.error });
        });
        DaApi.on('job', update);
        DaApi.on('ready', (state) => {
            if (state && state.ready) ready();
            else renderBoot({ status: 'failed', error: (state && state.error) || 'The data could not be loaded' });
        });
        DaApi.on('changed', changed);
        DaApi.on('offline', () => {
            app.state.offline = true;
            app.updateFolderUi();
        });
        DaApi.on('online', () => {
            app.state.offline = false;
            app.rescan();
        });
    }

    window.CCStatus = { init, track, task };
})();
