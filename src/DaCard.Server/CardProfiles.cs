using DaCard.Server.Storage;
using SPTarkov.Common.Models.Logging;
using SPTarkov.DI.Annotations;
using SPTarkov.Server.Core.DI;
using SPTarkov.Server.Core.Models.Common;
using SPTarkov.Server.Core.Models.Eft.Common;
using SPTarkov.Server.Core.Models.Eft.Common.Tables;
using SPTarkov.Server.Core.Models.Eft.Profile;
using SPTarkov.Server.Core.Servers;
using Path = System.IO.Path;

namespace DaCard.Server;

[Injectable(TypePriority = OnLoadOrder.SaveCallbacks + 1)]
public class CardProfiles(ISptLogger<CardProfiles> logger, SaveServer saveServer, ItemLedger ledger, CardIndex index, CardCopies copies, CardStore store) : IOnLoad
{
    private class Report
    {
        public int Converted, Foils, Refoiled, Moved, Stamped, Granted, Tidied;
        public bool Changed => Converted + Refoiled + Moved + Stamped + Granted + Tidied > 0;
    }

    public async Task OnLoadAsync(CancellationToken cancellationToken)
    {
        if (!ledger.Ready || index.Templates.Count == 0)
            return;
        _retiredFoils = store.RetiredFoilLayers();

        foreach (var (sessionId, profile) in saveServer.GetProfiles().ToList())
        {
            if (profile.ProfileInfo?.InvalidOrUnloadableProfile == true || profile.CharacterData?.PmcData == null)
                continue;
            var who = profile.ProfileInfo?.Username ?? sessionId.ToString();
            try
            {
                var report = new Report();
                foreach (var items in RetiredItemCleanup.ItemLists(profile).Concat(RetiredItemCleanup.PresetLists(profile)).ToList())
                    Convert(items, report);
                foreach (var character in Characters(profile))
                    Tidy(character, report);
                if (!report.Changed)
                    continue;
                var backup = Backup(sessionId);
                await saveServer.SaveProfileAsync(sessionId, cancellationToken);
                logger.Info($"[DaCard] Profile '{who}': {Summary(report)}. Backup of the profile before: {backup ?? "none (no profile file yet)"}");
            }
            catch (Exception e)
            {
                logger.Error($"[DaCard] Could not update the cards of profile '{who}', it is left as it was: {e}");
                await saveServer.LoadProfileAsync(sessionId, cancellationToken);
            }
        }
    }

    private HashSet<string> _retiredFoils = new(StringComparer.OrdinalIgnoreCase);

    private Dictionary<string, string> AllFoil(CardStamp stamp) =>
        copies.RollFoils(stamp, _ => true).ToDictionary(p => p.Key, _ => CardRarities.DefaultFoilTypes[0], StringComparer.OrdinalIgnoreCase);

