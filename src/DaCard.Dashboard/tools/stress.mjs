import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { openDatabase, transaction, upgradeSchema } from '../server/db.mjs';
import { layout } from '../server/paths.mjs';
import { createImageStore } from '../server/images.mjs';
import { idFor, binderId, cardIds, newImageId } from '../server/ids.mjs';
import { collectionScope } from '../server/paths.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
};
const modDir = path.resolve(option('--mod', '.'));
const collections = Number(option('--collections', 20));
const perCollection = Number(option('--cards', 1000));
const chanceShare = Number(option('--chance-share', 0.2));
const RARITIES = [['Common', 0.5], ['Uncommon', 0.25], ['Rare', 0.15], ['Epic', 0.07], ['Legendary', 0.03]];

const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};
function png(width, height, [r, g, b]) {
    const chunk = (type, data) => {
        const head = Buffer.alloc(8);
        head.writeUInt32BE(data.length, 0);
        head.write(type, 4, 'ascii');
        const tail = Buffer.alloc(4);
        tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
        return Buffer.concat([head, data, tail]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr.set([8, 6, 0, 0, 0], 8);
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x++) row.set([r, g, b, 255], 1 + x * 4);
    const raw = Buffer.concat(Array.from({ length: height }, () => row));
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const rarityAt = (i) => {
    const x = (i * 0.6180339887) % 1;
    let acc = 0;
    for (const [name, share] of RARITIES) if (x < (acc += share)) return name;
    return 'Common';
};

const paths = layout(modDir);
if (!fs.existsSync(paths.dbFile)) throw new Error(`No database at ${paths.dbFile}`);
const db = openDatabase(paths.dbFile);
upgradeSchema(db, { dataDir: paths.dataDir });
const store = createImageStore(db, paths.dataDir);
const art = png(63, 88, [90, 120, 160]);
const sticker = png(32, 32, [220, 170, 40]);
const started = Date.now();
const time = Date.now();
let cards = 0;

for (let c = 0; c < collections; c++) {
    const idKey = `stress_${c}_${newImageId()}`;
    const collId = binderId(idKey);
    const scope = collectionScope(collId);
    const files = [];
    transaction(db, () => {
        db.prepare(`INSERT INTO collections (id, id_key, name, short_name, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(collId, idKey, `Stress ${c + 1}`, `S${c + 1}`, 1000 + c, time, time);
        const card = db.prepare(`INSERT INTO cards (id, foil_id, id_key, collection_id, rarity, type, name, sort, thumb_version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, '2d', ?, ?, 1, ?, ?)`);
        const layer = db.prepare(`INSERT INTO layers (id, owner_kind, owner_id, face, position, key, name, chance, can_be_foil, over, price, price_percent)
            VALUES (?, 'card', ?, 'front', ?, ?, ?, ?, 1, 0, ?, 0)`);
        for (let i = 0; i < perCollection; i++) {
            const cardKey = `${idKey}_card_${i}`;
            const { id, foilId } = cardIds(cardKey);
            card.run(id, foilId, cardKey, collId, rarityAt(c * perCollection + i), `Stress card ${c + 1}-${i + 1}`, i, time, time);
            const picture = newImageId();
            layer.run(picture, id, 0, `card:${picture}`, null, 100, 0);
            files.push([picture, art]);
            if ((i * 0.381966) % 1 < chanceShare) {
                const extra = newImageId();
                layer.run(extra, id, 1, `card:${extra}`, 'Sticker', 15, 2500);
                files.push([extra, sticker]);
            }
            cards++;
        }
        const packId = idFor(`stress-pack:${idKey}`);
        db.prepare(`INSERT INTO packs (id, collection_id, name, card_count, price, purchasable, loot_percent, look, sort, created_at, updated_at)
            VALUES (?, ?, ?, 5, 25000, 1, 0.5, 'preset', ?, ?, ?)`).run(packId, collId, `Stress ${c + 1} pack`, 1000 + c, time, time);
    });
    for (const [setId, data] of files) await store.putImage(scope, setId, 'albedo', data);
    process.stdout.write(`collection ${c + 1}/${collections}: ${perCollection} cards\n`);
}

db.close();
process.stdout.write(`Added ${collections} collection(s), ${cards} card(s) in ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
