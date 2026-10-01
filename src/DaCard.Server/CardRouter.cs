using DaCard.Server.Storage;
using SPTarkov.DI.Annotations;
using SPTarkov.Server.Core.DI;
using SPTarkov.Server.Core.Models.Eft.Common;
using SPTarkov.Server.Core.Utils;

namespace DaCard.Server;

[Injectable]
public class CardRouter(JsonUtil jsonUtil, CardIndex index) : StaticRouter(jsonUtil,
[
    new RouteAction<EmptyRequestData>("/dacard/index",
        (_, _, _, _, _) => new ValueTask<string>(jsonUtil.Serialize(index.Client) ?? "{}"))
]);

[Injectable]
public class CardDetailsRouter(JsonUtil jsonUtil, CardManifests manifests) : DynamicRouter(jsonUtil,
[
    new RouteAction<EmptyRequestData>(CardDetailsRouter.Route,
        (url, _, _, _, _) =>
        {
            var tpl = url[(url.IndexOf(Route, StringComparison.Ordinal) + Route.Length)..].Split('?', '/')[0].Trim();
            var entry = manifests.Get(tpl);
            return new ValueTask<string>(entry == null ? "null" : jsonUtil.Serialize(entry) ?? "null");
        })
])
{
    public const string Route = "/dacard/card/";
}
