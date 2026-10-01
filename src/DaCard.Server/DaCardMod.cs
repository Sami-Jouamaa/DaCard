using System.Reflection;
using System.Text.RegularExpressions;
using SPTarkov.Common.Models.Logging;
using SPTarkov.DI.Annotations;
using SPTarkov.Server.Core.DI;
using SPTarkov.Server.Core.Helpers.Server;
using SPTarkov.Server.Core.Models.Common;
using SPTarkov.Server.Core.Models.Eft.Common;
using SPTarkov.Server.Core.Models.Eft.Common.Tables;
using SPTarkov.Server.Core.Models.Spt.Config;
using SPTarkov.Server.Core.Models.Spt.Mod;
using SPTarkov.Server.Core.Models.Spt.Tables;
using SPTarkov.Server.Core.Services.Image;
using SPTarkov.Server.Core.Services.Modding.Custom;
using SPTarkov.Server.Core.Utils;
using Path = System.IO.Path;

namespace DaCard.Server;

[Injectable(TypePriority = OnLoadOrder.Preload + 1)]
public class DaCardMod(
    ISptLogger<DaCardMod> logger,
    ModHelper modHelper,
    JsonUtil jsonUtil,
    CardCatalog catalog,
    CollectionBinders binders,
    CustomItemService customItemService,
    ImageRouterService imageRouterService,
    CardLoot cardLoot,
    TradersTable tradersTable,
    GeekTrader geek,
    BoosterPacks boosterPacks,
    ItemLedger ledger,
    CardStickers stickers,
    RagfairConfig ragfairConfig) : IOnLoad
{
    public static string DefaultBundle(string type) => $"dacard/item_card_{type}.bundle";
    public const string ImageRoute = "/dacard/img/";

    internal const string CloneTpl = "5f745ee30acaeb0d490d8c5b";
    internal const string ParentJewelry = "57864a3d24597754843f8721";
    internal const string HandbookValuables = "5b47574386f77428ca22b2f1";
    private const string Roubles = "5449016a4bdc2d6f028b456f";

    private static readonly List<TextureSlot> DefaultSlots =
    [
        new() { Suffix = "", Property = "_MainTex", Required = true },
        new() { Suffix = "height", Property = "_HeightMap", Linear = true, Default = "white" },
        new() { Suffix = "holo", Property = "_HoloMask", Linear = true, Default = "white" },
        new() { Suffix = "foil", Property = "_FoilMask", Linear = true, Default = "white" },
        new() { Suffix = "normal", Property = "_NormalMap", Linear = true, Default = "bump" }
    ];

    private static readonly Dictionary<string, CardTypeSettings> DefaultCardTypes = new()
    {
        ["3d"] = new CardTypeSettings(),
        ["2d"] = new CardTypeSettings { Slots = ["", "holo", "foil", "normal"] }
    };

    public Task OnLoadAsync(CancellationToken cancellationToken)
    {
        var modPath = modHelper.GetAbsolutePathToModFolder(Assembly.GetExecutingAssembly());
        var config = LoadConfig(modPath);
        ledger.Load();

        var slots = config.Textures.Count > 0 ? config.Textures : DefaultSlots;
        if (slots.All(s => s.Suffix != ""))
            slots.Insert(0, new TextureSlot { Suffix = "", Property = "_MainTex", Required = true });
        var dataDir = DataFolder(modPath, out var oldLayout);
        catalog.Scan(dataDir, slots);

        var manifest = new CardManifest
        {
            Slots = slots,
            BackProperty = string.IsNullOrWhiteSpace(config.BackProperty) ? "_CARD_BACK" : config.BackProperty,
            OverlayProperty = string.IsNullOrWhiteSpace(config.OverlayProperty) ? "_CARD_FRONT_BORDER" : config.OverlayProperty
        };
        var configuredTypes = config.CardTypes.Count > 0 ? config.CardTypes : DefaultCardTypes;
        var cardTypes = AvailableTypes(modPath, configuredTypes);
        _stickerBundle = cardTypes.Select(t => t.Value.Bundle ?? DefaultBundle(t.Key.ToLowerInvariant())).First();

        var defaultBack = catalog.BackImagePath != null
            ? CardLayers.FromFiles(dataDir, "back", "default-back", 100, false, false, null, 12)
            : null;
        var defaultBackEntry = defaultBack != null ? RegisterLayer("default", defaultBack) : null;

        var collections = binders.Scan(dataDir);
        StickerOwner OwnerOf(CollectionEntry c) => new("collection:" + c.Key, c.Data.Name!);
        var collectionLayers = collections.ToDictionary(c => c.Key,
            c => (Front: c.Front.Select(l => (l.SourceFile, Entry: RegisterLayer(c.Id, l, OwnerOf(c)))).ToList(),
                  Back: c.Back.Select(l => (l.SourceFile, Entry: RegisterLayer(c.Id, l, OwnerOf(c)))).ToList()));
        var collectionText = collections.ToDictionary(c => c.Key, CollectionText);

        var shownAs = new Dictionary<string, int>();
        var created = new List<CardEntry>();
        foreach (var found in catalog.Cards)
        {
            var rarity = config.Rarities.GetValueOrDefault(found.Rarity) ?? new RaritySettings();
            var (typeName, type) = ResolveType(found, cardTypes, configuredTypes, shownAs);
            var card = OnlyTypeSlots(found, type);
            var bundle = type.Bundle ?? DefaultBundle(typeName);
            var collection = collections.FirstOrDefault(c => CollectionBinders.IsMember(card, c));
            var hiddenLayers = (card.Data.HideCollectionLayers ?? []).ToHashSet(StringComparer.OrdinalIgnoreCase);
            List<LayerManifestEntry> CollectionPart(List<(string File, LayerManifestEntry Entry)> layers) => layers
                .Select(l => AlignedFor(l.Entry, card.Data.TextAlign))
                .Select((entry, i) => card.Data.CollectionLayers == false || hiddenLayers.Contains(layers[i].File) ? entry with { Chance = 0 } : entry)
                .ToList();
            var collFront = collection != null ? CollectionPart(collectionLayers[collection.Key].Front) : [];
            var collBack = collection != null ? CollectionPart(collectionLayers[collection.Key].Back) : [];

            // Bottom to top: the card's layers, the collection's layers, the card's layers marked "over".
            // card.png: a 3D card's picture behind the window (with its depth map). A 2D card from before layers (or a
            // 3D card shown flat when its bundle is missing): its bottom layer. A layered 2D card's card.png is only its thumbnail.
            var usesDepth = type.Slots == null || type.Slots.Contains("height", StringComparer.OrdinalIgnoreCase);
            var declared = found.Data.Type?.Trim().ToLowerInvariant() ?? (found.Textures.ContainsKey("height") ? "3d" : "2d");
            var picture = !usesDepth && card.Textures.ContainsKey("") && (!card.HasLayers || declared != typeName)
                ? CardLayers.FromLegacyCard(card.Dir, card.Data.Animation)
                : null;
            var owner = new StickerOwner("card:" + card.Key, card.Data.Name!);
            List<LayerManifestEntry> Card(IEnumerable<LayerSource> layers) => layers.Select(l => RegisterLayer(card.Id, l, owner)).ToList();
            var front = Card(picture != null ? [picture] : []).Concat(Card(card.Front.Where(l => !l.Over)))
                .Concat(collFront).Concat(Card(card.Front.Where(l => l.Over))).ToList();
            var back = Card(card.Back.Where(l => !l.Over)).Concat(collBack).Concat(Card(card.Back.Where(l => l.Over))).ToList();
            if (back.Count == 0 && defaultBackEntry != null)
                back.Add(defaultBackEntry);

            var foilTpl = CardCatalog.FoilIdFor(card);
            foreach (var layer in front.Concat(back))
                ledger.RecordLayer(card.Id, layer.Key, layer.Chance);
            if (!CreateItem(card, CardPrice(rarity), rarity, bundle, foil: false, stickers.SlotsFor(card.Id, card.Id, front.Concat(back))))
                continue;
            var hasFoil = CreateItem(card, FoilPrice(config, rarity), rarity, bundle, foil: true, stickers.SlotsFor(foilTpl, card.Id, front.Concat(back)));
            created.Add(card);

            var entry = new CardManifestEntry
            {
                Tpl = card.Id,
                Rarity = card.Rarity,
                Type = typeName,
                Floats = card.Data.Floats is { Count: > 0 } own
                    ? type.Floats.Concat(own).GroupBy(p => p.Key).ToDictionary(g => g.Key, g => g.Last().Value)
                    : type.Floats,
                Textures = slots.Where(s => usesDepth && card.Textures.ContainsKey(s.Suffix)).ToDictionary(
                    s => s.Property,
                    s => RegisterImage(s.Suffix == "" ? card.Id : card.Id + "_" + s.Suffix.Replace('.', '_'), card.Textures[s.Suffix])),
                HoloStrength = card.Data.Holo?.Strength ?? rarity.Holo.Strength ?? 0,
                HoloPattern = PatternIndex(card.Data.Holo?.Pattern ?? rarity.Holo.Pattern),
                HoloAngle = card.Data.Holo?.Angle ?? rarity.Holo.Angle ?? 30,
                RarityColor = rarity.Color,
                Glow = (card.Data.Glow ?? new GlowSettings())
                    .Over((rarity.Glow ?? new GlowSettings()).Over(GlowSettings.Defaults.GetValueOrDefault(card.Rarity)))
                    .Resolve(rarity.Color),
                Collection = collection?.Data.Name,
                Front = front,
                Back = back,
                Text = collection != null ? collectionText[collection.Key]?.WithAlign(card.Data.TextAlign) : null,
                Animation = usesDepth ? RegisterFrames(card, slots) : null
            };
            manifest.Cards.Add(entry);
            if (hasFoil)
                manifest.Cards.Add(entry with { Tpl = foilTpl, Foil = true, BaseTpl = card.Id });
        }

        foreach (var (what, count) in shownAs)
            logger.Info($"[DaCard] {count} {what}: that card type's bundle is missing, so they are shown flat.");

        if (collections.Count > 0 && !File.Exists(Path.Combine(modPath, "bundles", CollectionBinders.BundlePath)))
            logger.Error($"[DaCard] bundles/{CollectionBinders.BundlePath} is missing, binders will have no model. Build the bundles in Unity.");
        manifest.Binders = binders.CreateBinders(collections, created, config.Binders, RegisterImage);

        var packs = boosterPacks.Scan(modPath);
        if (packs.Count > 0 && !File.Exists(Path.Combine(modPath, "bundles", BoosterPacks.BundlePath)))
            logger.Error($"[DaCard] bundles/{BoosterPacks.BundlePath} is missing, booster packs will have no model. Build the bundles in Unity.");
        var foilOf = manifest.Cards.Where(c => c.Foil && c.BaseTpl != null).ToDictionary(c => c.BaseTpl!, c => c.Tpl);
        manifest.Packs = boosterPacks.Create(packs, created, foilOf, config, FoilShare(config), RegisterImage);

        ledger.RetireMissing(modPath, config.RetiredItems, oldLayout);

        catalog.Manifest = manifest;
        stickers.Enable();
        catalog.Fonts = _fonts;
        cardLoot.Configure(config, manifest, FoilShare(config), boosterPacks.Loot);
        if (geek.Add(modPath))
        {
            AddTraderOffers(manifest.Binders.ToDictionary(b => b.Tpl, _ => config.Binders.Price), "binder");
            AddTraderOffers(boosterPacks.Offers, "booster pack");
            RaritySettings RarityOf(CardManifestEntry c) => config.Rarities.GetValueOrDefault(c.Rarity) ?? new RaritySettings();
            if (config.Geek.SellCards)
                AddTraderOffers(manifest.Cards.Where(c => !c.Foil).ToDictionary(c => c.Tpl, c => CardPrice(RarityOf(c))), "card");
            if (config.Geek.SellFoilCards)
                AddTraderOffers(manifest.Cards.Where(c => c.Foil).ToDictionary(c => c.Tpl, c => FoilPrice(config, RarityOf(c))), "foil card");
            SetBuyers(manifest.Cards.Select(c => c.Tpl).Concat(manifest.Binders.Select(b => b.Tpl))
                .Concat(manifest.Packs.Select(p => p.Tpl)).Concat(stickers.Stickers).Concat(ledger.Placeholders).ToList());
        }

        var regular = manifest.Cards.Where(c => !c.Foil).ToList();
        var perRarity = string.Join(", ", CardCatalog.RarityOrder.Select(r => $"{r} {regular.Count(c => c.Rarity == r)}"));
        var perType = string.Join(", ", regular.GroupBy(c => c.Type).Select(g => $"{g.Count()} {g.Key.ToUpperInvariant()}"));
        logger.Success($"[DaCard] 1.0.0 loaded {regular.Count} card(s) + their foil versions ({FoilShare(config):0.#%} of cards found): " +
                       $"{perRarity} ({perType}); {manifest.Binders.Count} collection binder(s); {manifest.Packs.Count} booster pack(s)");
        return Task.CompletedTask;
    }

    private Dictionary<string, CardTypeSettings> AvailableTypes(string modPath, Dictionary<string, CardTypeSettings> types)
    {
        var available = types.Where(t => File.Exists(Path.Combine(modPath, "bundles", t.Value.Bundle ?? DefaultBundle(t.Key.ToLowerInvariant()))))
            .ToDictionary(t => t.Key, t => t.Value, StringComparer.OrdinalIgnoreCase);
        if (available.Count > 0)
            return available;

        foreach (var (name, type) in types)
            logger.Error($"[DaCard] Card type \"{name}\": bundles/{type.Bundle ?? DefaultBundle(name.ToLowerInvariant())} is missing, its cards will have no model. " +
                         "Build the mod in Unity (DaCard > Build Mod) with a material for this type.");
        return new Dictionary<string, CardTypeSettings>(types, StringComparer.OrdinalIgnoreCase);
    }

    private (string Name, CardTypeSettings Settings) ResolveType(CardEntry card, Dictionary<string, CardTypeSettings> types,
        Dictionary<string, CardTypeSettings> configured, Dictionary<string, int> shownAs)
    {
        var name = card.Data.Type?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(name))
            name = card.Textures.ContainsKey("height") ? "3d" : "2d";

        if (types.TryGetValue(name, out var match))
            return (name, match);

        var fallback = types.ContainsKey("2d") ? "2d" : types.Keys.First().ToLowerInvariant();
        if (configured.Keys.Any(k => k.Equals(name, StringComparison.OrdinalIgnoreCase)))
        {
            var what = $"{name.ToUpperInvariant()} card(s)";
            shownAs[what] = shownAs.GetValueOrDefault(what) + 1;
        }
        else
        {
            logger.Error($"[DaCard] {card.Key} ({card.Rarity}): unknown type \"{card.Data.Type}\" (config.json cardTypes: {string.Join(", ", configured.Keys)}); using {fallback}.");
        }
        return (fallback, types[fallback]);
    }

    private static CardEntry OnlyTypeSlots(CardEntry card, CardTypeSettings type)
    {
        if (type.Slots == null)
            return card;
        var keep = type.Slots.Append("").ToHashSet(StringComparer.OrdinalIgnoreCase);
        return card with
        {
            Textures = card.Textures.Where(t => keep.Contains(t.Key)).ToDictionary(t => t.Key, t => t.Value),
            Frames = card.Frames.Where(f => keep.Contains(f.Key)).ToDictionary(f => f.Key, f => f.Value)
        };
    }

    public const string ConfigFile = "data/config.json";

    private string DataFolder(string modPath, out bool oldLayout)
    {
        var data = Path.Combine(modPath, "data");
        var known = new[] { CardCatalog.CardsFolder, BoosterPacks.PacksFolder, BoosterPacks.SkinsFolder }.Select(Path.GetFileName).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var old = new[] { "cards", "collections", "packs", "skins" }.Where(f => Directory.Exists(Path.Combine(modPath, f))).Select(f => f + "/").ToList();
        if (File.Exists(Path.Combine(modPath, Path.GetFileName(ConfigFile))))
            old.Add(Path.GetFileName(ConfigFile));
        if (Directory.Exists(data))
            old.AddRange(Directory.GetDirectories(data).Select(Path.GetFileName).Where(f => !known.Contains(f!)).Select(f => $"data/{f}/"));
        oldLayout = old.Count > 0;
        if (oldLayout)
            logger.Warning($"[DaCard] {string.Join(", ", old)} {(old.Count == 1 ? "is" : "are")} the old layout and ignored: cards go into " +
                           $"{CardCatalog.CardsFolder}/<collection>/<Rarity>/<card>/, booster packs into {BoosterPacks.PacksFolder}/, " +
                           $"skins into {BoosterPacks.SkinsFolder}/, the settings into {ConfigFile}. Until they are moved, nothing is removed from profiles.");
        return Path.Combine(modPath, CardCatalog.CardsFolder);
    }

    private static double CardPrice(RaritySettings rarity) => rarity.Price > 0 ? rarity.Price : 1000;

    private static double FoilPrice(DaCardConfig config, RaritySettings rarity) =>
        Math.Max(1, Math.Round(CardPrice(rarity) * config.Foil.PriceMultiplier));

    private static double FoilShare(DaCardConfig config) => Math.Clamp(config.Foil.Percent, 0, 100) / 100;

    private bool CreateItem(CardEntry card, double price, RaritySettings rarity, string bundle, bool foil, List<Slot> slots)
    {
        var tint = !card.Rarity.Equals("Common", StringComparison.OrdinalIgnoreCase)
                   && Regex.IsMatch(rarity.Color, "^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
            ? "#" + rarity.Color.TrimStart('#')
            : null;
        string Colored(string? name) => tint != null && name != null ? $"<color={tint}>{name}</color>" : name!;
        string Name(string? name) => Colored(foil && name != null ? name + " (Foil)" : name);
        string ShortName(string? name) => Colored(foil && name != null ? name + " (F)" : name);

        var locales = new Dictionary<string, LocaleDetails>
        {
            ["en"] = new()
            {
                Name = Name(card.Data.Name),
                ShortName = ShortName(card.Data.ShortName ?? card.Data.Name),
                Description = card.Data.Description ?? $"{card.Rarity} {(foil ? "foil " : "")}collectible card."
            }
        };
        foreach (var (lang, text) in card.Data.Locales ?? new())
        {
            locales[lang] = new LocaleDetails
            {
                Name = Name(text.Name ?? card.Data.Name),
                ShortName = ShortName(text.ShortName ?? text.Name ?? card.Data.ShortName ?? card.Data.Name),
                Description = text.Description ?? card.Data.Description
            };
        }

        var result = customItemService.CreateItemFromClone(new NewItemFromCloneDetails
        {
            ItemTplToClone = CollectionBinders.CloneTpl,
            ParentId = CollectionBinders.ParentCompoundItem,
            NewId = new MongoId(foil ? CardCatalog.FoilIdFor(card) : card.Id),
            NewItemName = "dacard_" + card.Key.ToLowerInvariant().Replace('/', '_') + (foil ? "_foil" : ""),
            FleaPriceRoubles = price,
            HandbookPriceRoubles = price,
            HandbookParentId = HandbookValuables,
            AddToHandbook = true,
            AddToFleaPriceDb = true,
            Locales = locales,
            OverrideProperties = new TemplateItemProperties
            {
                Prefab = new Prefab { Path = bundle, Rcid = "" },
                Width = 1,
                Height = 1,
                Weight = 0.005,
                BackgroundColor = rarity.Background,
                ExaminedByDefault = true,
                CanSellOnRagfair = false,
                ItemSound = "jewelry",
                LootExperience = 100,
                ExamineExperience = 100,
                MergesWithChildren = false,
                HideEntrails = false,
                Grids = [],
                Slots = slots
            }
        }, Assembly.GetExecutingAssembly());

        if (!result.Success)
        {
            logger.Error($"[DaCard] Could not create card '{card.Key}'{(foil ? " (foil)" : "")}: {string.Join("; ", result.Errors ?? [])}");
            return false;
        }

        ragfairConfig.Dynamic.Blacklist.Custom.Add(new MongoId(foil ? CardCatalog.FoilIdFor(card) : card.Id));
        ledger.Record(foil ? CardCatalog.FoilIdFor(card) : card.Id, new LedgerItem
        {
            Kind = foil ? ItemLedger.Foil : ItemLedger.Card,
            Key = card.Key,
            Name = foil ? $"{card.Data.Name} (Foil)" : card.Data.Name!,
            Price = price,
            Background = rarity.Background,
            Bundle = bundle,
            Slots = slots.Select(s => new LedgerSlot
            {
                Name = s.Name!,
                Id = s.Id.ToString()!,
                Label = stickers.SlotsOf(foil ? CardCatalog.FoilIdFor(card) : card.Id).FirstOrDefault(x => x.Name == s.Name)?.Label,
                Filter = s.Properties?.Filters?.FirstOrDefault()?.Filter?.Select(f => f.ToString()).ToList() ?? []
            }).ToList()
        });
        return true;
    }

    private CardAnimation? RegisterFrames(CardEntry card, List<TextureSlot> slots)
    {
        if (card.Frames.Count == 0)
            return null;

        var info = card.Data.Animation;
        double? OwnFps(string suffix) =>
            info?.Slots != null && info.Slots.TryGetValue(suffix == "" ? "art" : suffix, out var fps) && fps > 0 ? fps : null;
        // Maps without their own fps play in step, so all of them stop at the shortest one's length
        var shared = card.Frames.Where(f => OwnFps(f.Key) == null).Select(f => f.Value.Count).DefaultIfEmpty(0).Min();

        var animation = new CardAnimation();
        foreach (var slot in slots.Where(s => card.Frames.ContainsKey(s.Suffix)))
        {
            var own = OwnFps(slot.Suffix);
            var count = own != null ? card.Frames[slot.Suffix].Count : shared;
            var baseName = (slot.Suffix == "" ? card.Id : card.Id + "_" + slot.Suffix.Replace('.', '_')) + "_f";
            for (var i = 0; i < count; i++)
                RegisterImage(baseName + i.ToString("000"), card.Frames[slot.Suffix][i]);
            animation.Tracks[slot.Property] = new CardAnimationTrack
            {
                Url = ImageRoute + baseName.ToLowerInvariant(),
                Frames = count,
                Fps = Math.Clamp(own ?? info?.Fps ?? 12, 0.1, 120)
            };
        }
        return animation;
    }

    private string _stickerBundle = DefaultBundle("2d");

    private LayerManifestEntry RegisterLayer(string ownerId, LayerSource layer, StickerOwner? owner = null)
    {
        var name = "l" + CardCatalog.IdFor(ownerId + ":" + layer.Key);
        var entry = new LayerManifestEntry
        {
            Key = layer.Key,
            Chance = layer.Chance,
            CanBeFoil = layer.CanBeFoil,
            Frame = layer.Frame,
            Transform = layer.Transform,
            Sticker = owner != null ? stickers.Register(ownerId, owner, layer, _stickerBundle) : null,
            Textures = layer.Maps.ToDictionary(m => m.Key, m => RegisterImage($"{name}_{m.Key}", m.Value)),
            Id = layer.Id,
            Name = string.IsNullOrWhiteSpace(layer.Name) ? null : layer.Name.Trim(),
            Text = layer.Text == null ? null : layer.Text with { Font = RegisterFont(layer.FontPath) }
        };
        if (layer.Frames.Count == 0)
            return entry;

        // Maps without their own fps play in step, so all of them stop at the shortest one's length
        double? Own(string map) => layer.Fps.TryGetValue(map, out var fps) ? fps : null;
        var shared = layer.Frames.Where(f => Own(f.Key) == null).Select(f => f.Value.Count).DefaultIfEmpty(0).Min();
        entry.Animation = new Dictionary<string, CardAnimationTrack>();
        foreach (var (map, frames) in layer.Frames)
        {
            var own = Own(map);
            var count = own != null ? frames.Count : shared;
            var baseName = $"{name}_{map}_f";
            for (var i = 0; i < count; i++)
                RegisterImage(baseName + i.ToString("000"), frames[i]);
            entry.Animation[map] = new CardAnimationTrack
            {
                Url = ImageRoute + baseName.ToLowerInvariant(),
                Frames = count,
                Fps = Math.Clamp(own ?? layer.SharedFps, 0.1, 120)
            };
        }
        return entry;
    }

    private readonly Dictionary<string, string> _fonts = new();

    private string? RegisterFont(string? path)
    {
        if (path == null)
            return null;
        var id = "f" + CardCatalog.IdFor("font:" + Path.GetFullPath(path).ToLowerInvariant());
        if (!_fonts.ContainsKey(id))
            _fonts[id] = Convert.ToBase64String(File.ReadAllBytes(path));
        return id;
    }

    private static LayerManifestEntry AlignedFor(LayerManifestEntry layer, Dictionary<string, string>? align) =>
        layer.Text != null && layer.Id != null && align != null && align.TryGetValue(layer.Id, out var a) && CardTextSettings.IsAlign(a)
            ? layer with { Text = layer.Text with { Align = a } }
            : layer;

    private CardTextSettings? CollectionText(CollectionEntry collection)
    {
        var text = collection.Data.CardText;
        if (text == null)
            return null;

        TextStyle? WithFont(TextStyle? style, string what)
        {
            if (style == null || string.IsNullOrWhiteSpace(style.Font))
                return style;
            var file = Path.GetFileName(style.Font);
            var path = Path.Combine(collection.Dir, file);
            if (!File.Exists(path))
            {
                logger.Warning($"[DaCard] {CardCatalog.CardsFolder}/{collection.Key}/{file} (the cards' {what} font) is missing: the default font is used.");
                return style with { Font = null };
            }
            return style with { Font = RegisterFont(path) };
        }

        return text with { Name = WithFont(text.Name, "name"), Description = WithFont(text.Description, "description") };
    }

    private string RegisterImage(string name, string path)
    {
        var route = ImageRoute + name.ToLowerInvariant();
        imageRouterService.AddRoute(route, path);
        return route + ".png";
    }

    private void AddTraderOffers(Dictionary<string, double> prices, string what)
    {
        if (prices.Count == 0 || !tradersTable.TryGetValue(GeekTrader.Id, out var trader))
            return;

        var assort = trader.Assort;
        foreach (var (tpl, price) in prices)
        {
            var offerId = new MongoId(CardCatalog.IdFor("trader-offer:" + tpl));
            assort.Items.Add(new Item
            {
                Id = offerId,
                Template = new MongoId(tpl),
                ParentId = "hideout",
                SlotId = "hideout",
                Upd = new Upd { UnlimitedCount = true, StackObjectsCount = 999999 }
            });
            assort.BarterScheme[offerId] = [[new BarterScheme { Count = price, Template = new MongoId(Roubles) }]];
            assort.LoyalLevelItems[offerId] = 1;
        }

        logger.Info($"[DaCard] {trader.Base.Nickname} sells {prices.Count} {what}(s)");
    }

    private void SetBuyers(List<string> tpls)
    {
        if (tpls.Count == 0)
            return;

        var ids = tpls.Select(t => new MongoId(t)).ToList();
        var wanted = new HashSet<MongoId> { GeekTrader.Id };

        var names = new List<string>();
        foreach (var (id, trader) in tradersTable)
        {
            var buys = wanted.Contains(id);
            var list = buys
                ? trader.Base.ItemsBuy ??= new ItemBuyData { Category = [], IdList = [] }
                : trader.Base.ItemsBuyProhibited ??= new ItemBuyData { Category = [], IdList = [] };
            list.IdList.UnionWith(ids);
            if (buys)
                names.Add(trader.Base.Nickname ?? id.ToString());
        }
        logger.Info($"[DaCard] Cards, binders and booster packs are bought by: {string.Join(", ", names)}");
    }

    private DaCardConfig LoadConfig(string modPath)
    {
        var path = Path.Combine(modPath, ConfigFile);
        try
        {
            var text = File.ReadAllText(path);
            var config = jsonUtil.Deserialize<DaCardConfig>(text);
            if (config != null)
            {
                if (text.Contains("\"traderSale\""))
                    logger.Warning("[DaCard] config.json \"traderSale\" is no longer used: Geek sells the binders, and the cards with \"geek\" \"sellCards\" " +
                                   "(prices come from the rarities and binders.price).");
                config.Rarities = new Dictionary<string, RaritySettings>(config.Rarities, StringComparer.OrdinalIgnoreCase);
                return config;
            }
        }
        catch (Exception e)
        {
            logger.Error($"[DaCard] Could not read {path}: {e.Message}. Using no loot spawns.");
        }

        return new DaCardConfig();
    }

    private static int PatternIndex(string? pattern) => pattern?.ToLowerInvariant() switch
    {
        "radial" => 1,
        "sparkle" => 2,
        _ => 0
    };
}
