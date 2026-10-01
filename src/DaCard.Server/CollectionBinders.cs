using System.Reflection;
using System.Text.RegularExpressions;
using SPTarkov.Common.Models.Logging;
using SPTarkov.DI.Annotations;
using SPTarkov.Server.Core.Models.Common;
using SPTarkov.Server.Core.Models.Eft.Common.Tables;
using SPTarkov.Server.Core.Models.Spt.Mod;
using SPTarkov.Server.Core.Models.Spt.Tables;
using SPTarkov.Server.Core.Services.Modding.Custom;
using SPTarkov.Server.Core.Utils;
using Path = System.IO.Path;

namespace DaCard.Server;

public record StickerPicture(string Path, StickerPlacement Placement);

// Front / Back: the collection's card layers, under every card's own
public record CollectionEntry(string Id, string Key, CollectionFile Data, IReadOnlyList<StickerPicture> Stickers,
    List<LayerSource> Front, List<LayerSource> Back, string Dir)
{
    public string Addon { get; init; } = "";
    public string IdKey => CardCatalog.IdKeyOf(Data.IdKey, Key);
}

[Injectable(InjectionType.Singleton)]
public class CollectionBinders(ISptLogger<CollectionBinders> logger, JsonUtil jsonUtil, CustomItemService customItemService, LocaleTable locales, ItemLedger ledger)
{
    public const string BundlePath = "dacard/item_binder.bundle";
    public const string DataFile = "collection.json";
    public const string StickerFile = "sticker.png";
    public const string BackFile = "back.png";
    public const string OverlayFile = "overlay.png";

    internal const string CloneTpl = "619cbf9e0a7c3a1a2731940a";
    internal const string ParentCompoundItem = "566162e44bdc2d3f298b4573";
    internal const string HandbookStorageContainers = "5b5f6fa186f77409407a7eb7";
    internal const string SlotPrototype = "55d30c4c4bdc2db4468b457e";

    // Stash cells of every binder, whatever its card count
    public const int Width = 1, Height = 2;

