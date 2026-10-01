using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using SPTarkov.Common.Models.Logging;
using SPTarkov.DI.Annotations;
using Path = System.IO.Path;

namespace DaCard.Server;

public interface IDataMigration
{
    string Id { get; }
    string Title { get; }
    IEnumerable<string> Pending(string dataDir);
    void Apply(string dataDir, string folder);
}

public record MigrationRecord
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("title")] public string Title { get; set; } = "";
    [JsonPropertyName("by")] public string By { get; set; } = "";
    [JsonPropertyName("date")] public string Date { get; set; } = "";
    [JsonPropertyName("folders")] public List<string> Folders { get; set; } = new();
    [JsonPropertyName("seen")] public bool Seen { get; set; }
}

public record MigrationLog
{
    [JsonPropertyName("applied")] public List<MigrationRecord> Applied { get; set; } = new();
}

[Injectable(InjectionType.Singleton)]
public class DataMigrations(ISptLogger<DataMigrations> logger)
{
    public const string LogFile = "migrations.json";

    private static readonly IDataMigration[] All =
        [new AddonsMigration(), new LayerMapsMigration(), new DefaultSkinsMigration(), new PackLayersMigration(), new ItemHashesMigration()];

    internal static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public void Run(string dataDir)
    {
        if (!Directory.Exists(dataDir))
            return;
        var records = new List<MigrationRecord>();
        foreach (var migration in All)
        {
            List<string> pending;
            try
            {
                pending = migration.Pending(dataDir).ToList();
            }
            catch (Exception e)
            {
                logger.Error($"[DaCard] {migration.Title}: could not check the data folder: {e.Message}");
                continue;
            }
            if (pending.Count == 0)
                continue;

            var done = new List<string>();
            foreach (var folder in pending)
            {
                try
                {
                    migration.Apply(dataDir, folder);
                    done.Add(folder);
                }
                catch (Exception e)
                {
                    logger.Error($"[DaCard] {migration.Title}: could not update data/{folder}: {e.Message}");
                }
            }
            if (done.Count == 0)
                continue;
            records.Add(new MigrationRecord
            {
                Id = migration.Id,
                Title = migration.Title,
                By = "server",
                Date = DateTime.UtcNow.ToString("o"),
                Folders = done
            });
            logger.Warning($"[DaCard] {migration.Title}: updated {done.Count} folder(s) to the new format ({string.Join(", ", done.Take(5))}{(done.Count > 5 ? ", ..." : "")}).");
        }
        if (records.Count > 0)
            AddToLog(dataDir, records);
    }

    private void AddToLog(string dataDir, List<MigrationRecord> records)
    {
        var path = Path.Combine(dataDir, LogFile);
        var log = new MigrationLog();
        try
        {
            if (File.Exists(path))
                log = JsonSerializer.Deserialize<MigrationLog>(File.ReadAllText(path)) ?? new MigrationLog();
        }
        catch (Exception e)
        {
            logger.Warning($"[DaCard] data/{LogFile} could not be read ({e.Message}); starting it again.");
        }
        log.Applied.AddRange(records);
        try
        {
            File.WriteAllText(path, JsonSerializer.Serialize(log, Json) + "\n");
        }
        catch (Exception e)
        {
            logger.Error($"[DaCard] Could not write data/{LogFile}: {e.Message}");
        }
    }

    internal static IEnumerable<(string Dir, string JsonFile)> CardFolders(string dataDir) =>
        Addons.Dirs(dataDir).Prepend(dataDir).SelectMany(root => CardFoldersIn(Path.Combine(root, Addons.Cards)));

    private static IEnumerable<(string Dir, string JsonFile)> CardFoldersIn(string cards)
    {
        if (!Directory.Exists(cards))
            yield break;
        yield return (cards, "");
        foreach (var collection in Directory.GetDirectories(cards).OrderBy(d => d, StringComparer.OrdinalIgnoreCase))
        {
            var collectionJson = Path.Combine(collection, "collection.json");
            if (File.Exists(collectionJson))
                yield return (collection, collectionJson);
            foreach (var rarity in Directory.GetDirectories(collection).OrderBy(d => d, StringComparer.OrdinalIgnoreCase))
            foreach (var card in Directory.GetDirectories(rarity).OrderBy(d => d, StringComparer.OrdinalIgnoreCase))
            {
                var cardJson = Path.Combine(card, CardCatalog.DataFile);
                if (File.Exists(cardJson))
                    yield return (card, cardJson);
            }
        }
    }

