using System.Security.Cryptography;
using System.Text;
using SPTarkov.Common.Models.Logging;
using SPTarkov.DI.Annotations;
using SPTarkov.Server.Core.Utils;

namespace DaCard.Server;

// Textures / Frames: card.png and its maps (a 3D card's picture behind the window; older 2D cards' only picture).
// Front / Back: the card's own layers (card.json "layers")
public record CardEntry(string Id, string Key, string Rarity, string? Collection, Dictionary<string, string> Textures,
    Dictionary<string, List<string>> Frames, CardFile Data, string Dir, List<LayerSource> Front, List<LayerSource> Back)
{
    public bool HasLayers => Data.Layers != null;
    public string Addon { get; init; } = "";
    public string IdKey => CardCatalog.IdKeyOf(Data.IdKey, Key);
}

[Injectable(InjectionType.Singleton)]
public class CardCatalog(ISptLogger<CardCatalog> logger, JsonUtil jsonUtil)
{
    public static readonly string[] RarityOrder = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];

    public const string DefaultCollection = "_Default";
    public const string DataFile = "card.json";
    public const string ArtBase = "card";
    public const string FramesBase = "frames";

    private const string IdSalt = "DaCard:";

    public List<CardEntry> Cards { get; } = new();
    public Dictionary<string, string> BackImages { get; } = new(StringComparer.OrdinalIgnoreCase);

    public CardManifest Manifest { get; set; } = new();

    public Dictionary<string, string> Fonts { get; set; } = new();

    public static bool IsRarity(string folder) => RarityOrder.Any(r => r.Equals(folder, StringComparison.OrdinalIgnoreCase));

    public static string IdKeyOf(string? idKey, string key) => string.IsNullOrWhiteSpace(idKey) ? key : idKey.Trim();

    public void Scan(IReadOnlyList<AddonEntry> addons, IReadOnlyList<TextureSlot> slots)
    {
        Cards.Clear();
        BackImages.Clear();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var ids = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var addon in addons)
        {
            var cardsDir = Path.Combine(addon.Dir, Addons.Cards);
            if (!Directory.Exists(cardsDir))
                continue;
            var back = Path.Combine(cardsDir, "back.png");
            if (File.Exists(back))
                BackImages[addon.Folder] = back;
            foreach (var card in ScanAddon(addon, cardsDir, slots, seen))
            {
                if (ids.TryGetValue(card.Id, out var first))
                {
                    logger.Error($"[DaCard] {addon.Where(Addons.Cards)}: card '{card.Key}' is the same card as '{first}' (same \"idKey\": a copied card folder?); skipping it.");
                    continue;
                }
                ids[card.Id] = card.Key;
                Cards.Add(card);
            }
        }
    }

    private IEnumerable<CardEntry> ScanAddon(AddonEntry addon, string cardsDir, IReadOnlyList<TextureSlot> slots, HashSet<string> seen)
    {
        var cardsPath = addon.Where(Addons.Cards);
        foreach (var collectionDir in Directory.GetDirectories(cardsDir).OrderBy(p => p, StringComparer.OrdinalIgnoreCase))
        {
            var folder = Path.GetFileName(collectionDir);
            if (IsRarity(folder))
            {
                logger.Warning($"[DaCard] {cardsPath}/{folder}/ is ignored: cards go into {cardsPath}/<collection>/{folder}/<card>/, " +
                               $"or {cardsPath}/{DefaultCollection}/{folder}/<card>/ without a collection.");
                continue;
            }
            var collection = folder.Equals(DefaultCollection, StringComparison.OrdinalIgnoreCase) ? null : folder;

            foreach (var rarityDir in Directory.GetDirectories(collectionDir).OrderBy(p => p, StringComparer.OrdinalIgnoreCase))
            {
                var rarity = RarityOrder.FirstOrDefault(r => r.Equals(Path.GetFileName(rarityDir), StringComparison.OrdinalIgnoreCase));
                if (rarity == null)
                {
                    logger.Warning($"[DaCard] Ignoring {cardsPath}/{folder}/{Path.GetFileName(rarityDir)}: not a rarity ({string.Join(", ", RarityOrder)})");
                    continue;
                }

                var loose = Directory.GetFiles(rarityDir, "*.png").Length + Directory.GetFiles(rarityDir, "*.json").Length;
                if (loose > 0)
                    logger.Warning($"[DaCard] {cardsPath}/{folder}/{rarity}: {loose} file(s) directly in the rarity folder are ignored. " +
                                   $"Every card needs its own folder: {rarity}/<card>/{DataFile} + {ArtBase}.png.");

                foreach (var cardDir in Directory.GetDirectories(rarityDir).OrderBy(p => p, StringComparer.OrdinalIgnoreCase))
                {
                    var name = Path.GetFileName(cardDir);
                    var key = collection == null ? name : $"{collection}/{name}";
                    if (!seen.Add(key))
                    {
                        logger.Error($"[DaCard] Duplicate card '{name}' in {cardsPath}/{folder}: card folder names must be unique; skipping {cardsPath}/{folder}/{rarity}/{name}.");
                        continue;
                    }

                    var card = TryLoad($"{cardsPath}/{folder}/{rarity}/{name}", rarity, key, collection, cardDir, slots);
                    if (card != null)
                        yield return card with { Addon = addon.Folder };
                }
            }
        }
    }

    private CardEntry? TryLoad(string where, string rarity, string key, string? collection, string cardDir, IReadOnlyList<TextureSlot> slots)
    {
        var jsonPath = Path.Combine(cardDir, DataFile);
        if (!File.Exists(jsonPath))
        {
            logger.Error($"[DaCard] {where} has no {DataFile}; skipping.");
            return null;
        }

        CardFile? data;
        try
        {
            data = jsonUtil.Deserialize<CardFile>(File.ReadAllText(jsonPath));
        }
        catch (Exception e)
        {
            logger.Error($"[DaCard] {where}/{DataFile} is not valid JSON: {e.Message}");
            return null;
        }

        if (string.IsNullOrWhiteSpace(data?.Name))
        {
            logger.Error($"[DaCard] {where}/{DataFile} needs a \"name\"; skipping.");
            return null;
        }

        var front = CardLayers.Read(cardDir, data.Layers?.Front, "card:", false, where, logger);
        var back = CardLayers.Read(cardDir, data.Layers?.Back, "card:", false, where, logger);

        var textures = new Dictionary<string, string>();
        foreach (var slot in slots)
        {
            var file = Path.Combine(cardDir, slot.Suffix == "" ? $"{ArtBase}.png" : $"{ArtBase}.{slot.Suffix}.png");
            if (File.Exists(file))
                textures[slot.Suffix] = file;
            else if ((slot.Required || slot.Suffix == "") && data.Layers == null)
            {
                logger.Error($"[DaCard] {where} is missing {Path.GetFileName(file)}; skipping.");
                return null;
            }
        }

        var frames = new Dictionary<string, List<string>>();
        foreach (var suffix in textures.Keys)
        {
            var dir = Path.Combine(cardDir, suffix == "" ? FramesBase : $"{FramesBase}.{suffix}");
            if (!Directory.Exists(dir))
                continue;
            var files = Directory.GetFiles(dir, "frame_*.png").OrderBy(f => f, StringComparer.OrdinalIgnoreCase).ToList();
            if (files.Count > 1)
                frames[suffix] = files;
        }

        if (data.Layers != null && front.Count == 0 && !textures.ContainsKey(""))
        {
            logger.Error($"[DaCard] {where} has no front layer (and no {ArtBase}.png); skipping.");
            return null;
        }

        return new CardEntry(IdFor(IdKeyOf(data.IdKey, key)), key, rarity, collection, textures, frames, data, cardDir, front, back);
    }

    public static string IdFor(string key)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(IdSalt + key.ToLowerInvariant()));
        return Convert.ToHexString(hash, 0, 12).ToLowerInvariant();
    }

    public static string FoilIdFor(CardEntry card) => IdFor("foil:" + card.IdKey);
}
