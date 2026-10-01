using System;
using System.Collections.Generic;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using EFT;
using EFT.InventoryLogic;
using HarmonyLib;
using SPT.Reflection.Patching;
using UnityEngine;

namespace DaCard.Client
{
    internal class CreateItemPatch : ModulePatch
    {
        private static readonly Regex ColorTag = new Regex(@"</?color(=[^>]*)?>", RegexOptions.IgnoreCase);

        protected override MethodBase GetTargetMethod() =>
            AccessTools.Method(typeof(ObjectsFactory), nameof(ObjectsFactory.CreateItemAsync));

        [PatchPostfix]
        private static void Postfix(Item item, ref Task<GameObject> __result)
        {
            var templateId = item?.StringTemplateId;
            if (__result == null)
                return;
            var isBinder = CardRegistry.IsBinder(templateId);
            var isPack = PackRegistry.IsPack(templateId);
            if (!isBinder && !isPack && !CardRegistry.IsCard(templateId))
                return;

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
                            CardRegistry.Apply(model, templateId, CardName(item), item.Id.ToString(), Stickers(item));
                    }
                    catch (Exception e)
                    {
                        Plugin.Log.LogError($"Could not apply card {templateId}: {e}");
                    }
                }
                return model;
            }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        }

        private static HashSet<string> Stickers(Item item)
        {
            var stickers = new HashSet<string>();
            if (item is CompoundItem compound)
                foreach (var slot in compound.Slots)
                    if (slot.ContainedItem != null)
                        stickers.Add(slot.ContainedItem.StringTemplateId);
            return stickers;
        }

        private static string CardName(Item item)
        {
            try
            {
                return ColorTag.Replace(item.LocalizedName(), "");
            }
            catch (Exception e)
            {
                Plugin.Log.LogWarning($"No localized name for card {item.StringTemplateId}: {e.Message}");
                return item.Name;
            }
        }
    }
}
