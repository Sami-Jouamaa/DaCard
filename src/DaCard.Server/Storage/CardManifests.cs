using SPTarkov.DI.Annotations;

namespace DaCard.Server.Storage;

[Injectable(InjectionType.Singleton)]
public class CardManifests(CardStore store, CardIndex index)
{
    public const string ImageRoute = "/dacard/img/";
    public const string FontRoute = "/dacard/font/";
    public const string Albedo = "albedo";
    public const string PictureLayerId = "picture";

    public static string ImageUrl(ImageRow image) => $"{ImageRoute}v{image.UpdatedAt}/{image.SetId}_{image.Channel}.png".ToLowerInvariant();

    public static string FramesUrl(ImageRow image) => $"{ImageRoute}v{image.UpdatedAt}/{image.SetId}_{image.Channel}_f".ToLowerInvariant();

    public string FontUrl(string ownerId, string file)
    {
        var path = store.FontPath(ownerId, file);
        var version = path != null ? $"v{new DateTimeOffset(File.GetLastWriteTimeUtc(path)).ToUnixTimeMilliseconds()}/" : "";
        return $"{FontRoute}{version}{ownerId}/{file}";
    }

    public CardManifestEntry? Get(string cardId, bool remember = true)
    {
        var cached = index.Cached(cardId);
        if (cached != null)
            return cached;
        var created = index.Find(cardId);
        if (created == null)
            return null;
        var entry = Build(created);
        if (entry != null && remember)
            index.Remember(created.Id, entry);
        return entry;
    }

    private CardManifestEntry? Build(CreatedCard created)
    {
        var details = store.Card(created.Id);
        if (details == null)
            return null;
        var card = details.Card;
        var resolved = CardRarities.Find(index.RaritiesOf(card.CollectionId), created.Rarity);
        var rarity = resolved?.Settings ?? new RaritySettings();
        var glowDefaults = resolved is { Custom: true } ? null : GlowSettings.Defaults.GetValueOrDefault(created.Rarity);
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
        IEnumerable<LayerManifestEntry> Expand(LayerRow layer, Func<LayerRow, LayerManifestEntry> entry) =>
            layer.IsVariantLayer
                ? layers.Where(v => v.ParentId == layer.Id).OrderBy(v => v.Position).Select(v => entry(v) with { Group = layer.Id })
                : [entry(layer)];
        List<LayerManifestEntry> Stack(string face)
        {
            var own = layers.Where(l => !l.IsCollection && l.Face == face && l.ParentId == null).OrderBy(l => l.Position).ToList();
            var coll = layers.Where(l => l.IsCollection && l.Face == face && l.ParentId == null).OrderBy(l => l.Position).ToList();
            return own.Where(l => !l.Over).SelectMany(l => Expand(l, v => Entry(v, false)))
                .Concat(coll.SelectMany(l => Expand(l, v => CollectionEntry(v, face == "front"))))
                .Concat(own.Where(l => l.Over).SelectMany(l => Expand(l, v => Entry(v, false))))
                .ToList();
        }

        var front = Stack("front");
        var back = Stack("back");
        if (back.Count == 0)
            back.AddRange(layers.Where(l => l.IsCollection && l.Face == "default-back" && l.ParentId == null).OrderBy(l => l.Position)
                .SelectMany(l => Expand(l, v => Entry(v, false))));
        if (!created.UsesDepth && created.DeclaredType != created.TypeName && cardImages.ContainsKey(Albedo))
            front.Insert(0, PictureLayer(cardImages, details.Animation));

        return new CardManifestEntry
        {
            Tpl = card.Id,
            Template = created.Template,
            Price = index.Templates.GetValueOrDefault(created.Template)?.Price ?? 0,
            Name = card.Name,
            ShortName = card.ShortName,
            Description = card.Description,
            Locales = card.Locales,
            Rarity = created.Rarity,
            Type = created.TypeName,
            Floats = details.Floats is { Count: > 0 } own
                ? type.Floats.Concat(own).GroupBy(p => p.Key).ToDictionary(g => g.Key, g => g.Last().Value)
                : type.Floats,
            Textures = created.UsesDepth
                ? index.Slots.Where(s => cardImages.ContainsKey(ChannelOf(s.Suffix)) && (allowed == null || allowed.Contains(ChannelOf(s.Suffix))))
                    .ToDictionary(s => s.Property, s => ImageUrl(cardImages[ChannelOf(s.Suffix)]))
                : new Dictionary<string, string>(),
            RarityColor = rarity.Color,
            Glow = (details.Glow ?? new GlowSettings())
                .Over((rarity.Glow ?? new GlowSettings()).Over(glowDefaults))
                .Resolve(rarity.Color),
            FoilLayers = (index.Layers.GetValueOrDefault(card.Id) ?? []).Where(l => l.CanFoil && l.FoilChance > 0).Select(l => l.Id).ToList(),
            Collection = collection?.Name,
            Front = front,
            Back = back,
            Text = collection?.CardText == null ? null : CollectionText(collection).WithAlign(details.TextAlign),
            Animation = created.UsesDepth ? CardAnimation(cardImages, details.Animation, allowed) : null
        };
    }

