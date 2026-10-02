using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using EFT;
using EFT.InventoryLogic;
using EFT.Trading;
using HarmonyLib;
using Newtonsoft.Json.Linq;
using SPT.Reflection.Patching;
using UnityEngine;

namespace DaCard.Client
{
    internal sealed class CardStamp
    {
        public string Card;
        public List<string> Layers;
        public HashSet<string> Rolled;
        public Dictionary<string, string> Foils = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    }

    internal static class FoilTypes
    {
        public const string Picture = "picture";
        public static readonly string[] All = { "foil", "linear", "radial", "sparkle", "galaxy", "diamond", "squares", "circles", "surge", "ripple", "speckle", "crackle" };

        public static int Index(string type) => Math.Max(0, Array.IndexOf(All, type?.ToLowerInvariant()));
    }

    internal static class CardCopies
    {
        public const string UpdKey = "DaCard";

        private static readonly ConcurrentDictionary<string, CardStamp> Stamps = new ConcurrentDictionary<string, CardStamp>();

        public static CardStamp Get(Item item) => item != null && Stamps.TryGetValue(item.Id.ToString(), out var stamp) ? stamp : null;

        public static void Set(string itemId, CardStamp stamp) => Stamps[itemId] = stamp;

        public static CardStamp Parse(JToken token)
        {
            if (!(token is JObject data) || !(data["c"] is JValue card) || card.Type != JTokenType.String || string.IsNullOrEmpty((string)card))
                return null;
            var layers = (data["l"] as JArray)?.Where(t => t.Type == JTokenType.String).Select(t => (string)t).Where(t => !string.IsNullOrEmpty(t)).ToList()
                         ?? new List<string>();
            var stamp = new CardStamp { Card = (string)card, Layers = layers, Rolled = new HashSet<string>(layers, StringComparer.OrdinalIgnoreCase) };
            if (data["f"] is JObject foils)
                foreach (var foil in foils.Properties())
                    if (foil.Value.Type == JTokenType.String && FoilTypes.All.Contains((string)foil.Value))
                        stamp.Foils[foil.Name] = (string)foil.Value;
            return stamp;
        }

        public static Dictionary<string, object> ToUpd(CardStamp stamp)
        {
            var upd = new Dictionary<string, object> { ["c"] = stamp.Card, ["l"] = stamp.Layers };
            if (stamp.Foils.Count > 0)
                upd["f"] = new Dictionary<string, string>(stamp.Foils);
            return upd;
        }

        public static string FoilKey(CardStamp stamp) =>
            stamp == null ? "" : string.Join(",", stamp.Foils.OrderBy(f => f.Key, StringComparer.OrdinalIgnoreCase).Select(f => f.Key + "=" + f.Value));

        public static int Hash(CardStamp stamp) =>
            (int)CardLayers.Hash(stamp.Card + "|" + string.Join(",", stamp.Layers.OrderBy(l => l, StringComparer.OrdinalIgnoreCase)) + "|" + FoilKey(stamp));

        public static bool Shows(CardLayer layer, CardStamp stamp) =>
            layer != null && (layer.Group != null
                ? layer.Layer != null && stamp != null && stamp.Rolled.Contains(layer.Layer)
                : layer.Chance >= 100 || (layer.Layer != null && stamp != null && stamp.Rolled.Contains(layer.Layer)));

        public static string FoilOf(CardLayer layer, CardStamp stamp) =>
            layer?.Layer != null && stamp != null && stamp.Foils.TryGetValue(layer.Layer, out var type) ? type : null;

        public static double ExtraValue(CardManifestEntry card, CardStamp stamp)
        {
            var layers = (card.Front ?? new List<CardLayer>()).Concat(card.Back ?? new List<CardLayer>()).ToList();
            var extra = layers.Where(l => Shows(l, stamp)).Sum(l => Math.Max(0, l.Price) + Math.Max(0, l.PricePercent) / 100 * card.Price);
            var shown = new HashSet<string>(layers.Where(l => l.Layer != null && Shows(l, stamp)).Select(l => l.Layer), StringComparer.OrdinalIgnoreCase)
                { FoilTypes.Picture };
            var foilable = (card.FoilLayers ?? new List<string>()).Where(shown.Contains).ToList();
            if (foilable.Count > 0 && stamp != null)
                extra += card.Price * foilable.Count(stamp.Foils.ContainsKey) / foilable.Count;
            return extra;
        }
    }

