using System.Text.Json;
using Microsoft.Data.Sqlite;
using SPTarkov.DI.Annotations;
using Path = System.IO.Path;

namespace DaCard.Server.Storage;

public record CollectionRow(string Id, string IdKey, string Name, string? ShortName, string? Description, Dictionary<string, CardText>? Locales,
    CardTextSettings? CardText, long UpdatedAt, List<RarityDefinition>? Rarities, double? FoilChance, List<string>? FoilTypes);

public record CardRow(string Id, string FoilId, string IdKey, string CollectionId, string Rarity, string Type, string Name, string? ShortName,
    string? Description, Dictionary<string, CardText>? Locales, string? LegacyKey, long UpdatedAt);

public record CardDetails(CardRow Card, GlowSettings? Glow, Dictionary<string, double>? Floats, AnimationInfo? Animation,
    Dictionary<string, string>? TextAlign, bool CollectionLayers, List<string> HiddenLayers);

public record LayerRow(string Id, string OwnerKind, string OwnerId, string Face, int Position, string Key, string? Name, string? TextId, double Chance,
    bool CanBeFoil, bool Over, double Price, LayerTransform? Transform, LayerText? Text, Dictionary<string, double>? Fps, double Speed,
    double? Roughness, double? Metallic, double PricePercent, double? FoilChance, string? FoilType, string? Kind, string? ParentId)
{
    public bool IsCollection => OwnerKind == "collection";
    public bool IsVariantLayer => Kind == "variant";
}

public record ImageRow(string SetId, string Channel, string Scope, int Frames, long UpdatedAt);

public record StickerRow(string CollectionId, int Position, string SetId, StickerPlacement Placement);

public record PackRow(string Id, string? CollectionId, string Name, string? ShortName, string? Description, Dictionary<string, CardText>? Locales,
    List<string>? Rarities, int CardCount, double Price, bool Purchasable, double LootPercent, string? Background, string Look,
    string? SkinId);

public record PoolCard(string Id, string Rarity);

[Injectable(InjectionType.Singleton)]
public class CardStore(DaCardDatabase db)
{
    public static readonly string[] SettingKeys =
        ["rarities", "loot", "containers", "textures", "cardTypes", "backProperty", "overlayProperty", "binders", "geek", "foil", "retiredItems"];

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

    private const string CollectionColumns = "id, id_key, name, short_name, description, locales, card_text, updated_at, rarities, foil_chance, foil_types";

    private static CollectionRow ReadCollection(SqliteDataReader r) => new(r.GetString(0), r.GetString(1), r.GetString(2),
        DaCardDatabase.Text(r, "short_name"), DaCardDatabase.Text(r, "description"),
        DaCardDatabase.FromJson<Dictionary<string, CardText>>(r, "locales"), DaCardDatabase.FromJson<CardTextSettings>(r, "card_text"), r.GetInt64(7),
        DaCardDatabase.FromJson<List<RarityDefinition>>(r, "rarities"), DaCardDatabase.NumberOrNull(r, "foil_chance"),
        DaCardDatabase.FromJson<List<string>>(r, "foil_types"));

    public List<CollectionRow> Collections() => db.Query($"SELECT {CollectionColumns} FROM collections ORDER BY sort, name", ReadCollection);

    public CollectionRow? Collection(string id) => db.One($"SELECT {CollectionColumns} FROM collections WHERE id = $id", ReadCollection, ("$id", id));

    private const string CardColumns = "id, foil_id, id_key, collection_id, rarity, type, name, short_name, description, locales, legacy_key, updated_at";

