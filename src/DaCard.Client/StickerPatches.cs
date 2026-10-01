using System.Collections.Generic;
using System.Reflection;
using System.Threading.Tasks;
using EFT;
using EFT.InventoryLogic;
using EFT.UI;
using EFT.UI.DragAndDrop;
using HarmonyLib;
using SPT.Reflection.Patching;
using UnityEngine;
using UnityEngine.UI;

namespace DaCard.Client
{
    internal static class StickerSlots
    {
        public const string Prefix = "stickerslot_";

        public static bool IsStickerSlot(Slot slot) => slot?.Name != null && slot.Name.StartsWith(Prefix);

        public static bool IsDeadSlot(Slot slot) =>
            slot.ContainedItem == null && !CardRegistry.CanRoll(slot.ParentItem?.StringTemplateId, slot.Name.Substring(Prefix.Length));
    }

    internal class StickerIconPatch : ModulePatch
    {
        private static readonly Dictionary<string, ItemIcon> Icons = new Dictionary<string, ItemIcon>();

        protected override MethodBase GetTargetMethod() =>
            AccessTools.Method(typeof(ItemIconCreator), nameof(ItemIconCreator.GetItemIcon));

        [PatchPrefix]
        private static bool Prefix(Item item, ref ItemIcon __result)
        {
            var templateId = item?.StringTemplateId;
            if (!CardRegistry.IsSticker(templateId))
                return true;
            if (!Icons.TryGetValue(templateId, out var icon) || icon.Sprite == null)
                Icons[templateId] = icon = new ItemIcon(templateId.GetHashCode()) { Sprite = CardRegistry.StickerSprite(templateId) };
            __result = icon;
            return false;
        }
    }

    internal class CardModelSlotsPatch : ModulePatch
    {
        protected override MethodBase GetTargetMethod() =>
            AccessTools.Method(typeof(ObjectsFactory), nameof(ObjectsFactory.AttachMods));

        [PatchPrefix]
        private static bool Prefix(ContainerCollection containerCollection, ref Task __result)
        {
            if (!CardRegistry.IsCard(containerCollection?.StringTemplateId))
                return true;
            __result = Task.CompletedTask;
            return false;
        }
    }

    internal class NestedStickerSlotsPatch : ModulePatch
    {
        private static readonly AccessTools.FieldRef<ItemSpecificationPanel, LayoutElement> PanelLayout =
            AccessTools.FieldRefAccess<ItemSpecificationPanel, LayoutElement>("_layoutElement");

        protected override MethodBase GetTargetMethod() =>
            AccessTools.Method(typeof(ItemSpecificationPanel), nameof(ItemSpecificationPanel.CreateModSlots));

        [PatchPostfix]
        private static void Postfix(ItemSpecificationPanel __instance, CompoundItem compoundItem)
        {
            var container = __instance._modsContainer;
            var removed = false;
            for (var i = container.childCount - 1; i >= 0; i--)
            {
                var view = container.GetChild(i).GetComponent<ModSlotView>();
                var slot = view != null ? view.Slot : null;
                if (!StickerSlots.IsStickerSlot(slot) || (slot.ParentItem == compoundItem && !StickerSlots.IsDeadSlot(slot)))
                    continue;
                view.Close();
                Object.DestroyImmediate(view.gameObject);
                removed = true;
            }
            if (!removed)
                return;
            if (container.childCount == 0)
                __instance._modsPanel.gameObject.SetActive(false);
            else
                FitWidth(__instance, container.childCount);
        }

        private static void FitWidth(ItemSpecificationPanel panel, int count)
        {
            var layout = PanelLayout(panel);
            var grid = panel._modsContainer.GetComponent<GridLayoutGroup>();
            if (layout == null || grid == null)
                return;
            var padding = 0;
            for (var t = panel._modsContainer as Transform; t != null && t != panel.transform; t = t.parent)
            {
                var group = t.GetComponent<LayoutGroup>();
                if (group != null)
                    padding += group.padding.left + group.padding.right;
            }
            var columns = Mathf.Max(6, Mathf.CeilToInt(count / 3f));
            layout.minWidth = padding + grid.cellSize.x * columns + grid.spacing.x * (columns - 1);
        }
    }

    internal class StickerSlotLookPatch : ModulePatch
    {
        protected override MethodBase GetTargetMethod() =>
            AccessTools.Method(typeof(ModSlotView), nameof(ModSlotView.ModLock));

        [PatchPostfix]
        private static void Postfix(ModSlotView __instance, Slot slot)
        {
            if (StickerSlots.IsStickerSlot(slot) && __instance._canvasGroup != null)
                __instance._canvasGroup.alpha = 1f;
        }
    }
}
