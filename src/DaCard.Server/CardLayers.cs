using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using SPTarkov.Common.Models.Logging;
using Path = System.IO.Path;

namespace DaCard.Server;

// card.json / collection.json "layers": pictures stacked on the card, bottom first. A collection's layers go over its
// cards' layers, except those marked "over".
public record LayerLists
{
    [JsonPropertyName("front")] public List<LayerFile>? Front { get; set; }
    [JsonPropertyName("back")] public List<LayerFile>? Back { get; set; }
}

public record LayerFile
{
    [JsonPropertyName("file")] public string? File { get; set; }

    [JsonPropertyName("name")] public string? Name { get; set; }

    // % of copies that show this layer (rolled per copy of the card)
    [JsonPropertyName("chance")] public double Chance { get; set; } = 100;

    [JsonPropertyName("canBeFoil")] public bool CanBeFoil { get; set; } = true;

    [JsonPropertyName("fps")] public Dictionary<string, double>? Fps { get; set; }

    // A card's layer over its collection's layers (an autograph...); else under them (its art, under the collection's frame)
    [JsonPropertyName("over")] public bool Over { get; set; }

    // Where the picture sits on the card (none: it fills the card)
    [JsonPropertyName("transform")] public LayerTransform? Transform { get; set; }

    [JsonPropertyName("price")] public double Price { get; set; }

    [JsonPropertyName("id")] public string? Id { get; set; }

    [JsonPropertyName("text")] public LayerText? Text { get; set; }
}

public record LayerText
{
    [JsonPropertyName("value")] public string Value { get; set; } = "";
    [JsonPropertyName("x")] public double X { get; set; } = 0.5;
    [JsonPropertyName("y")] public double Y { get; set; } = 0.05;
    [JsonPropertyName("width")] public double Width { get; set; } = 0.84;
    [JsonPropertyName("height")] public double Height { get; set; } = 0.1;
    [JsonPropertyName("size")] public double Size { get; set; } = 0.05;
    [JsonPropertyName("align")] public string Align { get; set; } = "center";
    [JsonPropertyName("valign")] public string VAlign { get; set; } = "top";
    [JsonPropertyName("color")] public string Color { get; set; } = "#FFFFFF";
    [JsonPropertyName("opacity")] public double Opacity { get; set; } = 1;
    [JsonPropertyName("uppercase")] public bool Uppercase { get; set; }
    [JsonPropertyName("autoSize")] public bool AutoSize { get; set; }
    [JsonPropertyName("rotation")] public double Rotation { get; set; }
    [JsonPropertyName("font")] public string? Font { get; set; }
}

public record LayerTransform
{
    [JsonPropertyName("x")] public double X { get; set; } = 0.5;
    [JsonPropertyName("y")] public double Y { get; set; } = 0.5;
    [JsonPropertyName("scale")] public double Scale { get; set; } = 1;
    [JsonPropertyName("rotation")] public double Rotation { get; set; }
}

public record LayerSource(string Key, double Chance, bool CanBeFoil, bool Frame, Dictionary<string, string> Maps,
    Dictionary<string, List<string>> Frames, Dictionary<string, double> Fps, double SharedFps)
{
    public bool Over { get; init; }
    public LayerTransform? Transform { get; init; }
    public double Price { get; init; }
    public string? Id { get; init; }
    public string? Name { get; init; }
    public LayerText? Text { get; init; }
    public string? FontPath { get; init; }
    public string SourceFile { get; init; } = "";

    public const string Art = "art", Normal = "normal", Roughness = "roughness", Metallic = "metallic", Mask = "mask";
    public static readonly string[] MapNames = [Art, Normal, Roughness, Metallic, Mask];
}

public record LayerManifestEntry
{
    // Rolled against the copy's item id: the same copy always shows the same layers
    [JsonPropertyName("key")] public required string Key { get; set; }
    [JsonPropertyName("chance")] public double Chance { get; set; } = 100;
    [JsonPropertyName("canBeFoil")] public bool CanBeFoil { get; set; }

    // A collection's layer (frame, background): glows like the card frame, not like the art
    [JsonPropertyName("frame")] public bool Frame { get; set; }

    [JsonPropertyName("textures")] public Dictionary<string, string> Textures { get; set; } = new();

    [JsonPropertyName("transform")] public LayerTransform? Transform { get; set; }

