import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { resolveModDir, layout, dashboardDir } from './paths.mjs';
import { openDatabase, fromJson, getSetting, setSetting, transaction, recordMigration } from './db.mjs';
import { createImageStore } from './images.mjs';
import { createJobs } from './jobs.mjs';
import { runUpgrade, SETTING_KEYS, currentConfig, legacyState } from './upgrade.mjs';
import {
    DocumentError, cardDocument, collectionDocument, packDocument, skinDocument, saveCard, duplicateCard, deleteCard, saveCollection, deleteCollection,
    savePack, deletePack, saveSkin, deleteSkin, moveCard, setCardThumb, setCollectionThumb,
} from './documents.mjs';
import { exportCollection, importZip, inspectZip } from './exchange.mjs';
import { hex } from './ids.mjs';
import { THUMB_VERSION } from './schema.mjs';

export const VERSION = '2.0.1';

const args = process.argv.slice(2);
const option = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};

function readSettings() {
    try {
        return JSON.parse(fs.readFileSync(path.join(dashboardDir, 'settings.json'), 'utf8'));
    } catch {
        return {};
    }
}

const settings = readSettings();
const port = Number(option('--port') || process.env.DACARD_PORT || settings.port || 6967);
const host = '127.0.0.1';
const modDir = resolveModDir(option('--mod'));
const paths = layout(modDir);
const webDir = path.join(dashboardDir, 'web');
const jobs = createJobs();

let db = null;
let store = null;
let readyError = null;
let resolveReady;
const ready = new Promise((resolve) => { resolveReady = resolve; });

const MIME = {
    '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2', '.zip': 'application/zip',
    '.ico': 'image/x-icon', '.webp': 'image/webp', '.gif': 'image/gif',
};

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function send(res, status, body, type = 'application/json') {
    const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(data);
}

async function sendFile(res, file, { cache = false } = {}) {
    let stat;
    try {
        stat = await fs.promises.stat(file);
    } catch {
        throw new HttpError(404, 'Not found');
    }
    if (!stat.isFile()) throw new HttpError(404, 'Not found');
    res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': cache ? 'private, max-age=31536000, immutable' : 'no-cache',
    });
    await pipeline(fs.createReadStream(file), res);
}

async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        throw new HttpError(400, 'The request is not valid JSON');
    }
}

async function readForm(req) {
    const request = new Request(`http://${host}/`, { method: req.method, headers: req.headers, body: Readable.toWeb(req), duplex: 'half' });
    const form = await request.formData();
    let meta = {};
    const uploads = new Map();
    for (const [name, value] of form.entries()) {
        if (name === 'meta') {
            meta = JSON.parse(typeof value === 'string' ? value : await value.text());
            continue;
        }
        if (typeof value === 'string') continue;
        uploads.set(name, Buffer.from(await value.arrayBuffer()));
    }
    return { meta, uploads };
}

async function saveBodyToFile(req, prefix) {
    await fs.promises.mkdir(paths.tempDir, { recursive: true });
    const file = path.join(paths.tempDir, `${prefix}-${hex(6)}.zip`);
    await pipeline(req, fs.createWriteStream(file));
    return file;
}

function thumbUrl(scope, id) {
    const file = store.thumbPath(scope, id);
    try {
        return `/files/${scope}/thumbs/${id}.png?v=${Math.round(fs.statSync(file).mtimeMs)}`;
    } catch {
        return null;
    }
}

