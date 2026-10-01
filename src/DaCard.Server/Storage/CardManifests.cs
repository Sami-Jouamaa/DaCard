using SPTarkov.DI.Annotations;

namespace DaCard.Server.Storage;

[Injectable(InjectionType.Singleton)]
public class CardManifests(CardStore store, CardIndex index)
{
    public const string ImageRoute = "/dacard/img/";
    public const string FontRoute = "/dacard/font/";
    public const string Albedo = "albedo";

    public static string ImageUrl(string setId, string channel) => $"{ImageRoute}{setId}_{channel}.png".ToLowerInvariant();

    public static string FramesUrl(string setId, string channel) => $"{ImageRoute}{setId}_{channel}_f".ToLowerInvariant();

    public static string FontUrl(string ownerId, string file) => $"{FontRoute}{ownerId}/{file}";

    public CardManifestEntry? Get(string tpl)
    {
        var cached = index.Cached(tpl);
        if (cached != null)
            return cached;
        var created = index.Find(tpl);
        if (created == null)
            return null;
        var entry = Build(created);
        if (entry == null)
            return null;
        index.Remember(created.Id, entry);
        var foil = entry with { Tpl = created.FoilId, Foil = true, BaseTpl = created.Id };
        if (created.HasFoil)
            index.Remember(created.FoilId, foil);
        return tpl.Equals(created.Id, StringComparison.OrdinalIgnoreCase) ? entry : created.HasFoil ? foil : null;
    }

    private CardManifestEntry? Build(CreatedCard created)
    {
        var details = store.Card(created.Id);
        if (details == null)
            return null;
        var card = details.Card;
        var config = index.Config;
        var rarity = config.Rarities.GetValueOrDefault(card.Rarity) ?? new RaritySettings();
        var collection = store.Collection(card.CollectionId);
        var layers = store.LayersOf(card.Id, card.CollectionId);
        var images = store.Images(layers.Select(l => l.Id).Append(card.Id))
            .GroupBy(i => i.SetId).ToDictionary(g => g.Key, g => g.ToDictionary(i => i.Channel, i => i));
        var cardImages = images.GetValueOrDefault(card.Id) ?? new Dictionary<string, ImageRow>();
        var type = index.Types.GetValueOrDefault(created.TypeName) ?? new CardTypeSettings();
        var allowed = type.Slots?.Select(ChannelOf).ToHashSet(StringComparer.OrdinalIgnoreCase);

        var hidden = details.HiddenLayers.ToHashSet(StringComparer.OrdinalIgnoreCase);
        LayerManifestEntry Entry(LayerRow layer, bool frame) => LayerEntry(layer, frame, images.GetValueOrDefault(layer.Id), card.Id, card.CollectionId);
        LayerManifestEntry CollectionEntry(LayerRow layer, bool frame)
        {
            var entry = Aligned(Entry(layer, frame), details.TextAlign);
            return !details.CollectionLayers || hidden.Contains(layer.Id) ? entry with { Chance = 0 } : entry;
        }
        List<LayerManifestEntry> Stack(string face)
        {
            var own = layers.Where(l => !l.IsCollection && l.Face == face).OrderBy(l => l.Position).ToList();
            var coll = layers.Where(l => l.IsCollection && l.Face == face).OrderBy(l => l.Position).ToList();
            return own.Where(l => !l.Over).Select(l => Entry(l, false))
                .Concat(coll.Select(l => CollectionEntry(l, face == "front")))
                .Concat(own.Where(l => l.Over).Select(l => Entry(l, false)))
                .ToList();
        }

        var front = Stack("front");
        var back = Stack("back");
        if (back.Count == 0)
            back.AddRange(layers.Where(l => l.IsCollection && l.Face == "default-back").OrderBy(l => l.Position).Select(l => Entry(l, false)));
        if (!created.UsesDepth && created.DeclaredType != created.TypeName && cardImages.ContainsKey(Albedo))
            front.Insert(0, PictureLayer(card.Id, cardImages, details.Animation));

        return new CardManifestEntry
        {
            Tpl = card.Id,
            Rarity = card.Rarity,
            Type = created.TypeName,
            Floats = details.Floats is { Count: > 0 } own
                ? type.Floats.Concat(own).GroupBy(p => p.Key).ToDictionary(g => g.Key, g => g.Last().Value)
                : type.Floats,
            Textures = created.UsesDepth
                ? index.Slots.Where(s => cardImages.ContainsKey(ChannelOf(s.Suffix)) && (allowed == null || allowed.Contains(ChannelOf(s.Suffix))))
                    .ToDictionary(s => s.Property, s => ImageUrl(card.Id, ChannelOf(s.Suffix)))
                : new Dictionary<string, string>(),
            HoloStrength = details.Holo?.Strength ?? rarity.Holo.Strength ?? 0,
            HoloPattern = PatternIndex(details.Holo?.Pattern ?? rarity.Holo.Pattern),
            HoloAngle = details.Holo?.Angle ?? rarity.Holo.Angle ?? 30,
            RarityColor = rarity.Color,
            Glow = (details.Glow ?? new GlowSettings())
                .Over((rarity.Glow ?? new GlowSettings()).Over(GlowSettings.Defaults.GetValueOrDefault(card.Rarity)))
                .Resolve(rarity.Color),
            Collection = collection?.Name,
            Front = front,
            Back = back,
            Text = collection?.CardText == null ? null : CollectionText(collection).WithAlign(details.TextAlign),
            Animation = created.UsesDepth ? CardAnimation(card.Id, cardImages, details.Animation, allowed) : null
        };
    }

