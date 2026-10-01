using System.Reflection;
using DaCard.Server.Storage;
using SPTarkov.Common.Models.Logging;
using SPTarkov.DI.Annotations;
using SPTarkov.Reflection.Patching;
using SPTarkov.Server.Core.Extensions;
using SPTarkov.Server.Core.Generators.Loot;
using SPTarkov.Server.Core.Helpers.Items;
using SPTarkov.Server.Core.Helpers.Profile;
using SPTarkov.Server.Core.Models.Common;
using SPTarkov.Server.Core.Models.Eft.Common;
using SPTarkov.Server.Core.Models.Eft.Common.Tables;

namespace DaCard.Server;

// Cards found in raid: extra loot, on top of what a container would hold anyway. After SPT fills a raid's containers, every
// container of a card container type ("containers" in config.json) rolls each rarity's chance ("lootPercent": % of those
// containers that get a card of that rarity); a hit adds a random card of the rarity (its foil version at the foil chance)
// into a free cell, if there is one.
[Injectable(InjectionType.Singleton)]
public class CardLoot(ISptLogger<CardLoot> logger, ItemHelper itemHelper, InventoryHelper inventoryHelper, CardStickers stickers, CardStore store, CardIndex index)
{
    private static CardLoot? _instance;
    private static bool _patched;

    private HashSet<MongoId> _containers = new();
    private List<(string Rarity, double Percent)> _rarities = new();
    private double _foilShare;
    private List<(string Tpl, double Percent)> _packs = new();

    public void Configure(DaCardConfig config, IReadOnlyList<CreatedCard> cards, double foilShare, IEnumerable<(string Tpl, double Percent)> packs)
    {
        _packs = packs.Where(p => p.Percent > 0).ToList();
        _containers = config.Containers.Select(c => new MongoId(c)).ToHashSet();
        _foilShare = foilShare;
        _rarities = CardCatalog.RarityOrder
            .Select(r => (Rarity: r, Percent: Math.Clamp(config.Rarities.GetValueOrDefault(r)?.LootPercent ?? 0, 0, 100)))
            .Where(r => r.Percent > 0 && cards.Any(c => c.Rarity == r.Rarity))
            .ToList();

        _instance = this;
        if (_patched)
            return;
        new StaticContainersPatch().Enable();
        _patched = true;
    }

    private void AddCards(string locationId, List<SpawnpointTemplate>? containers)
    {
        if (containers == null || (_rarities.Count == 0 && _packs.Count == 0))
            return;

        var added = 0;
        var packsAdded = 0;
        var filled = 0;
        foreach (var container in containers)
        {
            var items = container.Items?.ToList();
            var root = items?.FirstOrDefault(i => i.Id.ToString() == container.Root) ?? items?.FirstOrDefault();
            if (items == null || root == null || !_containers.Contains(root.Template))
                continue;

            var grid = itemHelper.GetItem(root.Template).Value?.Properties?.Grids?.FirstOrDefault();
            if (grid?.Properties?.CellsH is not > 0 || grid.Properties.CellsV is not > 0)
                continue;

            int[,]? map = null;
            var before = items.Count;
            bool Put(string tpl)
            {
                map ??= inventoryHelper.GetContainerMap(grid.Properties.CellsH.Value, grid.Properties.CellsV.Value, items, root.Id);
                var slot = map.FindSlotForItem(1, 1);
                if (slot.Success != true)
                    return false;
                var rotated = slot.Rotation ?? false;
                map.TryFillContainerMapWithItem(slot.X!.Value, slot.Y!.Value, 1, 1, rotated, out _);
                var id = new MongoId();
                items.Add(new SptLootItem
                {
                    Id = id,
                    Template = new MongoId(tpl),
                    ParentId = root.Id.ToString(),
                    SlotId = grid.Name ?? "main",
                    Location = new ItemLocation
                    {
                        X = slot.X,
                        Y = slot.Y,
                        R = rotated ? ItemRotation.Vertical : ItemRotation.Horizontal
                    }
                });
                foreach (var (stickerSlot, sticker) in stickers.Roll(tpl))
                    items.Add(new SptLootItem
                    {
                        Id = new MongoId(),
                        Template = new MongoId(sticker),
                        ParentId = id.ToString(),
                        SlotId = stickerSlot
                    });
                return true;
            }

            foreach (var (rarity, percent) in _rarities)
            {
                if (Random.Shared.NextDouble() * 100 >= percent)
                    continue;
                var card = PickCard(rarity);
                if (card == null)
                    continue;
                if (!Put(card.HasFoil && Random.Shared.NextDouble() < _foilShare ? card.FoilId : card.Id))
                    break;
                added++;
            }

            foreach (var (tpl, percent) in _packs)
            {
                if (Random.Shared.NextDouble() * 100 >= percent)
                    continue;
                if (!Put(tpl))
                    break;
                packsAdded++;
            }

            if (items.Count == before)
                continue;
            container.Items = items;
            filled++;
        }

        logger.Info($"[DaCard] {locationId}: {added} card(s) and {packsAdded} booster pack(s) added to {filled} container(s)");
    }

    private CreatedCard? PickCard(string rarity)
    {
        for (var attempt = 0; attempt < 5; attempt++)
        {
            var row = store.RandomCard(rarity);
            if (row == null)
                return null;
            if (index.Find(row.Id) is { } created)
                return created;
        }
        return null;
    }

    private void LogError(string message) => logger.Error(message);

    // After SPT fills a raid's static containers
    private class StaticContainersPatch : AbstractPatch
    {
        protected override MethodBase GetTargetMethod() =>
            typeof(LocationLootGenerator).GetMethod(nameof(LocationLootGenerator.GenerateStaticContainers))!;

        [PatchPostfix]
        public static void Postfix(string locationId, List<SpawnpointTemplate> __result)
        {
            try
            {
                _instance?.AddCards(locationId, __result);
            }
            catch (Exception e)
            {
                _instance?.LogError($"[DaCard] Could not add cards to {locationId}'s containers: {e}");
            }
        }
    }
}
