using System.Reflection;
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
using SPTarkov.Server.Core.Utils;
using Path = System.IO.Path;

namespace DaCard.Server;

public record PackEntry(string Key, string Id, PackFile Data, string Dir, Dictionary<string, string> Maps, string MapsOwner);

[Injectable(InjectionType.Singleton)]
public class BoosterPacks(
    ISptLogger<BoosterPacks> logger,
    JsonUtil jsonUtil,
    CustomItemService customItemService,
    InventoryHelper inventoryHelper,
    ItemLedger ledger,
    CardStickers stickers)
{
    public const string BundlePath = "dacard/item_pack.bundle";
    public const string PacksFolder = "data/packs";
    public const string SkinsFolder = "data/skins";
    public const string DataFile = "pack.json";
    public const string SkinDataFile = "skin.json";

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
    private const string HandbookValuables = "5b47574386f77428ca22b2f1";
    private const double DefaultPrice = 25000;
    public const int MaxCards = 10;

    private static BoosterPacks? _instance;
    private static bool _patched;

    private record Pool(string Name, int Count, Dictionary<string, List<(string Tpl, string? FoilTpl)>> ByRarity);

    private readonly Dictionary<MongoId, Pool> _pools = new();
    private Dictionary<string, double> _weights = new(PackSettings.DefaultWeights, StringComparer.OrdinalIgnoreCase);
    private double _foilShare;

    public List<(string Tpl, double Percent)> Loot { get; } = new();
    public Dictionary<string, double> Offers { get; } = new();

    public List<PackEntry> Scan(string modPath)
    {
        var found = new List<PackEntry>();
        var dir = Path.Combine(modPath, PacksFolder);
        if (!Directory.Exists(dir))
            return found;

        var skins = ScanSkins(Path.Combine(modPath, SkinsFolder));
        foreach (var packDir in Directory.GetDirectories(dir).OrderBy(d => d, StringComparer.OrdinalIgnoreCase))
        {
            var key = Path.GetFileName(packDir);
            var where = $"{PacksFolder}/{key}/{DataFile}";
            var json = Path.Combine(packDir, DataFile);
            if (!File.Exists(json))
            {
                logger.Warning($"[DaCard] {PacksFolder}/{key} has no {DataFile}; skipping.");
                continue;
            }

            PackFile? data;
            try
            {
                data = jsonUtil.Deserialize<PackFile>(File.ReadAllText(json));
            }
            catch (Exception e)
            {
                logger.Error($"[DaCard] {where} is not valid JSON: {e.Message}");
                continue;
            }
            if (data == null)
                continue;
            data.Name = string.IsNullOrWhiteSpace(data.Name) ? key : data.Name.Trim();

            var maps = MapsIn(packDir);
            var owner = "pack:" + key;
            if (!string.IsNullOrWhiteSpace(data.Skin))
            {
                if (skins.TryGetValue(data.Skin.Trim(), out var skin))
                {
                    maps = skin;
                    owner = "skin:" + data.Skin.Trim().ToLowerInvariant();
                }
                else
                {
                    logger.Warning($"[DaCard] {where}: skin '{data.Skin}' is not in {SkinsFolder}/; the pack uses its own pictures (or the plain template).");
                }
            }

            found.Add(new PackEntry(key, CardCatalog.IdFor("pack:" + key), data, packDir, maps, owner));
        }
        return found;
    }

    private Dictionary<string, Dictionary<string, string>> ScanSkins(string dir)
    {
        var skins = new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
        if (!Directory.Exists(dir))
            return skins;
        foreach (var skinDir in Directory.GetDirectories(dir))
            skins[Path.GetFileName(skinDir)] = MapsIn(skinDir);
        return skins;
    }

    private static Dictionary<string, string> MapsIn(string dir) => Maps
        .Select(m => (m.Map, Path: Path.Combine(dir, m.Map + ".png")))
        .Where(m => File.Exists(m.Path))
        .ToDictionary(m => m.Map, m => m.Path);

    public List<PackManifestEntry> Create(IReadOnlyList<PackEntry> packs, IReadOnlyList<CardEntry> cards, IReadOnlyDictionary<string, string> foilOf,
        DaCardConfig config, double foilShare, Func<string, string, string> registerImage)
    {
        _pools.Clear();
        Loot.Clear();
        Offers.Clear();
        _weights = new Dictionary<string, double>(config.Packs.RarityWeights ?? PackSettings.DefaultWeights, StringComparer.OrdinalIgnoreCase);
        _foilShare = foilShare;

        var entries = new List<PackManifestEntry>();
        var registered = new Dictionary<string, string>();
        foreach (var pack in packs)
        {
            var members = PoolOf(pack, cards);
            if (members.Count == 0)
            {
                logger.Warning($"[DaCard] Booster pack '{pack.Data.Name}' ({PacksFolder}/{pack.Key}) has no cards (none match its card choice); no pack.");
                continue;
            }

            var count = Math.Clamp(pack.Data.CardCount, 1, MaxCards);
            var price = pack.Data.Price > 0 ? pack.Data.Price : DefaultPrice;
            if (!CreateSealed(pack, price, count))
                continue;

            var byRarity = CardCatalog.RarityOrder
                .Select(r => (r, members.Where(c => c.Rarity == r).Select(c => (c.Id, foilOf.GetValueOrDefault(c.Id))).ToList()))
                .Where(p => p.Item2.Count > 0)
                .ToDictionary(p => p.r, p => p.Item2, StringComparer.OrdinalIgnoreCase);
            _pools[new MongoId(pack.Id)] = new Pool(pack.Data.Name!, count, byRarity);

            if (pack.Data.LootPercent > 0)
                Loot.Add((pack.Id, Math.Clamp(pack.Data.LootPercent, 0, 100)));
            if (pack.Data.Purchasable)
                Offers[pack.Id] = price;

            var textures = new Dictionary<string, string>();
            foreach (var (map, property) in Maps)
            {
                if (!pack.Maps.TryGetValue(map, out var path))
                    continue;
                var name = $"pack_{CardCatalog.IdFor(pack.MapsOwner)}_{map}";
                if (!registered.TryGetValue(name, out var url))
                    registered[name] = url = registerImage(name, path);
                textures[property] = url;
            }

            entries.Add(new PackManifestEntry { Tpl = pack.Id, CardCount = count, Textures = textures });
            logger.Info($"[DaCard] Booster pack '{pack.Data.Name}': {count} of {members.Count} card(s) " +
                        $"({string.Join(", ", byRarity.Select(r => $"{r.Key} {r.Value.Count}"))}), {price:0} ₽" +
                        $"{(pack.Data.Purchasable ? ", sold by Geek" : "")}{(pack.Data.LootPercent > 0 ? $", in {pack.Data.LootPercent:0.##}% of card containers" : "")}");
        }

        _instance = this;
        if (!_patched && _pools.Count > 0)
        {
            new OpenPackPatch().Enable();
            _patched = true;
        }
        return entries;
    }

    private static List<CardEntry> PoolOf(PackEntry pack, IReadOnlyList<CardEntry> cards)
    {
        var choice = pack.Data.Cards ?? new PackCards();
        var collections = (choice.Collections ?? []).Select(c => c.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var singles = (choice.Cards ?? []).Select(c => c.Trim().Replace('\\', '/')).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var rarities = (choice.Rarities ?? []).Where(CardCatalog.IsRarity).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return cards.Where(c => choice.All || collections.Contains(c.Collection ?? CardCatalog.DefaultCollection) || singles.Contains(c.Key))
            .Where(c => rarities.Count == 0 || rarities.Contains(c.Rarity))
            .ToList();
    }

    private Dictionary<string, LocaleDetails> Locales(PackFile data, string english, string shortName, string description)
    {
        var locales = new Dictionary<string, LocaleDetails>
        {
            ["en"] = new() { Name = english, ShortName = shortName, Description = description }
        };
        foreach (var (lang, text) in data.Locales ?? new())
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

    private bool CreateSealed(PackEntry pack, double price, int count)
    {
        var data = pack.Data;
        var result = customItemService.CreateItemFromClone(new NewItemFromCloneDetails
        {
            ItemTplToClone = CloneTpl,
            ParentId = ParentJewelry,
            NewId = new MongoId(pack.Id),
            NewItemName = "dacard_pack_" + pack.Key.ToLowerInvariant(),
            FleaPriceRoubles = price,
            HandbookPriceRoubles = price,
            HandbookParentId = HandbookValuables,
            AddToHandbook = true,
            AddToFleaPriceDb = true,
            Locales = Locales(data, data.Name!, data.ShortName ?? data.Name!,
                data.Description ?? $"A sealed booster pack of {count} trading card{(count == 1 ? "" : "s")}. Open it in your stash: its cards go straight into your stash."),
            OverrideProperties = new TemplateItemProperties
            {
                Prefab = new Prefab { Path = BundlePath, Rcid = "" },
                Width = 1,
                Height = 1,
                Weight = 0.03,
                BackgroundColor = data.Background ?? "blue",
                ExaminedByDefault = true
            }
        }, Assembly.GetExecutingAssembly());

        if (!result.Success)
        {
            logger.Error($"[DaCard] Could not create booster pack '{data.Name}': {string.Join("; ", result.Errors ?? [])}");
            return false;
        }
        ledger.Record(pack.Id, new LedgerItem
        {
            Kind = ItemLedger.Pack,
            Key = pack.Key,
            Name = data.Name!,
            Price = price,
            Background = data.Background ?? "blue",
            Bundle = BundlePath
        });
        return true;
    }

    private List<string> Roll(Pool pool)
    {
        var picks = new List<string>();
        var used = new HashSet<string>();
        for (var i = 0; i < pool.Count; i++)
        {
            var list = pool.ByRarity[PickRarity(pool)];
            var fresh = list.Where(c => !used.Contains(c.Tpl)).ToList();
            if (fresh.Count == 0)
                fresh = list;
            var (tpl, foilTpl) = fresh[Random.Shared.Next(fresh.Count)];
            used.Add(tpl);
            picks.Add(foilTpl != null && Random.Shared.NextDouble() < _foilShare ? foilTpl : tpl);
        }
        return picks;
    }

    private string PickRarity(Pool pool)
    {
        var rarities = pool.ByRarity.Keys.ToList();
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
        var pack = pmcData.Inventory?.Items?.FirstOrDefault(i => i.Id == request.Item);
        if (pack == null || !_pools.TryGetValue(pack.Template, out var pool))
            return false;

        var foundInRaid = pack.Upd?.SpawnedInSession ?? false;
        var cards = Roll(pool);
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
            logger.Info($"[DaCard] A '{pool.Name}' booster pack stays closed: no room in the stash for its {cards.Count} card(s)");
            return true;
        }

        inventoryHelper.RemoveItem(pmcData, pack.Id, sessionId, output);
        logger.Info($"[DaCard] Opened a '{pool.Name}' booster pack: {cards.Count} card(s)");
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