function overview() {
    const animated = new Set(db.prepare(`SELECT l.owner_id AS id FROM layers l JOIN images i ON i.set_id = l.id WHERE l.owner_kind = 'card' AND i.frames > 1
        UNION SELECT set_id FROM images WHERE frames > 1`).all().map((r) => r.id));
    const counts = Object.fromEntries(db.prepare('SELECT collection_id, COUNT(*) AS n FROM cards GROUP BY collection_id').all().map((r) => [r.collection_id, r.n]));
    const collections = db.prepare('SELECT * FROM collections ORDER BY sort, name').all().map((c) => ({
        id: c.id, name: c.name, shortName: c.short_name, description: c.description, idKey: c.id_key, cards: counts[c.id] || 0,
        thumb: thumbUrl(`collections/${c.id}`, c.id),
    }));
    const cards = db.prepare('SELECT id, collection_id, rarity, type, name, short_name, thumb_version, updated_at FROM cards ORDER BY sort').all().map((c) => ({
        id: c.id, collectionId: c.collection_id, rarity: c.rarity, type: c.type, name: c.name, shortName: c.short_name, animated: animated.has(c.id),
        thumbStale: c.thumb_version < THUMB_VERSION,
        thumb: thumbUrl(`collections/${c.collection_id}`, c.id),
    }));
    const packs = db.prepare('SELECT * FROM packs ORDER BY sort, name').all().map((p) => ({
        id: p.id, collectionId: p.collection_id, name: p.name, look: p.look, skin: p.skin_id, cardCount: p.card_count, price: p.price,
        purchasable: !!p.purchasable, lootPercent: p.loot_percent, allCollections: !!p.all_collections, rarities: fromJson(p.rarities),
        thumb: thumbUrl(p.collection_id ? `collections/${p.collection_id}` : `packs/${p.id}`, p.id),
    }));
    const skins = db.prepare('SELECT * FROM skins ORDER BY builtin DESC, sort, name').all().map((s) => ({
        id: s.id, name: s.name, builtin: !!s.builtin, design: fromJson(s.design), thumb: thumbUrl(`skins/${s.id}`, s.id),
        albedo: db.prepare("SELECT updated_at FROM images WHERE set_id = ? AND channel = 'albedo'").get(s.id) ? `/files/skins/${s.id}/${s.id}_albedo.png` : null,
    }));
    const migrations = db.prepare('SELECT * FROM migrations WHERE seen = 0 ORDER BY id').all().map((m) => ({ ...m, details: fromJson(m.details) }));
    return { version: VERSION, settings: currentConfig(db, paths), collections, cards, packs, skins, migrations, legacy: legacyState(paths).old };
}

const changed = () => jobs.events.emit('changed');