    [JsonPropertyName("sticker")] public string? Sticker { get; set; }

    // Animated maps
    [JsonPropertyName("animation")] public Dictionary<string, CardAnimationTrack>? Animation { get; set; }

    [JsonPropertyName("id")] public string? Id { get; set; }

    [JsonPropertyName("name")] public string? Name { get; set; }

    [JsonPropertyName("text")] public LayerText? Text { get; set; }
}

public static class CardLayers
{
    public const string Legacy = "card";
    private static readonly Regex FileName = new("^[A-Za-z0-9_.-]+$");

    public static List<LayerSource> Read<T>(string dir, List<LayerFile>? files, string keyPrefix, bool frame, string where, ISptLogger<T> logger)
    {
        var layers = new List<LayerSource>();
        foreach (var layer in files ?? [])
        {
            var file = layer.File ?? "";
            if (!FileName.IsMatch(file))
            {
                logger.Warning($"[DaCard] {where}: layer file name '{layer.File}' is not valid (letters, digits, _ . -); skipping it.");
                continue;
            }
            if (layer.Text != null)
            {
                string? fontPath = null;
                if (!string.IsNullOrWhiteSpace(layer.Text.Font))
                {
                    var font = Path.GetFileName(layer.Text.Font);
                    if (FileName.IsMatch(font) && File.Exists(Path.Combine(dir, font)))
                        fontPath = Path.Combine(dir, font);
                    else
                        logger.Warning($"[DaCard] {where}: text layer '{file}' font {layer.Text.Font} is missing; it uses the default font.");
                }
                layers.Add(new LayerSource(keyPrefix + file, Math.Clamp(layer.Chance, 0, 100), layer.CanBeFoil, false, new(), new(), new(), 12)
                {
                    Over = layer.Over,
                    Price = Math.Max(0, layer.Price),
                    SourceFile = file,
                    Id = layer.Id,
                    Name = layer.Name,
                    Text = layer.Text with { Font = null },
                    FontPath = fontPath
                });
                continue;
            }
            var source = FromFiles(dir, file, keyPrefix + file, layer.Chance, layer.CanBeFoil, frame, layer.Fps, 12);
            if (source == null)
                logger.Warning($"[DaCard] {where}: layer '{file}' has no {file}.png; skipping it.");
            else
                layers.Add(source with { SourceFile = file, Name = layer.Name, Over = layer.Over, Transform = layer.Transform, Price = Math.Max(0, layer.Price) });
        }
        return layers;
    }

    public static LayerSource? FromFiles(string dir, string file, string key, double chance, bool canBeFoil, bool frame,
        Dictionary<string, double>? fps, double sharedFps)
    {
        var maps = new Dictionary<string, string>();
        var frames = new Dictionary<string, List<string>>();
        foreach (var map in LayerSource.MapNames)
        {
            var path = Path.Combine(dir, map == LayerSource.Art ? $"{file}.png" : $"{file}.{map}.png");
            if (!File.Exists(path))
                continue;
            maps[map] = path;
            var framesDir = Path.Combine(dir, FramesFolder(file, map));
            if (!Directory.Exists(framesDir))
                continue;
            var list = Directory.GetFiles(framesDir, "frame_*.png").OrderBy(f => f, StringComparer.OrdinalIgnoreCase).ToList();
            if (list.Count > 1)
                frames[map] = list;
        }
        if (!maps.ContainsKey(LayerSource.Art))
            return null;
        var own = (fps ?? new()).Where(p => p.Value > 0).ToDictionary(p => p.Key, p => p.Value, StringComparer.OrdinalIgnoreCase);
        return new LayerSource(key, Math.Clamp(chance, 0, 100), canBeFoil, frame, maps, frames, own, sharedFps);
    }

    public static string FramesFolder(string file, string map)
    {
        var baseName = file == Legacy ? "frames" : "frames." + file;
        return map == LayerSource.Art ? baseName : baseName + "." + map;
    }

    // card.png (+ its foil / normal maps and frames): the card's picture, as its bottom layer when it has no depth
    public static LayerSource? FromLegacyCard(string dir, AnimationInfo? animation)
    {
        var fps = animation?.Slots?.ToDictionary(p => p.Key, p => p.Value);
        return FromFiles(dir, Legacy, "card:" + Legacy, 100, true, false, fps, animation?.Fps ?? 12);
    }
}
