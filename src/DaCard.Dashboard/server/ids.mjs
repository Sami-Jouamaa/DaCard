import { createHash, randomBytes } from 'node:crypto';

const SALT = 'DaCard:';

export function idFor(key) {
    return createHash('sha256').update(SALT + String(key).toLowerCase(), 'utf8').digest('hex').slice(0, 24);
}

export function hex(bytes) {
    return randomBytes(bytes).toString('hex');
}

export const newKey = (prefix) => `${prefix}_${hex(6)}`;

export const newImageId = () => hex(6);

export const cardIds = (idKey) => ({ id: idFor(idKey), foilId: idFor('foil:' + idKey) });

export const binderId = (idKey) => idFor('binder:' + idKey);

export const isMongoId = (value) => typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value);

export const cardLayerKey = (layerId) => 'card:' + layerId;

export const collectionLayerKey = (collectionIdKey, layerId) => `coll:${collectionIdKey}:${layerId}`;