    public static string ChannelOf(string suffix) => suffix == "" ? Albedo : suffix.Replace('.', '_').ToLowerInvariant();

    private LayerManifestEntry LayerEntry(LayerRow layer, bool frame, Dictionary<string, ImageRow>? images, string cardId, string collectionId)
    {
        images ??= new Dictionary<string, ImageRow>();
        var entry = new LayerManifestEntry
        {
            Key = layer.Key,
            Layer = layer.Id,
            Chance = Math.Clamp(layer.Chance, 0, 100),
            CanBeFoil = layer.CanBeFoil,
            Price = Math.Max(0, layer.Price),
            PricePercent = layer.PricePercent,
            Frame = frame,
            Transform = layer.Transform,
            Roughness = layer.Roughness,
            Metallic = layer.Metallic,
            Textures = images.Values.ToDictionary(i => i.Channel, ImageUrl),
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
            Url = FramesUrl(i),
            Frames = Own(i.Channel) != null ? i.Frames : shared,
            Fps = Math.Clamp(Own(i.Channel) ?? layer.Speed, 0.1, 120)
        });
        return entry;
    }

    private static LayerManifestEntry PictureLayer(Dictionary<string, ImageRow> images, AnimationInfo? animation)
    {
        var maps = new[] { Albedo, "normal" }.Where(images.ContainsKey).ToList();
        var entry = new LayerManifestEntry
        {
            Key = "card:card",
            Layer = PictureLayerId,
            Chance = 100,
            CanBeFoil = true,
            Textures = maps.ToDictionary(m => m, m => ImageUrl(images[m]))
        };
        var animated = maps.Where(m => images[m].Frames > 1).ToList();
        if (animated.Count > 0)
            entry.Animation = animated.ToDictionary(m => m, m => new CardAnimationTrack
            {
                Url = FramesUrl(images[m]),
                Frames = images[m].Frames,
                Fps = Math.Clamp(animation?.Slots?.GetValueOrDefault(m) is > 0 and var own ? own : animation?.Fps ?? 12, 0.1, 120)
            });
        return entry;
    }

    private CardAnimation? CardAnimation(Dictionary<string, ImageRow> images, AnimationInfo? info, HashSet<string>? allowed)
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
                Url = FramesUrl(images[channel]),
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

    private CardTextSettings CollectionText(CollectionRow collection)
    {
        var text = collection.CardText!;
        TextStyle? WithFont(TextStyle? style) => style == null || string.IsNullOrWhiteSpace(style.Font)
            ? style
            : style with { Font = FontUrl(collection.Id, style.Font) };
        return text with { Name = WithFont(text.Name), Description = WithFont(text.Description) };
    }
}
