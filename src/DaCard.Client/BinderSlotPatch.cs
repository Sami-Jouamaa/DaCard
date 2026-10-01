using System.Linq;
using System.Reflection;
using EFT;
using EFT.InventoryLogic;
using EFT.UI;
using EFT.UI.DragAndDrop;
using EFT.Utilities;
using HarmonyLib;
using SPT.Reflection.Patching;
using UnityEngine;

namespace DaCard.Client
{
    internal class BinderSlotPatch : ModulePatch
    {
        private const string SlotPrefix = "cardslot_";

        protected override MethodBase GetTargetMethod() =>
            AccessTools.Method(typeof(ModSlotView), nameof(ModSlotView.Show),
                new[] { typeof(Slot), typeof(ItemContext), typeof(ItemController), typeof(ItemUiContext) });

        [PatchPrefix]
        private static void Prefix(Slot slot)
        {
            var name = slot?.Name;
            var sticker = StickerSlots.IsStickerSlot(slot);
            if (name == null || (!sticker && !name.StartsWith(SlotPrefix)))
                return;

            var key = "Slots/" + name;
            if (ResourcesCache._storage.TryGetValue(key, out var existing) && existing as Sprite != null)
                return;

            var sprite = sticker ? CardRegistry.EmptyLayerSlotSprite() : CardRegistry.EmptySlotSprite();
            if (sprite != null)
                ResourcesCache._storage[key] = sprite;
        }
    }
}