    public static string ChannelOf(string suffix) => suffix == "" ? Albedo : suffix.Replace('.', '_').ToLowerInvariant();

    private LayerManifestEntry LayerEntry(LayerRow layer, bool frame, Dictionary<string, ImageRow>? images, string cardId, string collectionId)
    {
        images ??= new Dictionary<string, ImageRow>();
        var entry = new LayerManifestEntry
        {
            Key = layer.Key,
            Chance = Math.Clamp(layer.Chance, 0, 100),
            CanBeFoil = layer.CanBeFoil,
            Frame = frame,
            Transform = layer.Transform,
            Roughness = layer.Roughness,
            Metallic = layer.Metallic,
            Sticker = index.StickerOf.GetValueOrDefault(CardIndex.StickerKey(layer.IsCollection ? collectionId : cardId, layer.Key)),
            Textures = images.Values.ToDictionary(i => i.Channel, i => ImageUrl(i.SetId, i.Channel)),
            Id = layer.TextId,
            Name = string.IsNullOrWhiteSpace(layer.Name) ? null : layer.Name.Trim(),
            Text = layer.Text == null ? null : layer.Text with
            {
                Font = string.IsNullOrWhiteSpace(layer.Text.Font) ? null : FontUrl(collectionId, layer.Text.Font)
            }
        };
        var animated = images.Values.Where(i => i.Frames > 1).ToList();
        if (animated.Count == 0)
            return entry;
        double? Own(string channel) => layer.Fps != null && layer.Fps.TryGetValue(channel, out var fps) && fps > 0 ? fps : null;
        var shared = animated.Where(i => Own(i.Channel) == null).Select(i => i.Frames).DefaultIfEmpty(0).Min();
        entry.Animation = animated.ToDictionary(i => i.Channel, i => new CardAnimationTrack
        {
            Url = FramesUrl(i.SetId, i.Channel),
            Frames = Own(i.Channel) != null ? i.Frames : shared,
            Fps = Math.Clamp(Own(i.Channel) ?? layer.Speed, 0.1, 120)
        });
        return entry;
    }

    private static LayerManifestEntry PictureLayer(string cardId, Dictionary<string, ImageRow> images, AnimationInfo? animation)
    {
        var maps = new[] { Albedo, "normal" }.Where(images.ContainsKey).ToList();
        var entry = new LayerManifestEntry
        {
            Key = "card:card",
            Chance = 100,
            CanBeFoil = true,
            Textures = maps.ToDictionary(m => m, m => ImageUrl(cardId, m))
        };
        var animated = maps.Where(m => images[m].Frames > 1).ToList();
        if (animated.Count > 0)
            entry.Animation = animated.ToDictionary(m => m, m => new CardAnimationTrack
            {
                Url = FramesUrl(cardId, m),
                Frames = images[m].Frames,
                Fps = Math.Clamp(animation?.Slots?.GetValueOrDefault(m) is > 0 and var own ? own : animation?.Fps ?? 12, 0.1, 120)
            });
        return entry;
    }

    private CardAnimation? CardAnimation(string cardId, Dictionary<string, ImageRow> images, AnimationInfo? info, HashSet<string>? allowed)
    {
        var animated = index.Slots.Select(s => (Slot: s, Channel: ChannelOf(s.Suffix)))
            .Where(s => images.TryGetValue(s.Channel, out var i) && i.Frames > 1 && (allowed == null || allowed.Contains(s.Channel)))
            .ToList();
        if (animated.Count == 0)
            return null;
        double? Own(string channel) => info?.Slots != null && info.Slots.TryGetValue(channel, out var fps) && fps > 0 ? fps : null;
        var shared = animated.Where(s => Own(s.Channel) == null).Select(s => images[s.Channel].Frames).DefaultIfEmpty(0).Min();
        var animation = new CardAnimation();
        foreach (var (slot, channel) in animated)
        {
            var own = Own(channel);
            animation.Tracks[slot.Property] = new CardAnimationTrack
            {
                Url = FramesUrl(cardId, channel),
                Frames = own != null ? images[channel].Frames : shared,
                Fps = Math.Clamp(own ?? info?.Fps ?? 12, 0.1, 120)
            };
        }
        return animation;
    }

    private static LayerManifestEntry Aligned(LayerManifestEntry layer, Dictionary<string, string>? align) =>
        layer.Text != null && layer.Id != null && align != null && align.TryGetValue(layer.Id, out var a) && CardTextSettings.IsAlign(a)
            ? layer with { Text = layer.Text with { Align = a } }
            : layer;

    private static CardTextSettings CollectionText(CollectionRow collection)
    {
        var text = collection.CardText!;
        TextStyle? WithFont(TextStyle? style) => style == null || string.IsNullOrWhiteSpace(style.Font)
            ? style
            : style with { Font = FontUrl(collection.Id, style.Font) };
        return text with { Name = WithFont(text.Name), Description = WithFont(text.Description) };
    }

    public static int PatternIndex(string? pattern) => pattern?.ToLowerInvariant() switch
    {
        "radial" => 1,
        "sparkle" => 2,
        _ => 0
    };
}
