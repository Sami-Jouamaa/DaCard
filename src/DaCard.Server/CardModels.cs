using System.Text.Json.Serialization;

namespace DaCard.Server;

public record CardFile
{
    [JsonPropertyName("name")] public string? Name { get; set; }

    [JsonPropertyName("type")] public string? Type { get; set; }

    [JsonPropertyName("shortName")] public string? ShortName { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }

    [JsonPropertyName("locales")] public Dictionary<string, CardText>? Locales { get; set; }

    [JsonPropertyName("holo")] public HoloSettings? Holo { get; set; }

    [JsonPropertyName("glow")] public GlowSettings? Glow { get; set; }

    [JsonPropertyName("animation")] public AnimationInfo? Animation { get; set; }

    [JsonPropertyName("floats")] public Dictionary<string, double>? Floats { get; set; }

    [JsonPropertyName("layers")] public LayerLists? Layers { get; set; }

    [JsonPropertyName("textAlign")] public Dictionary<string, string>? TextAlign { get; set; }

    [JsonPropertyName("collectionLayers")] public bool? CollectionLayers { get; set; }

    [JsonPropertyName("hideCollectionLayers")] public List<string>? HideCollectionLayers { get; set; }
}

public record AnimationInfo
{
    [JsonPropertyName("fps")] public double Fps { get; set; } = 12;

    // Own speed per map ("art", "height", "foil", "normal"); maps without one play at fps, in step with each other
    [JsonPropertyName("slots")] public Dictionary<string, double>? Slots { get; set; }
}

public record CardAnimation
{
    // Per material texture property
    [JsonPropertyName("tracks")] public Dictionary<string, CardAnimationTrack> Tracks { get; set; } = new();
}

public record CardAnimationTrack
{
    // Frame i is <url><i:000>.png
    [JsonPropertyName("url")] public required string Url { get; set; }
    [JsonPropertyName("frames")] public int Frames { get; set; }
    [JsonPropertyName("fps")] public double Fps { get; set; }
}

public record CardText
{
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("shortName")] public string? ShortName { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
}

public record HoloSettings
{
    [JsonPropertyName("strength")] public double? Strength { get; set; }

    [JsonPropertyName("pattern")] public string? Pattern { get; set; }

    [JsonPropertyName("angle")] public double? Angle { get; set; }
}

public record GlowSettings
{
    [JsonPropertyName("strength")] public double? Strength { get; set; }
    [JsonPropertyName("color")] public string? Color { get; set; }
    [JsonPropertyName("color2")] public string? Color2 { get; set; }
    [JsonPropertyName("line")] public double? Line { get; set; }
    [JsonPropertyName("halo")] public double? Halo { get; set; }
    [JsonPropertyName("sparkles")] public double? Sparkles { get; set; }
    [JsonPropertyName("flares")] public double? Flares { get; set; }
    [JsonPropertyName("smoke")] public double? Smoke { get; set; }
    [JsonPropertyName("rays")] public double? Rays { get; set; }
    // Thick smoke dripping down from the card (towards its bottom edge)
    [JsonPropertyName("drip")] public double? Drip { get; set; }
    [JsonPropertyName("speed")] public double? Speed { get; set; }

    public static readonly Dictionary<string, GlowSettings> Defaults = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Common"] = new() { Strength = 1.1, Color2 = "#E8ECF2", Rays = 1, Sparkles = 0.8 },
        ["Uncommon"] = new() { Strength = 1.1, Color2 = "#B8FFB0", Rays = 1, Sparkles = 0.8 },
        ["Rare"] = new() { Strength = 1.1, Color2 = "#7FD4FF", Rays = 1, Sparkles = 0.8 },
        ["Epic"] = new() { Strength = 1.1, Color2 = "#3F6BFF", Rays = 1, Sparkles = 0.8 },
        ["Legendary"] = new() { Strength = 1.1, Color = "#FFA01C", Color2 = "#FF6A00", Rays = 1, Sparkles = 0.8, Smoke = 1 }
    };

    public GlowSettings Over(GlowSettings? below) => below == null ? this : new()
    {
        Strength = Strength ?? below.Strength,
        Color = Color ?? below.Color,
        Color2 = Color2 ?? below.Color2,
        Line = Line ?? below.Line,
        Halo = Halo ?? below.Halo,
        Sparkles = Sparkles ?? below.Sparkles,
        Flares = Flares ?? below.Flares,
        Smoke = Smoke ?? below.Smoke,
        Rays = Rays ?? below.Rays,
        Drip = Drip ?? below.Drip,
        Speed = Speed ?? below.Speed
    };

    public GlowManifestEntry? Resolve(string rarityColor)
    {
        if (!(Strength > 0))
            return null;
        var color = Color ?? rarityColor;
        return new GlowManifestEntry
        {
            Strength = Strength.Value,
            Color = color,
            Color2 = Color2 ?? color,
            Line = Line ?? 1,
            Halo = Halo ?? 1,
            Sparkles = Sparkles ?? 0,
            Flares = Flares ?? 0,
            Smoke = Smoke ?? 0,
            Rays = Rays ?? 0,
            Drip = Drip ?? 0,
            Speed = Speed ?? 1
        };
    }
}