    private static CardRow ReadCard(SqliteDataReader r) => new(r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4),
        r.GetString(5), r.GetString(6), DaCardDatabase.Text(r, "short_name"), DaCardDatabase.Text(r, "description"),
        DaCardDatabase.FromJson<Dictionary<string, CardText>>(r, "locales"), DaCardDatabase.Text(r, "legacy_key"), r.GetInt64(11));

    public List<CardRow> Cards() => db.Query($"SELECT {CardColumns} FROM cards ORDER BY sort, name", ReadCard);

    public CardDetails? Card(string tpl) => db.One(
        $"SELECT {CardColumns}, glow, floats, animation, text_align, collection_layers, hidden_layers FROM cards WHERE id = $id OR foil_id = $id",
        r => new CardDetails(ReadCard(r), DaCardDatabase.FromJson<GlowSettings>(r, "glow"),
            DaCardDatabase.FromJson<Dictionary<string, double>>(r, "floats"), DaCardDatabase.FromJson<AnimationInfo>(r, "animation"),
            DaCardDatabase.FromJson<Dictionary<string, string>>(r, "text_align"), DaCardDatabase.Flag(r, "collection_layers"),
            DaCardDatabase.FromJson<List<string>>(r, "hidden_layers") ?? []),
        ("$id", tpl));

    public Dictionary<string, (bool CollectionLayers, List<string> Hidden)> HiddenLayers() => db.Query(
            "SELECT id, collection_layers, hidden_layers FROM cards WHERE collection_layers = 0 OR hidden_layers IS NOT NULL",
            r => (r.GetString(0), (DaCardDatabase.Flag(r, "collection_layers"), DaCardDatabase.FromJson<List<string>>(r, "hidden_layers") ?? [])))
        .ToDictionary(p => p.Item1, p => p.Item2, StringComparer.OrdinalIgnoreCase);

    private const string LayerColumns = "id, owner_kind, owner_id, face, position, key, name, text_id, chance, can_be_foil, over, price, transform, text, fps, speed, roughness, metallic, price_percent, foil_chance, foil_type, kind, parent_id";

    private static LayerRow ReadLayer(SqliteDataReader r) => new(r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetInt32(4),
        r.GetString(5), DaCardDatabase.Text(r, "name"), DaCardDatabase.Text(r, "text_id"), DaCardDatabase.Number(r, "chance", 100),
        DaCardDatabase.Flag(r, "can_be_foil"), DaCardDatabase.Flag(r, "over"), DaCardDatabase.Number(r, "price"),
        DaCardDatabase.FromJson<LayerTransform>(r, "transform"), DaCardDatabase.FromJson<LayerText>(r, "text"),
        DaCardDatabase.FromJson<Dictionary<string, double>>(r, "fps"), DaCardDatabase.Number(r, "speed", 12),
        DaCardDatabase.Optional(r, "roughness"), DaCardDatabase.Optional(r, "metallic"), Math.Max(0, DaCardDatabase.Number(r, "price_percent")),
        DaCardDatabase.NumberOrNull(r, "foil_chance"), DaCardDatabase.Text(r, "foil_type"), DaCardDatabase.Text(r, "kind"),
        DaCardDatabase.Text(r, "parent_id"));

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
        "SELECT id, collection_id, name, short_name, description, locales, rarities, card_count, price, purchasable, loot_percent, background, look, skin_id FROM packs ORDER BY sort, name",
        r => new PackRow(r.GetString(0), DaCardDatabase.Text(r, "collection_id"), r.GetString(2), DaCardDatabase.Text(r, "short_name"),
            DaCardDatabase.Text(r, "description"), DaCardDatabase.FromJson<Dictionary<string, CardText>>(r, "locales"),
            DaCardDatabase.FromJson<List<string>>(r, "rarities"), r.GetInt32(7), DaCardDatabase.Number(r, "price", 25000), DaCardDatabase.Flag(r, "purchasable"),
            DaCardDatabase.Number(r, "loot_percent"), DaCardDatabase.Text(r, "background"), DaCardDatabase.Text(r, "look") ?? "preset",
            DaCardDatabase.Text(r, "skin_id")));

    private const string PoolFilter = """
        c.collection_id = $collection
        AND (NOT EXISTS (SELECT 1 FROM pack_cards WHERE pack_id = $pack) OR c.id IN (SELECT card_id FROM pack_cards WHERE pack_id = $pack))
        AND ($rarities IS NULL OR lower(c.rarity) IN (SELECT lower(value) FROM json_each($rarities)))
        """;

    private static (string, object?)[] PoolParameters(PackRow pack) =>
    [
        ("$collection", pack.CollectionId),
        ("$pack", pack.Id),
        ("$rarities", pack.Rarities is { Count: > 0 } ? JsonSerializer.Serialize(pack.Rarities) : null)
    ];

    public List<PoolCard> PackMembers(PackRow pack) => db.Query(
        $"SELECT c.id, c.rarity FROM cards c WHERE {PoolFilter}", r => new PoolCard(r.GetString(0), r.GetString(1)), PoolParameters(pack));

    public HashSet<string> RetiredFoilLayers()
    {
        var value = db.One("SELECT value FROM meta WHERE key = 'retiredFoilLayers'", r => r.GetString(0));
        try
        {
            return new HashSet<string>(value == null ? [] : JsonSerializer.Deserialize<List<string>>(value) ?? [], StringComparer.OrdinalIgnoreCase);
        }
        catch (JsonException)
        {
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        }
    }

    public Dictionary<string, string> LegacyTemplates() => db.Query("SELECT id, foil_id FROM cards", r => (r.GetString(0), r.GetString(1)))
        .SelectMany(p => new[] { (p.Item1, p.Item1), (p.Item2, p.Item1) })
        .ToDictionary(p => p.Item1, p => p.Item2, StringComparer.OrdinalIgnoreCase);

    public bool Exists(string kind, string tpl) => kind switch
    {
        ItemLedger.Card or ItemLedger.Foil => db.Scalar<long>("SELECT COUNT(*) FROM cards WHERE id = $t OR foil_id = $t", ("$t", tpl)) > 0,
        ItemLedger.Collection => db.Scalar<long>("SELECT COUNT(*) FROM collections WHERE id = $t", ("$t", tpl)) > 0,
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
