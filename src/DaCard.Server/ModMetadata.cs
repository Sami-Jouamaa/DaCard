using SPTarkov.Server.Core.Models.Spt.Mod;

namespace DaCard.Server;

public record ModMetadata : IModMetadata
{
    public string ModGuid { get; init; } = "com.guro.dacard";
    public string Name { get; init; } = "DaCard";
    public string Author { get; init; } = "Guro";
    public List<string>? Contributors { get; init; }
    public const string CurrentVersion = "2.0.1";
    public SemanticVersioning.Version Version { get; init; } = new(CurrentVersion);
    public SemanticVersioning.Range SptVersion { get; init; } = new("~4.1.5");
    public List<string>? Incompatibilities { get; init; }
    public Dictionary<string, SemanticVersioning.Range>? ModDependencies { get; init; }
    public string? Url { get; init; }
    public string License { get; init; } = "CC-BY-NC-SA-4.0";
    public bool HasPrepatcher { get; init; } = false;
}
