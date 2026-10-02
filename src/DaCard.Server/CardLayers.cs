using System.Text.Json.Serialization;

namespace DaCard.Server;

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

public record LayerManifestEntry
{
    [JsonPropertyName("key")] public required string Key { get; set; }

    [JsonPropertyName("layer")] public string? Layer { get; set; }

    [JsonPropertyName("group")] public string? Group { get; set; }
    [JsonPropertyName("chance")] public double Chance { get; set; } = 100;
    [JsonPropertyName("canBeFoil")] public bool CanBeFoil { get; set; }

    [JsonPropertyName("price")] public double Price { get; set; }
    [JsonPropertyName("pricePercent")] public double PricePercent { get; set; }

    // A collection's layer (frame, background): glows like the card frame, not like the art
    [JsonPropertyName("frame")] public bool Frame { get; set; }

    [JsonPropertyName("textures")] public Dictionary<string, string> Textures { get; set; } = new();

    [JsonPropertyName("transform")] public LayerTransform? Transform { get; set; }

    [JsonPropertyName("roughness")] public double? Roughness { get; set; }
    [JsonPropertyName("metallic")] public double? Metallic { get; set; }

    // Animated maps
    [JsonPropertyName("animation")] public Dictionary<string, CardAnimationTrack>? Animation { get; set; }

    [JsonPropertyName("id")] public string? Id { get; set; }

    [JsonPropertyName("name")] public string? Name { get; set; }

    [JsonPropertyName("text")] public LayerText? Text { get; set; }
}
