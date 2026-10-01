using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Path = System.IO.Path;

namespace DaCard.Server;

public record AddonFile
{
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("thumbnail")] public string? Thumbnail { get; set; }
    [JsonPropertyName("requires")] public List<AddonRequirement>? Requires { get; set; }
}

public record AddonRequirement
{
    [JsonPropertyName("type")] public string? Type { get; set; }
    [JsonPropertyName("folder")] public string? Folder { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("addon")] public string? Addon { get; set; }
    [JsonPropertyName("addonName")] public string? AddonName { get; set; }
}

public record AddonEntry(string Folder, string Name, string Dir)
{
    public List<AddonRequirement> Requires { get; init; } = [];

    public string Describe(string type, string folder)
    {
        var known = Requires.FirstOrDefault(r => r.Type == type && folder.Equals(r.Folder, StringComparison.OrdinalIgnoreCase));
        var name = string.IsNullOrWhiteSpace(known?.Name) ? folder : $"'{known.Name}' ({folder})";
        var from = known?.AddonName ?? known?.Addon;
        return string.IsNullOrWhiteSpace(from) ? name : $"{name} from the addon '{from}'";
    }

    public string Where(params string[] parts) => string.Join("/", new[] { "data", Folder }.Concat(parts));
}

public static class Addons
{
    public const string DataFile = "addon.json";
    public const string Cards = "cards", Packs = "packs", Skins = "skins";
    public static readonly string[] Contents = [Cards, Packs, Skins];

    public const string TemplateFolder = "dacardtemplate";
    public const string TemplateName = "DaCard Template";

    public static string FolderFor(string name)
    {
        var folder = Regex.Replace(name.ToLowerInvariant(), "[^a-z0-9]", "");
        return folder.Length > 0 ? folder : "addon";
    }

    public static IEnumerable<string> Dirs(string dataDir) =>
        Directory.Exists(dataDir)
            ? Directory.GetDirectories(dataDir)
                .Where(d => !Contents.Contains(Path.GetFileName(d), StringComparer.OrdinalIgnoreCase))
                .Where(d => File.Exists(Path.Combine(d, DataFile)) || Contents.Any(c => Directory.Exists(Path.Combine(d, c))))
                .OrderBy(d => d, StringComparer.OrdinalIgnoreCase)
            : [];

    public static List<AddonEntry> Scan(string dataDir, Func<string, AddonFile?> read)
    {
        var found = new List<AddonEntry>();
        foreach (var dir in Dirs(dataDir))
        {
            var folder = Path.GetFileName(dir);
            AddonFile? data = null;
            var json = Path.Combine(dir, DataFile);
            if (File.Exists(json))
            {
                try
                {
                    data = read(File.ReadAllText(json));
                }
                catch (Exception)
                {
                    data = null;
                }
            }
            found.Add(new AddonEntry(folder, string.IsNullOrWhiteSpace(data?.Name) ? folder : data.Name.Trim(), dir)
            {
                Requires = data?.Requires?.Where(r => r != null).ToList() ?? []
            });
        }
        return found;
    }
}
