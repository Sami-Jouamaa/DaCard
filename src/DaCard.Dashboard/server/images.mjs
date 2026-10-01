import fs from 'node:fs';
import path from 'node:path';
import { scopeDir, imageFile, framesDir, frameFile, thumbFile, fontFile, SAFE_NAME } from './paths.mjs';
import { now } from './db.mjs';

export const LAYER_CHANNELS = ['albedo', 'normal', 'roughness', 'metallic', 'mask'];
export const CARD_CHANNELS = ['albedo', 'height', 'holo', 'foil', 'normal'];
export const PACK_CHANNELS = ['albedo', 'normal', 'metallic', 'roughness', 'ao'];

const CHANNEL = /^[a-z][a-z0-9]*$/;
const SET = /^[A-Za-z0-9_-]+$/;

function check(setId, channel) {
    if (!SET.test(setId)) throw new Error(`Bad image id "${setId}"`);
    if (channel !== undefined && !CHANNEL.test(channel)) throw new Error(`Bad image channel "${channel}"`);
}

async function write(file, data) {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    if (typeof data === 'string') await fs.promises.copyFile(data, file);
    else await fs.promises.writeFile(file, data);
}

export function createImageStore(db, dataDir) {
    const dirOf = (scope) => scopeDir(dataDir, scope);
    const upsert = db.prepare(`INSERT INTO images (set_id, channel, scope, frames, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(set_id, channel) DO UPDATE SET scope = excluded.scope, frames = excluded.frames, updated_at = excluded.updated_at`);
    const removeRow = db.prepare('DELETE FROM images WHERE set_id = ? AND channel = ?');
    const rowsOf = db.prepare('SELECT * FROM images WHERE set_id = ?');

    const store = {
        dirOf,

        imagePath: (scope, setId, channel) => path.join(dirOf(scope), imageFile(setId, channel)),

        framePath: (scope, setId, channel, index) => path.join(dirOf(scope), framesDir(setId), channel, frameFile(index)),

        thumbPath: (scope, ownerId) => path.join(dirOf(scope), thumbFile(ownerId)),

        fontPath: (scope, name) => {
            if (!SAFE_NAME.test(name)) throw new Error(`Bad font file name "${name}"`);
            return path.join(dirOf(scope), fontFile(name));
        },

        channels: (setId) => rowsOf.all(setId),

        async putImage(scope, setId, channel, data) {
            check(setId, channel);
            await write(store.imagePath(scope, setId, channel), data);
            const current = db.prepare('SELECT frames FROM images WHERE set_id = ? AND channel = ?').get(setId, channel);
            upsert.run(setId, channel, scope, current ? current.frames : 0, now());
        },

        async putFrames(scope, setId, channel, frames) {
            check(setId, channel);
            const dir = path.join(dirOf(scope), framesDir(setId), channel);
            await fs.promises.rm(dir, { recursive: true, force: true });
            for (let i = 0; i < frames.length; i++) await write(path.join(dir, frameFile(i)), frames[i]);
            if (!fs.existsSync(store.imagePath(scope, setId, channel)) && frames.length) await write(store.imagePath(scope, setId, channel), frames[0]);
            upsert.run(setId, channel, scope, frames.length > 1 ? frames.length : 0, now());
        },

        async removeChannel(scope, setId, channel) {
            check(setId, channel);
            await fs.promises.rm(store.imagePath(scope, setId, channel), { force: true });
            await fs.promises.rm(path.join(dirOf(scope), framesDir(setId), channel), { recursive: true, force: true });
            removeRow.run(setId, channel);
        },

        async removeSet(setId) {
            check(setId);
            for (const row of rowsOf.all(setId)) {
                await fs.promises.rm(store.imagePath(row.scope, setId, row.channel), { force: true });
                await fs.promises.rm(path.join(dirOf(row.scope), framesDir(setId)), { recursive: true, force: true });
            }
            db.prepare('DELETE FROM images WHERE set_id = ?').run(setId);
        },

        async putThumb(scope, ownerId, data) {
            check(ownerId);
            await write(store.thumbPath(scope, ownerId), data);
        },

        async removeThumb(scope, ownerId) {
            await fs.promises.rm(store.thumbPath(scope, ownerId), { force: true });
        },

        async putFont(scope, name, data) {
            await write(store.fontPath(scope, name), data);
        },

        async removeScope(scope) {
            await fs.promises.rm(dirOf(scope), { recursive: true, force: true });
            db.prepare('DELETE FROM images WHERE scope = ?').run(scope);
        },
    };
    return store;
}
