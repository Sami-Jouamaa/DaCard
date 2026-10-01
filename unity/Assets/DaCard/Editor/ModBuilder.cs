using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using UnityEditor;
using Debug = UnityEngine.Debug;

namespace DaCard.Editor
{
    public static class ModBuilder
    {
        private const int TimeoutSeconds = 600;
        private const string Title = "Build Mod";

        [MenuItem("DaCard/Build Mod", priority = 0)]
        public static void BuildMod() => Build(interactive: true);

        public static void BuildModBatch()
        {
            try
            {
                var ok = Build(interactive: false);
                EditorApplication.Exit(ok ? 0 : 1);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                EditorApplication.Exit(1);
            }
        }

        private static bool Build(bool interactive)
        {
            try
            {
                if (interactive) EditorUtility.DisplayProgressBar(Title, "Building the bundles…", 0.1f);
                CardBundleBuilder.BuildBundle();
            }
            catch (Exception e)
            {
                EditorUtility.ClearProgressBar();
                Debug.LogException(e);
                Fail(interactive, "Building the bundles failed: " + e.Message);
                return false;
            }

            var script = Path.Combine(CardPaths.RepoRoot, "package.ps1");
            var output = new List<string>();
            int exitCode;
            try
            {
                exitCode = Run("powershell.exe", $"-NoProfile -ExecutionPolicy Bypass -File \"{script}\"",
                    CardPaths.RepoRoot, output, interactive ? Title : null);
            }
            catch (Exception e)
            {
                EditorUtility.ClearProgressBar();
                Debug.LogException(e);
                Fail(interactive, "Could not run package.ps1: " + e.Message);
                return false;
            }
            EditorUtility.ClearProgressBar();

            var log = string.Join("\n", output);
            if (exitCode != 0)
            {
                Debug.LogError($"[DaCard] package.ps1 failed (exit code {exitCode}):\n{log}");
                var errors = output.Where(l => l.Contains(" error ") || l.Contains("Exception") || l.Contains("failed")).Take(5);
                Fail(interactive, "The mod build failed:\n\n" + string.Join("\n", errors) + "\n\nThe full output is in the Console.");
                return false;
            }

            var created = output.LastOrDefault(l => l.StartsWith("Created "));
            var zip = created?.Substring("Created ".Length).Split(new[] { " (" }, StringSplitOptions.None)[0].Trim();
            Debug.Log($"[DaCard] Mod built: {zip}\n{log}");

            var settings = CardBuildSettings.LoadOrCreate();
            if (settings.installAfterBuild)
            {
                var installed = ModInstaller.Install(settings.modsFolder, out var message);
                if (!installed)
                {
                    Debug.LogError($"[DaCard] Mod built but {char.ToLowerInvariant(message[0])}{message.Substring(1)}");
                    Fail(interactive, $"The mod was built ({zip}), but:\n\n{message}");
                    return false;
                }
                Debug.Log($"[DaCard] Mod {char.ToLowerInvariant(message[0])}{message.Substring(1)}");
                return true;
            }

            if (interactive && zip != null && File.Exists(zip))
                EditorUtility.RevealInFinder(zip);
            return true;
        }

        private static void Fail(bool interactive, string message)
        {
            if (interactive)
                EditorUtility.DisplayDialog(Title, message, "OK");
        }

        private static int Run(string file, string arguments, string workingDir, List<string> output, string title)
        {
            var info = new ProcessStartInfo(file, arguments)
            {
                WorkingDirectory = workingDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using var process = new Process { StartInfo = info };
            var sync = new object();
            void Add(string line)
            {
                if (line == null) return;
                lock (sync) output.Add(line);
            }
            process.OutputDataReceived += (_, e) => Add(e.Data);
            process.ErrorDataReceived += (_, e) => Add(e.Data);
            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            var started = DateTime.Now;
            while (!process.WaitForExit(200))
            {
                var seconds = (DateTime.Now - started).TotalSeconds;
                string last;
                lock (sync) last = output.LastOrDefault(l => !string.IsNullOrWhiteSpace(l)) ?? "";
                if (title != null && EditorUtility.DisplayCancelableProgressBar(title, "Building and zipping the mod… " + last.Trim(),
                        0.2f + 0.75f * (float)Math.Min(1, seconds / 60)))
                {
                    process.Kill();
                    throw new OperationCanceledException("Cancelled");
                }
                if (seconds > TimeoutSeconds)
                {
                    process.Kill();
                    throw new TimeoutException($"package.ps1 took over {TimeoutSeconds} s");
                }
            }
            process.WaitForExit();
            return process.ExitCode;
        }
    }
}
