using SPTarkov.Common.Models.Logging;
using SPTarkov.DI.Annotations;
using SPTarkov.Server.Core.DI;
using SPTarkov.Server.Core.Models.Common;
using SPTarkov.Server.Core.Models.Eft.Common.Tables;
using SPTarkov.Server.Core.Models.Eft.Profile;
using SPTarkov.Server.Core.Servers;
using Path = System.IO.Path;

namespace DaCard.Server;

[Injectable(TypePriority = OnLoadOrder.SaveCallbacks + 2)]
public class StickerGrants(ISptLogger<StickerGrants> logger, SaveServer saveServer, CardStickers stickers) : IOnLoad
{
    public async Task OnLoadAsync(CancellationToken cancellationToken)
    {
        if (!stickers.HasGrants)
            return;

        foreach (var (sessionId, profile) in saveServer.GetProfiles().ToList())
        {
            if (profile.ProfileInfo?.InvalidOrUnloadableProfile == true)
                continue;
            var who = profile.ProfileInfo?.Username ?? sessionId.ToString();
            try
            {
                var added = Grant(profile);
                if (added == 0)
                    continue;
                var backup = Backup(sessionId);
                await saveServer.SaveProfileAsync(sessionId, cancellationToken);
                logger.Info($"[DaCard] Profile '{who}': {added} sticker(s) given to card copies whose layer is no longer on every card, " +
                            $"so they keep it. Backup of the profile before: {backup ?? "none"}");
            }
            catch (Exception e)
            {
                logger.Error($"[DaCard] Could not give the stickers to the cards of profile '{who}', it is left as it was: {e}");
                await saveServer.LoadProfileAsync(sessionId, cancellationToken);
            }
        }
    }

    private int Grant(SptProfile profile)
    {
        var added = 0;
        foreach (var items in RetiredItemCleanup.ItemLists(profile).ToList())
        {
            foreach (var card in items.ToList())
            {
                var granted = stickers.SlotsOf(card.Template.ToString()).Where(s => s.Grant).ToList();
                if (granted.Count == 0)
                    continue;
                var id = card.Id.ToString();
                foreach (var slot in granted)
                {
                    if (items.Any(i => i.ParentId == id && i.SlotId == slot.Name))
                        continue;
                    items.Add(new Item
                    {
                        Id = new MongoId(),
                        Template = new MongoId(slot.Sticker),
                        ParentId = id,
                        SlotId = slot.Name,
                        Upd = card.Upd?.SpawnedInSession == true ? new Upd { SpawnedInSession = true } : null
                    });
                    added++;
                }
            }
        }
        return added;
    }

    private static string? Backup(MongoId sessionId)
    {
        var source = Path.Combine("user", "profiles", $"{sessionId}.json");
        if (!File.Exists(source))
            return null;
        var folder = Path.Combine(ItemLedger.Folder, "backups");
        Directory.CreateDirectory(folder);
        var target = Path.Combine(folder, $"{sessionId}-stickers-{DateTime.Now:yyyyMMdd-HHmmss}.json");
        File.Copy(source, target, true);
        return Path.GetFullPath(target);
    }
}
