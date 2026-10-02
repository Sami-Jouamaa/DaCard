using System.Globalization;
using DaCard.Server.Storage;

namespace DaCard.Server;

public record ResolvedRarity(string Name, int Rank, double Weight, RaritySettings Settings, bool Custom);

public static class CardRarities
{
    public static readonly string[] FoilTypes = ["foil", "linear", "radial", "sparkle", "galaxy", "diamond", "squares", "circles", "surge", "ripple", "speckle", "crackle"];
    public static readonly string[] DefaultFoilTypes = ["foil"];

    private static readonly (string Name, int R, int G, int B)[] Backgrounds =
    [
        ("grey", 140, 140, 140), ("green", 70, 160, 70), ("blue", 60, 110, 200), ("violet", 150, 70, 200),
        ("yellow", 220, 180, 40), ("orange", 220, 120, 40), ("red", 200, 50, 50), ("black", 30, 30, 30)
    ];

    public static List<ResolvedRarity> Of(CollectionRow? collection, DaCardConfig config)
    {
        var custom = collection?.Rarities?.Where(r => !string.IsNullOrWhiteSpace(r.Name)).ToList();
        if (custom is { Count: > 0 })
            return custom.Select((r, i) => new ResolvedRarity(r.Name.Trim(), i, Math.Max(0, r.Weight), Custom(r), true)).ToList();
        return CardCatalog.RarityOrder.Select((name, i) =>
        {
            var settings = config.Rarities.GetValueOrDefault(name) ?? new RaritySettings();
            return new ResolvedRarity(name, i, Math.Max(0, settings.Weight), settings, false);
        }).ToList();
    }

    public static ResolvedRarity? Find(List<ResolvedRarity> list, string? name) =>
        name == null ? null : list.FirstOrDefault(r => r.Name.Equals(name.Trim(), StringComparison.OrdinalIgnoreCase));

    public static string[] FoilTypesOf(CollectionRow? collection)
    {
        var types = collection?.FoilTypes?.Select(t => t.ToLowerInvariant()).Where(t => FoilTypes.Contains(t)).Distinct().ToArray();
        return types is { Length: > 0 } ? types : DefaultFoilTypes;
    }

    public static int FoilIndex(string? type) => Math.Max(0, Array.IndexOf(FoilTypes, type?.ToLowerInvariant()));

    private static RaritySettings Custom(RarityDefinition rarity)
    {
        var color = Hex(rarity.Color) ?? "#FFFFFF";
        return new RaritySettings
        {
            Weight = rarity.Weight,
            Price = rarity.Price,
            Color = color,
            Background = NearestBackground(color),
            Glow = new GlowSettings { Strength = 1.1, Color = color, Color2 = Lighter(color), Rays = 1, Sparkles = 0.8 }
        };
    }

    private static string? Hex(string? value)
    {
        var v = value?.Trim().TrimStart('#');
        return v is { Length: 6 } && int.TryParse(v, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out _) ? "#" + v.ToUpperInvariant() : null;
    }

    private static (int R, int G, int B) Rgb(string hex)
    {
        var v = int.Parse(hex.TrimStart('#'), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        return ((v >> 16) & 255, (v >> 8) & 255, v & 255);
    }

    private static string Lighter(string hex)
    {
        var (r, g, b) = Rgb(hex);
        return $"#{(r + 255) / 2:X2}{(g + 255) / 2:X2}{(b + 255) / 2:X2}";
    }

    private static string NearestBackground(string hex)
    {
        var (r, g, b) = Rgb(hex);
        return Backgrounds.MinBy(c => (c.R - r) * (c.R - r) + (c.G - g) * (c.G - g) + (c.B - b) * (c.B - b)).Name;
    }
}

public sealed class RarityRoller
{
    private readonly double[] _ends;
    private readonly string[][] _pools;

    private RarityRoller(double[] ends, string[][] pools)
    {
        _ends = ends;
        _pools = pools;
    }

    public bool IsEmpty => _pools.Length == 0;

    public int Count => _pools.Sum(p => p.Length);

    public IReadOnlyList<string[]> Pools => _pools;

    public static RarityRoller Build(IEnumerable<(string Card, string Collection, string Rarity)> cards, Func<string, List<ResolvedRarity>> raritiesOf)
    {
        var byCollection = cards.GroupBy(c => c.Collection, StringComparer.OrdinalIgnoreCase).ToList();
        var ranges = new List<(string Collection, double Start, double End, string[] Cards)>();
        foreach (var group in byCollection)
        {
            var rarities = raritiesOf(group.Key);
            var total = rarities.Sum(r => r.Weight);
            var members = group.GroupBy(c => c.Rarity, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.Select(c => c.Card).Distinct(StringComparer.OrdinalIgnoreCase).ToArray(), StringComparer.OrdinalIgnoreCase);
            var at = 0.0;
            foreach (var rarity in rarities)
            {
                var size = total > 0 ? rarity.Weight / total * 100 : 100.0 / rarities.Count;
                if (size > 0 && members.TryGetValue(rarity.Name, out var list) && list.Length > 0)
                    ranges.Add((group.Key, at, at + size, list));
                at += size;
            }
        }

        var cuts = ranges.SelectMany(r => new[] { r.Start, r.End }).Append(0).Append(100).Select(v => Math.Round(v, 9)).Distinct().OrderBy(v => v).ToList();
        var ends = new List<double>();
        var pools = new List<string[]>();
        var sum = 0.0;
        for (var i = 0; i + 1 < cuts.Count; i++)
        {
            var mid = (cuts[i] + cuts[i + 1]) / 2;
            var pool = ranges.Where(r => mid >= r.Start && mid < r.End).SelectMany(r => r.Cards).ToArray();
            if (pool.Length == 0)
                continue;
            sum += cuts[i + 1] - cuts[i];
            ends.Add(sum);
            pools.Add(pool);
        }
        return new RarityRoller(ends.ToArray(), pools.ToArray());
    }

    public string[]? PickPool(Random random)
    {
        if (_pools.Length == 0)
            return null;
        var roll = random.NextDouble() * _ends[^1];
        var index = Array.BinarySearch(_ends, roll);
        index = index < 0 ? ~index : index + 1;
        return _pools[Math.Min(index, _pools.Length - 1)];
    }

    public string? Pick(Random random) => PickPool(random) is { } pool ? pool[random.Next(pool.Length)] : null;
}