public record GlowManifestEntry
{
    [JsonPropertyName("strength")] public double Strength { get; set; }
    [JsonPropertyName("color")] public required string Color { get; set; }
    [JsonPropertyName("color2")] public required string Color2 { get; set; }
    [JsonPropertyName("line")] public double Line { get; set; }
    [JsonPropertyName("halo")] public double Halo { get; set; }
    [JsonPropertyName("sparkles")] public double Sparkles { get; set; }
    [JsonPropertyName("flares")] public double Flares { get; set; }
    [JsonPropertyName("smoke")] public double Smoke { get; set; }
    [JsonPropertyName("rays")] public double Rays { get; set; }
    [JsonPropertyName("drip")] public double Drip { get; set; }
    [JsonPropertyName("speed")] public double Speed { get; set; }
}

public record CollectionFile
{
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("shortName")] public string? ShortName { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }

    [JsonPropertyName("locales")] public Dictionary<string, CardText>? Locales { get; set; }

    [JsonPropertyName("stickers")] public List<StickerLayer>? Stickers { get; set; }

    [JsonPropertyName("sticker")] public StickerPlacement? Sticker { get; set; }

    [JsonPropertyName("cardText")] public CardTextSettings? CardText { get; set; }

    [JsonPropertyName("layers")] public LayerLists? Layers { get; set; }
}

public record CardTextSettings
{
    [JsonPropertyName("name")] public TextStyle? Name { get; set; }
    [JsonPropertyName("description")] public TextStyle? Description { get; set; }

    public CardTextSettings WithAlign(Dictionary<string, string>? align) => align == null ? this : this with
    {
        Name = Aligned(Name, align.GetValueOrDefault("name")),
        Description = Aligned(Description, align.GetValueOrDefault("description"))
    };

    public static bool IsAlign(string? align) => align is "left" or "center" or "right";

    private static TextStyle? Aligned(TextStyle? style, string? align) =>
        style != null && IsAlign(align) ? style with { Align = align! } : style;
}

public record TextStyle
{
    [JsonPropertyName("show")] public bool Show { get; set; } = true;
    [JsonPropertyName("x")] public double X { get; set; } = 0.5;
    [JsonPropertyName("y")] public double Y { get; set; } = 0.05;
    [JsonPropertyName("width")] public double Width { get; set; } = 0.8;
    [JsonPropertyName("height")] public double? Height { get; set; }
    [JsonPropertyName("size")] public double Size { get; set; } = 0.05;
    [JsonPropertyName("align")] public string Align { get; set; } = "center";
    [JsonPropertyName("color")] public string Color { get; set; } = "#FFFFFF";
    [JsonPropertyName("font")] public string? Font { get; set; }
}

public record StickerPlacement
{
    [JsonPropertyName("x")] public double X { get; set; } = 0.5;
    [JsonPropertyName("y")] public double Y { get; set; } = 0.4;
    [JsonPropertyName("width")] public double Width { get; set; } = 0.6;
    [JsonPropertyName("height")] public double Height { get; set; } = 0.3;
    [JsonPropertyName("rotation")] public double Rotation { get; set; }
}

public record StickerLayer : StickerPlacement
{
    [JsonPropertyName("file")] public string? File { get; set; }
}