    public List<CollectionEntry> Scan(IReadOnlyList<AddonEntry> addons)
    {
        var found = new List<CollectionEntry>();
        var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var addon in addons)
        foreach (var collection in ScanAddon(addon))
        {
            if (!keys.Add(collection.Key) || !ids.Add(collection.Id))
            {
                logger.Error($"[DaCard] {addon.Where(Addons.Cards, collection.Key)}: another collection has the same folder name or \"idKey\" (a copied collection?); skipping it.");
                continue;
            }
            found.Add(collection);
        }
        return found;
    }

    private IEnumerable<CollectionEntry> ScanAddon(AddonEntry addon)
    {
        var cardsDir = Path.Combine(addon.Dir, Addons.Cards);
        if (!Directory.Exists(cardsDir))
            yield break;
        var cardsPath = addon.Where(Addons.Cards);
        foreach (var dir in Directory.GetDirectories(cardsDir).OrderBy(d => d, StringComparer.OrdinalIgnoreCase))
        {
            var key = Path.GetFileName(dir);
            if (key.Equals(CardCatalog.DefaultCollection, StringComparison.OrdinalIgnoreCase) || CardCatalog.IsRarity(key))
                continue;
            var json = Path.Combine(dir, DataFile);
            if (!File.Exists(json))
                continue;
            CollectionFile? data;
            try
            {
                data = jsonUtil.Deserialize<CollectionFile>(File.ReadAllText(json));
            }
            catch (Exception e)
            {
                logger.Error($"[DaCard] {cardsPath}/{key}/{DataFile} is not valid JSON: {e.Message}");
                continue;
            }
            if (data == null)
                continue;
            data.Name = string.IsNullOrWhiteSpace(data.Name) ? key : data.Name;
            var idKey = CardCatalog.IdKeyOf(data.IdKey, key);
            var where = $"{cardsPath}/{key}/{DataFile}";
            var (front, back) = ReadLayers(dir, idKey, data, where);
            yield return new CollectionEntry(CardCatalog.IdFor("binder:" + idKey), key, data, FindStickers(dir, where, data), front, back, dir)
            {
                Addon = addon.Folder
            };
        }
    }

    // Collection front layers glow like a card frame. Older collections: overlay.png (the frame) and back.png
    private (List<LayerSource> Front, List<LayerSource> Back) ReadLayers(string dir, string key, CollectionFile data, string where)
    {
        if (data.Layers != null)
            return (CardLayers.Read(dir, data.Layers.Front, $"coll:{key}:", true, where, logger),
                    CardLayers.Read(dir, data.Layers.Back, $"coll:{key}:", false, where, logger));

        var front = CardLayers.FromFiles(dir, Path.GetFileNameWithoutExtension(OverlayFile), $"coll:{key}:overlay", 100, false, true, null, 12);
        var back = CardLayers.FromFiles(dir, Path.GetFileNameWithoutExtension(BackFile), $"coll-back:{key}:back", 100, false, false, null, 12);
        return (front != null ? [front] : [], back != null ? [back] : []);
    }

    private List<StickerPicture> FindStickers(string dir, string where, CollectionFile data)
    {
        var stickers = new List<StickerPicture>();
        if (data.Stickers != null)
        {
            foreach (var layer in data.Stickers)
            {
                var file = Path.GetFileName(layer.File ?? "");
                var path = Path.Combine(dir, file);
                if (file.Length > 0 && File.Exists(path))
                    stickers.Add(new StickerPicture(path, layer));
                else
                    logger.Warning($"[DaCard] {where}: sticker picture '{layer.File}' is missing; skipping that sticker.");
            }
            return stickers;
        }
        var legacy = Path.Combine(dir, StickerFile);
        if (File.Exists(legacy))
            stickers.Add(new StickerPicture(legacy, data.Sticker ?? new StickerPlacement()));
        return stickers;
    }

    public static bool IsMember(CardEntry card, CollectionEntry collection) =>
        card.Collection != null && card.Collection.Equals(collection.Key, StringComparison.OrdinalIgnoreCase);

    public List<BinderManifestEntry> CreateBinders(IReadOnlyList<CollectionEntry> collections, IReadOnlyList<CardEntry> cards,
        BinderSettings settings, Func<string, string, string> registerImage)
    {
        var entries = new List<BinderManifestEntry>();
        var slotLabels = new Dictionary<string, CardEntry>();
        foreach (var collection in collections)
        {
            var members = cards.Where(c => IsMember(c, collection))
                .OrderBy(c => Array.IndexOf(CardCatalog.RarityOrder, c.Rarity))
                .ThenBy(c => c.Data.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (members.Count == 0)
            {
                logger.Warning($"[DaCard] Collection '{collection.Data.Name}' has no cards (card.json \"collection\": \"{collection.Data.Name}\"); no binder.");
                continue;
            }

            var slots = members.Select(card =>
            {
                var slotName = SlotName(card);
                slotLabels[slotName] = card;
                return new Slot
                {
                    Name = slotName,
                    Id = new MongoId(CardCatalog.IdFor($"binder-slot:{collection.IdKey}:{card.IdKey}")),
                    Parent = new MongoId(collection.Id),
                    Properties = new SlotProperties
                    {
                        Filters = [new SlotFilter { Shift = 0, Filter = [new MongoId(card.Id), new MongoId(CardCatalog.FoilIdFor(card))] }]
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
                Key = collection.Key,
                Name = $"{collection.Data.Name} binder",
                Price = settings.Price,
                Background = settings.Background,
                Bundle = BundlePath,
                Slots = members.Select(card => new LedgerSlot
                {
                    Name = SlotName(card),
                    Id = CardCatalog.IdFor($"binder-slot:{collection.IdKey}:{card.IdKey}"),
                    Label = card.Data.ShortName ?? card.Data.Name,
                    Filter = [card.Id, CardCatalog.FoilIdFor(card)]
                }).ToList()
            });

            entries.Add(new BinderManifestEntry
            {
                Tpl = collection.Id,
                Collection = collection.Key,
                Stickers = collection.Stickers.Select((sticker, i) => new BinderStickerEntry
                {
                    Image = registerImage($"binder_{collection.Id}_{i}", sticker.Path),
                    Placement = sticker.Placement
                }).ToList(),
                Cards = members.Select(c => c.Id).ToList()
            });
        }

        AddSlotLabels(slotLabels);
        return entries;
    }

    private static string SlotName(CardEntry card) => "cardslot_" + Regex.Replace(card.IdKey.ToLowerInvariant(), "[^a-z0-9_]", "_");

    private bool CreateItem(CollectionEntry collection, int cardCount, List<Slot> slots, BinderSettings settings)
    {
        var name = collection.Data.Name!;
        var english = new LocaleDetails
        {
            Name = $"{name} binder",
            ShortName = collection.Data.ShortName ?? name,
            Description = collection.Data.Description ?? $"Binder for the {name} collection: a pocket for each of its {cardCount} cards. Inspect it to put cards in."
        };
        var itemLocales = new Dictionary<string, LocaleDetails> { ["en"] = english };
        foreach (var (lang, text) in collection.Data.Locales ?? new())
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
            NewItemName = "dacard_binder_" + collection.IdKey.ToLowerInvariant(),
            FleaPriceRoubles = settings.Price,
            HandbookPriceRoubles = settings.Price,
            HandbookParentId = HandbookStorageContainers,
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

    private void AddSlotLabels(Dictionary<string, CardEntry> slots)
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
                    data[slot] = card.Data.Locales?.GetValueOrDefault(lang)?.ShortName ?? card.Data.Locales?.GetValueOrDefault(lang)?.Name
                                 ?? card.Data.ShortName ?? card.Data.Name ?? card.Key;
                return data;
            });
        }
    }
}