    internal static string Relative(string dataDir, string dir) => Path.GetRelativePath(dataDir, dir).Replace('\\', '/');

    internal static JsonObject? ReadObject(string path)
    {
        try
        {
            return File.Exists(path) ? JsonNode.Parse(File.ReadAllText(path)) as JsonObject : null;
        }
        catch (Exception)
        {
            return null;
        }
    }

    internal static void WriteObject(string path, JsonObject json) => File.WriteAllText(path, json.ToJsonString(Json) + "\n");

    internal static string? Text(JsonNode? node) => node is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    internal static void Move(string from, string to)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                Directory.Move(from, to);
                return;
            }
            catch (IOException) when (attempt < 5)
            {
                Thread.Sleep(250 * attempt);
            }
            catch (UnauthorizedAccessException) when (attempt < 5)
            {
                Thread.Sleep(250 * attempt);
            }
        }
    }

    internal static string Hex(int bytes) => Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(bytes)).ToLowerInvariant();
}

public class LayerMapsMigration : IDataMigration
{
    public string Id => "layer-maps";
    public string Title => "Layer maps (albedo, normal, roughness, metallic, mask)";

    private static readonly Regex LayerName = new(@"^((front|back)_\d+|layer_[0-9a-f]{10})$", RegexOptions.IgnoreCase);
    private static readonly Regex OldFile = new(@"^((front|back)_\d+|layer_[0-9a-f]{10})\.(foil|normalmask)\.png$", RegexOptions.IgnoreCase);
    private static readonly Regex OldFrames = new(@"^frames\.((front|back)_\d+|layer_[0-9a-f]{10})\.(foil|normalmask)$", RegexOptions.IgnoreCase);
    private static readonly Regex FileName = new("^[A-Za-z0-9_.-]+$");

    public IEnumerable<string> Pending(string dataDir) =>
        DataMigrations.CardFolders(dataDir).Where(f => Needed(f.Dir, f.JsonFile)).Select(f => DataMigrations.Relative(dataDir, f.Dir));

    private static bool Needed(string dir, string jsonFile)
    {
        try
        {
            return Work(dir, jsonFile, false);
        }
        catch (Exception)
        {
            return false;
        }
    }

    public void Apply(string dataDir, string folder)
    {
        var dir = Path.Combine(dataDir, folder);
        var json = DataMigrations.CardFolders(dataDir).FirstOrDefault(f => Path.GetFullPath(f.Dir).Equals(Path.GetFullPath(dir), StringComparison.OrdinalIgnoreCase)).JsonFile;
        if (json != null)
            Work(dir, json, true);
    }