    private void Convert(List<Item> items, Report report)
    {
        var children = items.Where(i => i.ParentId != null).ToLookup(i => i.ParentId!);
        var dropped = new HashSet<MongoId>();
        foreach (var item in items)
        {
            var tpl = item.Template.ToString();
            if (ledger.IsLegacy(item.Template) && index.LegacyTemplates.TryGetValue(tpl, out var cardId) && index.Cards.TryGetValue(cardId, out var card))
            {
                var stickers = children[item.Id.ToString()].Where(c => ledger.IsSticker(c.Template)).ToList();
                var layers = stickers.Select(s => ledger.LegacyLayer(s.Template)).OfType<string>().ToList();
                var converted = new CardStamp(cardId, layers, new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase));
                if (ledger.Get(item.Template)?.Kind == ItemLedger.Foil)
                {
                    converted = converted with { Foils = AllFoil(converted) };
                    report.Foils++;
                }
                item.Template = new MongoId(card.Template);
                CardCopies.Write(item, converted);
                dropped.UnionWith(stickers.Select(s => s.Id));
                report.Converted++;
                continue;
            }
            if (ledger.IsCardItem(item.Template) && CardCopies.Read(item) is { } stamp && index.Cards.TryGetValue(stamp.Card, out var current)
                && !current.Template.Equals(tpl, StringComparison.OrdinalIgnoreCase))
            {
                item.Template = new MongoId(current.Template);
                report.Moved++;
                continue;
            }
            if (!copies.IsCopy(item))
                continue;
            if (copies.StampIfMissing(item))
            {
                report.Stamped++;
                continue;
            }
            if (_retiredFoils.Count > 0 && CardCopies.Read(item) is { } old && old.Layers.Any(_retiredFoils.Contains))
            {
                var kept = old with { Layers = old.Layers.Where(l => !_retiredFoils.Contains(l)).ToList() };
                CardCopies.Write(item, kept with { Foils = AllFoil(kept) });
                report.Refoiled++;
            }
            report.Granted += Grant(item);
        }
        if (dropped.Count > 0)
            items.RemoveAll(i => dropped.Contains(i.Id));
    }

    private int Grant(Item item)
    {
        if (CardCopies.Read(item) is not { } stamp)
            return 0;
        var stack = index.Layers.GetValueOrDefault(stamp.Card) ?? [];
        var granted = stack
            .Where(l => l.Group == null && !l.IsGroup && l.Chance < 100 && ledger.PreviousChance(stamp.Card, l.Id) >= 100
                        && !stamp.Layers.Contains(l.Id, StringComparer.OrdinalIgnoreCase))
            .Select(l => l.Id).ToList();
        foreach (var group in stack.Where(l => l.IsGroup && l.Chance >= 100))
            if (!stack.Any(v => v.Group == group.Id && stamp.Layers.Contains(v.Id, StringComparer.OrdinalIgnoreCase))
                && CardCopies.PickVariant(stack, group.Id) is { } variant)
                granted.Add(variant);
        if (granted.Count == 0)
            return 0;
        CardCopies.Write(item, stamp with { Layers = stamp.Layers.Concat(granted).ToList() });
        return granted.Count;
    }

    private void Tidy(PmcData character, Report report)
    {
        foreach (var tpl in character.Encyclopedia?.Keys.Where(ledger.IsLegacy).ToList() ?? [])
            report.Tidied += character.Encyclopedia!.Remove(tpl) ? 1 : 0;
        foreach (var tpl in character.WishList?.Keys.Where(ledger.IsLegacy).ToList() ?? [])
            report.Tidied += character.WishList!.Remove(tpl) ? 1 : 0;
    }

    private static IEnumerable<PmcData> Characters(SptProfile profile)
    {
        if (profile.CharacterData?.PmcData is { } pmc)
            yield return pmc;
        if (profile.CharacterData?.ScavData is { } scav)
            yield return scav;
    }

    private static string Summary(Report report)
    {
        var parts = new List<string>();
        if (report.Converted > 0)
            parts.Add($"{report.Converted} card(s) moved to this version's card items ({report.Foils} of them foil)");
        if (report.Refoiled > 0)
            parts.Add($"{report.Refoiled} foil card(s) now foil on every layer that can be foil");
        if (report.Moved > 0)
            parts.Add($"{report.Moved} card(s) moved to their new rarity or card type");
        if (report.Stamped > 0)
            parts.Add($"{report.Stamped} card(s) without a picture got one of their collection and rarity");
        if (report.Granted > 0)
            parts.Add($"{report.Granted} layer(s) kept on copies whose layer is no longer on every card");
        if (report.Tidied > 0)
            parts.Add("old card entries cleared from the wishlist and encyclopedia");
        return string.Join("; ", parts);
    }

    private static string? Backup(MongoId sessionId)
    {
        var source = Path.Combine("user", "profiles", $"{sessionId}.json");
        if (!File.Exists(source))
            return null;
        var folder = Path.Combine(ItemLedger.Folder, "backups");
        Directory.CreateDirectory(folder);
        var target = Path.Combine(folder, $"{sessionId}-cards-{DateTime.Now:yyyyMMdd-HHmmss}.json");
        File.Copy(source, target, true);
        return Path.GetFullPath(target);
    }
}
