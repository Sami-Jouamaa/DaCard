using SPTarkov.DI.Annotations;
using SPTarkov.Server.Core.Models.Common;
using SPTarkov.Server.Core.Models.Eft.Common.Tables;
using SPTarkov.Server.Core.Models.Spt.Tables;

namespace DaCard.Server;

[Injectable(InjectionType.Singleton)]
public class DaCardHandbook(TemplateTable templates, LocaleTable locales)
{
    public static readonly string Root = CardCatalog.IdFor("handbook:dacard");
    public static readonly string Cards = CardCatalog.IdFor("handbook:dacard:cards");
    public static readonly string Foils = CardCatalog.IdFor("handbook:dacard:foils");
    public static readonly string Stickers = CardCatalog.IdFor("handbook:dacard:stickers");
    public static readonly string Binders = CardCatalog.IdFor("handbook:dacard:binders");
    public static readonly string Packs = CardCatalog.IdFor("handbook:dacard:packs");

    private static readonly (string Id, string? Parent, string Name, string Icon, string Order)[] Categories =
    [
        (Root, null, "DaCard", "/files/handbook/icon_barter_valuables.png", "14"),
        (Cards, Root, "Cards", "/files/handbook/icon_barter_valuables.png", "0"),
        (Foils, Root, "Foil cards", "/files/handbook/icon_barter_valuables.png", "1"),
        (Stickers, Root, "Stickers", "/files/handbook/icon_barter_valuables.png", "2"),
        (Binders, Root, "Binders", "/files/handbook/icon_gear_cases.png", "3"),
        (Packs, Root, "Booster packs", "/files/handbook/icon_barter_valuables.png", "4")
    ];

    private bool _registered;

    public static string CategoryOf(string kind) => kind switch
    {
        ItemLedger.Foil => Foils,
        ItemLedger.Sticker => Stickers,
        ItemLedger.Binder => Binders,
        ItemLedger.Pack => Packs,
        _ => Cards
    };

    public void Register()
    {
        if (_registered)
            return;
        _registered = true;
        var existing = templates.Handbook.Categories.Select(c => c.Id.ToString()).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var (id, parent, _, icon, order) in Categories)
        {
            if (existing.Contains(id))
                continue;
            templates.Handbook.Categories.Add(new HandbookCategory
            {
                Id = new MongoId(id),
                ParentId = parent != null ? new MongoId(parent) : (MongoId?)null,
                Icon = icon,
                Color = "",
                Order = order
            });
        }

        foreach (var (lang, _) in locales.Languages)
        {
            if (!locales.Global.TryGetValue(lang, out var table))
                continue;
            table.AddTransformer(data =>
            {
                if (data == null)
                    return data;
                foreach (var (id, _, name, _, _) in Categories)
                    data[id] = name;
                return data;
            });
        }
    }
}
