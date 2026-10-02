using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using Diz.LanguageExtensions;
using EFT.InventoryLogic;
using HarmonyLib;
using SPT.Reflection.Patching;

namespace DaCard.Client
{
    internal class BinderInRaidError : InventoryError
    {
        public override string ToString() => "Binders stay out of raids: keep them in your stash.";

        public override string GetLocalizedDescription() => ToString();
    }

    internal class BinderPocketPatch : ModulePatch
    {
        protected override MethodBase GetTargetMethod() => AccessTools.Method(typeof(Slot), nameof(Slot.CheckConditions));

        [PatchPostfix]
        private static void Postfix(Slot __instance, Item item, bool ignoreRestrictions, ref Option<bool> __result)
        {
            if (ignoreRestrictions || __result.Failed || item == null)
                return;
            var wanted = CardRegistry.PocketCard(__instance);
            if (wanted == null)
                return;
            var stamp = CardCopies.Get(item);
            if (stamp == null || !string.Equals(stamp.Card, wanted, StringComparison.OrdinalIgnoreCase))
                __result = new Slot.ItemFiltersWontAllowError(item, __instance);
        }
    }

    internal class BinderRaidPatch : ModulePatch
    {
        protected override MethodBase GetTargetMethod() => AccessTools.Method(typeof(ItemManipulator), nameof(ItemManipulator.MovePathCheck));

        [PatchPostfix]
        private static void Postfix(Item item, ItemAddress to, ref Option<None> __result)
        {
            if (__result.Failed || item == null || to == null)
                return;
            if (!(to.GetRootItem() is InventoryEquipment))
                return;
            if (CardRegistry.IsBinder(item.StringTemplateId) || item.GetAllItems().Any(i => CardRegistry.IsBinder(i.StringTemplateId)))
                __result = new BinderInRaidError();
        }
    }

    internal class ContainerLookupPatch : ModulePatch
    {
        private const int Threshold = 32;

        private sealed class Lookup
        {
            public Slot[] Slots;
            public Dictionary<string, IContainer> ById;
        }

        private static readonly ConditionalWeakTable<CompoundItem, Lookup> Lookups = new ConditionalWeakTable<CompoundItem, Lookup>();

        protected override MethodBase GetTargetMethod() => AccessTools.Method(typeof(CompoundItem), nameof(CompoundItem.GetContainer));

        [PatchPrefix]
        private static bool Prefix(CompoundItem __instance, string containerId, ref IContainer __result)
        {
            var slots = __instance.Slots;
            if (slots == null || slots.Length < Threshold || containerId == null)
                return true;
            var lookup = Lookups.GetValue(__instance, _ => new Lookup());
            if (lookup.Slots != slots || lookup.ById == null)
            {
                var byId = new Dictionary<string, IContainer>(slots.Length);
                foreach (var grid in __instance.Grids ?? Array.Empty<Grid>())
                    byId[grid.ID] = grid;
                foreach (var slot in slots)
                    byId[slot.ID] = slot;
                lookup.Slots = slots;
                lookup.ById = byId;
            }
            __result = lookup.ById.TryGetValue(containerId, out var container) ? container : null;
            return false;
        }
    }
}