    private static bool Work(string dir, string jsonFile, bool apply)
    {
        var root = jsonFile == "" ? new JsonObject() : JsonNode.Parse(File.ReadAllText(jsonFile)) as JsonObject;
        if (root == null)
            return false;
        var isCard = Path.GetFileName(jsonFile).Equals(CardCatalog.DataFile, StringComparison.OrdinalIgnoreCase);
        var bases = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var jsonChanged = false;

        if (root["layers"] is JsonObject layers)
        {
            foreach (var side in new[] { "front", "back" })
            {
                if (layers[side] is not JsonArray list)
                    continue;
                foreach (var entry in list.OfType<JsonObject>())
                {
                    if (entry["file"] is JsonValue file && file.TryGetValue<string>(out var name) && FileName.IsMatch(name))
                        bases.Add(name);
                    if (entry["fps"] is JsonObject fps)
                        jsonChanged |= RenameMaps(fps);
                }
            }
        }
        else if (isCard && IsFlat(dir, root))
        {
            bases.Add(CardLayers.Legacy);
            if (root["animation"] is JsonObject animation && animation["slots"] is JsonObject slots)
                jsonChanged |= RenameMaps(slots);
        }
        else if (jsonFile == "")
        {
            bases.Add(Path.GetFileNameWithoutExtension(CollectionBinders.BackFile));
        }
        else if (!isCard)
        {
            bases.Add(Path.GetFileNameWithoutExtension(CollectionBinders.OverlayFile));
            bases.Add(Path.GetFileNameWithoutExtension(CollectionBinders.BackFile));
        }

        var filesChanged = false;
        foreach (var name in bases)
        {
            filesChanged |= MoveFile(dir, $"{name}.foil.png", $"{name}.{LayerSource.Mask}.png", apply);
            filesChanged |= MoveDir(dir, CardLayers.FramesFolder(name, "foil"), CardLayers.FramesFolder(name, LayerSource.Mask), apply);
            filesChanged |= Delete(dir, $"{name}.normalmask.png", apply);
            filesChanged |= Delete(dir, CardLayers.FramesFolder(name, "normalmask"), apply);
        }
        foreach (var path in Directory.GetFiles(dir).Where(f => OldFile.IsMatch(Path.GetFileName(f))))
            filesChanged |= Delete(dir, Path.GetFileName(path), apply);
        foreach (var path in Directory.GetDirectories(dir).Where(d => OldFrames.IsMatch(Path.GetFileName(d))))
            filesChanged |= Delete(dir, Path.GetFileName(path), apply);

        if (apply && jsonChanged)
            File.WriteAllText(jsonFile, root.ToJsonString(DataMigrations.Json) + "\n");
        return jsonChanged || filesChanged;
    }

    private static bool IsFlat(string dir, JsonObject card)
    {
        var type = card["type"] is JsonValue v && v.TryGetValue<string>(out var t) ? t.Trim().ToLowerInvariant() : null;
        return type == "2d" || (type == null && !File.Exists(Path.Combine(dir, $"{CardLayers.Legacy}.height.png")));
    }

    private static bool RenameMaps(JsonObject maps)
    {
        var changed = false;
        if (maps.ContainsKey("foil"))
        {
            var value = maps["foil"];
            maps.Remove("foil");
            if (!maps.ContainsKey(LayerSource.Mask))
                maps[LayerSource.Mask] = value;
            changed = true;
        }
        if (maps.ContainsKey("normalmask"))
        {
            maps.Remove("normalmask");
            changed = true;
        }
        return changed;
    }

    private static bool MoveFile(string dir, string from, string to, bool apply)
    {
        var source = Path.Combine(dir, from);
        if (!File.Exists(source))
            return false;
        if (apply)
        {
            var target = Path.Combine(dir, to);
            if (File.Exists(target))
                File.Delete(source);
            else
                File.Move(source, target);
        }
        return true;
    }

    private static bool MoveDir(string dir, string from, string to, bool apply)
    {
        var source = Path.Combine(dir, from);
        if (!Directory.Exists(source))
            return false;
        if (apply)
        {
            var target = Path.Combine(dir, to);
            if (Directory.Exists(target))
                Directory.Delete(source, true);
            else
                Directory.Move(source, target);
        }
        return true;
    }

    private static bool Delete(string dir, string name, bool apply)
    {
        var path = Path.Combine(dir, name);
        if (File.Exists(path))
        {
            if (apply)
                File.Delete(path);
            return true;
        }
        if (Directory.Exists(path))
        {
            if (apply)
                Directory.Delete(path, true);
            return true;
        }
        return false;
    }
}

public class AddonsMigration : IDataMigration
{
    public string Id => "addons";
    public string Title => $"Addons (1.0 data moved into the {Addons.TemplateName} addon)";

    public IEnumerable<string> Pending(string dataDir) => Addons.Contents.Where(f => Directory.Exists(Path.Combine(dataDir, f)));

