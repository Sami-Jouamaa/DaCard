using System;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using EFT;
using Diz.Jobs;
using EFT.InventoryLogic;
using HarmonyLib;
using SPT.Reflection.Patching;
using UnityEngine;

namespace DaCard.Client
{
    internal class CreateItemPatch : ModulePatch
    {
        protected override MethodBase GetTargetMethod() =>
            AccessTools.Method(typeof(ObjectsFactory), nameof(ObjectsFactory.CreateItemAsync));

        [PatchPostfix]
        private static void Postfix(Item item, YieldDelegate yield, ref Task<GameObject> __result)
        {
            var templateId = item?.StringTemplateId;
            if (__result == null)
                return;
            var isBinder = CardRegistry.IsBinder(templateId);
            var isPack = PackRegistry.IsPack(templateId);
            var isCard = CardRegistry.IsCard(templateId);
            if (!isBinder && !isPack && !isCard)
                return;

            if (!isPack && yield != null && !yield.Equals(JobYieldPriority.Immediate))
            {
                var stamp = isCard ? CardCopies.Get(item) : null;
                var itemId = item.Id.ToString();
                __result = Prepared(__result, isBinder ? CardRegistry.PrepareBinder(templateId) : CardRegistry.PrepareCard(stamp), model =>
                {
                    if (isBinder)
                        CardRegistry.ApplyBinder(model, templateId);
                    else
                        CardRegistry.Apply(model, stamp, itemId);
                }, templateId);
                return;
            }

            __result = __result.ContinueWith(task =>
            {
                var model = task.GetAwaiter().GetResult();
                if (model != null)
                {
                    try
                    {
                        if (isPack)
                            PackRegistry.Apply(model, templateId);
                        else if (isBinder)
                            CardRegistry.ApplyBinder(model, templateId);
                        else
                            CardRegistry.Apply(model, CardCopies.Get(item), item.Id.ToString());
                    }
                    catch (Exception e)
                    {
                        Plugin.Log.LogError($"Could not apply card {templateId}: {e}");
                    }
                }
                return model;
            }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        }

        private static async Task<GameObject> Prepared(Task<GameObject> created, Task textures, Action<GameObject> apply, string templateId)
        {
            var model = await created;
            if (model == null)
                return null;
            try
            {
                await textures;
                await FrameBudget.Turn();
                var start = FrameBudget.Start();
                if (model != null)
                    apply(model);
                FrameBudget.Spend(start);
            }
            catch (Exception e)
            {
                Plugin.Log.LogError($"Could not apply card {templateId}: {e}");
            }
            return model;
        }
    }
}