function routes() {
    const table = [];
    const on = (method, pattern, handler, { wait = true } = {}) => table.push({ method, pattern, handler, wait });

    on('GET', /^\/api\/ping$/, () => ({ app: 'dacard', version: VERSION, ready: !!db }), { wait: false });
    on('GET', /^\/api\/jobs$/, () => jobs.list(), { wait: false });
    on('GET', /^\/api\/jobs\/([a-f0-9]+)$/, (_, [id]) => jobs.get(id) || Promise.reject(new HttpError(404, 'No such job')), { wait: false });
    on('GET', /^\/api\/overview$/, () => overview());
    on('GET', /^\/api\/settings$/, () => currentConfig(db, paths));
    on('PUT', /^\/api\/settings$/, async (req) => {
        const body = await readJsonBody(req);
        return jobs.serial(() => {
            transaction(db, () => {
                for (const key of SETTING_KEYS) if (body[key] !== undefined) setSetting(db, key, body[key]);
            });
            changed();
            return currentConfig(db, paths);
        });
    });
    on('POST', /^\/api\/migrations\/seen$/, () => {
        db.prepare('UPDATE migrations SET seen = 1 WHERE seen = 0').run();
        return { ok: true };
    });

    const documentRoutes = (kind, read, save, remove) => {
        on('GET', new RegExp(`^/api/${kind}/([A-Za-z0-9_-]+)$`), (_, [id]) => read(db, store, id));
        on('POST', new RegExp(`^/api/${kind}$`), async (req) => {
            const { meta, uploads } = await readForm(req);
            return jobs.serial(async () => {
                const result = await save({ ...meta, db, store, paths, id: null, uploads });
                changed();
                return result;
            });
        });
        on('PUT', new RegExp(`^/api/${kind}/([A-Za-z0-9_-]+)$`), async (req, [id]) => {
                const { meta, uploads } = await readForm(req);
                return jobs.serial(async () => {
                    const result = await save({ ...meta, db, store, paths, id, uploads });
                    changed();
                    return result;
                });
            });
        on('DELETE', new RegExp(`^/api/${kind}/([A-Za-z0-9_-]+)$`), (_, [id]) => jobs.serial(async () => {
            await remove({ db, store, id });
            changed();
            return { ok: true };
        }));
    };
    documentRoutes('cards', cardDocument, saveCard, deleteCard);
    documentRoutes('collections', collectionDocument, saveCollection, deleteCollection);
    documentRoutes('packs', packDocument, savePack, deletePack);
    documentRoutes('skins', skinDocument, saveSkin, deleteSkin);
    on('POST', /^\/api\/cards\/([a-f0-9]+)\/duplicate$/, (_, [id]) => jobs.serial(async () => {
        const result = await duplicateCard({ db, store, paths, id });
        changed();
        return result;
    }));

    on('POST', /^\/api\/cards\/([a-f0-9]+)\/move$/, async (req, [id]) => {
        const body = await readJsonBody(req);
        return jobs.serial(async () => {
            const result = await moveCard({ db, store, paths, id, collectionId: body.collectionId, rarity: body.rarity });
            changed();
            return result;
        });
    });
    on('PUT', /^\/api\/cards\/([a-f0-9]+)\/thumb$/, async (req, [id]) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        await setCardThumb({ db, store, id, data: Buffer.concat(chunks) });
        return { ok: true };
    });
    on('PUT', /^\/api\/collections\/([A-Za-z0-9_-]+)\/thumb$/, async (req, [id]) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        await setCollectionThumb({ db, store, id, data: Buffer.concat(chunks) });
        changed();
        return { ok: true };
    });
    on('DELETE', /^\/api\/collections\/([A-Za-z0-9_-]+)\/thumb$/, async (_, [id]) => {
        await setCollectionThumb({ db, store, id, data: null });
        changed();
        return { ok: true };
    });
    on('POST', /^\/api\/collections\/([a-f0-9]+)\/export$/, (_, [id]) => {
        const name = db.prepare('SELECT name FROM collections WHERE id = ?').get(id)?.name;
        if (!name) throw new HttpError(404, 'No such collection');
        return jobs.start('export', `Exporting ${name}`, (job) => exportCollection({ db, store, paths, id, version: VERSION, onProgress: job.progress }));
    });
    on('POST', /^\/api\/import\/inspect$/, async (req) => {
        const file = await saveBodyToFile(req, 'inspect');
        try {
            const info = await inspectZip(file);
            const installed = info.kind === 'collection' ? db.prepare('SELECT name FROM collections WHERE id = ?').get(info.manifest.collection.id) : null;
            return { kind: info.kind, name: info.name ?? null, cards: info.cards ?? null, installed: installed?.name ?? null, upload: path.basename(file) };
        } catch (e) {
            await fs.promises.rm(file, { force: true });
            throw e;
        }
    });
    on('POST', /^\/api\/import$/, async (req, _, url) => {
        const upload = url.searchParams.get('upload');
        const file = upload && /^inspect-[a-f0-9]+\.zip$/.test(upload) ? path.join(paths.tempDir, upload) : await saveBodyToFile(req, 'import');
        if (!fs.existsSync(file)) throw new HttpError(404, 'The upload is gone; pick the file again');
        const replace = url.searchParams.get('replace') === '1';
        const title = url.searchParams.get('name') ? `Importing ${url.searchParams.get('name')}` : 'Importing a collection';
        return jobs.start('import', title, async (job) => {
            try {
                const result = await importZip({ db, store, paths, file, replace, onProgress: job.progress, onLog: (line) => job.message(line) });
                changed();
                return result;
            } finally {
                await fs.promises.rm(file, { force: true }).catch(() => { });
            }
        });
    });
    on('GET', /^\/api\/downloads\/([A-Za-z0-9_.-]+)$/, async (req, [file], url, res) => {
        const full = path.join(paths.exportsDir, file);
        const name = file.replace(/^[a-f0-9]+-/, '');
        let stat;
        try {
            stat = await fs.promises.stat(full);
        } catch {
            throw new HttpError(404, 'The export is gone; export it again');
        }
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': stat.size, 'Content-Disposition': `attachment; filename="${name}"` });
        await pipeline(fs.createReadStream(full), res);
        return undefined;
    });
    return table;
}

const table = routes();

function events(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const write = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    write('hello', { version: VERSION, jobs: jobs.list(), ready: !!db, error: readyError });
    const onJob = (job) => write('job', job);
    const onChanged = () => write('changed', {});
    const onReady = (state) => write('ready', state);
    jobs.events.on('job', onJob);
    jobs.events.on('changed', onChanged);
    jobs.events.on('ready', onReady);
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
        clearInterval(keepAlive);
        jobs.events.off('job', onJob);
        jobs.events.off('changed', onChanged);
        jobs.events.off('ready', onReady);
    });
}

