using System.Reflection;
using SPTarkov.Common.Models.Logging;
using SPTarkov.DI.Annotations;
using SPTarkov.Server.Core.Models.Common;
using SPTarkov.Server.Core.Models.Eft.Common.Tables;
using SPTarkov.Server.Core.Models.Spt.Config;
using SPTarkov.Server.Core.Models.Spt.Mod;
using SPTarkov.Server.Core.Models.Spt.Tables;
using SPTarkov.Server.Core.Services.Modding.Custom;
using SPTarkov.Server.Core.Utils;
using Path = System.IO.Path;

namespace DaCard.Server;

public enum RetiredMode
{
    Keep,
    Refund,
    Remove
}

[Injectable(InjectionType.Singleton)]
public class ItemLedger(ISptLogger<ItemLedger> logger, JsonUtil jsonUtil, CustomItemService customItemService, LocaleTable locales, RagfairConfig ragfairConfig)
{
    public const string Card = "card", Foil = "foil", Binder = "binder", Pack = "pack", Sticker = "sticker";

    public static readonly string Folder = Path.Combine("user", "dacard");
    private static readonly string FilePath = Path.Combine(Folder, "ledger.json");

    private LedgerFile _file = new();
    private readonly HashSet<string> _seen = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<MongoId> _removable = new();
    private readonly HashSet<MongoId> _goneStickers = new();
    private Dictionary<string, double> _previousLayers = new();

    public bool Ready { get; private set; }
    public RetiredMode Mode { get; private set; } = RetiredMode.Remove;
    public List<string> Placeholders { get; } = new();

    public bool Load()
    {
        Ready = false;
        _seen.Clear();
        _removable.Clear();
        _goneStickers.Clear();
        _previousLayers = new Dictionary<string, double>();
        Placeholders.Clear();
        _file = new LedgerFile();
        if (!File.Exists(FilePath))
        {
            Ready = true;
            return true;
        }
        try
        {
            _file = jsonUtil.Deserialize<LedgerFile>(File.ReadAllText(FilePath)) ?? throw new InvalidDataException("empty file");
            _file.Items = new Dictionary<string, LedgerItem>(_file.Items, StringComparer.OrdinalIgnoreCase);
            _previousLayers = new Dictionary<string, double>(_file.Layers ?? new(), StringComparer.OrdinalIgnoreCase);
            _file.Layers = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
            Ready = true;
        }
        catch (Exception e)
        {
            logger.Error($"[DaCard] {Path.GetFullPath(FilePath)} can't be read ({e.Message}). Deleted cards, binders and booster packs can't be kept or " +
                         "cleaned up from profiles until it's fixed or deleted. Nothing in the profiles is changed.");
        }
        return Ready;
    }

    public void Record(string tpl, LedgerItem item)
    {
        if (!Ready)
            return;
        _seen.Add(tpl);
        _file.Items[tpl] = item with { LastSeen = DateTimeOffset.UtcNow.ToUnixTimeSeconds() };
    }

    public LedgerItem? Get(MongoId tpl) => _file.Items.GetValueOrDefault(tpl.ToString());

    public void RecordLayer(string cardTpl, string layerKey, double chance)
    {
        if (Ready)
            _file.Layers[$"{cardTpl}|{layerKey}"] = chance;
    }

    public double? PreviousChance(string cardTpl, string layerKey) =>
        _previousLayers.TryGetValue($"{cardTpl}|{layerKey}", out var chance) ? chance : null;

    public IEnumerable<MongoId> Binders => _file.Items.Where(i => i.Value.Kind == Binder).Select(i => new MongoId(i.Key));

    public IEnumerable<MongoId> Cards => _file.Items.Where(i => i.Value.Kind is Card or Foil).Select(i => new MongoId(i.Key));

    public bool IsSticker(MongoId tpl) => Get(tpl)?.Kind == Sticker;

    public bool IsRemovable(MongoId tpl) => _goneStickers.Contains(tpl) || (Mode != RetiredMode.Keep && _removable.Contains(tpl));

