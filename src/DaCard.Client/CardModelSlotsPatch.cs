using System.Reflection;
using System.Threading.Tasks;
using EFT;
using EFT.InventoryLogic;
using HarmonyLib;
using SPT.Reflection.Patching;

namespace DaCard.Client
{
    internal class CardModelSlotsPatch : ModulePatch
    {
        protected override MethodBase GetTargetMethod() =>
            AccessTools.Method(typeof(ObjectsFactory), nameof(ObjectsFactory.AttachMods));

        [PatchPrefix]
        private static bool Prefix(ContainerCollection containerCollection, ref Task __result)
        {
            var templateId = containerCollection?.StringTemplateId;
            if (!CardRegistry.IsCard(templateId) && !CardRegistry.IsBinder(templateId))
                return true;
            __result = Task.CompletedTask;
            return false;
        }
    }
}
