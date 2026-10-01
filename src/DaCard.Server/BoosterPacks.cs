using System.Reflection;
using DaCard.Server.Storage;
using SPTarkov.Common.Models.Logging;
using SPTarkov.DI.Annotations;
using SPTarkov.Reflection.Patching;
using SPTarkov.Server.Core.Controllers;
using SPTarkov.Server.Core.Helpers.Profile;
using SPTarkov.Server.Core.Models.Common;
using SPTarkov.Server.Core.Models.Eft.Common;
using SPTarkov.Server.Core.Models.Eft.Common.Tables;
using SPTarkov.Server.Core.Models.Eft.Inventory;
using SPTarkov.Server.Core.Models.Eft.ItemEvent;
using SPTarkov.Server.Core.Models.Spt.Mod;
using SPTarkov.Server.Core.Services.Modding.Custom;

namespace DaCard.Server;

[Injectable(InjectionType.Singleton)]
public class BoosterPacks(
    ISptLogger<BoosterPacks> logger,
    CustomItemService customItemService,
    InventoryHelper inventoryHelper,
    ItemLedger ledger,
    CardStickers stickers,
    CardStore store,
    CardIndex index)
{
    public const string BundlePath = "dacard/item_pack.bundle";
    public const string FallbackSkin = "escape_from_tarkov";

    public static readonly (string Map, string Property)[] Maps =
    [
        ("albedo", "_MainTex"),
        ("normal", "_BumpMap"),
        ("metallic", "_MetallicMap"),
        ("roughness", "_RoughnessMap"),
        ("ao", "_OcclusionMap")
    ];

    private const string CloneTpl = "5f745ee30acaeb0d490d8c5b";
    private const string ParentJewelry = "57864a3d24597754843f8721";
    private const double DefaultPrice = 25000;
    public const int MaxCards = 10;

    private static BoosterPacks? _instance;
    private static bool _patched;

    private readonly Dictionary<MongoId, PackRow> _packs = new();
    private Dictionary<string, double> _weights = new(PackSettings.DefaultWeights, StringComparer.OrdinalIgnoreCase);
    private double _foilShare;

    public List<(string Tpl, double Percent)> Loot { get; } = new();
    public Dictionary<string, double> Offers { get; } = new();

    public List<PackManifestEntry> Create(IReadOnlyList<PackRow> packs, DaCardConfig config, double foilShare)
    {
        _packs.Clear();
        Loot.Clear();
        Offers.Clear();
        _weights = new Dictionary<string, double>(config.Packs.RarityWeights ?? PackSettings.DefaultWeights, StringComparer.OrdinalIgnoreCase);
        _foilShare = foilShare;

        var entries = new List<PackManifestEntry>();
        foreach (var pack in packs)
        {
            var pool = store.PoolRarities(pack);
            var members = pool.Values.Sum();
            if (members == 0)
            {
                logger.Warning($"[DaCard] Booster pack '{pack.Name}' has no cards (none match its card choice); no pack.");
                continue;
            }

            var count = Math.Clamp(pack.CardCount, 1, MaxCards);
            var price = pack.Price > 0 ? pack.Price : DefaultPrice;
            if (!CreateSealed(pack, price, count))
                continue;
            _packs[new MongoId(pack.Id)] = pack;

            if (pack.LootPercent > 0)
                Loot.Add((pack.Id, Math.Clamp(pack.LootPercent, 0, 100)));
            if (pack.Purchasable)
                Offers[pack.Id] = price;

            entries.Add(new PackManifestEntry { Tpl = pack.Id, CardCount = count, Textures = Textures(pack) });
            logger.Info($"[DaCard] Booster pack '{pack.Name}': {count} of {members} card(s) " +
                        $"({string.Join(", ", CardCatalog.RarityOrder.Where(pool.ContainsKey).Select(r => $"{r} {pool[r]}"))}), {price:0} ₽" +
                        $"{(pack.Purchasable ? ", sold by Geek" : "")}{(pack.LootPercent > 0 ? $", in {pack.LootPercent:0.##}% of card containers" : "")}");
        }

        _instance = this;
        if (!_patched && _packs.Count > 0)
        {
            new OpenPackPatch().Enable();
            _patched = true;
        }
        return entries;
    }

    private Dictionary<string, string> Textures(PackRow pack)
    {
        string? Owner(string setId) => store.Images([setId]).Any(i => i.Channel == "albedo") ? setId : null;
        var owner = pack.Look == "preset" && pack.SkinId != null ? Owner(pack.SkinId) : null;
        owner ??= Owner(pack.Id);
        if (owner == null)
        {
            if (pack.Look == "preset" && pack.SkinId != null)
                logger.Error($"[DaCard] Booster pack '{pack.Name}': its skin is not installed; it uses the default skin '{FallbackSkin}'.");
            owner = Owner(FallbackSkin);
        }
        if (owner == null)
            return new Dictionary<string, string>();
        var channels = store.Images([owner]).Select(i => i.Channel).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return Maps.Where(m => channels.Contains(m.Map)).ToDictionary(m => m.Property, m => CardManifests.ImageUrl(owner, m.Map));
    }

    private static Dictionary<string, LocaleDetails> Locales(PackRow pack, string english, string shortName, string description)
    {
        var locales = new Dictionary<string, LocaleDetails>
        {
            ["en"] = new() { Name = english, ShortName = shortName, Description = description }
        };
        foreach (var (lang, text) in pack.Locales ?? new())
        {
            locales[lang] = new LocaleDetails
            {
                Name = text.Name ?? english,
                ShortName = text.ShortName ?? shortName,
                Description = text.Description ?? description
            };
        }
        return locales;
    }

    private bool CreateSealed(PackRow pack, double price, int count)
    {
        var result = customItemService.CreateItemFromClone(new NewItemFromCloneDetails
        {
            ItemTplToClone = CloneTpl,
            ParentId = ParentJewelry,
            NewId = new MongoId(pack.Id),
            NewItemName = "dacard_pack_" + pack.Id,
            FleaPriceRoubles = price,
            HandbookPriceRoubles = price,
            HandbookParentId = DaCardHandbook.Packs,
            AddToHandbook = true,
            AddToFleaPriceDb = true,
            Locales = Locales(pack, pack.Name, pack.ShortName ?? pack.Name,
                pack.Description ?? $"A sealed booster pack of {count} trading card{(count == 1 ? "" : "s")}. Open it in your stash: its cards go straight into your stash."),
            OverrideProperties = new TemplateItemProperties
            {
                Prefab = new Prefab { Path = BundlePath, Rcid = "" },
                Width = 1,
                Height = 1,
                Weight = 0.03,
                BackgroundColor = pack.Background ?? "blue",
                ExaminedByDefault = true
            }
        }, Assembly.GetExecutingAssembly());

        if (!result.Success)
        {
            logger.Error($"[DaCard] Could not create booster pack '{pack.Name}': {string.Join("; ", result.Errors ?? [])}");
            return false;
        }
        ledger.Record(pack.Id, new LedgerItem
        {
            Kind = ItemLedger.Pack,
            Key = pack.Id,
            Name = pack.Name,
            Price = price,
            Background = pack.Background ?? "blue",
            Bundle = BundlePath
        });
        return true;
    }

    private List<string> Roll(PackRow pack)
    {
        var rarities = store.PoolRarities(pack).Where(p => p.Value > 0).Select(p => p.Key).ToList();
        var picks = new List<string>();
        var used = new List<string>();
        var count = Math.Clamp(pack.CardCount, 1, MaxCards);
        for (var i = 0; i < count && rarities.Count > 0; i++)
        {
            var card = store.RandomPoolCard(pack, PickRarity(rarities), used);
            if (card == null || index.Find(card.Id) is not { } created)
                continue;
            used.Add(card.Id);
            picks.Add(created.HasFoil && Random.Shared.NextDouble() < _foilShare ? created.FoilId : created.Id);
        }
        return picks;
    }

    private string PickRarity(List<string> rarities)
    {
        var weights = rarities.Select(r => Math.Max(0, _weights.GetValueOrDefault(r))).ToList();
        var total = weights.Sum();
        if (total <= 0)
            return rarities[Random.Shared.Next(rarities.Count)];
        var roll = Random.Shared.NextDouble() * total;
        for (var i = 0; i < rarities.Count; i++)
        {
            roll -= weights[i];
            if (roll < 0)
                return rarities[i];
        }
        return rarities[^1];
    }

    private bool TryOpen(PmcData pmcData, OpenRandomLootContainerRequestData request, MongoId sessionId, ItemEventRouterResponse output)
    {
        var item = pmcData.Inventory?.Items?.FirstOrDefault(i => i.Id == request.Item);
        if (item == null || !_packs.TryGetValue(item.Template, out var pack))
            return false;

        var foundInRaid = item.Upd?.SpawnedInSession ?? false;
        var cards = Roll(pack);
        if (cards.Count == 0)
        {
            logger.Warning($"[DaCard] A '{pack.Name}' booster pack stays closed: none of its cards could be picked");
            return true;
        }
        inventoryHelper.AddItemsToStash(sessionId, new AddItemsDirectRequest
        {
            ItemsWithModsToAdd = cards.Select(tpl =>
            {
                var card = new Item { Id = new MongoId(), Template = new MongoId(tpl), Upd = new Upd { SpawnedInSession = foundInRaid } };
                return new List<Item> { card }.Concat(stickers.RolledOn(card)).ToList();
            }).ToList(),
            FoundInRaid = foundInRaid,
            Callback = null,
            UseSortingTable = false
        }, pmcData, output);
        if (output.Warnings is { Count: > 0 })
        {
            logger.Info($"[DaCard] A '{pack.Name}' booster pack stays closed: no room in the stash for its {cards.Count} card(s)");
            return true;
        }

        inventoryHelper.RemoveItem(pmcData, item.Id, sessionId, output);
        logger.Info($"[DaCard] Opened a '{pack.Name}' booster pack: {cards.Count} card(s)");
        return true;
    }

    private void LogError(string message) => logger.Error(message);

    private class OpenPackPatch : AbstractPatch
    {
        protected override MethodBase GetTargetMethod() =>
            typeof(InventoryController).GetMethod(nameof(InventoryController.OpenRandomLootContainer))!;

        [PatchPrefix]
        public static bool Prefix(PmcData pmcData, OpenRandomLootContainerRequestData request, MongoId sessionId, ItemEventRouterResponse output)
        {
            try
            {
                return _instance == null || !_instance.TryOpen(pmcData, request, sessionId, output);
            }
            catch (Exception e)
            {
                _instance?.LogError($"[DaCard] Could not open the booster pack: {e}");
                return false;
            }
        }
    }
}