public record BinderStickerEntry
{
    [JsonPropertyName("image")] public required string Image { get; set; }
    [JsonPropertyName("placement")] public StickerPlacement Placement { get; set; } = new();
}

public record BinderSettings
{
    [JsonPropertyName("price")] public double Price { get; set; } = 5000;

    [JsonPropertyName("background")] public string Background { get; set; } = "default";
}

public record BinderManifestEntry
{
    [JsonPropertyName("tpl")] public required string Tpl { get; set; }
    [JsonPropertyName("collection")] public required string Collection { get; set; }
    [JsonPropertyName("stickers")] public List<BinderStickerEntry> Stickers { get; set; } = new();
    [JsonPropertyName("cards")] public List<string> Cards { get; set; } = new();
}

public record DaCardConfig
{
    [JsonPropertyName("rarities")] public Dictionary<string, RaritySettings> Rarities { get; set; } = new();

    [JsonPropertyName("containers")] public List<string> Containers { get; set; } = new();

    [JsonPropertyName("textures")] public List<TextureSlot> Textures { get; set; } = new();

    [JsonPropertyName("cardTypes")] public Dictionary<string, CardTypeSettings> CardTypes { get; set; } = new();

    [JsonPropertyName("backProperty")] public string? BackProperty { get; set; }

    [JsonPropertyName("overlayProperty")] public string? OverlayProperty { get; set; }

    [JsonPropertyName("binders")] public BinderSettings Binders { get; set; } = new();

    [JsonPropertyName("geek")] public GeekSettings Geek { get; set; } = new();

    [JsonPropertyName("foil")] public FoilSettings Foil { get; set; } = new();

    [JsonPropertyName("packs")] public PackSettings Packs { get; set; } = new();

    [JsonPropertyName("retiredItems")] public string? RetiredItems { get; set; }
}

public record LedgerFile
{
    [JsonPropertyName("version")] public int Version { get; set; } = 1;
    [JsonPropertyName("items")] public Dictionary<string, LedgerItem> Items { get; set; } = new();
    [JsonPropertyName("layers")] public Dictionary<string, double> Layers { get; set; } = new();
}

public record LedgerItem
{
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("key")] public string Key { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("price")] public double Price { get; set; }
    [JsonPropertyName("background")] public string? Background { get; set; }
    [JsonPropertyName("bundle")] public string? Bundle { get; set; }
    [JsonPropertyName("owner")] public string? Owner { get; set; }
    [JsonPropertyName("slots")] public List<LedgerSlot>? Slots { get; set; }
    [JsonPropertyName("lastSeen")] public long LastSeen { get; set; }
}

public record LedgerSlot
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("label")] public string? Label { get; set; }
    [JsonPropertyName("filter")] public List<string> Filter { get; set; } = new();
}

public record PackSettings
{
    [JsonPropertyName("rarityWeights")] public Dictionary<string, double> RarityWeights { get; set; } = new(DefaultWeights, StringComparer.OrdinalIgnoreCase);

    public static readonly Dictionary<string, double> DefaultWeights = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Common"] = 68, ["Uncommon"] = 22, ["Rare"] = 7, ["Epic"] = 2, ["Legendary"] = 1
    };
}

public record PackFile
{
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("shortName")] public string? ShortName { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }

    [JsonPropertyName("locales")] public Dictionary<string, CardText>? Locales { get; set; }

    [JsonPropertyName("skin")] public string? Skin { get; set; }

    [JsonPropertyName("cards")] public PackCards Cards { get; set; } = new();

    [JsonPropertyName("cardCount")] public int CardCount { get; set; } = 3;

    [JsonPropertyName("price")] public double Price { get; set; } = 25000;

    [JsonPropertyName("purchasable")] public bool Purchasable { get; set; } = true;

    [JsonPropertyName("lootPercent")] public double LootPercent { get; set; }

    [JsonPropertyName("background")] public string? Background { get; set; }
}

public record PackCards
{
    [JsonPropertyName("all")] public bool All { get; set; }
    [JsonPropertyName("collections")] public List<string>? Collections { get; set; }
    [JsonPropertyName("cards")] public List<string>? Cards { get; set; }
    [JsonPropertyName("rarities")] public List<string>? Rarities { get; set; }
}

