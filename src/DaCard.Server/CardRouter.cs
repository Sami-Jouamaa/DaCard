using System.Text.Json.Serialization;
using DaCard.Server.Storage;
using SPTarkov.DI.Annotations;
using SPTarkov.Server.Core.DI;
using SPTarkov.Server.Core.Models.Eft.Common;
using SPTarkov.Server.Core.Models.Utils;
using SPTarkov.Server.Core.Utils;

namespace DaCard.Server;

public record CardBatchRequest : IRequestData
{
    [JsonPropertyName("tpls")] public List<string> Tpls { get; set; } = new();
}

[Injectable]
public class CardRouter(JsonUtil jsonUtil, CardIndex index, CardManifests manifests) : StaticRouter(jsonUtil,
[
    new RouteAction<EmptyRequestData>("/dacard/index",
        (_, _, _, _, _) => new ValueTask<string>(jsonUtil.Serialize(index.Client) ?? "{}")),
    new RouteAction<CardBatchRequest>(CardRouter.BatchRoute,
        (_, request, _, _, _) =>
        {
            var cards = new Dictionary<string, CardManifestEntry>();
            foreach (var tpl in (request.Tpls ?? []).Distinct(StringComparer.OrdinalIgnoreCase).Take(BatchLimit))
                if (manifests.Get(tpl, remember: false) is { } entry)
                    cards[tpl] = entry;
            return new ValueTask<string>(jsonUtil.Serialize(cards) ?? "{}");
        })
])
{
    public const string BatchRoute = "/dacard/cards";
    public const int BatchLimit = 200;
}

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
