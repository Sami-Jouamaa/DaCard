using System.Collections.Concurrent;
using System.Text.Json.Serialization;
using SPTarkov.DI.Annotations;

namespace DaCard.Server.Storage;

public record CreatedCard(string Id, string CollectionId, string Rarity, int RarityRank, string DeclaredType, string TypeName, bool UsesDepth, string Template);

public record CardTemplate(string Id, string CollectionId, string Rarity, string TypeName, double Price);

public record RollLayer(string Id, double Chance, double Price, double PricePercent, bool CanFoil, double FoilChance, string? FoilType,
    string? Group = null, bool IsGroup = false);

public record ClientTemplate
{
    [JsonPropertyName("collection")] public required string Collection { get; set; }
    [JsonPropertyName("rarity")] public required string Rarity { get; set; }
    [JsonPropertyName("price")] public double Price { get; set; }
}

public record ClientIndex
{
    [JsonPropertyName("backProperty")] public string BackProperty { get; set; } = "_CARD_BACK";
    [JsonPropertyName("overlayProperty")] public string OverlayProperty { get; set; } = "_CARD_FRONT_BORDER";
    [JsonPropertyName("slots")] public List<TextureSlot> Slots { get; set; } = new();
    [JsonPropertyName("versions")] public Dictionary<string, string> Versions { get; set; } = new();
    [JsonPropertyName("templates")] public Dictionary<string, ClientTemplate> Templates { get; set; } = new();
    [JsonPropertyName("binders")] public List<BinderManifestEntry> Binders { get; set; } = new();
    [JsonPropertyName("packs")] public List<PackManifestEntry> Packs { get; set; } = new();
    [JsonPropertyName("fonts")] public bool Fonts { get; set; }
}

[Injectable(InjectionType.Singleton)]
public class CardIndex
{
    public Dictionary<string, CreatedCard> Cards { get; } = new(StringComparer.OrdinalIgnoreCase);
    public HashSet<string> Stored { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, CardTemplate> Templates { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, string[]> CardsOfTemplate { get; private set; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, RollLayer[]> Layers { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, string[]> FoilTypes { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, List<ResolvedRarity>> Rarities { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, string> Versions { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, string> LegacyTemplates { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public ClientIndex Client { get; set; } = new();
    public DaCardConfig Config { get; set; } = new();
    public List<TextureSlot> Slots { get; set; } = new();
    public Dictionary<string, CardTypeSettings> Types { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    private readonly ConcurrentDictionary<string, CardManifestEntry> _manifests = new(StringComparer.OrdinalIgnoreCase);
    private const int CacheLimit = 4096;

    public void Clear()
    {
        Cards.Clear();
        Stored.Clear();
        Templates.Clear();
        CardsOfTemplate = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
        Layers.Clear();
        FoilTypes.Clear();
        Rarities.Clear();
        Versions.Clear();
        LegacyTemplates = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        _manifests.Clear();
        Client = new ClientIndex();
    }

    public void Seal() => CardsOfTemplate = Cards.Values.GroupBy(c => c.Template, StringComparer.OrdinalIgnoreCase)
        .ToDictionary(g => g.Key, g => g.Select(c => c.Id).ToArray(), StringComparer.OrdinalIgnoreCase);

    public CreatedCard? Find(string cardId) => Cards.GetValueOrDefault(cardId);

    public List<ResolvedRarity> RaritiesOf(string collectionId) => Rarities.GetValueOrDefault(collectionId) ?? CardRarities.Of(null, Config);

    public bool IsCardTemplate(string tpl) => Templates.ContainsKey(tpl);

    public CardManifestEntry? Cached(string cardId) => _manifests.GetValueOrDefault(cardId);

    public void Remember(string cardId, CardManifestEntry entry)
    {
        if (_manifests.Count >= CacheLimit)
            _manifests.Clear();
        _manifests[cardId] = entry;
    }
}
