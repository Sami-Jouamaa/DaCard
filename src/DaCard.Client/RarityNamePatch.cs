using System.Reflection;
using System.Runtime.CompilerServices;
using EFT;
using EFT.UI;
using EFT.UI.DragAndDrop;
using HarmonyLib;
using SPT.Reflection.Patching;
using TMPro;

namespace DaCard.Client
{
    internal static class RarityNames
    {
        private static readonly ConditionalWeakTable<TMP_Text, StrongBox<bool>> Original = new ConditionalWeakTable<TMP_Text, StrongBox<bool>>();

        public static void Apply(TMP_Text text, bool tinted)
        {
            if (text == null)
                return;
            if (tinted)
            {
                Original.GetValue(text, t => new StrongBox<bool>(t.overrideColorTags));
                text.overrideColorTags = false;
            }
            else if (Original.TryGetValue(text, out var original))
            {
                text.overrideColorTags = original.Value;
            }
        }

        public static bool IsTinted(string name) => name != null && name.StartsWith("<color=");
    }

    internal class GridItemNamePatch : ModulePatch
    {
        protected override MethodBase GetTargetMethod() =>
            AccessTools.Method(typeof(GridItemView), nameof(GridItemView.UpdateItemName));

        [PatchPostfix]
        private static void Postfix(GridItemView __instance)
        {
            var item = __instance.Item;
            var tinted = item != null && CardRegistry.IsCard(item.StringTemplateId) && RarityNames.IsTinted(__instance.Caption.text?.Replace("<color=#b6c1c7> ", ""));
            RarityNames.Apply(__instance.Caption, tinted);
        }
    }

    internal class InspectCaptionPatch : ModulePatch
    {
        protected override MethodBase GetTargetMethod() =>
            AccessTools.Method(typeof(ItemInfoWindowLabels), nameof(ItemInfoWindowLabels.SetCaptionText));

        [PatchPostfix]
        private static void Postfix(ItemInfoWindowLabels __instance, string value)
        {
            RarityNames.Apply(__instance._caption, RarityNames.IsTinted(value));
        }
    }
}
