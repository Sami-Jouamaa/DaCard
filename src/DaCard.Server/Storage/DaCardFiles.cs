using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http;
using SPTarkov.DI.Annotations;
using SPTarkov.Server.Core.Models.Common;
using SPTarkov.Server.Core.Servers.Http;
using SPTarkov.Server.Core.Utils;
using Path = System.IO.Path;

namespace DaCard.Server.Storage;

[Injectable(InjectionType.Singleton)]
public partial class DaCardFiles(CardStore store, DaCardDatabase database, HttpFileUtil httpFileUtil) : IHttpListener
{
    private readonly ConcurrentDictionary<string, string?> _paths = new(StringComparer.OrdinalIgnoreCase);
    private const int CacheLimit = 20000;

    [GeneratedRegex("^(?<set>.+)_(?<channel>[a-z0-9]+)_f(?<frame>[0-9]{1,5})$")]
    private static partial Regex FramePattern();

    [GeneratedRegex("^(?<set>.+)_(?<channel>[a-z0-9]+)$")]
    private static partial Regex ImagePattern();

    [GeneratedRegex("^v[0-9]+$")]
    private static partial Regex VersionPattern();

    public bool CanHandle(HttpContext context)
    {
        var path = context.Request.Path.Value ?? "";
        return path.StartsWith(CardManifests.ImageRoute, StringComparison.OrdinalIgnoreCase)
               || path.StartsWith(CardManifests.FontRoute, StringComparison.OrdinalIgnoreCase);
    }

    public async Task HandleAsync(MongoId sessionId, HttpContext context, CancellationToken cancellationToken = default)
    {
        var path = Uri.UnescapeDataString(context.Request.Path.Value ?? "");
        var file = database.IsOpen ? Resolve(path) : null;
        if (file == null || !File.Exists(file))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }
        await httpFileUtil.SendFileAsync(context.Response, file, cancellationToken);
    }

    private string? Resolve(string path)
    {
        if (_paths.TryGetValue(path, out var cached))
            return cached;
        var file = path.StartsWith(CardManifests.FontRoute, StringComparison.OrdinalIgnoreCase) ? Font(path) : Image(path);
        if (_paths.Count >= CacheLimit)
            _paths.Clear();
        _paths[path] = file;
        return file;
    }

    private string? Font(string path)
    {
        var parts = path[CardManifests.FontRoute.Length..].Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 3 && VersionPattern().IsMatch(parts[0]))
            parts = parts[1..];
        return parts.Length == 2 && Regex.IsMatch(parts[0], "^[A-Za-z0-9_-]+$") ? store.FontPath(parts[0], parts[1]) : null;
    }

    private string? Image(string path)
    {
        var name = Path.GetFileNameWithoutExtension(path[CardManifests.ImageRoute.Length..]).ToLowerInvariant();
        var frame = FramePattern().Match(name);
        var match = frame.Success ? frame : ImagePattern().Match(name);
        if (!match.Success)
            return null;
        var setId = match.Groups["set"].Value;
        var channel = match.Groups["channel"].Value;
        var row = store.Image(setId, channel);
        if (row == null)
            return null;
        var dir = store.ScopePath(row.Scope);
        if (!frame.Success)
            return Path.Combine(dir, CardStore.ImageFile(setId, channel));
        var index = int.Parse(frame.Groups["frame"].Value);
        return index < Math.Max(row.Frames, 1) ? Path.Combine(dir, CardStore.FrameFile(setId, channel, index)) : null;
    }
}
