using System.Diagnostics;
using System.Text.Json;
using SPTarkov.Common.Models.Logging;
using SPTarkov.DI.Annotations;
using Path = System.IO.Path;

namespace DaCard.Server.Storage;

[Injectable(InjectionType.Singleton)]
public class DashboardUpgrade(ISptLogger<DashboardUpgrade> logger)
{
    public const string DashboardFolder = "dashboard";
    private static readonly TimeSpan Limit = TimeSpan.FromMinutes(30);

    public static string Script(string modPath) => Path.Combine(modPath, DashboardFolder, "server", "cli.mjs");

    public static string? Node(string modPath)
    {
        var bundled = Path.Combine(modPath, DashboardFolder, "node", OperatingSystem.IsWindows() ? "node.exe" : "node");
        if (File.Exists(bundled))
            return bundled;
        var names = OperatingSystem.IsWindows() ? new[] { "node.exe" } : new[] { "node" };
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
            foreach (var name in names)
            {
                var path = Path.Combine(dir.Trim(), name);
                if (File.Exists(path))
                    return path;
            }
        return null;
    }

    public bool Run(string modPath)
    {
        var script = Script(modPath);
        if (!File.Exists(script))
        {
            logger.Error($"[DaCard] {Path.Combine(DashboardFolder, "server", "cli.mjs")} is missing: the data can't be checked for updates. Reinstall DaCard.");
            return false;
        }
        var node = Node(modPath);
        if (node == null)
        {
            logger.Warning("[DaCard] Node.js was not found, so the data was not checked for updates. If DaCard says the database is missing or out of date, " +
                           $"run \"{Path.Combine(modPath, "DaCard Dashboard.bat")}\" once (or install Node.js 22.13+ on this machine).");
            return false;
        }

        var start = new ProcessStartInfo(node)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WorkingDirectory = Path.Combine(modPath, DashboardFolder)
        };
        foreach (var arg in new[] { "--disable-warning=ExperimentalWarning", script, "upgrade", "--by", "server", "--mod", modPath })
            start.ArgumentList.Add(arg);

        try
        {
            using var process = Process.Start(start) ?? throw new InvalidOperationException("the process did not start");
            var errors = new List<string>();
            process.ErrorDataReceived += (_, e) =>
            {
                if (!string.IsNullOrWhiteSpace(e.Data))
                    lock (errors)
                        errors.Add(e.Data);
            };
            process.BeginErrorReadLine();
            var lastShown = -1;
            var ok = true;
            string? line;
            while ((line = process.StandardOutput.ReadLine()) != null)
            {
                var tab = line.IndexOf('\t');
                if (tab < 0)
                    continue;
                var kind = line[..tab];
                var payload = line[(tab + 1)..];
                switch (kind)
                {
                    case "log":
                        logger.Info("[DaCard] " + payload);
                        break;
                    case "progress":
                        lastShown = ShowProgress(payload, lastShown);
                        break;
                    case "error":
                        ok = false;
                        logger.Error("[DaCard] Updating the data failed: " + payload);
                        break;
                    case "done":
                        Summarise(payload);
                        break;
                }
            }
            if (!process.WaitForExit(Limit))
            {
                process.Kill(true);
                logger.Error("[DaCard] Updating the data took too long and was stopped.");
                return false;
            }
            process.WaitForExit();
            if (process.ExitCode != 0 && ok)
                logger.Error($"[DaCard] Updating the data failed (exit code {process.ExitCode}): {string.Join(" ", errors.TakeLast(5))}");
            return ok && process.ExitCode == 0;
        }
        catch (Exception e)
        {
            logger.Error($"[DaCard] Could not run Node.js ({node}) to update the data: {e.Message}");
            return false;
        }
    }

    private int ShowProgress(string payload, int lastShown)
    {
        try
        {
            using var doc = JsonDocument.Parse(payload);
            var done = doc.RootElement.GetProperty("done").GetDouble();
            var total = doc.RootElement.GetProperty("total").GetDouble();
            var message = doc.RootElement.TryGetProperty("message", out var m) ? m.GetString() : null;
            var percent = total > 0 ? (int)Math.Floor(done / total * 10) * 10 : 100;
            if (percent == lastShown)
                return lastShown;
            logger.Info($"[DaCard] {message ?? "Updating the data"}: {percent}% ({done:0}/{total:0})");
            return percent;
        }
        catch (JsonException)
        {
            return lastShown;
        }
    }

    private void Summarise(string payload)
    {
        try
        {
            using var doc = JsonDocument.Parse(payload);
            var root = doc.RootElement;
            if (root.TryGetProperty("warnings", out var warnings))
                foreach (var w in warnings.EnumerateArray())
                    logger.Warning("[DaCard] " + w.GetString());
            if (root.TryGetProperty("legacy", out var legacy) && legacy.ValueKind == JsonValueKind.Object)
            {
                logger.Success($"[DaCard] Moved the old addon data into the database: {legacy.GetProperty("collections").GetInt32()} collection(s), " +
                               $"{legacy.GetProperty("cards").GetInt32()} card(s), {legacy.GetProperty("packs").GetInt32()} booster pack(s). " +
                               $"The old folders are kept in {legacy.GetProperty("backup").GetString()}.");
                if (legacy.TryGetProperty("warnings", out var lw))
                    foreach (var w in lw.EnumerateArray())
                        logger.Warning("[DaCard] " + w.GetString());
            }
        }
        catch (JsonException)
        {
        }
    }
}
