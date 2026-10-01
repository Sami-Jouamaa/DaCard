(() => {
    'use strict';

    async function request(method, url, body, headers = {}) {
        const init = { method, headers: { ...headers } };
        if (body instanceof FormData || body instanceof Blob || body instanceof ArrayBuffer) init.body = body;
        else if (body !== undefined) {
            init.body = JSON.stringify(body);
            init.headers['Content-Type'] = 'application/json';
        }
        let response;
        try {
            response = await fetch(url, init);
        } catch {
            throw new Error('The DaCard dashboard is not running. Start "DaCard Dashboard.bat" again.');
        }
        const text = await response.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = null; }
        if (!response.ok) throw new Error((data && data.error) || `${response.status} ${response.statusText}`);
        return data;
    }

    const get = (url) => request('GET', url);
    const post = (url, body) => request('POST', url, body);
    const put = (url, body) => request('PUT', url, body);
    const del = (url) => request('DELETE', url);

    async function upload(method, url, meta, files = []) {
        const form = new FormData();
        form.append('meta', JSON.stringify(meta));
        for (const [name, blob] of files) if (blob) form.append(name, blob, name.split('/').pop());
        return request(method, url, form);
    }

    const lower = (s) => String(s || '').toLowerCase();
    const notFound = (name) => new DOMException(`${name} was not found`, 'NotFoundError');
    const fileCache = new Map();

    function remoteFile(name, url) {
        return {
            kind: 'file',
            name,
            async getFile() {
                if (!fileCache.has(url)) {
                    fileCache.set(url, fetch(url).then(async (r) => {
                        if (!r.ok) throw notFound(name);
                        const blob = await r.blob();
                        return new File([blob], name, { type: blob.type || (name.endsWith('.png') ? 'image/png' : 'application/octet-stream') });
                    }).catch((e) => {
                        fileCache.delete(url);
                        throw e;
                    }));
                }
                return fileCache.get(url);
            },
        };
    }

    function framesFolder(name, urls) {
        const files = urls.map((url, i) => [`frame_${String(i).padStart(3, '0')}.png`, remoteFile(`frame_${String(i).padStart(3, '0')}.png`, url)]);
        return {
            kind: 'directory',
            name,
            async getFileHandle(file) {
                const hit = files.find(([n]) => lower(n) === lower(file));
                if (!hit) throw notFound(file);
                return hit[1];
            },
            async getDirectoryHandle(dir) { throw notFound(dir); },
            async *entries() { for (const entry of files) yield entry; },
            async *values() { for (const [, handle] of files) yield handle; },
            async *keys() { for (const [n] of files) yield n; },
        };
    }

    function folder(doc, name = doc && doc.id) {
        const files = Object.entries((doc && doc.files) || {});
        const folders = Object.entries((doc && doc.folders) || {});
        const find = (list, n) => list.find(([k]) => lower(k) === lower(n));
        return {
            kind: 'directory',
            name: name || 'remote',
            remote: true,
            doc,
            async getFileHandle(n) {
                const hit = find(files, n);
                if (!hit) throw notFound(n);
                return remoteFile(hit[0], hit[1]);
            },
            async getDirectoryHandle(n) {
                const hit = find(folders, n);
                if (!hit) throw notFound(n);
                return framesFolder(hit[0], hit[1]);
            },
            async *entries() {
                for (const [n, url] of files) yield [n, remoteFile(n, url)];
                for (const [n, urls] of folders) yield [n, framesFolder(n, urls)];
            },
            async *values() { for await (const [, h] of this.entries()) yield h; },
            async *keys() { for await (const [n] of this.entries()) yield n; },
        };
    }

    const listeners = { job: new Set(), changed: new Set(), ready: new Set(), hello: new Set(), offline: new Set(), online: new Set() };
    let source = null;
    let wasOffline = false;

    function connect() {
        source = new EventSource('/api/events');
        for (const kind of ['job', 'changed', 'ready', 'hello']) {
            source.addEventListener(kind, (e) => {
                let data = null;
                try { data = JSON.parse(e.data); } catch { }
                if (kind === 'hello' && wasOffline) {
                    wasOffline = false;
                    for (const fn of listeners.online) fn();
                }
                for (const fn of listeners[kind]) fn(data);
            });
        }
        source.onerror = () => {
            if (!wasOffline) {
                wasOffline = true;
                for (const fn of listeners.offline) fn();
            }
        };
    }

    function on(kind, fn) {
        if (!source) connect();
        listeners[kind].add(fn);
        return () => listeners[kind].delete(fn);
    }

    async function waitJob(id, onUpdate) {
        return new Promise((resolve) => {
            const off = on('job', (job) => {
                if (!job || job.id !== id) return;
                if (onUpdate) onUpdate(job);
                if (job.status === 'done' || job.status === 'failed') {
                    off();
                    resolve(job);
                }
            });
            get(`/api/jobs/${id}`).then((job) => {
                if (job && (job.status === 'done' || job.status === 'failed')) {
                    off();
                    resolve(job);
                }
            }).catch(() => { });
        });
    }

    function forget(urls) {
        for (const url of urls || []) fileCache.delete(url);
    }

    window.DaApi = { request, get, post, put, del, upload, folder, on, waitJob, forget };
})();