    public void Apply(string dataDir, string folder)
    {
        var target = Path.Combine(dataDir, Addons.TemplateFolder);
        Directory.CreateDirectory(target);
        var json = Path.Combine(target, Addons.DataFile);
        if (!File.Exists(json))
            DataMigrations.WriteObject(json, new JsonObject { ["name"] = Addons.TemplateName });
        Merge(Path.Combine(dataDir, folder), Path.Combine(target, folder));
    }

    private static void Merge(string from, string to)
    {
        if (!Directory.Exists(to))
        {
            DataMigrations.Move(from, to);
            return;
        }
        foreach (var file in Directory.GetFiles(from))
        {
            var target = Path.Combine(to, Path.GetFileName(file));
            if (File.Exists(target))
                File.Delete(file);
            else
                File.Move(file, target);
        }
        foreach (var dir in Directory.GetDirectories(from))
            Merge(dir, Path.Combine(to, Path.GetFileName(dir)));
        Directory.Delete(from, true);
    }
}

public class ItemHashesMigration : IDataMigration
{
    public string Id => "item-hashes";
    public string Title => "Addon item folders (hash names)";

    private static readonly Regex Hex12 = new("^[0-9a-f]{12}$");
    private static readonly Regex Prefixed = new("^[a-z0-9]+_([0-9a-f]{12})$", RegexOptions.IgnoreCase);

    public IEnumerable<string> Pending(string dataDir) =>
        Addons.Dirs(dataDir).Where(Needed).Select(d => DataMigrations.Relative(dataDir, d)).ToList();

    private static bool Valid(string name) => Hex12.IsMatch(name);

    internal static string HashOf(string name)
    {
        var match = Prefixed.Match(name);
        return Hex12.IsMatch(name) ? name : match.Success ? match.Groups[1].Value.ToLowerInvariant() : name.ToLowerInvariant();
    }

    internal static bool DefinedElsewhere(string dataDir, string ownAddon, string folder) =>
        Addons.Dirs(dataDir)
            .Where(d => !Path.GetFullPath(d).Equals(Path.GetFullPath(ownAddon), StringComparison.OrdinalIgnoreCase))
            .SelectMany(d => Children(Path.Combine(d, Addons.Cards)))
            .Any(c => File.Exists(Path.Combine(c, CollectionBinders.DataFile)) && HashOf(Path.GetFileName(c)) == HashOf(folder));

    internal static IEnumerable<string> Children(string dir) =>
        Directory.Exists(dir) ? Directory.GetDirectories(dir).OrderBy(d => d, StringComparer.OrdinalIgnoreCase) : [];

    private static bool Needed(string dir)
    {
        var folder = Path.GetFileName(dir);
        if (folder != Addons.FolderFor(folder))
            return true;
        foreach (var coll in Children(Path.Combine(dir, Addons.Cards)))
        {
            var name = Path.GetFileName(coll);
            if (CardCatalog.IsRarity(name))
                continue;
            if (!name.Equals(CardCatalog.DefaultCollection, StringComparison.OrdinalIgnoreCase) && !Valid(name))
                return true;
            if (Children(coll).Where(r => CardCatalog.IsRarity(Path.GetFileName(r))).SelectMany(Children)
                .Any(card => File.Exists(Path.Combine(card, CardCatalog.DataFile)) && !Valid(Path.GetFileName(card))))
                return true;
        }
        foreach (var pack in Children(Path.Combine(dir, Addons.Packs)))
        {
            if (!File.Exists(Path.Combine(pack, BoosterPacks.DataFile)))
                continue;
            if (!Valid(Path.GetFileName(pack)))
                return true;
        }
        return Children(Path.Combine(dir, Addons.Skins)).Any(skin => !Valid(Path.GetFileName(skin)));
    }

