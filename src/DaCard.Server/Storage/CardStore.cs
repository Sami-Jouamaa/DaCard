using System.Text.Json;
using Microsoft.Data.Sqlite;
using SPTarkov.DI.Annotations;
using Path = System.IO.Path;

namespace DaCard.Server.Storage;

public record CollectionRow(string Id, string IdKey, string Name, string? ShortName, string? Description, Dictionary<string, CardText>? Locales,
    CardTextSettings? CardText, long UpdatedAt);

public record CardRow(string Id, string FoilId, string IdKey, string CollectionId, string Rarity, string Type, string Name, string? ShortName,
    string? Description, Dictionary<string, CardText>? Locales, string? LegacyKey, long UpdatedAt);

public record CardDetails(CardRow Card, HoloSettings? Holo, GlowSettings? Glow, Dictionary<string, double>? Floats, AnimationInfo? Animation,
    Dictionary<string, string>? TextAlign, bool CollectionLayers, List<string> HiddenLayers);

public record LayerRow(string Id, string OwnerKind, string OwnerId, string Face, int Position, string Key, string? Name, string? TextId, double Chance,
    bool CanBeFoil, bool Over, double Price, LayerTransform? Transform, LayerText? Text, Dictionary<string, double>? Fps, double Speed,
    double? Roughness, double? Metallic)
{
    public bool IsCollection => OwnerKind == "collection";
}

public record ImageRow(string SetId, string Channel, string Scope, int Frames, long UpdatedAt);

public record StickerRow(string CollectionId, int Position, string SetId, StickerPlacement Placement);

public record PackRow(string Id, string? CollectionId, string Name, string? ShortName, string? Description, Dictionary<string, CardText>? Locales,
    bool AllCollections, List<string>? Rarities, int CardCount, double Price, bool Purchasable, double LootPercent, string? Background, string Look,
    string? SkinId);

public record PoolCard(string Id, string FoilId, string Rarity);

[Injectable(InjectionType.Singleton)]
public class CardStore(DaCardDatabase db)
{
    public static readonly string[] SettingKeys =
        ["rarities", "containers", "textures", "cardTypes", "backProperty", "overlayProperty", "binders", "geek", "foil", "packs", "retiredItems"];

    public DaCardConfig LoadConfig(string defaultsFile)
    {
        var merged = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
        if (File.Exists(defaultsFile))
        {
            using var defaults = JsonDocument.Parse(File.ReadAllText(defaultsFile));
            foreach (var property in defaults.RootElement.EnumerateObject())
                merged[property.Name] = property.Value.Clone();
        }
        foreach (var (key, value) in db.Query("SELECT key, value FROM settings", r => (r.GetString(0), r.GetString(1))))
        {
            using var parsed = JsonDocument.Parse(value);
            merged[key] = parsed.RootElement.Clone();
        }
        var json = JsonSerializer.Serialize(merged);
        var config = JsonSerializer.Deserialize<DaCardConfig>(json, DaCardDatabase.Json) ?? new DaCardConfig();
        config.Rarities = new Dictionary<string, RaritySettings>(config.Rarities, StringComparer.OrdinalIgnoreCase);
        return config;
    }

    private const string CollectionColumns = "id, id_key, name, short_name, description, locales, card_text, updated_at";

    private static CollectionRow ReadCollection(SqliteDataReader r) => new(r.GetString(0), r.GetString(1), r.GetString(2),
        DaCardDatabase.Text(r, "short_name"), DaCardDatabase.Text(r, "description"),
        DaCardDatabase.FromJson<Dictionary<string, CardText>>(r, "locales"), DaCardDatabase.FromJson<CardTextSettings>(r, "card_text"), r.GetInt64(7));

    public List<CollectionRow> Collections() => db.Query($"SELECT {CollectionColumns} FROM collections ORDER BY sort, name", ReadCollection);

    public CollectionRow? Collection(string id) => db.One($"SELECT {CollectionColumns} FROM collections WHERE id = $id", ReadCollection, ("$id", id));

    private const string CardColumns = "id, foil_id, id_key, collection_id, rarity, type, name, short_name, description, locales, legacy_key, updated_at";

