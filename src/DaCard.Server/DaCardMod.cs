using System.Reflection;
using System.Text.RegularExpressions;
using DaCard.Server.Storage;
using SPTarkov.Common.Models.Logging;
using SPTarkov.DI.Annotations;
using SPTarkov.Server.Core.DI;
using SPTarkov.Server.Core.Helpers.Server;
using SPTarkov.Server.Core.Models.Common;
using SPTarkov.Server.Core.Models.Eft.Common.Tables;
using SPTarkov.Server.Core.Models.Spt.Config;
using SPTarkov.Server.Core.Models.Spt.Mod;
using SPTarkov.Server.Core.Models.Spt.Tables;
using SPTarkov.Server.Core.Services.Modding.Custom;
using Path = System.IO.Path;

namespace DaCard.Server;

[Injectable(TypePriority = OnLoadOrder.Preload + 1)]
public class DaCardMod(
    ISptLogger<DaCardMod> logger,
    ModHelper modHelper,
    DashboardUpgrade upgrade,
    DaCardDatabase database,
    CardStore store,
    CardIndex index,
    CollectionBinders binders,
    CustomItemService customItemService,
    CardLoot cardLoot,
    TradersTable tradersTable,
    GeekTrader geek,
    BoosterPacks boosterPacks,
    ItemLedger ledger,
    DaCardHandbook handbook,
    CardStickers stickers,
    RagfairConfig ragfairConfig) : IOnLoad
{
    public static string DefaultBundle(string type) => $"dacard/item_card_{type}.bundle";

    internal const string CloneTpl = "5f745ee30acaeb0d490d8c5b";
    internal const string ParentJewelry = "57864a3d24597754843f8721";
    private const string Roubles = "5449016a4bdc2d6f028b456f";
    public const string DefaultConfigFile = "defaults/config.json";

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
        index.Clear();
        handbook.Register();
        upgrade.Run(modPath);
        var problem = database.Open(modPath);
        if (problem != null)
        {
            logger.Error($"[DaCard] No cards, binders or booster packs: {problem}.");
            return Task.CompletedTask;
        }
        ledger.Load();
        var config = store.LoadConfig(Path.Combine(modPath, DefaultConfigFile));
        index.Config = config;

        var slots = config.Textures.Count > 0 ? config.Textures : DefaultSlots;
        if (slots.All(s => s.Suffix != ""))
            slots.Insert(0, new TextureSlot { Suffix = "", Property = "_MainTex", Required = true });
        index.Slots = slots;
        var configuredTypes = config.CardTypes.Count > 0 ? config.CardTypes : DefaultCardTypes;
        var cardTypes = AvailableTypes(modPath, configuredTypes);
        index.Types = new Dictionary<string, CardTypeSettings>(cardTypes, StringComparer.OrdinalIgnoreCase);
        var stickerBundle = cardTypes.Select(t => t.Value.Bundle ?? DefaultBundle(t.Key.ToLowerInvariant())).First();

        var collections = store.Collections();
        var collectionById = collections.ToDictionary(c => c.Id, StringComparer.OrdinalIgnoreCase);
        var layers = store.AllLayers();
        var layersOf = layers.GroupBy(l => (l.OwnerKind, l.OwnerId)).ToDictionary(g => g.Key, g => g.ToList());
        var stickerArt = store.Images(layers.Where(l => l.Chance < 100).Select(l => l.Id))
            .Where(i => i.Channel == CardManifests.Albedo).ToDictionary(i => i.SetId, i => CardManifests.ImageUrl(i.SetId, i.Channel));

        foreach (var collection in collections)
            foreach (var layer in layersOf.GetValueOrDefault(("collection", collection.Id)) ?? [])
                RegisterSticker(collection.Id, new StickerOwner($"collection:{collection.Id}", collection.Name), layer, stickerBundle, stickerArt);

        _hidden = store.HiddenLayers();
        var shownAs = new Dictionary<string, int>();
        var created = new List<CardRow>();
        var cards = store.Cards();
        foreach (var card in cards)
        {
            if (!collectionById.ContainsKey(card.CollectionId))
                continue;
            var rarity = config.Rarities.GetValueOrDefault(card.Rarity) ?? new RaritySettings();
            var (typeName, type) = ResolveType(card, cardTypes, configuredTypes, shownAs);
            var bundle = type.Bundle ?? DefaultBundle(typeName);
            var usesDepth = type.Slots == null || type.Slots.Contains("height", StringComparer.OrdinalIgnoreCase);

            var own = layersOf.GetValueOrDefault(("card", card.Id)) ?? [];
            foreach (var layer in own)
                RegisterSticker(card.Id, new StickerOwner($"card:{card.Id}", card.Name), layer, stickerBundle, stickerArt);
            var stack = StickerStack(card, own, layersOf.GetValueOrDefault(("collection", card.CollectionId)) ?? []);
            foreach (var (key, chance, _, _) in stack)
                ledger.RecordLayer(card.Id, key, chance);

            if (!CreateItem(card, CardPrice(rarity), rarity, bundle, foil: false, stickers.SlotsFor(card.Id, card.Id, stack)))
                continue;
            var hasFoil = CreateItem(card, FoilPrice(config, rarity), rarity, bundle, foil: true, stickers.SlotsFor(card.FoilId, card.Id, stack));
            created.Add(card);
            index.Cards[card.Id] = new CreatedCard(card.Id, card.FoilId, card.CollectionId, card.Rarity, card.Type.Trim().ToLowerInvariant(), typeName, usesDepth, hasFoil);
            if (hasFoil)
                index.FoilToBase[card.FoilId] = card.Id;
        }

        foreach (var (what, count) in shownAs)
            logger.Info($"[DaCard] {count} {what}: that card type's bundle is missing, so they are shown flat.");

        if (collections.Count > 0 && !File.Exists(Path.Combine(modPath, "bundles", CollectionBinders.BundlePath)))
            logger.Error($"[DaCard] bundles/{CollectionBinders.BundlePath} is missing, binders will have no model. Build the bundles in Unity.");
        var binderEntries = binders.CreateBinders(collections, created, store.BinderStickers(), config.Binders);

        var packs = boosterPacks.Create(store.Packs(), config, FoilShare(config));
        if (packs.Count > 0 && !File.Exists(Path.Combine(modPath, "bundles", BoosterPacks.BundlePath)))
            logger.Error($"[DaCard] bundles/{BoosterPacks.BundlePath} is missing, booster packs will have no model. Build the bundles in Unity.");

        ledger.RetireMissing(modPath, config.RetiredItems, store.Exists);

        index.Client = new ClientIndex
        {
            Slots = slots,
            BackProperty = string.IsNullOrWhiteSpace(config.BackProperty) ? "_CARD_BACK" : config.BackProperty,
            OverlayProperty = string.IsNullOrWhiteSpace(config.OverlayProperty) ? "_CARD_FRONT_BORDER" : config.OverlayProperty,
            Cards = index.Cards.Keys.ToList(),
            Foils = new Dictionary<string, string>(index.FoilToBase),
            Binders = binderEntries,
            Packs = packs,
            Stickers = index.StickerOf.Values.Distinct().ToDictionary(t => t, t => _stickerArt.GetValueOrDefault(t)),
            Fonts = layers.Any(l => !string.IsNullOrWhiteSpace(l.Text?.Font)) || collections.Any(c => c.CardText?.Name?.Font != null || c.CardText?.Description?.Font != null)
        };

        stickers.Enable();
        cardLoot.Configure(config, index.Cards.Values.ToList(), FoilShare(config), boosterPacks.Loot);
        if (geek.Add(modPath))
        {
            AddTraderOffers(binderEntries.ToDictionary(b => b.Tpl, _ => config.Binders.Price), "binder");
            AddTraderOffers(boosterPacks.Offers, "booster pack");
            RaritySettings RarityOf(CreatedCard c) => config.Rarities.GetValueOrDefault(c.Rarity) ?? new RaritySettings();
            if (config.Geek.SellCards)
                AddTraderOffers(index.Cards.Values.ToDictionary(c => c.Id, c => CardPrice(RarityOf(c))), "card");
            if (config.Geek.SellFoilCards)
                AddTraderOffers(index.Cards.Values.Where(c => c.HasFoil).ToDictionary(c => c.FoilId, c => FoilPrice(config, RarityOf(c))), "foil card");
            SetBuyers(index.Cards.Keys.Concat(index.FoilToBase.Keys).Concat(binderEntries.Select(b => b.Tpl))
                .Concat(packs.Select(p => p.Tpl)).Concat(stickers.Stickers).Concat(ledger.Placeholders).ToList());
        }

        var perRarity = string.Join(", ", CardCatalog.RarityOrder.Select(r => $"{r} {index.Cards.Values.Count(c => c.Rarity == r)}"));
        var perType = string.Join(", ", index.Cards.Values.GroupBy(c => c.TypeName).Select(g => $"{g.Count()} {g.Key.ToUpperInvariant()}"));
        logger.Success($"[DaCard] {ModMetadata.CurrentVersion} loaded {index.Cards.Count} card(s) + their foil versions ({FoilShare(config):0.#%} of cards found): " +
                       $"{perRarity} ({perType}); {binderEntries.Count} collection binder(s); {packs.Count} booster pack(s); {collections.Count} collection(s)");
        return Task.CompletedTask;
    }

    private readonly Dictionary<string, string?> _stickerArt = new(StringComparer.OrdinalIgnoreCase);
    private Dictionary<string, (bool CollectionLayers, List<string> Hidden)> _hidden = new();

    private void RegisterSticker(string ownerId, StickerOwner owner, LayerRow layer, string bundle, Dictionary<string, string> art)
    {
        var tpl = stickers.Register(ownerId, owner, layer, bundle);
        if (tpl == null)
            return;
        index.StickerOf[CardIndex.StickerKey(ownerId, layer.Key)] = tpl;
        _stickerArt[tpl] = art.GetValueOrDefault(layer.Id);
    }

    private List<(string Key, double Chance, string? Sticker, string? Name)> StickerStack(CardRow card, List<LayerRow> own, List<LayerRow> collection)
    {
        var found = _hidden.TryGetValue(card.Id, out var h);
        var hidden = (found ? h.Hidden : []).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var hideAll = found && !h.CollectionLayers;
        (string, double, string?, string?) Own(LayerRow l) =>
            (l.Key, Math.Clamp(l.Chance, 0, 100), index.StickerOf.GetValueOrDefault(CardIndex.StickerKey(card.Id, l.Key)), l.Name);
        (string, double, string?, string?) Coll(LayerRow l) =>
            (l.Key, hideAll || hidden.Contains(l.Id) ? 0 : Math.Clamp(l.Chance, 0, 100), index.StickerOf.GetValueOrDefault(CardIndex.StickerKey(card.CollectionId, l.Key)), l.Name);
        var stack = new List<(string Key, double Chance, string? Sticker, string? Name)>();
        foreach (var face in new[] { "front", "back" })
        {
            var mine = own.Where(l => l.Face == face).OrderBy(l => l.Position).ToList();
            var theirs = collection.Where(l => l.Face == face).OrderBy(l => l.Position).ToList();
            var part = mine.Where(l => !l.Over).Select(Own).Concat(theirs.Select(Coll)).Concat(mine.Where(l => l.Over).Select(Own)).ToList();
            if (face == "back" && part.Count == 0)
                part = collection.Where(l => l.Face == "default-back").Select(Coll).ToList();
            stack.AddRange(part);
        }
        return stack;
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

    private (string Name, CardTypeSettings Settings) ResolveType(CardRow card, Dictionary<string, CardTypeSettings> types,
        Dictionary<string, CardTypeSettings> configured, Dictionary<string, int> shownAs)
    {
        var name = string.IsNullOrWhiteSpace(card.Type) ? "2d" : card.Type.Trim().ToLowerInvariant();
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
            logger.Error($"[DaCard] {card.Name} ({card.Rarity}): unknown type \"{card.Type}\" (settings card types: {string.Join(", ", configured.Keys)}); using {fallback}.");
        }
        return (fallback, types[fallback]);
    }

    private static double CardPrice(RaritySettings rarity) => rarity.Price > 0 ? rarity.Price : 1000;

    private static double FoilPrice(DaCardConfig config, RaritySettings rarity) =>
        Math.Max(1, Math.Round(CardPrice(rarity) * config.Foil.PriceMultiplier));

    private static double FoilShare(DaCardConfig config) => Math.Clamp(config.Foil.Percent, 0, 100) / 100;

    private bool CreateItem(CardRow card, double price, RaritySettings rarity, string bundle, bool foil, List<Slot> slots)
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
                Name = Name(card.Name),
                ShortName = ShortName(card.ShortName ?? card.Name),
                Description = card.Description ?? $"{card.Rarity} {(foil ? "foil " : "")}collectible card."
            }
        };
        foreach (var (lang, text) in card.Locales ?? new())
        {
            locales[lang] = new LocaleDetails
            {
                Name = Name(text.Name ?? card.Name),
                ShortName = ShortName(text.ShortName ?? text.Name ?? card.ShortName ?? card.Name),
                Description = text.Description ?? card.Description
            };
        }

        var tpl = foil ? card.FoilId : card.Id;
        var result = customItemService.CreateItemFromClone(new NewItemFromCloneDetails
        {
            ItemTplToClone = CollectionBinders.CloneTpl,
            ParentId = CollectionBinders.ParentCompoundItem,
            NewId = new MongoId(tpl),
            NewItemName = "dacard_" + card.IdKey.ToLowerInvariant().Replace('/', '_') + (foil ? "_foil" : ""),
            FleaPriceRoubles = price,
            HandbookPriceRoubles = price,
            HandbookParentId = foil ? DaCardHandbook.Foils : DaCardHandbook.Cards,
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
            logger.Error($"[DaCard] Could not create card '{card.Name}'{(foil ? " (foil)" : "")}: {string.Join("; ", result.Errors ?? [])}");
            return false;
        }

        ragfairConfig.Dynamic.Blacklist.Custom.Add(new MongoId(tpl));
        ledger.Record(tpl, new LedgerItem
        {
            Kind = foil ? ItemLedger.Foil : ItemLedger.Card,
            Key = card.LegacyKey ?? card.IdKey,
            Name = foil ? $"{card.Name} (Foil)" : card.Name,
            Price = price,
            Background = rarity.Background,
            Bundle = bundle,
            Slots = slots.Select(s => new LedgerSlot
            {
                Name = s.Name!,
                Id = s.Id.ToString()!,
                Label = stickers.SlotsOf(tpl).FirstOrDefault(x => x.Name == s.Name)?.Label,
                Filter = s.Properties?.Filters?.FirstOrDefault()?.Filter?.Select(f => f.ToString()).ToList() ?? []
            }).ToList()
        });
        return true;
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
}