    public void Apply(string dataDir, string folder)
    {
        var dir = Path.Combine(dataDir, folder);
        var clean = Addons.FolderFor(Path.GetFileName(dir));
        if (clean != Path.GetFileName(dir))
        {
            var target = Path.Combine(dataDir, clean);
            if (Directory.Exists(target) && !clean.Equals(Path.GetFileName(dir), StringComparison.OrdinalIgnoreCase))
                throw new IOException($"data/{clean} already exists");
            var temp = Path.Combine(dataDir, clean + "_" + DataMigrations.Hex(4));
            DataMigrations.Move(dir, temp);
            DataMigrations.Move(temp, target);
            dir = target;
        }
        var collections = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var cards = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var skins = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        var cardsDir = Path.Combine(dir, Addons.Cards);
        foreach (var collDir in Children(cardsDir).ToList())
        {
            var oldColl = Path.GetFileName(collDir);
            if (CardCatalog.IsRarity(oldColl))
                continue;
            var isDefault = oldColl.Equals(CardCatalog.DefaultCollection, StringComparison.OrdinalIgnoreCase);
            var newColl = isDefault || Valid(oldColl) ? oldColl : Fresh(oldColl, cardsDir);
            var collPath = collDir;
            if (newColl != oldColl)
            {
                var jsonPath = Path.Combine(collDir, CollectionBinders.DataFile);
                if (File.Exists(jsonPath) || !DefinedElsewhere(dataDir, dir, oldColl))
                {
                    var json = DataMigrations.ReadObject(jsonPath) ?? new JsonObject();
                    if (string.IsNullOrWhiteSpace(DataMigrations.Text(json["name"])))
                        json["name"] = oldColl;
                    if (string.IsNullOrWhiteSpace(DataMigrations.Text(json["idKey"])))
                        json["idKey"] = oldColl;
                    DataMigrations.WriteObject(jsonPath, json);
                }
                collPath = Path.Combine(cardsDir, newColl);
                DataMigrations.Move(collDir, collPath);
                collections[oldColl] = newColl;
            }
            foreach (var rarityDir in Children(collPath).Where(r => CardCatalog.IsRarity(Path.GetFileName(r))).ToList())
            foreach (var cardDir in Children(rarityDir).ToList())
            {
                var jsonPath = Path.Combine(cardDir, CardCatalog.DataFile);
                if (!File.Exists(jsonPath))
                    continue;
                var oldName = Path.GetFileName(cardDir);
                var newName = Valid(oldName) ? oldName : Fresh(oldName, rarityDir);
                var oldKey = isDefault ? oldName : $"{oldColl}/{oldName}";
                var newKey = isDefault ? newName : $"{newColl}/{newName}";
                if (oldKey == newKey)
                    continue;
                var json = DataMigrations.ReadObject(jsonPath);
                if (json != null && string.IsNullOrWhiteSpace(DataMigrations.Text(json["idKey"])))
                {
                    json["idKey"] = oldKey;
                    DataMigrations.WriteObject(jsonPath, json);
                }
                if (newName != oldName)
                    DataMigrations.Move(cardDir, Path.Combine(rarityDir, newName));
                cards[oldKey] = newKey;
            }
        }

        var packsDir = Path.Combine(dir, Addons.Packs);
        foreach (var packDir in Children(packsDir).ToList())
        {
            var jsonPath = Path.Combine(packDir, BoosterPacks.DataFile);
            var json = DataMigrations.ReadObject(jsonPath);
            if (json == null)
                continue;
            var oldName = Path.GetFileName(packDir);
            var newName = Valid(oldName) ? oldName : Fresh(oldName, packsDir);
            if (newName != oldName)
            {
                var id = BoosterPacks.IdOf(oldName, new PackFile { Id = DataMigrations.Text(json["id"]) });
                var ordered = new JsonObject { ["id"] = id };
                foreach (var (key, value) in json.ToList())
                {
                    json.Remove(key);
                    if (key != "id")
                        ordered[key] = value;
                }
                json = ordered;
            }
            if (newName == oldName)
                continue;
            DataMigrations.WriteObject(jsonPath, json);
            DataMigrations.Move(packDir, Path.Combine(packsDir, newName));
        }

        var skinsDir = Path.Combine(dir, Addons.Skins);
        foreach (var skinDir in Children(skinsDir).ToList())
        {
            var oldName = Path.GetFileName(skinDir);
            if (Valid(oldName))
                continue;
            var newName = Fresh(oldName, skinsDir);
            var jsonPath = Path.Combine(skinDir, BoosterPacks.SkinDataFile);
            var json = DataMigrations.ReadObject(jsonPath) ?? new JsonObject();
            if (string.IsNullOrWhiteSpace(DataMigrations.Text(json["name"])))
            {
                json["name"] = oldName;
                DataMigrations.WriteObject(jsonPath, json);
            }
            DataMigrations.Move(skinDir, Path.Combine(skinsDir, newName));
            skins[oldName] = newName;
        }

        if (collections.Count + cards.Count + skins.Count > 0)
            RewritePacks(dataDir, Path.GetFileName(dir), collections, cards, skins);
    }

