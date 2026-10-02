using System.Collections.Concurrent;
using System.Text.Json.Serialization;
using SPTarkov.DI.Annotations;

namespace DaCard.Server.Storage;

public record CreatedCard(string Id, string FoilId, string CollectionId, string Rarity, string DeclaredType, string TypeName, bool UsesDepth, bool HasFoil);

public record ClientIndex
{
    [JsonPropertyName("backProperty")] public string BackProperty { get; set; } = "_CARD_BACK";
    [JsonPropertyName("overlayProperty")] public string OverlayProperty { get; set; } = "_CARD_FRONT_BORDER";
    [JsonPropertyName("slots")] public List<TextureSlot> Slots { get; set; } = new();
    [JsonPropertyName("cards")] public List<string> Cards { get; set; } = new();
    [JsonPropertyName("versions")] public Dictionary<string, string> Versions { get; set; } = new();
    [JsonPropertyName("foils")] public Dictionary<string, string> Foils { get; set; } = new();
    [JsonPropertyName("binders")] public List<BinderManifestEntry> Binders { get; set; } = new();
    [JsonPropertyName("packs")] public List<PackManifestEntry> Packs { get; set; } = new();
    [JsonPropertyName("stickers")] public Dictionary<string, string?> Stickers { get; set; } = new();
    [JsonPropertyName("fonts")] public bool Fonts { get; set; }
}

[Injectable(InjectionType.Singleton)]
public class CardIndex
{
    public Dictionary<string, CreatedCard> Cards { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, string> FoilToBase { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, string> StickerOf { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, string> Versions { get; } = new(StringComparer.OrdinalIgnoreCase);
    public ClientIndex Client { get; set; } = new();
    public DaCardConfig Config { get; set; } = new();
    public List<TextureSlot> Slots { get; set; } = new();
    public Dictionary<string, CardTypeSettings> Types { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    private readonly ConcurrentDictionary<string, CardManifestEntry> _manifests = new(StringComparer.OrdinalIgnoreCase);
    private const int CacheLimit = 4096;

    public static string StickerKey(string ownerId, string layerKey) => ownerId + "|" + layerKey;

    public void Clear()
    {
        Cards.Clear();
        FoilToBase.Clear();
        StickerOf.Clear();
        Versions.Clear();
        _manifests.Clear();
        Client = new ClientIndex();
    }

    public CreatedCard? Find(string tpl)
    {
        if (Cards.TryGetValue(tpl, out var card))
            return card;
        return FoilToBase.TryGetValue(tpl, out var baseTpl) ? Cards.GetValueOrDefault(baseTpl) : null;
    }

    public CardManifestEntry? Cached(string tpl) => _manifests.GetValueOrDefault(tpl);

    public void Remember(string tpl, CardManifestEntry entry)
    {
        if (_manifests.Count >= CacheLimit)
            _manifests.Clear();
        _manifests[tpl] = entry;
    }
}
