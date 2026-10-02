using System.Text.Json;
using DaCard.Server.Storage;
using SPTarkov.DI.Annotations;
using SPTarkov.Server.Core.Models.Common;
using SPTarkov.Server.Core.Models.Eft.Common.Tables;

namespace DaCard.Server;

public record CardStamp(string Card, List<string> Layers, Dictionary<string, string> Foils);

[Injectable(InjectionType.Singleton)]
public class CardCopies(CardIndex index)
{
    public const string UpdKey = "DaCard";

    public static CardStamp? Read(Item item)
    {
        var data = item.Upd?.ExtensionData;
        if (data == null || !data.TryGetValue(UpdKey, out var value) || value == null)
            return null;
        try
        {
            var element = value switch
            {
                JsonElement e => e,
                _ => JsonSerializer.SerializeToElement(value)
            };
            if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty("c", out var card) || card.ValueKind != JsonValueKind.String)
                return null;
            var layers = new List<string>();
            if (element.TryGetProperty("l", out var list) && list.ValueKind == JsonValueKind.Array)
                foreach (var layer in list.EnumerateArray())
                    if (layer.ValueKind == JsonValueKind.String && layer.GetString() is { Length: > 0 } id)
                        layers.Add(id);
            var foils = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (element.TryGetProperty("f", out var map) && map.ValueKind == JsonValueKind.Object)
                foreach (var foil in map.EnumerateObject())
                    if (foil.Value.ValueKind == JsonValueKind.String && CardRarities.FoilTypes.Contains(foil.Value.GetString()))
                        foils[foil.Name] = foil.Value.GetString()!;
            return string.IsNullOrEmpty(card.GetString()) ? null : new CardStamp(card.GetString()!, layers, foils);
        }
        catch (Exception)
        {
            return null;
        }
    }

    public static void Write(Item item, CardStamp stamp)
    {
        item.Upd ??= new Upd();
        var data = new Dictionary<string, object> { ["c"] = stamp.Card, ["l"] = stamp.Layers.Distinct(StringComparer.OrdinalIgnoreCase).ToList() };
        if (stamp.Foils.Count > 0)
            data["f"] = new Dictionary<string, string>(stamp.Foils);
        item.Upd.ExtensionData![UpdKey] = data;
    }

    public static bool Shows(RollLayer layer, CardStamp stamp) =>
        !layer.IsGroup && (layer.Group != null
            ? stamp.Layers.Contains(layer.Id, StringComparer.OrdinalIgnoreCase)
            : layer.Chance >= 100 || (layer.Chance > 0 && stamp.Layers.Contains(layer.Id, StringComparer.OrdinalIgnoreCase)));

    public static string? PickVariant(RollLayer[] stack, string group)
    {
        var variants = stack.Where(v => v.Group == group && v.Chance > 0).ToList();
        var total = variants.Sum(v => v.Chance);
        if (total <= 0)
            return null;
        var roll = Random.Shared.NextDouble() * total;
        foreach (var variant in variants)
        {
            roll -= variant.Chance;
            if (roll < 0)
                return variant.Id;
        }
        return variants[^1].Id;
    }

    public CardStamp Roll(string cardId)
    {
        var stack = index.Layers.GetValueOrDefault(cardId) ?? [];
        var layers = new List<string>();
        foreach (var layer in stack)
        {
            if (layer.Group != null || layer.Chance <= 0)
                continue;
            var hit = layer.Chance >= 100 || Random.Shared.NextDouble() * 100 < layer.Chance;
            if (!hit)
                continue;
            if (!layer.IsGroup)
            {
                if (layer.Chance < 100)
                    layers.Add(layer.Id);
                continue;
            }
            if (PickVariant(stack, layer.Id) is { } variant)
                layers.Add(variant);
        }
        var stamp = new CardStamp(cardId, layers, new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase));
        return stamp with { Foils = RollFoils(stamp, f => Random.Shared.NextDouble() * 100 < f.FoilChance) };
    }

    public Dictionary<string, string> RollFoils(CardStamp stamp, Func<RollLayer, bool> foiled)
    {
        var foils = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var types = index.FoilTypes.GetValueOrDefault(index.Find(stamp.Card)?.CollectionId ?? "") ?? CardRarities.DefaultFoilTypes;
        foreach (var layer in index.Layers.GetValueOrDefault(stamp.Card) ?? [])
            if (layer.CanFoil && layer.FoilChance > 0 && Shows(layer, stamp) && foiled(layer))
                foils[layer.Id] = layer.FoilType ?? types[Random.Shared.Next(types.Length)];
        return foils;
    }

    public Item NewCopy(string cardId, bool foundInRaid)
    {
        var card = index.Cards[cardId];
        var item = new Item { Id = new MongoId(), Template = new MongoId(card.Template), Upd = new Upd { SpawnedInSession = foundInRaid } };
        Write(item, Roll(cardId));
        return item;
    }

    public void Stamp(Item item, string cardId) => Write(item, Roll(cardId));

    public string? RandomCardOf(string template)
    {
        var cards = index.CardsOfTemplate.GetValueOrDefault(template);
        return cards is { Length: > 0 } ? cards[Random.Shared.Next(cards.Length)] : null;
    }

    public bool IsCopy(Item item) => index.IsCardTemplate(item.Template.ToString());

    public bool StampIfMissing(Item item)
    {
        if (!IsCopy(item) || Read(item) != null)
            return false;
        var card = RandomCardOf(item.Template.ToString());
        if (card == null)
            return false;
        Stamp(item, card);
        return true;
    }
}
