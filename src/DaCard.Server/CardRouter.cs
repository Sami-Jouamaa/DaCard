using SPTarkov.DI.Annotations;
using SPTarkov.Server.Core.DI;
using SPTarkov.Server.Core.Models.Eft.Common;
using SPTarkov.Server.Core.Utils;

namespace DaCard.Server;

[Injectable]
public class CardRouter(JsonUtil jsonUtil, CardCatalog catalog) : StaticRouter(jsonUtil,
[
    new RouteAction<EmptyRequestData>("/dacard/manifest",
        (_, _, _, _, _) => new ValueTask<string>(jsonUtil.Serialize(catalog.Manifest) ?? "{}")),
    new RouteAction<EmptyRequestData>("/dacard/fonts",
        (_, _, _, _, _) => new ValueTask<string>(jsonUtil.Serialize(catalog.Fonts) ?? "{}"))
]);