    private static string Fresh(string old, string parent)
    {
        var name = HashOf(old);
        if (!Hex12.IsMatch(name))
            name = DataMigrations.Hex(6);
        while (Directory.Exists(Path.Combine(parent, name)) || File.Exists(Path.Combine(parent, name)))
            name = DataMigrations.Hex(6);
        return name;
    }

    internal static void RewritePacks(string dataDir, string addon, Dictionary<string, string> collections, Dictionary<string, string> cards,
        Dictionary<string, string> skins)
    {
        foreach (var addonDir in Addons.Dirs(dataDir).Prepend(dataDir))
        {
            var own = Path.GetFileName(addonDir).Equals(addon, StringComparison.OrdinalIgnoreCase);
            foreach (var packDir in Children(Path.Combine(addonDir, Addons.Packs)))
            {
                var jsonPath = Path.Combine(packDir, BoosterPacks.DataFile);
                var json = DataMigrations.ReadObject(jsonPath);
                if (json == null)
                    continue;
                var changed = false;
                if (json["cards"] is JsonObject choice)
                {
                    changed |= Rename(choice["collections"] as JsonArray, collections);
                    changed |= Rename(choice["cards"] as JsonArray, cards);
                }
                foreach (var key in new[] { "skin", "base" })
                {
                    var skin = DataMigrations.Text(json[key])?.Trim();
                    if (skin == null || !skins.TryGetValue(skin, out var renamed))
                        continue;
                    if (!own && Directory.Exists(Path.Combine(addonDir, Addons.Skins, skin)))
                        continue;
                    json[key] = renamed;
                    changed = true;
                }
                if (changed)
                    DataMigrations.WriteObject(jsonPath, json);
            }
        }
    }

    private static bool Rename(JsonArray? list, Dictionary<string, string> names)
    {
        if (list == null)
            return false;
        var changed = false;
        for (var i = 0; i < list.Count; i++)
        {
            var value = DataMigrations.Text(list[i])?.Trim().Replace('\\', '/');
            if (value != null && names.TryGetValue(value, out var renamed))
            {
                list[i] = renamed;
                changed = true;
            }
        }
        return changed;
    }
}

public class DefaultSkinsMigration : IDataMigration
{
    public string Id => "default-skins";
    public string Title => "Stock skins (now shipped with the mod)";

    private static readonly HashSet<string> Ignored = new(StringComparer.OrdinalIgnoreCase) { BoosterPacks.SkinDataFile, "thumb.png" };

    private static string DefaultsDir(string dataDir) => Path.GetFullPath(Path.Combine(dataDir, "..", BoosterPacks.DefaultSkinsFolder));

    public IEnumerable<string> Pending(string dataDir)
    {
        var defaults = ItemHashesMigration.Children(DefaultsDir(dataDir)).ToList();
        return Addons.Dirs(dataDir)
            .Where(addon => ItemHashesMigration.Children(Path.Combine(addon, Addons.Skins)).Any(skin => Stock(skin, defaults) != null))
            .Select(d => DataMigrations.Relative(dataDir, d))
            .ToList();
    }