    public void RetireMissing(string modPath, string? mode, bool keepAll = false)
    {
        Mode = ParseMode(mode);
        if (!Ready)
            return;

        var gone = new List<LedgerItem>();
        var broken = new List<LedgerItem>();
        var slotLabels = new Dictionary<string, string>();
        foreach (var (tpl, item) in _file.Items.Where(i => !_seen.Contains(i.Key)))
        {
            if (!MongoId.IsValidMongoId(tpl) || !CreatePlaceholder(tpl, item, modPath))
                continue;
            Placeholders.Add(tpl);
            foreach (var slot in item.Slots ?? [])
                if (slot.Label != null)
                    slotLabels.TryAdd(slot.Name, slot.Label);

            if (item.Kind == Sticker)
            {
                if (keepAll || item.Owner == null || _seen.Contains(item.Owner) || !OwnerExists(item, modPath))
                    _goneStickers.Add(new MongoId(tpl));
                else
                    broken.Add(item);
                continue;
            }
            if (keepAll || SourceExists(item, modPath))
            {
                broken.Add(item);
                continue;
            }
            gone.Add(item);
            _removable.Add(new MongoId(tpl));
        }
        AddSlotLabels(slotLabels);

        if (broken.Count > 0)
            logger.Warning($"[DaCard] {broken.Count} item(s) didn't load but their files are still there: {Describe(broken)}. " +
                           "Copies in profiles are kept (as retired items) until they load again.");
        if (gone.Count > 0)
            logger.Warning($"[DaCard] {gone.Count} item(s) no longer exist (their files are gone): {Describe(gone)}. " + Mode switch
            {
                RetiredMode.Keep => "Copies in profiles stay, as retired items Geek still buys (config.json \"retiredItems\": \"keep\").",
                RetiredMode.Refund => "Copies in profiles are removed and paid back in roubles (config.json \"retiredItems\": \"refund\").",
                _ => "Copies in profiles are removed (config.json \"retiredItems\": \"remove\")."
            });
        Save();
    }

    private RetiredMode ParseMode(string? mode)
    {
        if (string.IsNullOrWhiteSpace(mode))
            return RetiredMode.Remove;
        if (Enum.TryParse<RetiredMode>(mode.Trim(), true, out var parsed) && Enum.IsDefined(parsed))
            return parsed;
        logger.Warning($"[DaCard] config.json \"retiredItems\": \"{mode}\" is not keep, refund or remove; using keep.");
        return RetiredMode.Keep;
    }

    private static string Describe(List<LedgerItem> items)
    {
        var names = items.Select(i => $"{i.Name} ({i.Kind})").ToList();
        return names.Count <= 10 ? string.Join(", ", names) : string.Join(", ", names.Take(10)) + $" and {names.Count - 10} more";
    }

    private static IEnumerable<string> Roots(string modPath)
    {
        var data = Path.Combine(modPath, "data");
        return Addons.Dirs(data).Prepend(data);
    }

    private static bool SourceExists(LedgerItem item, string modPath)
    {
        switch (item.Kind)
        {
            case Card:
            case Foil:
                var cut = item.Key.IndexOf('/');
                var collection = cut < 0 ? CardCatalog.DefaultCollection : item.Key[..cut];
                var name = cut < 0 ? item.Key : item.Key[(cut + 1)..];
                return Roots(modPath).Any(root => CardCatalog.RarityOrder.Any(r => Directory.Exists(Path.Combine(root, Addons.Cards, collection, r, name))));
            case Binder:
                return Roots(modPath).Any(root => Directory.Exists(Path.Combine(root, Addons.Cards, item.Key)));
            case Pack:
                return Roots(modPath).Any(root => Directory.Exists(Path.Combine(root, Addons.Packs, item.Key)));
            default:
                return true;
        }
    }

    private static bool OwnerExists(LedgerItem item, string modPath)
    {
        var cut = item.Key.LastIndexOf(':');
        var owner = cut < 0 ? item.Key : item.Key[..cut];
        if (owner.StartsWith("collection:"))
            return SourceExists(new LedgerItem { Kind = Binder, Key = owner["collection:".Length..] }, modPath);
        return !owner.StartsWith("card:") || SourceExists(new LedgerItem { Kind = Card, Key = owner["card:".Length..] }, modPath);
    }

