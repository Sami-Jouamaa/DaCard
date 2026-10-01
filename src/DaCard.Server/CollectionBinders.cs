using System.Reflection;
using System.Text.RegularExpressions;
using DaCard.Server.Storage;
using SPTarkov.Common.Models.Logging;
using SPTarkov.DI.Annotations;
using SPTarkov.Server.Core.Models.Common;
using SPTarkov.Server.Core.Models.Eft.Common.Tables;
using SPTarkov.Server.Core.Models.Spt.Mod;
using SPTarkov.Server.Core.Models.Spt.Tables;
using SPTarkov.Server.Core.Services.Modding.Custom;

namespace DaCard.Server;

[Injectable(InjectionType.Singleton)]
public class CollectionBinders(ISptLogger<CollectionBinders> logger, CustomItemService customItemService, LocaleTable locales, ItemLedger ledger)
{
    public const string BundlePath = "dacard/item_binder.bundle";

    internal const string CloneTpl = "619cbf9e0a7c3a1a2731940a";
    internal const string ParentCompoundItem = "566162e44bdc2d3f298b4573";
    internal const string SlotPrototype = "55d30c4c4bdc2db4468b457e";

    public const int Width = 1, Height = 2;

    public List<BinderManifestEntry> CreateBinders(IReadOnlyList<CollectionRow> collections, IReadOnlyList<CardRow> cards,
        IReadOnlyList<StickerRow> stickers, BinderSettings settings)
    {
        var entries = new List<BinderManifestEntry>();
        var slotLabels = new Dictionary<string, CardRow>();
        var byCollection = cards.GroupBy(c => c.CollectionId).ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);
        foreach (var collection in collections)
        {
            var members = (byCollection.GetValueOrDefault(collection.Id) ?? [])
                .OrderBy(c => Array.IndexOf(CardCatalog.RarityOrder, c.Rarity))
                .ThenBy(c => c.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (members.Count == 0)
            {
                logger.Warning($"[DaCard] Collection '{collection.Name}' has no cards; no binder.");
                continue;
            }

            var slots = members.Select(card =>
            {
                var slotName = SlotName(card);
                slotLabels[slotName] = card;
                return new Slot
                {
                    Name = slotName,
                    Id = new MongoId(SlotId(collection, card)),
                    Parent = new MongoId(collection.Id),
                    Properties = new SlotProperties
                    {
                        Filters = [new SlotFilter { Shift = 0, Filter = [new MongoId(card.Id), new MongoId(card.FoilId)] }]
                    },
                    Required = false,
                    MergeSlotWithChildren = false,
                    Prototype = SlotPrototype
                };
            }).ToList();

            if (!CreateItem(collection, members.Count, slots, settings))
                continue;
            ledger.Record(collection.Id, new LedgerItem
            {
                Kind = ItemLedger.Binder,
                Key = collection.IdKey,
                Name = $"{collection.Name} binder",
                Price = settings.Price,
                Background = settings.Background,
                Bundle = BundlePath,
                Slots = members.Select(card => new LedgerSlot
                {
                    Name = SlotName(card),
                    Id = SlotId(collection, card),
                    Label = card.ShortName ?? card.Name,
                    Filter = [card.Id, card.FoilId]
                }).ToList()
            });

            entries.Add(new BinderManifestEntry
            {
                Tpl = collection.Id,
                Collection = collection.Name,
                Stickers = stickers.Where(s => s.CollectionId == collection.Id).OrderBy(s => s.Position).Select(s => new BinderStickerEntry
                {
                    Image = CardManifests.ImageUrl(s.SetId, CardManifests.Albedo),
                    Placement = s.Placement
                }).ToList()
            });
        }

        AddSlotLabels(slotLabels);
        return entries;
    }

    private static string SlotId(CollectionRow collection, CardRow card) => CardCatalog.IdFor($"binder-slot:{collection.IdKey}:{card.IdKey}");

    private static string SlotName(CardRow card) => "cardslot_" + Regex.Replace(card.IdKey.ToLowerInvariant(), "[^a-z0-9_]", "_");

    private bool CreateItem(CollectionRow collection, int cardCount, List<Slot> slots, BinderSettings settings)
    {
        var name = collection.Name;
        var english = new LocaleDetails
        {
            Name = $"{name} binder",
            ShortName = collection.ShortName ?? name,
            Description = collection.Description ?? $"Binder for the {name} collection: a pocket for each of its {cardCount} cards. Inspect it to put cards in."
        };
        var itemLocales = new Dictionary<string, LocaleDetails> { ["en"] = english };
        foreach (var (lang, text) in collection.Locales ?? new())
        {
            itemLocales[lang] = new LocaleDetails
            {
                Name = text.Name ?? english.Name,
                ShortName = text.ShortName ?? english.ShortName,
                Description = text.Description ?? english.Description
            };
        }

        var result = customItemService.CreateItemFromClone(new NewItemFromCloneDetails
        {
            ItemTplToClone = CloneTpl,
            ParentId = ParentCompoundItem,
            NewId = new MongoId(collection.Id),
            NewItemName = "dacard_binder_" + Regex.Replace(collection.IdKey.ToLowerInvariant(), "[^a-z0-9_]", "_"),
            FleaPriceRoubles = settings.Price,
            HandbookPriceRoubles = settings.Price,
            HandbookParentId = DaCardHandbook.Binders,
            AddToHandbook = true,
            AddToFleaPriceDb = true,
            Locales = itemLocales,
            OverrideProperties = new TemplateItemProperties
            {
                Prefab = new Prefab { Path = BundlePath, Rcid = "" },
                Width = Width,
                Height = Height,
                Weight = 0.4,
                BackgroundColor = settings.Background,
                ExaminedByDefault = true,
                MergesWithChildren = false,
                Grids = [],
                Slots = slots
            }
        }, Assembly.GetExecutingAssembly());

        if (!result.Success)
        {
            logger.Error($"[DaCard] Could not create the binder for '{name}': {string.Join("; ", result.Errors ?? [])}");
            return false;
        }
        return true;
    }

    private void AddSlotLabels(Dictionary<string, CardRow> slots)
    {
        if (slots.Count == 0)
            return;
        foreach (var (lang, _) in locales.Languages)
        {
            if (!locales.Global.TryGetValue(lang, out var table))
                continue;
            table.AddTransformer(data =>
            {
                if (data == null)
                    return data;
                foreach (var (slot, card) in slots)
                    data[slot] = card.Locales?.GetValueOrDefault(lang)?.ShortName ?? card.Locales?.GetValueOrDefault(lang)?.Name
                                 ?? card.ShortName ?? card.Name;
                return data;
            });
        }
    }
}