    public void Apply(string dataDir, string folder)
    {
        var defaults = ItemHashesMigration.Children(DefaultsDir(dataDir)).ToList();
        var skins = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var skin in ItemHashesMigration.Children(Path.Combine(dataDir, folder, Addons.Skins)).ToList())
        {
            if (Stock(skin, defaults) is not { } stock)
                continue;
            Directory.Delete(skin, true);
            skins[Path.GetFileName(skin)] = stock;
        }
        if (skins.Count > 0)
            ItemHashesMigration.RewritePacks(dataDir, Path.GetFileName(folder), new(), new(), skins);
    }

    private static string? Stock(string skin, List<string> defaults)
    {
        var files = Files(skin);
        if (files.Count == 0)
            return null;
        foreach (var stock in defaults)
        {
            var other = Files(stock);
            if (other.Count == files.Count && files.All(f => other.TryGetValue(f.Key, out var path) && Same(f.Value, path)))
                return Path.GetFileName(stock);
        }
        return null;
    }

    private static Dictionary<string, string> Files(string dir) =>
        Directory.GetFiles(dir).Where(f => !Ignored.Contains(Path.GetFileName(f)))
            .ToDictionary(f => Path.GetFileName(f), f => f, StringComparer.OrdinalIgnoreCase);

    private static bool Same(string a, string b)
    {
        var fa = new FileInfo(a);
        var fb = new FileInfo(b);
        return fa.Length == fb.Length && File.ReadAllBytes(a).AsSpan().SequenceEqual(File.ReadAllBytes(b));
    }
}

public class PackLayersMigration : IDataMigration
{
    public string Id => "pack-layers";
    public string Title => "Booster pack layers (albedo, normal, roughness, metallic, mask)";

    public const double PrintRoughness = 0.62, FoilRoughness = 0.2;
    private static readonly Regex HashLayer = new("^layer_[0-9a-f]{10}$");
    private static readonly Regex LayerFile = new(@"^layer_[A-Za-z0-9]+(\.[A-Za-z.]+)?\.png$", RegexOptions.IgnoreCase);
    private static readonly string[] OldKeys = ["artMask", "metallic", "roughness", "normal", "metallicMask", "roughnessMask", "normalMask", "normalmask", "foil", "finish"];
    private static readonly (string Key, string Suffix)[] Kept = [("artMask", ".mask"), ("metallic", ".metallic"), ("foil", ".metallic"), ("roughness", ".roughness"), ("normal", ".normal")];

    public IEnumerable<string> Pending(string dataDir) =>
        Addons.Dirs(dataDir).Prepend(dataDir)
            .SelectMany(root => ItemHashesMigration.Children(Path.Combine(root, Addons.Packs)))
            .Where(Needed)
            .Select(d => DataMigrations.Relative(dataDir, d))
            .ToList();

    private static bool Needed(string dir) =>
        DataMigrations.ReadObject(Path.Combine(dir, BoosterPacks.DataFile))?["layers"] is JsonArray layers
        && layers.OfType<JsonObject>().Any(e => DataMigrations.Text(e["file"]) is { } file
            && (!HashLayer.IsMatch(file) || OldKeys.Any(e.ContainsKey)));