    internal static class CardNames
    {
        public static CardManifestEntry Of(Item item)
        {
            var stamp = CardCopies.Get(item);
            return stamp != null ? CardRegistry.Card(stamp.Card) : null;
        }

        private static CardLocale Local(CardManifestEntry card)
        {
            var culture = LocalizationManager.Instance?.Culture;
            return culture != null && card.Locales != null && card.Locales.TryGetValue(culture, out var local) ? local : null;
        }

        public static string Name(CardManifestEntry card) => Local(card)?.Name ?? card.Name ?? "";

        public static string ShortName(CardManifestEntry card) => Local(card)?.ShortName ?? Local(card)?.Name ?? card.ShortName ?? card.Name ?? "";

        public static string Description(CardManifestEntry card) => Local(card)?.Description ?? card.Description ?? $"{card.Rarity} collectible card.";

        public static string Tinted(CardManifestEntry card, string text)
        {
            var hex = card.RarityColor != null ? "#" + card.RarityColor.TrimStart('#') : null;
            return card.Rarity != "Common" && hex != null && ColorUtility.TryParseHtmlString(hex, out _) ? $"<color={hex}>{text}</color>" : text;
        }
    }

    internal class ItemReadPatch : ModulePatch
    {
        protected override MethodBase GetTargetMethod() =>
            AccessTools.Method(typeof(ItemDeserializer), nameof(ItemDeserializer.CreateItem), new[] { typeof(Item), typeof(UnparsedData) });

        [PatchPrefix]
        private static void Prefix(Item item, ref UnparsedData properties)
        {
            if (item == null || !(properties?.JToken is JObject upd) || !upd.TryGetValue(CardCopies.UpdKey, out var data))
                return;
            var stamp = CardCopies.Parse(data);
            if (stamp != null)
                CardCopies.Set(item.Id.ToString(), stamp);
            var rest = new JObject(upd.Properties().Where(p => p.Name != CardCopies.UpdKey));
            properties = new UnparsedData { JToken = rest };
        }
    }

    internal class ItemWritePatch : ModulePatch
    {
        protected override MethodBase GetTargetMethod() => AccessTools.Method(typeof(ItemDeserializer), nameof(ItemDeserializer.GetItemProperties));

        [PatchPostfix]
        private static void Postfix(Item item, Dictionary<string, object> __result)
        {
            var stamp = CardCopies.Get(item);
            if (stamp != null && __result != null)
                __result[CardCopies.UpdKey] = CardCopies.ToUpd(stamp);
        }
    }

    internal class CardIconHashPatch : ModulePatch
    {
        protected override MethodBase GetTargetMethod() => AccessTools.Method(typeof(IconsHash), nameof(IconsHash.HashForItem));

        [PatchPostfix]
        private static void Postfix(Item item, ref int __result)
        {
            var stamp = CardCopies.Get(item);
            if (stamp != null)
                __result ^= CardCopies.Hash(stamp);
        }
    }

    internal class CardPricePatch : ModulePatch
    {
        protected override MethodBase GetTargetMethod() => AccessTools.Method(typeof(PriceCalculator), nameof(PriceCalculator.CalculateBasePriceForSingleItem));

        [PatchPostfix]
        private static void Postfix(Item item, ref double __result)
        {
            if (__result <= 0)
                return;
            var stamp = CardCopies.Get(item);
            var card = stamp != null ? CardRegistry.Card(stamp.Card) : null;
            if (card != null)
                __result += CardCopies.ExtraValue(card, stamp) * Math.Max(1, item.StackObjectsCount);
        }
    }

    internal class CardNamePatch : ModulePatch
    {
        protected override MethodBase GetTargetMethod() => AccessTools.Method(typeof(ItemFactory), nameof(ItemFactory.BriefItemName));

        [PatchPostfix]
        private static void Postfix(Item item, string defaultName, ref string __result)
        {
            var card = CardNames.Of(item);
            if (card == null)
                return;
            var wantsShort = defaultName == item.ShortName.Localized();
            __result = CardNames.Tinted(card, wantsShort ? CardNames.ShortName(card) : CardNames.Name(card));
        }
    }
}