    private bool CreatePlaceholder(string tpl, LedgerItem item, string modPath)
    {
        var binder = item.Kind == Binder;
        var card = item.Kind is Card or Foil;
        var bundle = item.Bundle != null && File.Exists(Path.Combine(modPath, "bundles", item.Bundle)) ? item.Bundle : null;
        var what = item.Kind switch
        {
            Binder => "binder",
            Pack => "booster pack",
            Sticker => "sticker",
            _ => "card"
        };
        var price = item.Price > 0 ? item.Price : 1;
        var result = customItemService.CreateItemFromClone(new NewItemFromCloneDetails
        {
            ItemTplToClone = binder || card ? CollectionBinders.CloneTpl : DaCardMod.CloneTpl,
            ParentId = binder || card ? CollectionBinders.ParentCompoundItem : DaCardMod.ParentJewelry,
            NewId = new MongoId(tpl),
            NewItemName = $"dacard_retired_{item.Kind}_{item.Key.ToLowerInvariant().Replace('/', '_')}",
            HandbookPriceRoubles = price,
            HandbookParentId = binder ? CollectionBinders.HandbookStorageContainers : DaCardMod.HandbookValuables,
            AddToHandbook = true,
            AddToFleaPriceDb = false,
            Locales = new Dictionary<string, LocaleDetails>
            {
                ["en"] = new()
                {
                    Name = $"{item.Name} (retired)",
                    ShortName = item.Name,
                    Description = $"This {what} was removed from DaCard. Geek still buys it."
                }
            },
            OverrideProperties = binder
                ? new TemplateItemProperties
                {
                    Prefab = bundle != null ? new Prefab { Path = bundle, Rcid = "" } : null,
                    Width = CollectionBinders.Width,
                    Height = CollectionBinders.Height,
                    Weight = 0.4,
                    BackgroundColor = item.Background ?? "orange",
                    ExaminedByDefault = true,
                    CanSellOnRagfair = false,
                    MergesWithChildren = false,
                    Grids = [],
                    Slots = (item.Slots ?? []).Select(s => new Slot
                    {
                        Name = s.Name,
                        Id = new MongoId(s.Id),
                        Parent = new MongoId(tpl),
                        Properties = new SlotProperties
                        {
                            Filters = [new SlotFilter { Shift = 0, Filter = [.. s.Filter.Select(f => new MongoId(f))] }]
                        },
                        Required = false,
                        MergeSlotWithChildren = false,
                        Prototype = CollectionBinders.SlotPrototype
                    }).ToList()
                }
                : card
                ? new TemplateItemProperties
                {
                    Prefab = bundle != null ? new Prefab { Path = bundle, Rcid = "" } : null,
                    Width = 1,
                    Height = 1,
                    Weight = 0.005,
                    BackgroundColor = item.Background ?? "default",
                    ExaminedByDefault = true,
                    CanSellOnRagfair = false,
                    MergesWithChildren = false,
                    HideEntrails = false,
                    Grids = [],
                    Slots = (item.Slots ?? []).Select(s => CardStickers.TemplateSlot(tpl, s.Name, s.Id, s.Filter.FirstOrDefault() ?? "")).ToList()
                }
                : new TemplateItemProperties
                {
                    Prefab = bundle != null ? new Prefab { Path = bundle, Rcid = "" } : null,
                    Width = 1,
                    Height = 1,
                    Weight = item.Kind switch { Pack => 0.03, Sticker => 0, _ => 0.005 },
                    BackgroundColor = item.Background ?? "default",
                    ExaminedByDefault = true,
                    CanSellOnRagfair = false
                }
        }, Assembly.GetExecutingAssembly());

        if (result.Success)
            ragfairConfig.Dynamic.Blacklist.Custom.Add(new MongoId(tpl));
        else
            logger.Error($"[DaCard] Could not keep the removed {what} '{item.Name}' ({tpl}) as a retired item: {string.Join("; ", result.Errors ?? [])}. " +
                         "Profiles holding it won't load, and DaCard won't touch it.");
        return result.Success;
    }

    private void AddSlotLabels(Dictionary<string, string> labels)
    {
        if (labels.Count == 0)
            return;
        foreach (var (lang, _) in locales.Languages)
        {
            if (!locales.Global.TryGetValue(lang, out var table))
                continue;
            table.AddTransformer(data =>
            {
                if (data == null)
                    return data;
                foreach (var (slot, label) in labels)
                    data.TryAdd(slot, label);
                return data;
            });
        }
    }

    private void Save()
    {
        try
        {
            Directory.CreateDirectory(Folder);
            var temp = FilePath + ".tmp";
            File.WriteAllText(temp, jsonUtil.Serialize(_file, true));
            File.Move(temp, FilePath, true);
        }
        catch (Exception e)
        {
            logger.Error($"[DaCard] Could not save {Path.GetFullPath(FilePath)}: {e.Message}");
        }
    }
}
