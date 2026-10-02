using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Comfort.Common;
using EFT;
using EFT.Communications;
using EFT.InventoryLogic;
using EFT.UI;
using HarmonyLib;
using SPT.Reflection.Patching;

namespace DaCard.Client
{
    internal static class PackOpening
    {
        private static bool _busy;

        public static bool IsPack(Item item) => item != null && PackRegistry.IsPack(item.StringTemplateId);

        public static bool CanOpen(Item item) => IsPack(item) && item.CurrentAddress != null && !InRaid();

#pragma warning disable CS0618
        private static bool InRaid() => InGameStatus.InRaid;
#pragma warning restore CS0618

        private static int FreeStashCells(Inventory inventory)
        {
            var grid = inventory?.Stash?.Grids?.FirstOrDefault();
            if (grid == null)
                return int.MaxValue;
            var one = new IntVec2(1, 1);
            var free = 0;
            for (var y = 0; y < grid.GridHeight; y++)
                for (var x = 0; x < grid.GridWidth; x++)
                    if (grid.CheckLayout(one, new LocationInGrid(x, y, ItemRotation.Horizontal)))
                        free++;
            return free;
        }

        private static string Name(Item item)
        {
            try
            {
                var card = CardNames.Of(item);
                return card != null ? CardNames.Tinted(card, CardNames.Name(card)) : item.LocalizedName();
            }
            catch (Exception)
            {
                return item.Name;
            }
        }

        public static async void Open(ItemUiContext ui, Item pack)
        {
            if (_busy || ui == null || pack == null)
                return;
            _busy = true;
            try
            {
                var inventory = ui.ClientSession?.Profile?.Inventory;
                var count = PackRegistry.CardCount(pack.StringTemplateId);
                if (FreeStashCells(inventory) < count)
                {
                    NotificationManager.DisplayWarningNotification($"Not enough room in your stash for the {count} cards in {Name(pack)}. It stays sealed.");
                    return;
                }

                var before = new HashSet<string>(inventory?.GetPlayerItems().Select(i => i.Id.ToString()) ?? Enumerable.Empty<string>());
                var result = await ui.UnpackItem(pack);
                if (result == null || result.Failed)
                {
                    NotificationManager.DisplayWarningNotification(string.IsNullOrEmpty(result?.Error)
                        ? $"Could not open {Name(pack)}. It stays sealed."
                        : result.Error);
                    return;
                }

                Singleton<GUISounds>.Instance?.PlayUISound(EUISoundType.MenuOpenContainer);
                var cards = inventory?.GetPlayerItems().Where(i => !before.Contains(i.Id.ToString())).Select(Name).ToList() ?? new List<string>();
                NotificationManager.DisplayMessageNotification(cards.Count > 0
                    ? $"{Name(pack)}: {string.Join(", ", cards)}"
                    : $"{Name(pack)} opened: the cards are in your stash.");
            }
            catch (Exception e)
            {
                Plugin.Log.LogError("Could not open the booster pack: " + e);
            }
            finally
            {
                _busy = false;
            }
        }
    }

    internal class PackButtonPatch : ModulePatch
    {
        protected override MethodBase GetTargetMethod() =>
            AccessTools.Method(typeof(ItemContextInteractionsSwitcher), nameof(ItemContextInteractionsSwitcher.IsActive));

        [PatchPrefix]
        private static bool Prefix(EItemInfoButton button, Item ____item, ref bool __result)
        {
            if (button != EItemInfoButton.Open || !PackOpening.IsPack(____item))
                return true;
            __result = PackOpening.CanOpen(____item);
            return false;
        }
    }

    internal class PackOpenPatch : ModulePatch
    {
        protected override MethodBase GetTargetMethod() =>
            AccessTools.Method(typeof(BaseItemContextInteractions), nameof(BaseItemContextInteractions.ExecuteInteractionInternal));

        [PatchPrefix]
        private static bool Prefix(BaseItemContextInteractions __instance, EItemInfoButton interaction)
        {
            if (interaction != EItemInfoButton.Open || !PackOpening.IsPack(__instance.Item))
                return true;
            PackOpening.Open(__instance.ItemUiContext, __instance.Item);
            return false;
        }
    }
}
