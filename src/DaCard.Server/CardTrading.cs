using System.Reflection;
using DaCard.Server.Storage;
using SPTarkov.Common.Models.Logging;
using SPTarkov.DI.Annotations;
using SPTarkov.Reflection.Patching;
using SPTarkov.Server.Core.Generators;
using SPTarkov.Server.Core.Helpers.Commerce;
using SPTarkov.Server.Core.Helpers.Profile;
using SPTarkov.Server.Core.Models.Common;
using SPTarkov.Server.Core.Models.Eft.Common.Tables;
using SPTarkov.Server.Core.Models.Eft.Inventory;
using SPTarkov.Server.Core.Models.Enums;
using SPTarkov.Server.Core.Models.Spt.Fence;
using SPTarkov.Server.Core.Models.Spt.Tables;
using SPTarkov.Server.Core.Services.Commerce;

namespace DaCard.Server;

[Injectable(InjectionType.Singleton)]
public class CardTrading(ISptLogger<CardTrading> logger, CardCopies copies, CardIndex index, TradersTable traders, FenceService fence)
{
    private static CardTrading? _instance;
    private static bool _patched;
    [ThreadStatic] private static bool _buying;

    public void Enable()
    {
        _instance = this;
        if (_patched)
            return;
        new BuyPatch().Enable();
        new StashPatch().Enable();
        new FenceBasePatch().Enable();
        new FenceOffersPatch().Enable();
        _patched = true;
    }

    private void StampPurchased(AddItemsDirectRequest request)
    {
        foreach (var items in request.ItemsWithModsToAdd ?? [])
            foreach (var item in items)
                copies.StampIfMissing(item);
    }

    private void AddCardsToFence()
    {
        if (!traders.TryGetValue(Traders.FENCE, out var trader) || trader.Assort == null)
            return;
        var assort = trader.Assort;
        var added = 0;
        foreach (var template in index.Templates.Values.Where(t => index.CardsOfTemplate.ContainsKey(t.Id)))
        {
            var tpl = new MongoId(template.Id);
            var item = new Item
            {
                Id = new MongoId(),
                Template = tpl,
                ParentId = "hideout",
                SlotId = "hideout",
                Upd = new Upd { StackObjectsCount = 9999999 }
            };
            var price = fence.GetItemPrice(tpl, [item]) ?? template.Price;
            assort.Items.Add(item);
            assort.BarterScheme[item.Id] = [[new BarterScheme { Count = Math.Round(price), Template = Money.ROUBLES }]];
            assort.LoyalLevelItems[item.Id] = 1;
            added++;
        }
        if (added > 0)
            logger.Info($"[DaCard] Fence can sell {added} kind(s) of random card");
    }

    private void StampOffers(CreateFenceAssortsResult result)
    {
        foreach (var offer in result.SptItems ?? [])
            if (offer.Count > 0)
                copies.StampIfMissing(offer[0]);
    }

    private void LogError(string message) => logger.Error(message);

    private class BuyPatch : AbstractPatch
    {
        protected override MethodBase GetTargetMethod() => typeof(TradeHelper).GetMethod(nameof(TradeHelper.BuyItem))!;

        [PatchPrefix]
        public static void Prefix() => _buying = true;

        [PatchFinalizer]
        public static void Finalizer() => _buying = false;
    }

    private class StashPatch : AbstractPatch
    {
        protected override MethodBase GetTargetMethod() => typeof(InventoryHelper).GetMethod(nameof(InventoryHelper.AddItemsToStash))!;

        [PatchPrefix]
        public static void Prefix(AddItemsDirectRequest request)
        {
            if (!_buying)
                return;
            try
            {
                _instance?.StampPurchased(request);
            }
            catch (Exception e)
            {
                _instance?.LogError($"[DaCard] Could not pick the cards of a purchase: {e}");
            }
        }
    }

    private class FenceBasePatch : AbstractPatch
    {
        protected override MethodBase GetTargetMethod() =>
            typeof(FenceBaseAssortGenerator).GetMethod(nameof(FenceBaseAssortGenerator.GenerateFenceBaseAssorts))!;

        [PatchPostfix]
        public static void Postfix()
        {
            try
            {
                _instance?.AddCardsToFence();
            }
            catch (Exception e)
            {
                _instance?.LogError($"[DaCard] Could not add cards to Fence: {e}");
            }
        }
    }

    private class FenceOffersPatch : AbstractPatch
    {
        protected override MethodBase GetTargetMethod() =>
            typeof(FenceService).GetMethod("CreateAssorts", BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)!;

        [PatchPostfix]
        public static void Postfix(CreateFenceAssortsResult __result)
        {
            try
            {
                if (__result != null)
                    _instance?.StampOffers(__result);
            }
            catch (Exception e)
            {
                _instance?.LogError($"[DaCard] Could not pick Fence's cards: {e}");
            }
        }
    }
}
