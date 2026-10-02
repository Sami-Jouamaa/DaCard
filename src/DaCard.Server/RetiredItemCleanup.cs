using DaCard.Server.Storage;
using SPTarkov.Common.Models.Logging;
using SPTarkov.DI.Annotations;
using SPTarkov.Server.Core.DI;
using SPTarkov.Server.Core.Models.Common;
using SPTarkov.Server.Core.Models.Eft.Common;
using SPTarkov.Server.Core.Models.Eft.Common.Tables;
using SPTarkov.Server.Core.Models.Eft.Profile;
using SPTarkov.Server.Core.Models.Enums;
using SPTarkov.Server.Core.Models.Spt.Tables;
using SPTarkov.Server.Core.Servers;
using SPTarkov.Server.Core.Services.Commerce;
using Path = System.IO.Path;

namespace DaCard.Server;

[Injectable(TypePriority = OnLoadOrder.SaveCallbacks + 2)]
public class RetiredItemCleanup(
    ISptLogger<RetiredItemCleanup> logger,
    ItemLedger ledger,
    SaveServer saveServer,
    TemplateTable templates,
    TradersTable traders,
    MailSendService mailSendService,
    CardIndex index) : IOnLoad
{
    private const string Roubles = "5449016a4bdc2d6f028b456f";
    private const int RoublesStack = 500000;
    private const long MailStorageSeconds = 10L * 365 * 24 * 3600;

    private enum Fate
    {
        Keep,
        Remove,
        MoveRoot,
        MoveChild
    }

    private class Report
    {
        public readonly Dictionary<string, int> Removed = new();
        public readonly List<List<Item>> Moved = new();
        public double Refund;
        public int Presets;
        public bool Tidied;
        public bool Changed => Removed.Count > 0 || Moved.Count > 0 || Presets > 0 || Tidied;
    }

    private Dictionary<MongoId, HashSet<string>> _slots = new();
    private Dictionary<MongoId, Dictionary<string, string>> _pockets = new();

    public async Task OnLoadAsync(CancellationToken cancellationToken)
    {
        if (!ledger.Ready)
            return;

        _slots = ledger.Binders.Concat(ledger.Cards)
            .Where(templates.Items.ContainsKey)
            .ToDictionary(t => t, t => (templates.Items[t].Properties?.Slots ?? []).Select(s => s.Name ?? "").ToHashSet());
        _pockets = ledger.Binders.ToDictionary(t => t, t => (ledger.Get(t)?.Slots ?? []).Where(s => s.Card != null)
            .GroupBy(s => s.Name).ToDictionary(g => g.Key, g => g.First().Card!));

        foreach (var (sessionId, profile) in saveServer.GetProfiles().ToList())
        {
            if (profile.ProfileInfo?.InvalidOrUnloadableProfile == true || profile.CharacterData?.PmcData == null)
                continue;
            if (!ItemLists(profile).Any(NeedsCleaning) && !NeedsStripping(profile))
                continue;

            var who = profile.ProfileInfo?.Username ?? sessionId.ToString();
            try
            {
                var backup = Backup(sessionId);
                var report = Clean(profile);
                if (!report.Changed)
                    continue;
                Mail(sessionId, report);
                await saveServer.SaveProfileAsync(sessionId, cancellationToken);
                logger.Warning($"[DaCard] Profile '{who}': {Summary(report)}. Backup of the profile before: {backup ?? "none (no profile file yet)"}");
            }
            catch (Exception e)
            {
                logger.Error($"[DaCard] Could not clean up profile '{who}', it is left as it was: {e}");
                await saveServer.LoadProfileAsync(sessionId, cancellationToken);
            }
        }
        ledger.DropUnheld();
    }

    internal static IEnumerable<List<Item>> ItemLists(SptProfile profile)
    {
        var pmc = profile.CharacterData?.PmcData;
        var scav = profile.CharacterData?.ScavData;
        if (pmc?.Inventory?.Items != null)
            yield return pmc.Inventory.Items;
        if (scav?.Inventory?.Items != null)
            yield return scav.Inventory.Items;
        foreach (var dialogue in (IEnumerable<Dialogue>?)profile.DialogueRecords?.Values ?? [])
        foreach (var message in dialogue.Messages ?? [])
            if (message.Items?.Data != null)
                yield return message.Items.Data;
        foreach (var insurance in profile.InsuranceList ?? [])
            if (insurance.Items != null)
                yield return insurance.Items;
        foreach (var delivery in profile.BtrDeliveryList ?? [])
            if (delivery.Items != null)
                yield return delivery.Items;
        foreach (var offer in pmc?.RagfairInfo?.Offers ?? [])
            if (offer.Items != null)
                yield return offer.Items;
        foreach (var production in (IEnumerable<Production?>?)pmc?.Hideout?.Production?.Values ?? [])
            if (production?.Products != null)
                yield return production.Products;
    }

    internal static IEnumerable<List<Item>> PresetLists(SptProfile profile)
    {
        foreach (var build in profile.UserBuildData?.EquipmentBuilds ?? [])
            yield return build.Items;
        foreach (var build in profile.UserBuildData?.WeaponBuilds ?? [])
            if (build.Items != null)
                yield return build.Items;
        foreach (var reward in RepeatableRewards(profile).SelectMany(r => r))
            if (reward.Items != null)
                yield return reward.Items;
    }

    private static IEnumerable<List<Reward>> RepeatableRewards(SptProfile profile)
    {
        foreach (var repeatable in profile.CharacterData?.PmcData?.RepeatableQuests ?? [])
        foreach (var quest in repeatable.ActiveQuests ?? [])
        foreach (var rewards in (IEnumerable<List<Reward>>?)quest.Rewards?.Values ?? [])
            yield return rewards;
    }

    private static IEnumerable<PmcData> Characters(SptProfile profile)
    {
        if (profile.CharacterData?.PmcData is { } pmc)
            yield return pmc;
        if (profile.CharacterData?.ScavData is { } scav)
            yield return scav;
    }

    private bool Removable(Item item) =>
        ledger.IsRemovable(item.Template) || (ledger.IsCardItem(item.Template) && CardCopies.Read(item) is { } stamp && !index.Stored.Contains(stamp.Card));

    private bool NeedsStripping(SptProfile profile) =>
        PresetLists(profile).Any(items => items.Any(Removable))
        || Characters(profile).Any(c => (c.Encyclopedia?.Keys.Any(ledger.IsRemovable) ?? false) || (c.WishList?.Keys.Any(ledger.IsRemovable) ?? false));

    private HashSet<MongoId> Strip(List<Item> items)
    {
        var gone = items.Where(Removable).Select(i => i.Id).ToHashSet();
        if (gone.Count == 0)
            return gone;
        var children = items.Where(i => i.ParentId != null).ToLookup(i => i.ParentId!);
        var queue = new Queue<MongoId>(gone);
        while (queue.Count > 0)
            foreach (var child in children[queue.Dequeue().ToString()])
                if (gone.Add(child.Id))
                    queue.Enqueue(child.Id);
        items.RemoveAll(i => gone.Contains(i.Id));
        return gone;
    }

    private bool Stripped(List<Item> items, MongoId root, Report report)
    {
        var gone = Strip(items);
        if (gone.Count > 0)
            report.Presets++;
        return gone.Contains(root);
    }

    private bool NeedsCleaning(List<Item> items)
    {
        if (items.Any(Removable))
            return true;
        var byId = items.GroupBy(i => i.Id.ToString()).ToDictionary(g => g.Key, g => g.First());
        return items.Any(i => i.ParentId != null && byId.TryGetValue(i.ParentId, out var parent)
            ? OutOfSlot(i, parent)
            : ledger.IsSticker(i.Template));
    }

    private bool OutOfSlot(Item item, Item parent) =>
        _slots.TryGetValue(parent.Template, out var slots)
            ? item.SlotId == null || !slots.Contains(item.SlotId) || WrongPocket(item, parent)
            : ledger.IsSticker(item.Template);

    private bool WrongPocket(Item item, Item parent) =>
        _pockets.TryGetValue(parent.Template, out var pockets) && item.SlotId != null && pockets.TryGetValue(item.SlotId, out var card)
        && CardCopies.Read(item) is { } stamp && !stamp.Card.Equals(card, StringComparison.OrdinalIgnoreCase);

    private Report Clean(SptProfile profile)
    {
        var report = new Report();
        var pmc = profile.CharacterData!.PmcData!;
        var scav = profile.CharacterData.ScavData;

        CleanInventory(pmc, report);
        if (scav != null)
            CleanInventory(scav, report);

        foreach (var dialogue in (IEnumerable<Dialogue>?)profile.DialogueRecords?.Values ?? [])
        foreach (var message in dialogue.Messages ?? [])
        {
            if (message.Items?.Data is not { Count: > 0 } data)
                continue;
            Clean(data, report);
            if (data.Count == 0)
            {
                message.HasRewards = false;
                message.RewardCollected = true;
            }
        }

        var emptied = profile.InsuranceList?.Where(i => i.Items != null && Clean(i.Items, report).Count > 0 && i.Items.Count == 0).ToList() ?? [];
        profile.InsuranceList?.RemoveAll(emptied.Contains);

        var delivered = profile.BtrDeliveryList?.Where(d => d.Items != null && Clean(d.Items, report).Count > 0 && d.Items.Count == 0).ToList() ?? [];
        profile.BtrDeliveryList?.RemoveAll(delivered.Contains);

        if (pmc.RagfairInfo?.Offers is { } offers)
        {
            var gone = offers.Where(o => o.Items != null && Clean(o.Items, report).Count > 0 && o.Items.All(i => i.Id != o.Root)).ToList();
            offers.RemoveAll(gone.Contains);
        }

        foreach (var production in (IEnumerable<Production?>?)pmc.Hideout?.Production?.Values ?? [])
            if (production?.Products != null)
                Clean(production.Products, report);

        if (profile.UserBuildData is { } builds)
        {
            builds.EquipmentBuilds?.RemoveAll(b => Stripped(b.Items, b.Root, report));
            builds.WeaponBuilds?.RemoveAll(b => b.Items != null && Stripped(b.Items, b.Root, report));
        }
        foreach (var rewards in RepeatableRewards(profile).ToList())
            report.Presets += rewards.RemoveAll(r => r.Items != null && Strip(r.Items).Count > 0);

        foreach (var character in Characters(profile))
        {
            foreach (var tpl in character.Encyclopedia?.Keys.Where(ledger.IsRemovable).ToList() ?? [])
                report.Tidied |= character.Encyclopedia!.Remove(tpl);
            foreach (var tpl in character.WishList?.Keys.Where(ledger.IsRemovable).ToList() ?? [])
                report.Tidied |= character.WishList!.Remove(tpl);
        }

        return report;
    }

    private void CleanInventory(PmcData character, Report report)
    {
        var inventory = character.Inventory;
        if (inventory?.Items == null)
            return;
        var taken = Clean(inventory.Items, report);
        if (taken.Count == 0)
            return;

        character.InsuredItems?.RemoveAll(i => i.ItemId is { } id && taken.Contains(id));
        if (inventory.FastPanel != null)
            foreach (var slot in inventory.FastPanel.Where(p => taken.Contains(p.Value)).Select(p => p.Key).ToList())
                inventory.FastPanel.Remove(slot);
        if (inventory.FavoriteItems != null)
            inventory.FavoriteItems = inventory.FavoriteItems.Where(id => !taken.Contains(id)).ToList();
    }

    private HashSet<MongoId> Clean(List<Item> items, Report report)
    {
        var ids = items.Select(i => i.Id.ToString()).ToHashSet();
        var children = items.Where(i => i.ParentId != null).ToLookup(i => i.ParentId!);
        var fate = new Dictionary<MongoId, Fate>();

        void Visit(Item item, Item? parent, Fate parentFate)
        {
            if (!fate.TryAdd(item.Id, Fate.Keep))
                return;
            fate[item.Id] = Removable(item) ? Fate.Remove
                : ledger.IsSticker(item.Template) && (parent == null || parentFate == Fate.Remove || OutOfSlot(item, parent)) ? Fate.Remove
                : parentFate == Fate.Remove ? Fate.MoveRoot
                : parentFate is Fate.MoveRoot or Fate.MoveChild ? Fate.MoveChild
                : parent != null && OutOfSlot(item, parent) ? Fate.MoveRoot
                : Fate.Keep;
            foreach (var child in children[item.Id.ToString()])
                Visit(child, item, fate[item.Id]);
        }

        foreach (var root in items.Where(i => i.ParentId == null || !ids.Contains(i.ParentId)).ToList())
            Visit(root, null, Fate.Keep);

        var taken = fate.Where(f => f.Value != Fate.Keep).Select(f => f.Key).ToHashSet();
        if (taken.Count == 0)
            return taken;

        foreach (var item in items.Where(i => fate.GetValueOrDefault(i.Id) == Fate.Remove))
        {
            if (ledger.Get(item.Template) is not { } entry)
                continue;
            var count = Math.Max(1, (int)(item.Upd?.StackObjectsCount ?? 1));
            report.Removed[$"{entry.Name} ({entry.Kind})"] = report.Removed.GetValueOrDefault($"{entry.Name} ({entry.Kind})") + count;
            report.Refund += entry.Price * count;
        }

        foreach (var root in items.Where(i => fate.GetValueOrDefault(i.Id) == Fate.MoveRoot))
        {
            var group = new List<Item> { root };
            for (var i = 0; i < group.Count; i++)
                group.AddRange(children[group[i].Id.ToString()].Where(c => fate.GetValueOrDefault(c.Id) == Fate.MoveChild));
            report.Moved.Add(group);
        }

        items.RemoveAll(i => taken.Contains(i.Id));
        return taken;
    }

    private void Mail(MongoId sessionId, Report report)
    {
        var stash = new MongoId();
        var items = new List<Item>();
        foreach (var group in report.Moved)
        {
            group[0].ParentId = stash;
            group[0].SlotId = "main";
            group[0].Location = null;
            items.Add(group[0]);
        }
        items.AddRange(report.Moved.SelectMany(g => g.Skip(1)));

        var refund = ledger.Mode == RetiredMode.Refund ? (long)Math.Round(report.Refund) : 0;
        for (var left = refund; left > 0; left -= RoublesStack)
            items.Insert(report.Moved.Count, new Item
            {
                Id = new MongoId(),
                Template = new MongoId(Roubles),
                ParentId = stash,
                SlotId = "main",
                Upd = new Upd { StackObjectsCount = Math.Min(left, RoublesStack) }
            });
        if (items.Count == 0 && report.Removed.Count == 0)
            return;

        var lines = new List<string>();
        if (report.Removed.Count > 0)
            lines.Add(refund > 0
                ? $"Some cards, stickers, binders or booster packs you had were removed from the game. I've taken them back and paid you {refund:N0} roubles for them."
                : "Some cards, stickers, binders or booster packs you had were removed from the game, so they're gone from your stash.");
        if (report.Moved.Count > 0)
            lines.Add("Some of your things were in a binder, or a binder pocket, that no longer exists. Here they are.");
        var text = string.Join(" ", lines);

        var attached = items.Count > 0 ? items : null;
        if (traders.ContainsKey(GeekTrader.Id))
            mailSendService.SendDirectNpcMessageToPlayer(sessionId, GeekTrader.Id.ToString(),
                attached != null ? MessageType.MessageWithItems : MessageType.NpcTraderMessage, text, attached, MailStorageSeconds);
        else
            mailSendService.SendSystemMessageToPlayer(sessionId, text, attached, MailStorageSeconds);
    }

    private string Summary(Report report)
    {
        var parts = new List<string>();
        if (report.Removed.Count > 0)
        {
            var removed = string.Join(", ", report.Removed.Select(r => r.Value > 1 ? $"{r.Key} x{r.Value}" : r.Key));
            parts.Add(ledger.Mode == RetiredMode.Refund
                ? $"removed {removed}, refunded {Math.Round(report.Refund):N0} roubles by mail"
                : $"removed {removed}");
        }
        if (report.Moved.Count > 0)
            parts.Add($"{report.Moved.Count} item(s) that were in a deleted binder or binder pocket sent back by mail");
        if (report.Presets > 0)
            parts.Add($"cleared from {report.Presets} preset(s) or quest reward(s)");
        if (report.Tidied)
            parts.Add("cleared from the wishlist and encyclopedia");
        return string.Join("; ", parts);
    }

    private static string? Backup(MongoId sessionId)
    {
        var source = Path.Combine("user", "profiles", $"{sessionId}.json");
        if (!File.Exists(source))
            return null;
        var folder = Path.Combine(ItemLedger.Folder, "backups");
        Directory.CreateDirectory(folder);
        var target = Path.Combine(folder, $"{sessionId}-{DateTime.Now:yyyyMMdd-HHmmss}.json");
        File.Copy(source, target, true);
        return Path.GetFullPath(target);
    }
}
