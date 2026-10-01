using System.Collections;
using System.Reflection;
using SPTarkov.Common.Models.Logging;
using SPTarkov.DI.Annotations;
using SPTarkov.Reflection.Patching;
using SPTarkov.Server.Core.DI.Routing;
using SPTarkov.Server.Core.Helpers.Commerce;
using SPTarkov.Server.Core.Helpers.Profile;
using SPTarkov.Server.Core.Models.Common;
using SPTarkov.Server.Core.Models.Eft.Common;
using SPTarkov.Server.Core.Models.Eft.Common.Request;
using SPTarkov.Server.Core.Models.Eft.Common.Tables;
using SPTarkov.Server.Core.Models.Eft.Inventory;
using SPTarkov.Server.Core.Models.Eft.ItemEvent;
using SPTarkov.Server.Core.Models.Spt.Config;
using SPTarkov.Server.Core.Models.Spt.Mod;
using SPTarkov.Server.Core.Models.Spt.Tables;
using SPTarkov.Server.Core.Services.Modding.Custom;
using SPTarkov.Server.Core.Utils;

namespace DaCard.Server;

public record StickerOwner(string Key, string Name);

public record StickerSlot(string Name, string Id, string Sticker, double Chance, string LayerKey, string Label, bool Grant);

[Injectable(InjectionType.Singleton)]
public class CardStickers(
    ISptLogger<CardStickers> logger,
    CustomItemService customItemService,
    LocaleTable locales,
    ItemLedger ledger,
    RagfairConfig ragfairConfig,
    HttpResponseUtil httpResponseUtil)
{
    public const string SlotPrefix = "stickerslot_";
    private const string Refusal = "Stickers can't be taken off a card, or put on one.";

    private static readonly HashSet<string> GuardedActions = new(StringComparer.OrdinalIgnoreCase)
    {
        "Move", "Remove", "Split", "Merge", "Transfer", "Swap", "Fold", "Toggle", "Bind", "TradingConfirm", "RagFairAddOffer"
    };

    private static CardStickers? _instance;
    private static bool _patched;
    [ThreadStatic] private static bool _buying;

    private readonly HashSet<string> _stickers = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, string> _labels = new();
    private readonly Dictionary<string, List<StickerSlot>> _cards = new(StringComparer.OrdinalIgnoreCase);

    public IEnumerable<string> Stickers => _stickers;

    public bool IsSticker(MongoId tpl) => _stickers.Contains(tpl.ToString());

    public bool HasGrants => _cards.Values.Any(slots => slots.Any(s => s.Grant));

    public IReadOnlyList<StickerSlot> SlotsOf(string cardTpl) => _cards.GetValueOrDefault(cardTpl) ?? [];

    public static string SlotName(string sticker) => SlotPrefix + sticker;

    public string? Register(string ownerId, StickerOwner owner, Storage.LayerRow layer, string bundle)
    {
        if (layer.Chance >= 100)
            return null;
        var tpl = CardCatalog.IdFor($"sticker:{ownerId}:{layer.Key}");
        if (_stickers.Contains(tpl))
            return tpl;

        var name = string.IsNullOrWhiteSpace(layer.Name) ? $"{owner.Name} sticker" : layer.Name.Trim();
        var price = Math.Max(1, Math.Round(layer.Price));
        var result = customItemService.CreateItemFromClone(new NewItemFromCloneDetails
        {
            ItemTplToClone = DaCardMod.CloneTpl,
            ParentId = DaCardMod.ParentJewelry,
            NewId = new MongoId(tpl),
            NewItemName = "dacard_sticker_" + tpl,
            HandbookPriceRoubles = price,
            HandbookParentId = DaCardHandbook.Stickers,
            AddToHandbook = true,
            AddToFleaPriceDb = false,
            Locales = new Dictionary<string, LocaleDetails>
            {
                ["en"] = new()
                {
                    Name = name,
                    ShortName = name,
                    Description = $"A sticker on a {owner.Name} card. It can't be taken off."
                }
            },
            OverrideProperties = new TemplateItemProperties
            {
                Prefab = new Prefab { Path = bundle, Rcid = "" },
                Width = 1,
                Height = 1,
                Weight = 0,
                ExaminedByDefault = true,
                CanSellOnRagfair = false
            }
        }, Assembly.GetExecutingAssembly());

        if (!result.Success)
        {
            logger.Error($"[DaCard] Could not create the sticker '{name}' ({owner.Key}): {string.Join("; ", result.Errors ?? [])}. That layer never shows.");
            return null;
        }

        ragfairConfig.Dynamic.Blacklist.Custom.Add(new MongoId(tpl));
        _stickers.Add(tpl);
        _labels[SlotName(tpl)] = name;
        ledger.Record(tpl, new LedgerItem
        {
            Kind = ItemLedger.Sticker,
            Key = $"{owner.Key}:{layer.Id}",
            Owner = ownerId,
            Name = name,
            Price = price,
            Bundle = bundle
        });
        return tpl;
    }

    public List<Slot> SlotsFor(string cardTpl, string baseTpl, IEnumerable<(string Key, double Chance, string? Sticker, string? Name)> layers)
    {
        var slots = layers.Where(l => l.Sticker != null)
            .GroupBy(l => l.Sticker!)
            .Select(g => g.First())
            .Select(l => new StickerSlot(SlotName(l.Sticker!), CardCatalog.IdFor($"sticker-slot:{cardTpl}:{l.Sticker}"), l.Sticker!, l.Chance, l.Key,
                _labels.GetValueOrDefault(SlotName(l.Sticker!)) ?? "Sticker", ledger.PreviousChance(baseTpl, l.Key) >= 100))
            .ToList();
        _cards[cardTpl] = slots;
        return slots.Select(s => TemplateSlot(cardTpl, s.Name, s.Id, s.Sticker)).ToList();
    }

    public static Slot TemplateSlot(string cardTpl, string name, string id, string sticker) => new()
    {
        Name = name,
        Id = new MongoId(id),
        Parent = new MongoId(cardTpl),
        Properties = new SlotProperties
        {
            Filters = [new SlotFilter { Shift = 0, Locked = true, Filter = [new MongoId(sticker)] }]
        },
        Required = false,
        MergeSlotWithChildren = false,
        Prototype = CollectionBinders.SlotPrototype
    };

    public IEnumerable<(string Slot, string Sticker)> Roll(string cardTpl) =>
        SlotsOf(cardTpl).Where(s => Random.Shared.NextDouble() * 100 < s.Chance).Select(s => (s.Name, s.Sticker)).ToList();

    public List<Item> RolledOn(Item card) => Roll(card.Template.ToString())
        .Select(s => new Item { Id = new MongoId(), Template = new MongoId(s.Sticker), ParentId = card.Id.ToString(), SlotId = s.Slot })
        .ToList();

    public void Enable()
    {
        AddSlotLabels();
        _instance = this;
        if (_patched)
            return;
        new GuardPatch().Enable();
        new BuyPatch().Enable();
        new StashPatch().Enable();
        _patched = true;
    }

    private void AddSlotLabels()
    {
        if (_labels.Count == 0)
            return;
        var labels = new Dictionary<string, string>(_labels);
        foreach (var (lang, _) in locales.Languages)
        {
            if (!locales.Global.TryGetValue(lang, out var table))
                continue;
            table.AddTransformer(data =>
            {
                if (data == null)
                    return data;
                foreach (var (slot, label) in labels)
                    data[slot] = label;
                return data;
            });
        }
    }

    private void RollPurchased(AddItemsDirectRequest request)
    {
        foreach (var items in request.ItemsWithModsToAdd ?? [])
        {
            var card = items.FirstOrDefault();
            if (card == null || SlotsOf(card.Template.ToString()).Count == 0 || items.Any(i => i.ParentId == card.Id.ToString()))
                continue;
            items.AddRange(RolledOn(card));
        }
    }

    private bool TouchesSticker(string action, PmcData pmcData, BaseInteractionRequestData body)
    {
        if (!GuardedActions.Contains(action) || pmcData.Inventory?.Items == null)
            return false;
        var stickers = pmcData.Inventory.Items.Where(i => IsSticker(i.Template)).Select(i => i.Id.ToString()).ToHashSet();
        if (stickers.Count == 0)
            return false;
        var ids = new HashSet<string>();
        CollectIds(body, ids, 0);
        return ids.Overlaps(stickers);
    }

    private static void CollectIds(object? value, HashSet<string> ids, int depth)
    {
        switch (value)
        {
            case null:
                return;
            case string text:
                ids.Add(text);
                return;
            case MongoId id:
                ids.Add(id.ToString());
                return;
        }
        if (depth > 4 || value.GetType().IsPrimitive || value is Enum)
            return;
        if (value is IEnumerable list)
        {
            foreach (var entry in list)
                CollectIds(entry, ids, depth + 1);
            return;
        }
        foreach (var property in value.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
            if (property.GetIndexParameters().Length == 0 && property.Name != "ExtensionData")
                CollectIds(property.GetValue(value), ids, depth + 1);
    }

    private ItemEventRouterResponse Refuse(ItemEventRouterResponse output) => httpResponseUtil.AppendErrorToOutput(output, Refusal);

    private void LogError(string message) => logger.Error(message);

    private class GuardPatch : AbstractPatch
    {
        protected override MethodBase GetTargetMethod() => typeof(ItemEventRouter).GetMethod(nameof(ItemEventRouter.HandleItemEvent))!;

        [PatchPrefix]
        public static bool Prefix(string url, PmcData pmcData, BaseInteractionRequestData body, ItemEventRouterResponse output,
            ref ValueTask<ItemEventRouterResponse> __result)
        {
            try
            {
                if (_instance == null || !_instance.TouchesSticker(url, pmcData, body))
                    return true;
                __result = new ValueTask<ItemEventRouterResponse>(_instance.Refuse(output));
                return false;
            }
            catch (Exception e)
            {
                _instance?.LogError($"[DaCard] Could not check '{url}' for stickers: {e}");
                return true;
            }
        }
    }

    private class BuyPatch : AbstractPatch
    {
        protected override MethodBase GetTargetMethod() => typeof(TradeHelper).GetMethod(nameof(TradeHelper.BuyItem))!;

        [PatchPrefix]
        public static void Prefix() => _buying = true;

        [PatchFinalizer]
        public static void Finalizer() => _buying = false;
    }

    private class StashPatch : AbstractPatch
    {
        protected override MethodBase GetTargetMethod() => typeof(InventoryHelper).GetMethod(nameof(InventoryHelper.AddItemsToStash))!;

        [PatchPrefix]
        public static void Prefix(AddItemsDirectRequest request)
        {
            if (!_buying)
                return;
            try
            {
                _instance?.RollPurchased(request);
            }
            catch (Exception e)
            {
                _instance?.LogError($"[DaCard] Could not put stickers on bought cards: {e}");
            }
        }
    }
}
