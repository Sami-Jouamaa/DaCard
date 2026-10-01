using System.Reflection;
using System.Text.Json;
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
    Refund,
    Remove
}

[Injectable(InjectionType.Singleton)]
public class ItemLedger(ISptLogger<ItemLedger> logger, JsonUtil jsonUtil, CustomItemService customItemService, LocaleTable locales, RagfairConfig ragfairConfig,
    TemplateTable templates, TradersTable traders)
{
    public const string Card = "card", Foil = "foil", Binder = "binder", Pack = "pack", Sticker = "sticker";

    public static readonly string Folder = Path.Combine("user", "dacard");
    private static readonly string FilePath = Path.Combine(Folder, "ledger.json");
    private static readonly string ProfilesFolder = Path.Combine("user", "profiles");

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
            logger.Error($"[DaCard] {Path.GetFullPath(FilePath)} can't be read ({e.Message}). Deleted cards, binders and booster packs can't be " +
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

    public bool IsRemovable(MongoId tpl) => _goneStickers.Contains(tpl) || _removable.Contains(tpl);

    public void RetireMissing(string modPath, string? mode, Func<string, string, bool> exists)
    {
        Mode = ParseMode(mode);
        if (!Ready)
            return;

        var gone = new List<LedgerItem>();
        var broken = new List<LedgerItem>();
        var slotLabels = new Dictionary<string, string>();
        var missing = _file.Items.Where(i => !_seen.Contains(i.Key)).ToList();
        var held = missing.Count > 0 ? HeldTemplates() : null;
        foreach (var (tpl, item) in missing)
        {
            if (held != null && !held.Contains(tpl))
                continue;
            if (!MongoId.IsValidMongoId(tpl) || !CreatePlaceholder(tpl, item, modPath))
                continue;
            Placeholders.Add(tpl);
            foreach (var slot in item.Slots ?? [])
                if (slot.Label != null)
                    slotLabels.TryAdd(slot.Name, slot.Label);

            if (item.Kind == Sticker)
            {
                if (item.Owner == null || _seen.Contains(item.Owner) || !OwnerExists(item, exists))
                    _goneStickers.Add(new MongoId(tpl));
                else
                    broken.Add(item);
                continue;
            }
            if (exists(item.Kind, tpl))
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
                           "Copies in profiles are kept until they load again.");
        if (gone.Count > 0)
            logger.Warning($"[DaCard] {gone.Count} item(s) no longer exist: {Describe(gone)}. " + (Mode == RetiredMode.Refund
                ? "Copies in profiles are removed and paid back in roubles."
                : "Copies in profiles are removed."));
        Save();
    }

    private RetiredMode ParseMode(string? mode)
    {
        if (string.IsNullOrWhiteSpace(mode))
            return RetiredMode.Remove;
        if (Enum.TryParse<RetiredMode>(mode.Trim(), true, out var parsed) && Enum.IsDefined(parsed))
            return parsed;
        logger.Warning($"[DaCard] \"retiredItems\": \"{mode}\" is not refund or remove; using refund.");
        return RetiredMode.Refund;
    }

    public void DropUnheld()
    {
        if (Placeholders.Count == 0)
            return;
        var held = HeldTemplates();
        if (held == null)
            return;
        var dropped = Placeholders.Where(t => !held.Contains(t)).Select(t => new MongoId(t)).ToHashSet();
        if (dropped.Count == 0)
            return;
        foreach (var tpl in dropped)
        {
            templates.Items.Remove(tpl);
            templates.Prices.Remove(tpl);
            ragfairConfig.Dynamic.Blacklist.Custom.Remove(tpl);
        }
        templates.Handbook.Items.RemoveAll(h => dropped.Contains(h.Id));
        foreach (var (_, trader) in traders)
        {
            trader.Base.ItemsBuy?.IdList.ExceptWith(dropped);
            trader.Base.ItemsBuyProhibited?.IdList.ExceptWith(dropped);
        }
        Placeholders.RemoveAll(t => dropped.Contains(new MongoId(t)));
        logger.Info($"[DaCard] Removed {dropped.Count} deleted item(s) from the database; no profile has them any more.");
    }

    private HashSet<string>? HeldTemplates()
    {
        var held = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (!Directory.Exists(ProfilesFolder))
            return held;
        foreach (var file in Directory.EnumerateFiles(ProfilesFolder, "*.json"))
        {
            try
            {
                var bytes = File.ReadAllBytes(file);
                var json = bytes.AsSpan().StartsWith((ReadOnlySpan<byte>)[0xEF, 0xBB, 0xBF]) ? bytes.AsSpan(3) : bytes.AsSpan();
                var reader = new Utf8JsonReader(json, new JsonReaderOptions { CommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true });
                while (reader.Read())
                {
                    if (reader.TokenType != JsonTokenType.PropertyName || !reader.ValueTextEquals("_tpl"))
                        continue;
                    if (reader.Read() && reader.TokenType == JsonTokenType.String && reader.GetString() is { } tpl)
                        held.Add(tpl);
                }
            }
            catch (Exception e)
            {
                logger.Warning($"[DaCard] Could not read {Path.GetFullPath(file)} ({e.Message}); every deleted item stays in the database for now.");
                return null;
            }
        }
        return held;
    }

    private static string Describe(List<LedgerItem> items)
    {
        var names = items.Select(i => $"{i.Name} ({i.Kind})").ToList();
        return names.Count <= 10 ? string.Join(", ", names) : string.Join(", ", names.Take(10)) + $" and {names.Count - 10} more";
    }

    private static bool OwnerExists(LedgerItem item, Func<string, string, bool> exists) =>
        exists(Card, item.Owner!) || exists(Binder, item.Owner!);

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
            HandbookParentId = DaCardHandbook.CategoryOf(item.Kind),
            AddToHandbook = true,
            AddToFleaPriceDb = false,
            Locales = new Dictionary<string, LocaleDetails>
            {
                ["en"] = new()
                {
                    Name = $"{item.Name} (unavailable)",
                    ShortName = item.Name,
                    Description = $"This {what} didn't load. It comes back once DaCard loads it again."
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
            logger.Error($"[DaCard] Could not add the placeholder for the {what} '{item.Name}' ({tpl}): {string.Join("; ", result.Errors ?? [])}. " +
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