async function serveFiles(res, pathname) {
    const parts = pathname.split('/').slice(2).map(decodeURIComponent);
    if (parts.length < 3 || !['collections', 'skins', 'packs'].includes(parts[0]) || parts.some((p) => !/^[A-Za-z0-9_.-]+$/.test(p) || p === '..'))
        throw new HttpError(404, 'Not found');
    await sendFile(res, path.join(paths.dataDir, ...parts), { cache: false });
}

async function serveWeb(res, pathname) {
    const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const full = path.resolve(webDir, relative);
    if (!full.startsWith(path.resolve(webDir) + path.sep)) throw new HttpError(404, 'Not found');
    await sendFile(res, full);
}

async function handle(req, res) {
    const url = new URL(req.url, `http://${host}:${port}`);
    const { pathname } = url;
    if (req.headers.host && !/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(req.headers.host)) throw new HttpError(403, 'Forbidden');
    if (pathname === '/api/events') return events(req, res);
    if (pathname === '/traders/geek.png') return sendFile(res, path.join(modDir, 'traders', 'geek.png'), { cache: true });
    if (pathname.startsWith('/files/')) {
        await ready;
        return serveFiles(res, pathname);
    }
    if (pathname.startsWith('/api/')) {
        for (const route of table) {
            if (route.method !== req.method) continue;
            const match = route.pattern.exec(pathname);
            if (!match) continue;
            if (route.wait) {
                await ready;
                if (!db) throw new HttpError(503, readyError || 'The database is not ready');
            }
            const result = await route.handler(req, match.slice(1), url, res);
            if (result !== undefined) send(res, 200, result);
            return;
        }
        throw new HttpError(404, 'Unknown request');
    }
    if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
    return serveWeb(res, pathname);
}

const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
        const status = e instanceof HttpError || e instanceof DocumentError ? e.status : 500;
        if (status === 500) console.error(e);
        if (!res.headersSent) send(res, status, { error: e.message || 'Something went wrong' });
        else res.end();
    });
});

function link(url) {
    if (!process.stdout.isTTY) return url;
    const esc = String.fromCharCode(27);
    const end = esc + String.fromCharCode(92);
    return `${esc}]8;;${url}${end}${esc}[94m${url}${esc}[39m${esc}]8;;${end}`;
}

function openBrowser(url) {
    const command = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    try {
        spawn(command[0], command[1], { detached: true, stdio: 'ignore' }).unref();
    } catch { }
}

async function alreadyRunning() {
    try {
        const response = await fetch(`http://${host}:${port}/api/ping`, { signal: AbortSignal.timeout(2000) });
        const body = await response.json();
        return body?.app === 'dacard';
    } catch {
        return false;
    }
}

function startUpgrade() {
    const job = jobs.start('upgrade', 'Checking the data', async (ctx) => {
        const summary = await runUpgrade({
            modDir, by: 'dashboard',
            onProgress: ({ done, total, message }) => ctx.progress(done, total, message),
            onLog: (line) => ctx.message(line),
        });
        return summary;
    });
    const watch = (state) => {
        if (state.id !== job.id || (state.status !== 'done' && state.status !== 'failed')) return;
        jobs.events.off('job', watch);
        if (state.status === 'failed') {
            readyError = `Could not update the data: ${state.error}`;
            console.error(readyError);
        } else {
            db = openDatabase(paths.dbFile);
            store = createImageStore(db, paths.dataDir);
            if (state.result?.legacy) console.log(`Moved ${state.result.legacy.cards} card(s) from the old addon folders into the database.`);
        }
        jobs.events.emit('ready', { ready: !!db, error: readyError });
        resolveReady();
    };
    jobs.events.on('job', watch);
}

server.on('error', async (e) => {
    if (e.code === 'EADDRINUSE') {
        if (await alreadyRunning()) {
            console.log(`The DaCard dashboard is already running: ${link(`http://${host}:${port}/`)}`);
            if (args.includes('--open')) openBrowser(`http://${host}:${port}/`);
            process.exit(0);
        }
        console.error(`Port ${port} is used by another program. Set another "port" in ${path.join(dashboardDir, 'settings.json')}.`);
        process.exit(1);
    }
    console.error(e);
    process.exit(1);
});

server.listen(port, host, () => {
    const url = `http://${host}:${port}/`;
    console.log(`DaCard dashboard ${VERSION}: ${link(url)}`);
    console.log(`Mod folder: ${modDir}`);
    startUpgrade();
    if (args.includes('--open')) openBrowser(url);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    try { db?.close(); } catch { }
    process.exit(0);
});