public record SkinFile
{
    [JsonPropertyName("name")] public string? Name { get; set; }
}

public record PackManifestEntry
{
    [JsonPropertyName("tpl")] public required string Tpl { get; set; }
    [JsonPropertyName("cardCount")] public int CardCount { get; set; }
    [JsonPropertyName("textures")] public Dictionary<string, string> Textures { get; set; } = new();
}

public record FoilSettings
{
    [JsonPropertyName("percent")] public double Percent { get; set; } = 10;

    // Foil version's price: the rarity's price times this
    [JsonPropertyName("priceMultiplier")] public double PriceMultiplier { get; set; } = 2;
}

public record TextureSlot
{
    [JsonPropertyName("suffix")] public string Suffix { get; set; } = "";

    [JsonPropertyName("property")] public string Property { get; set; } = "_MainTex";

    [JsonPropertyName("linear")] public bool Linear { get; set; }

    [JsonPropertyName("required")] public bool Required { get; set; }

    [JsonPropertyName("default")] public string? Default { get; set; }
}

public record CardTypeSettings
{
    [JsonPropertyName("bundle")] public string? Bundle { get; set; }

    [JsonPropertyName("slots")] public List<string>? Slots { get; set; }

    [JsonPropertyName("floats")] public Dictionary<string, double> Floats { get; set; } = new();
}

public record GeekSettings
{
    [JsonPropertyName("sellCards")] public bool SellCards { get; set; }

    [JsonPropertyName("sellFoilCards")] public bool SellFoilCards { get; set; }
}

public record RaritySettings
{
    [JsonPropertyName("lootPercent")] public double LootPercent { get; set; }

    [JsonPropertyName("price")] public double Price { get; set; }

    [JsonPropertyName("background")] public string Background { get; set; } = "default";

    [JsonPropertyName("color")] public string Color { get; set; } = "#FFFFFF";

    [JsonPropertyName("holo")] public HoloSettings Holo { get; set; } = new();

    [JsonPropertyName("glow")] public GlowSettings? Glow { get; set; }
}

public record CardManifest
{
    [JsonPropertyName("backProperty")] public string BackProperty { get; set; } = "_CARD_BACK";
    [JsonPropertyName("overlayProperty")] public string OverlayProperty { get; set; } = "_CARD_FRONT_BORDER";
    [JsonPropertyName("slots")] public List<TextureSlot> Slots { get; set; } = new();
    [JsonPropertyName("cards")] public List<CardManifestEntry> Cards { get; set; } = new();
    [JsonPropertyName("binders")] public List<BinderManifestEntry> Binders { get; set; } = new();
    [JsonPropertyName("packs")] public List<PackManifestEntry> Packs { get; set; } = new();
}

public record CardManifestEntry
{
    [JsonPropertyName("tpl")] public required string Tpl { get; set; }
    [JsonPropertyName("rarity")] public required string Rarity { get; set; }

    [JsonPropertyName("type")] public string Type { get; set; } = "3d";

    [JsonPropertyName("floats")] public Dictionary<string, double> Floats { get; set; } = new();

    [JsonPropertyName("textures")] public Dictionary<string, string> Textures { get; set; } = new();
    [JsonPropertyName("holoStrength")] public double HoloStrength { get; set; }

    [JsonPropertyName("holoPattern")] public int HoloPattern { get; set; }

    [JsonPropertyName("holoAngle")] public double HoloAngle { get; set; }

    [JsonPropertyName("foil")] public bool Foil { get; set; }

    [JsonPropertyName("baseTpl")] public string? BaseTpl { get; set; }

    [JsonPropertyName("rarityColor")] public string? RarityColor { get; set; }

    [JsonPropertyName("glow")] public GlowManifestEntry? Glow { get; set; }

    [JsonPropertyName("collection")] public string? Collection { get; set; }

    // Collection layers first, then the card's; bottom first
    [JsonPropertyName("front")] public List<LayerManifestEntry> Front { get; set; } = new();
    [JsonPropertyName("back")] public List<LayerManifestEntry> Back { get; set; } = new();

    [JsonPropertyName("text")] public CardTextSettings? Text { get; set; }

    [JsonPropertyName("animation")] public CardAnimation? Animation { get; set; }
}
