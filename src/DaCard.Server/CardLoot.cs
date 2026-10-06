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
// Build: dotnet build -p:E:\SPT, will automatically put the new DLL in the correct folder, run through powershell
// Cards found in raid: extra loot, on top of what a container would hold anyway. After SPT fills a raid's containers, every
// container of a card container type ("containers" in config.json) rolls "loot.cardPercent"; a hit rolls a rarity (each
// collection's own rarity chances) and adds a random card of it, with its layers rolled, into a free cell.
[Injectable(InjectionType.Singleton)]
public class CardLoot(ISptLogger<CardLoot> logger, ItemHelper itemHelper, InventoryHelper inventoryHelper, CardCopies copies, CardIndex index)
{
    private static CardLoot? _instance;
    private static bool _patched;

    private HashSet<MongoId> _containers = new();
    private RarityRoller? _cards;
    private double _cardPercent;
    private List<(string Tpl, double Percent)> _packs = new();

    public void Configure(DaCardConfig config, IEnumerable<(string Tpl, double Percent)> packs)
    {
        _packs = packs.Where(p => p.Percent > 0).ToList();
        _containers = config.Containers.Select(c => new MongoId(c)).ToHashSet();
        _cardPercent = Math.Clamp(config.Loot.CardPercent, 0, 100);
        _cards = RarityRoller.Build(index.Cards.Values.Select(c => (c.Id, c.CollectionId, c.Rarity)), index.RaritiesOf);

        _instance = this;
        if (_patched)
            return;
        new StaticContainersPatch().Enable();
        _patched = true;
    }

    private void AddCards(string locationId, List<SpawnpointTemplate>? containers)
    {
        var cardsOn = _cards is { IsEmpty: false } && _cardPercent > 0;
        if (containers == null || (!cardsOn && _packs.Count == 0))
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
            bool Put(string tpl, string? card = null)
            {
                map ??= inventoryHelper.GetContainerMap(grid.Properties.CellsH.Value, grid.Properties.CellsV.Value, items, root.Id);
                var slot = map.FindSlotForItem(1, 1);
                if (slot.Success != true)
                    return false;
                var rotated = slot.Rotation ?? false;
                map.TryFillContainerMapWithItem(slot.X!.Value, slot.Y!.Value, 1, 1, rotated, out _);
                var loot = new SptLootItem
                {
                    Id = new MongoId(),
                    Template = new MongoId(tpl),
                    ParentId = root.Id.ToString(),
                    SlotId = grid.Name ?? "main",
                    Location = new ItemLocation
                    {
                        X = slot.X,
                        Y = slot.Y,
                        R = rotated ? ItemRotation.Vertical : ItemRotation.Horizontal
                    }
                };
                if (card != null)
                    copies.Stamp(loot, card);
                items.Add(loot);
                return true;
            }

            if (cardsOn && Random.Shared.NextDouble() * 100 < _cardPercent && _cards!.Pick(Random.Shared) is { } picked
                && index.Cards.TryGetValue(picked, out var card) && Put(card.Template, card.Id))
                added++;

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
