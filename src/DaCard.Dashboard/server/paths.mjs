import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const dashboardDir = path.resolve(here, '..');

export function resolveModDir(explicit) {
    const value = explicit || process.env.DACARD_MOD;
    return value ? path.resolve(value) : path.resolve(dashboardDir, '..');
}

export function layout(modDir) {
    const dataDir = path.join(modDir, 'data');
    return {
        modDir,
        dataDir,
        dbFile: path.join(dataDir, 'dacard.db'),
        legacyDir: path.join(dataDir, '_legacy'),
        tempDir: path.join(dataDir, '_temp'),
        exportsDir: path.join(dataDir, '_exports'),
        defaultsDir: path.join(modDir, 'defaults'),
        defaultConfig: path.join(modDir, 'defaults', 'config.json'),
        defaultSkinsDir: path.join(modDir, 'defaults', 'skins'),
    };
}

export const collectionScope = (id) => `collections/${id}`;
export const skinScope = (id) => `skins/${id}`;
export const packScope = (id) => `packs/${id}`;

export function scopeDir(dataDir, scope) {
    if (!/^(collections|skins|packs)\/[A-Za-z0-9_-]+$/.test(scope)) throw new Error(`Bad image scope "${scope}"`);
    return path.join(dataDir, ...scope.split('/'));
}

export const imageFile = (setId, channel) => `${setId}_${channel}.png`;
export const framesDir = (setId) => `${setId}_frames`;
export const frameFile = (index) => `${String(index + 1).padStart(4, '0')}.png`;
export const thumbFile = (ownerId) => path.join('thumbs', `${ownerId}.png`);
export const fontFile = (name) => path.join('fonts', name);

export const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;