    private static CardRow ReadCard(SqliteDataReader r) => new(r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4),
        r.GetString(5), r.GetString(6), DaCardDatabase.Text(r, "short_name"), DaCardDatabase.Text(r, "description"),
        DaCardDatabase.FromJson<Dictionary<string, CardText>>(r, "locales"), DaCardDatabase.Text(r, "legacy_key"), r.GetInt64(11));

    public List<CardRow> Cards() => db.Query($"SELECT {CardColumns} FROM cards ORDER BY sort, name", ReadCard);

    public CardDetails? Card(string tpl) => db.One(
        $"SELECT {CardColumns}, holo, glow, floats, animation, text_align, collection_layers, hidden_layers FROM cards WHERE id = $id OR foil_id = $id",
        r => new CardDetails(ReadCard(r), DaCardDatabase.FromJson<HoloSettings>(r, "holo"), DaCardDatabase.FromJson<GlowSettings>(r, "glow"),
            DaCardDatabase.FromJson<Dictionary<string, double>>(r, "floats"), DaCardDatabase.FromJson<AnimationInfo>(r, "animation"),
            DaCardDatabase.FromJson<Dictionary<string, string>>(r, "text_align"), DaCardDatabase.Flag(r, "collection_layers"),
            DaCardDatabase.FromJson<List<string>>(r, "hidden_layers") ?? []),
        ("$id", tpl));

    public Dictionary<string, (bool CollectionLayers, List<string> Hidden)> HiddenLayers() => db.Query(
            "SELECT id, collection_layers, hidden_layers FROM cards WHERE collection_layers = 0 OR hidden_layers IS NOT NULL",
            r => (r.GetString(0), (DaCardDatabase.Flag(r, "collection_layers"), DaCardDatabase.FromJson<List<string>>(r, "hidden_layers") ?? [])))
        .ToDictionary(p => p.Item1, p => p.Item2, StringComparer.OrdinalIgnoreCase);

    private const string LayerColumns = "id, owner_kind, owner_id, face, position, key, name, text_id, chance, can_be_foil, over, price, transform, text, fps, speed, roughness, metallic";

    private static LayerRow ReadLayer(SqliteDataReader r) => new(r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetInt32(4),
        r.GetString(5), DaCardDatabase.Text(r, "name"), DaCardDatabase.Text(r, "text_id"), DaCardDatabase.Number(r, "chance", 100),
        DaCardDatabase.Flag(r, "can_be_foil"), DaCardDatabase.Flag(r, "over"), DaCardDatabase.Number(r, "price"),
        DaCardDatabase.FromJson<LayerTransform>(r, "transform"), DaCardDatabase.FromJson<LayerText>(r, "text"),
        DaCardDatabase.FromJson<Dictionary<string, double>>(r, "fps"), DaCardDatabase.Number(r, "speed", 12),
        DaCardDatabase.Optional(r, "roughness"), DaCardDatabase.Optional(r, "metallic"));

    public List<LayerRow> AllLayers() => db.Query($"SELECT {LayerColumns} FROM layers ORDER BY owner_kind, owner_id, face, position", ReadLayer);

    public List<LayerRow> LayersOf(string cardId, string collectionId) => db.Query(
        $"SELECT {LayerColumns} FROM layers WHERE (owner_kind = 'card' AND owner_id = $card) OR (owner_kind = 'collection' AND owner_id = $coll) ORDER BY face, position",
        ReadLayer, ("$card", cardId), ("$coll", collectionId));

    public List<ImageRow> Images(IEnumerable<string> setIds)
    {
        var ids = setIds.Distinct().ToList();
        if (ids.Count == 0)
            return [];
        var names = ids.Select((_, i) => "$s" + i).ToList();
        return db.Query($"SELECT set_id, channel, scope, frames, updated_at FROM images WHERE set_id IN ({string.Join(", ", names)})",
            r => new ImageRow(r.GetString(0), r.GetString(1), r.GetString(2), r.GetInt32(3), r.GetInt64(4)),
            ids.Select((id, i) => (names[i], (object?)id)).ToArray());
    }

    public ImageRow? Image(string setId, string channel) => db.One(
        "SELECT set_id, channel, scope, frames, updated_at FROM images WHERE set_id = $s AND channel = $c",
        r => new ImageRow(r.GetString(0), r.GetString(1), r.GetString(2), r.GetInt32(3), r.GetInt64(4)), ("$s", setId), ("$c", channel));

    public List<StickerRow> BinderStickers() => db.Query(
        "SELECT collection_id, position, set_id, x, y, width, height, rotation FROM binder_stickers ORDER BY collection_id, position",
        r => new StickerRow(r.GetString(0), r.GetInt32(1), r.GetString(2), new StickerPlacement
        {
            X = r.GetDouble(3), Y = r.GetDouble(4), Width = r.GetDouble(5), Height = r.GetDouble(6), Rotation = r.GetDouble(7)
        }));

    public List<PackRow> Packs() => db.Query(
        "SELECT id, collection_id, name, short_name, description, locales, all_collections, rarities, card_count, price, purchasable, loot_percent, background, look, skin_id FROM packs ORDER BY sort, name",
        r => new PackRow(r.GetString(0), DaCardDatabase.Text(r, "collection_id"), r.GetString(2), DaCardDatabase.Text(r, "short_name"),
            DaCardDatabase.Text(r, "description"), DaCardDatabase.FromJson<Dictionary<string, CardText>>(r, "locales"), DaCardDatabase.Flag(r, "all_collections"),
            DaCardDatabase.FromJson<List<string>>(r, "rarities"), r.GetInt32(8), DaCardDatabase.Number(r, "price", 25000), DaCardDatabase.Flag(r, "purchasable"),
            DaCardDatabase.Number(r, "loot_percent"), DaCardDatabase.Text(r, "background"), DaCardDatabase.Text(r, "look") ?? "preset",
            DaCardDatabase.Text(r, "skin_id")));

    private const string PoolFilter = """
        (c.collection_id = $collection
            OR $all = 1
            OR c.collection_id IN (SELECT collection_id FROM pack_collections WHERE pack_id = $pack)
            OR c.id IN (SELECT card_id FROM pack_cards WHERE pack_id = $pack))
        AND ($rarities IS NULL OR c.rarity IN (SELECT value FROM json_each($rarities)))
        """;

    private static (string, object?)[] PoolParameters(PackRow pack) =>
    [
        ("$collection", pack.CollectionId),
        ("$all", pack.AllCollections ? 1 : 0),
        ("$pack", pack.Id),
        ("$rarities", pack.Rarities is { Count: > 0 } ? JsonSerializer.Serialize(pack.Rarities) : null)
    ];

    public Dictionary<string, int> PoolRarities(PackRow pack) => db.Query(
        $"SELECT c.rarity, COUNT(*) FROM cards c WHERE {PoolFilter} GROUP BY c.rarity",
        r => (r.GetString(0), r.GetInt32(1)), PoolParameters(pack)).ToDictionary(p => p.Item1, p => p.Item2, StringComparer.OrdinalIgnoreCase);

    public PoolCard? RandomPoolCard(PackRow pack, string rarity, IReadOnlyCollection<string> avoid)
    {
        var parameters = PoolParameters(pack).Append(("$rarity", (object?)rarity)).Append(("$avoid", (object?)JsonSerializer.Serialize(avoid))).ToArray();
        return db.One($"SELECT c.id, c.foil_id, c.rarity FROM cards c WHERE {PoolFilter} AND c.rarity = $rarity AND c.id NOT IN (SELECT value FROM json_each($avoid)) ORDER BY random() LIMIT 1",
                   r => new PoolCard(r.GetString(0), r.GetString(1), r.GetString(2)), parameters)
               ?? db.One($"SELECT c.id, c.foil_id, c.rarity FROM cards c WHERE {PoolFilter} AND c.rarity = $rarity ORDER BY random() LIMIT 1",
                   r => new PoolCard(r.GetString(0), r.GetString(1), r.GetString(2)), PoolParameters(pack).Append(("$rarity", (object?)rarity)).ToArray());
    }

    public Dictionary<string, int> RarityCounts() => db.Query("SELECT rarity, COUNT(*) FROM cards GROUP BY rarity", r => (r.GetString(0), r.GetInt32(1)))
        .ToDictionary(p => p.Item1, p => p.Item2, StringComparer.OrdinalIgnoreCase);

    public PoolCard? RandomCard(string rarity) => db.One(
        "SELECT id, foil_id, rarity FROM cards WHERE rarity = $rarity ORDER BY random() LIMIT 1",
        r => new PoolCard(r.GetString(0), r.GetString(1), r.GetString(2)), ("$rarity", rarity));

    public bool Exists(string kind, string tpl) => kind switch
    {
        ItemLedger.Card or ItemLedger.Foil => db.Scalar<long>("SELECT COUNT(*) FROM cards WHERE id = $t OR foil_id = $t", ("$t", tpl)) > 0,
        ItemLedger.Binder => db.Scalar<long>("SELECT COUNT(*) FROM collections WHERE id = $t", ("$t", tpl)) > 0,
        ItemLedger.Pack => db.Scalar<long>("SELECT COUNT(*) FROM packs WHERE id = $t", ("$t", tpl)) > 0,
        _ => true
    };

    public string ScopePath(string scope) => Path.Combine([db.DataDir, .. scope.Split('/')]);

    public static string ImageFile(string setId, string channel) => $"{setId}_{channel}.png";

    public static string FrameFile(string setId, string channel, int index) => Path.Combine($"{setId}_frames", channel, $"{index + 1:0000}.png");

    public string? FontPath(string scopeOwner, string file)
    {
        if (file.Contains('/') || file.Contains('\\') || file.Contains(".."))
            return null;
        foreach (var root in new[] { "collections", "packs", "skins" })
        {
            var path = Path.Combine(db.DataDir, root, scopeOwner, "fonts", file);
            if (File.Exists(path))
                return path;
        }
        return null;
    }
}