    public void Apply(string dataDir, string folder)
    {
        var dir = Path.Combine(dataDir, folder);
        var jsonPath = Path.Combine(dir, BoosterPacks.DataFile);
        if (DataMigrations.ReadObject(jsonPath) is not { } pack || pack["layers"] is not JsonArray layers)
            return;
        var keep = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in layers.OfType<JsonObject>())
        {
            if (DataMigrations.Text(entry["file"]) is not { } file)
                continue;
            var old = file.EndsWith(".png", StringComparison.OrdinalIgnoreCase) || OldKeys.Any(entry.ContainsKey);
            var oldStem = file.EndsWith(".png", StringComparison.OrdinalIgnoreCase) ? file[..^4] : file;
            var stem = HashLayer.IsMatch(oldStem) && used.Add(oldStem) ? oldStem : Fresh(dir, used);
            var moves = new List<(string From, string To)> { (oldStem + ".png", stem + ".png") };
            foreach (var (key, suffix) in Kept)
                if (DataMigrations.Text(entry[key]) is { } path && !moves.Any(m => m.To.Equals(stem + suffix + ".png", StringComparison.OrdinalIgnoreCase)))
                    moves.Add((path, stem + suffix + ".png"));
            if (DataMigrations.Text(entry["file"]) == oldStem)
                foreach (var suffix in new[] { ".mask", ".metallic", ".roughness", ".normal" })
                    if (!moves.Any(m => m.To.Equals(stem + suffix + ".png", StringComparison.OrdinalIgnoreCase)) && File.Exists(Path.Combine(dir, oldStem + suffix + ".png")))
                        moves.Add((oldStem + suffix + ".png", stem + suffix + ".png"));

            var temp = moves.Where(m => File.Exists(Path.Combine(dir, m.From)))
                .Select(m => (Temp: Path.Combine(dir, "migrating_" + DataMigrations.Hex(6) + ".png"), m.To)).ToList();
            var existing = moves.Where(m => File.Exists(Path.Combine(dir, m.From))).ToList();
            for (var i = 0; i < existing.Count; i++)
                File.Move(Path.Combine(dir, existing[i].From), temp[i].Temp);
            foreach (var (from, to) in temp)
            {
                var target = Path.Combine(dir, to);
                if (File.Exists(target))
                    File.Delete(target);
                File.Move(from, target);
                keep.Add(to);
            }

            var finish = DataMigrations.Text(entry["finish"])?.Trim().ToLowerInvariant() ?? "print";
            (double Metal, double Rough)? flat = finish switch
            {
                "foil" => (1, FoilRoughness),
                "base" => null,
                _ => (0, PrintRoughness)
            };
            if (old && flat is { } values)
            {
                foreach (var (suffix, value) in new[] { (".metallic", values.Metal), (".roughness", values.Rough) })
                {
                    var name = stem + suffix + ".png";
                    if (keep.Contains(name))
                        continue;
                    File.WriteAllBytes(Path.Combine(dir, name), Png.Gray(value));
                    keep.Add(name);
                }
            }

            foreach (var key in OldKeys)
                entry.Remove(key);
            entry["file"] = stem;
        }
        foreach (var file in Directory.GetFiles(dir))
        {
            var name = Path.GetFileName(file);
            if (LayerFile.IsMatch(name) && !keep.Contains(name))
                File.Delete(file);
        }
        DataMigrations.WriteObject(jsonPath, pack);
    }

    private static string Fresh(string dir, HashSet<string> used)
    {
        string stem;
        do stem = "layer_" + DataMigrations.Hex(5);
        while (!used.Add(stem) || Directory.GetFiles(dir, stem + "*").Length > 0);
        return stem;
    }
}

public static class Png
{
    private static readonly uint[] Table = Enumerable.Range(0, 256).Select(n =>
    {
        var c = (uint)n;
        for (var k = 0; k < 8; k++)
            c = (c & 1) != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1;
        return c;
    }).ToArray();

    public static byte[] Gray(double value)
    {
        var v = (byte)Math.Clamp(Math.Round(value * 255), 0, 255);
        using var output = new MemoryStream();
        output.Write([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        Chunk(output, "IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]);
        using (var raw = new MemoryStream())
        {
            using (var z = new System.IO.Compression.ZLibStream(raw, System.IO.Compression.CompressionLevel.Optimal, true))
                z.Write([0, v]);
            Chunk(output, "IDAT", raw.ToArray());
        }
        Chunk(output, "IEND", []);
        return output.ToArray();
    }

    private static void Chunk(Stream output, string type, byte[] data)
    {
        var head = System.Text.Encoding.ASCII.GetBytes(type);
        Span<byte> length = stackalloc byte[4];
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(length, (uint)data.Length);
        output.Write(length);
        output.Write(head);
        output.Write(data);
        var crc = 0xFFFFFFFFu;
        foreach (var b in head.Concat(data))
            crc = Table[(crc ^ b) & 0xFF] ^ (crc >> 8);
        Span<byte> tail = stackalloc byte[4];
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(tail, crc ^ 0xFFFFFFFF);
        output.Write(tail);
    }
}
