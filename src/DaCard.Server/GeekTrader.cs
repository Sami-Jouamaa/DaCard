using SPTarkov.Common.Models.Logging;
using SPTarkov.DI.Annotations;
using SPTarkov.Server.Core.Models.Common;
using SPTarkov.Server.Core.Models.Eft.Common.Tables;
using SPTarkov.Server.Core.Models.Enums;
using SPTarkov.Server.Core.Models.Spt.Config;
using SPTarkov.Server.Core.Models.Spt.Tables;
using SPTarkov.Server.Core.Services.Image;
using SPTarkov.Server.Core.Utils;
using Path = System.IO.Path;

namespace DaCard.Server;

[Injectable(InjectionType.Singleton)]
public class GeekTrader(
    ISptLogger<GeekTrader> logger,
    JsonUtil jsonUtil,
    TradersTable traders,
    LocaleTable locales,
    ImageRouterService imageRouterService,
    TraderConfig traderConfig,
    RagfairConfig ragfairConfig)
{
    public const string Nickname = "Geek";
    public static readonly MongoId Id = new(CardCatalog.IdFor("trader:geek"));
    public const string AvatarFile = "traders/geek.png";

    private const string TemplateTrader = "54cb57776803fa99248b456e";
    private const string Location = "Card shop";
    private const string Description = "Collects trading cards of every kind. Sells the binders to keep them in, and buys any card you bring.";

    public bool Add(string modPath)
    {
        if (traders.ContainsKey(Id))
            return true;
        if (!traders.TryGetValue(new MongoId(TemplateTrader), out var template))
        {
            logger.Error("[DaCard] Can't add the Geek trader: the trader it is copied from (Therapist) is missing.");
            return false;
        }

        var traderBase = jsonUtil.Deserialize<TraderBase>(jsonUtil.Serialize(template.Base))!;
        traderBase.Id = Id;
        traderBase.Nickname = Nickname;
        traderBase.Name = Nickname;
        traderBase.Surname = "";
        traderBase.Location = Location;
        traderBase.Avatar = $"/files/trader/avatar/{Id}.png";
        traderBase.Currency = CurrencyType.RUB;
        traderBase.UnlockedByDefault = true;
        traderBase.AvailableInRaid = false;
        traderBase.CustomizationSeller = false;
        traderBase.Medic = false;
        traderBase.BuyerUp = false;
        traderBase.Discount = 0;
        traderBase.MainDialogue = null;
        traderBase.SellCategory = [];
        if (traderBase.Insurance != null) traderBase.Insurance.Availability = false;
        if (traderBase.Repair != null) traderBase.Repair.Availability = false;
        var level = traderBase.LoyaltyLevels?.FirstOrDefault() ?? new TraderLoyaltyLevel();
        level.MinLevel = 1;
        level.MinSalesSum = 0;
        level.MinStanding = 0;
        traderBase.LoyaltyLevels = [level];
        if (traderBase.ItemsSell != null)
            traderBase.ItemsSell = traderBase.ItemsSell.Where(s => s.Key == "1").ToDictionary(s => s.Key, s => s.Value);
        traderBase.ItemsBuy = new ItemBuyData { Category = [], IdList = [] };
        traderBase.ItemsBuyProhibited = new ItemBuyData { Category = [], IdList = [] };

        traders[Id] = new Trader
        {
            Base = traderBase,
            Assort = new TraderAssort { Items = [], BarterScheme = new(), LoyalLevelItems = new(), NextResupply = traderBase.NextResupply },
            Dialogue = new(),
            QuestAssort = new() { ["started"] = new(), ["success"] = new(), ["fail"] = new() },
            Suits = [],
            Services = []
        };

        traderConfig.UpdateTime.Add(new UpdateTime { Name = "geek", TraderId = Id, Seconds = new MinMax<int>(3600, 7200) });
        ragfairConfig.Traders[Id] = true;

        var avatar = Path.Combine(modPath, AvatarFile);
        if (File.Exists(avatar))
            imageRouterService.AddRoute($"/files/trader/avatar/{Id}", avatar);
        else
            logger.Warning($"[DaCard] {AvatarFile} is missing: Geek has no picture.");

        AddLocales();
        return true;
    }

    private void AddLocales()
    {
        var texts = new Dictionary<string, string>
        {
            [$"{Id} FullName"] = Nickname,
            [$"{Id} FirstName"] = Nickname,
            [$"{Id} Nickname"] = Nickname,
            [$"{Id} Location"] = Location,
            [$"{Id} Description"] = Description
        };
        foreach (var (lang, _) in locales.Languages)
        {
            if (!locales.Global.TryGetValue(lang, out var table))
                continue;
            table.AddTransformer(data =>
            {
                if (data == null)
                    return data;
                foreach (var (key, text) in texts)
                    data[key] = text;
                return data;
            });
        }
    }
}
