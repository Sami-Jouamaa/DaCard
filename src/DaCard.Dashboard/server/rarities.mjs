export const DEFAULT_RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

export const FOIL_TYPES = [
    { id: 'foil', name: 'Rainbow' },
    { id: 'linear', name: 'Linear' },
    { id: 'radial', name: 'Radial' },
    { id: 'sparkle', name: 'Sparkle' },
    { id: 'galaxy', name: 'Galaxy' },
    { id: 'diamond', name: 'Diamond' },
    { id: 'squares', name: 'Squares' },
    { id: 'circles', name: 'Circles' },
    { id: 'surge', name: 'Surge' },
    { id: 'ripple', name: 'Ripple' },
    { id: 'speckle', name: 'Speckle' },
    { id: 'crackle', name: 'Crackle' },
];

export const DEFAULT_FOIL_TYPES = ['foil'];
export const DEFAULT_FOIL_CHANCE = 10;
export const MAX_RARITIES = 12;

const NAME = /^[\p{L}\p{N}][\p{L}\p{N} _'.-]{0,23}$/u;
const COLOR = /^#[0-9a-f]{6}$/i;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

export function defaultRarityList(config) {
    const settings = config?.rarities && typeof config.rarities === 'object' ? config.rarities : {};
    const find = (name) => Object.entries(settings).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1] || {};
    return DEFAULT_RARITIES.map((name) => {
        const r = find(name);
        return {
            name,
            color: COLOR.test(r.color || '') ? r.color.toUpperCase() : '#FFFFFF',
            price: finite(r.price) && r.price > 0 ? r.price : 1000,
            weight: finite(r.weight) && r.weight >= 0 ? r.weight : 0,
        };
    });
}

export function cleanRarities(value) {
    if (value == null) return { list: null };
    if (!Array.isArray(value)) return { error: 'Rarities need to be a list' };
    if (!value.length) return { list: null };
    if (value.length > MAX_RARITIES) return { error: `A collection can have up to ${MAX_RARITIES} rarities` };
    const list = [];
    const seen = new Set();
    for (const r of value) {
        const name = typeof r?.name === 'string' ? r.name.trim() : '';
        if (!NAME.test(name)) return { error: `"${name}" can't be a rarity name (letters, numbers, spaces, up to 24)` };
        if (seen.has(name.toLowerCase())) return { error: `Two rarities are called "${name}"` };
        seen.add(name.toLowerCase());
        if (!COLOR.test(r.color || '')) return { error: `${name}: the colour needs to be #RRGGBB` };
        if (!finite(r.price) || r.price < 0) return { error: `${name}: the price needs to be 0 or more` };
        if (!finite(r.weight) || r.weight < 0) return { error: `${name}: the chance needs to be 0 or more` };
        list.push({ name, color: r.color.toUpperCase(), price: Math.round(r.price), weight: Math.round(r.weight * 1000) / 1000 });
    }
    if (!list.some((r) => r.weight > 0)) return { error: 'At least one rarity needs a chance above 0' };
    return { list };
}

export function cleanFoilTypes(value) {
    if (!Array.isArray(value)) return null;
    const ids = [...new Set(value.map((v) => String(v).toLowerCase()))].filter((v) => FOIL_TYPES.some((t) => t.id === v));
    return ids.length ? ids : null;
}

export const isFoilType = (value) => FOIL_TYPES.some((t) => t.id === value);

export function cleanChance(value) {
    return finite(value) ? Math.min(100, Math.max(0, Math.round(value * 1000) / 1000)) : null;
}

export function raritiesOfRow(row, config) {
    let custom = null;
    try {
        custom = row?.rarities ? JSON.parse(row.rarities) : null;
    } catch { }
    const cleaned = cleanRarities(custom);
    return cleaned.list || defaultRarityList(config);
}

export function rarityIn(list, value) {
    const v = String(value ?? '').trim().toLowerCase();
    return list.find((r) => r.name.toLowerCase() === v)?.name || null;
}
