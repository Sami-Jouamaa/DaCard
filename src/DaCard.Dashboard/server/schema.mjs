import { retireFoilLayersAndBindPacks } from './migrate5.mjs';

export const SCHEMA = [
    {
        version: 1,
        title: 'Database created',
        sql: `
CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE collections (
    id TEXT PRIMARY KEY,
    id_key TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    short_name TEXT,
    description TEXT,
    locales TEXT,
    card_text TEXT,
    legacy_folder TEXT COLLATE NOCASE,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    foil_id TEXT NOT NULL UNIQUE,
    id_key TEXT NOT NULL UNIQUE COLLATE NOCASE,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    rarity TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT '2d',
    name TEXT NOT NULL,
    short_name TEXT,
    description TEXT,
    locales TEXT,
    holo TEXT,
    glow TEXT,
    floats TEXT,
    animation TEXT,
    text_align TEXT,
    collection_layers INTEGER NOT NULL DEFAULT 1,
    hidden_layers TEXT,
    legacy_key TEXT COLLATE NOCASE,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX cards_by_collection ON cards(collection_id, rarity);
CREATE INDEX cards_by_rarity ON cards(rarity);

CREATE TABLE layers (
    id TEXT PRIMARY KEY,
    owner_kind TEXT NOT NULL CHECK (owner_kind IN ('card', 'collection')),
    owner_id TEXT NOT NULL,
    face TEXT NOT NULL CHECK (face IN ('front', 'back', 'default-back')),
    position INTEGER NOT NULL,
    key TEXT NOT NULL,
    name TEXT,
    text_id TEXT,
    chance REAL NOT NULL DEFAULT 100,
    can_be_foil INTEGER NOT NULL DEFAULT 1,
    over INTEGER NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    transform TEXT,
    text TEXT,
    fps TEXT,
    speed REAL NOT NULL DEFAULT 12
);
CREATE INDEX layers_by_owner ON layers(owner_kind, owner_id, face, position);
CREATE UNIQUE INDEX layers_unique_key ON layers(owner_kind, owner_id, key);

CREATE TABLE images (
    set_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    scope TEXT NOT NULL,
    frames INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (set_id, channel)
);
CREATE INDEX images_by_scope ON images(scope);

CREATE TABLE binder_stickers (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    set_id TEXT NOT NULL,
    x REAL NOT NULL DEFAULT 0.5,
    y REAL NOT NULL DEFAULT 0.4,
    width REAL NOT NULL DEFAULT 0.6,
    height REAL NOT NULL DEFAULT 0.3,
    rotation REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (collection_id, position)
);

CREATE TABLE skins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    builtin INTEGER NOT NULL DEFAULT 0,
    design TEXT,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE packs (
    id TEXT PRIMARY KEY,
    collection_id TEXT REFERENCES collections(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    short_name TEXT,
    description TEXT,
    locales TEXT,
    all_collections INTEGER NOT NULL DEFAULT 0,
    rarities TEXT,
    card_count INTEGER NOT NULL DEFAULT 3,
    price REAL NOT NULL DEFAULT 25000,
    purchasable INTEGER NOT NULL DEFAULT 1,
    loot_percent REAL NOT NULL DEFAULT 0,
    background TEXT,
    look TEXT NOT NULL DEFAULT 'preset',
    skin_id TEXT REFERENCES skins(id) ON DELETE SET NULL,
    design TEXT,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX packs_by_collection ON packs(collection_id);

CREATE TABLE pack_collections (
    pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    PRIMARY KEY (pack_id, collection_id)
);

CREATE TABLE pack_cards (
    pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    PRIMARY KEY (pack_id, card_id)
);

CREATE TABLE migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    migration TEXT NOT NULL,
    title TEXT NOT NULL,
    by TEXT NOT NULL,
    date TEXT NOT NULL,
    details TEXT,
    seen INTEGER NOT NULL DEFAULT 0
);
`,
    },
    {
        version: 2,
        title: 'Layer roughness and metallic values',
        sql: `
ALTER TABLE layers ADD COLUMN roughness REAL;
ALTER TABLE layers ADD COLUMN metallic REAL;
`,
    },
    {
        version: 3,
        title: 'Card previews show the card\'s chance layers',
        sql: `
ALTER TABLE cards ADD COLUMN thumb_version INTEGER NOT NULL DEFAULT 0;
UPDATE cards SET thumb_version = 1 WHERE NOT EXISTS (
    SELECT 1 FROM layers l WHERE l.owner_kind = 'card' AND l.owner_id = cards.id AND l.face = 'front' AND l.chance < 100
);
`,
    },
    {
        version: 4,
        title: "Layer prices: a share of the card's price",
        sql: `
ALTER TABLE layers ADD COLUMN foil INTEGER NOT NULL DEFAULT 0;
ALTER TABLE layers ADD COLUMN price_percent REAL NOT NULL DEFAULT 0;
`,
    },
    {
        version: 5,
        title: 'Custom rarities, foil types and one collection per booster pack',
        sql: `
ALTER TABLE collections ADD COLUMN rarities TEXT;
ALTER TABLE collections ADD COLUMN foil_chance REAL;
ALTER TABLE collections ADD COLUMN foil_types TEXT;
ALTER TABLE layers ADD COLUMN foil_chance REAL;
ALTER TABLE layers ADD COLUMN foil_type TEXT;
`,
        run: retireFoilLayersAndBindPacks,
    },
    {
        version: 6,
        title: 'Variant layers and foil masks',
        sql: `
ALTER TABLE layers ADD COLUMN kind TEXT;
ALTER TABLE layers ADD COLUMN parent_id TEXT;
CREATE INDEX layers_by_parent ON layers(parent_id);
`,
    },
];

export const THUMB_VERSION = 1;

export const LATEST = SCHEMA[SCHEMA.length - 1].version;
