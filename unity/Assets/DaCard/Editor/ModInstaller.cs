using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace DaCard.Editor
{
    public static class ModInstaller
    {
        public static string StagingDir => Path.Combine(CardPaths.RepoRoot, "artifacts", "staging");

        public static bool TryResolve(string picked, out string modsFolder, out string gameRoot, out string error)
        {
            modsFolder = gameRoot = null;
            error = null;
            if (string.IsNullOrWhiteSpace(picked))
            {
                error = "Pick the game's SPT mods folder (<game>\\SPT_Runtime\\user\\mods).";
                return false;
            }

            var full = Path.GetFullPath(picked.Trim());
            if (!Directory.Exists(full))
            {
                error = "Folder not found: " + full;
                return false;
            }

            var dir = new DirectoryInfo(full);
            if (Directory.Exists(Path.Combine(full, "SPT_Runtime", "user", "mods")))
            {
                gameRoot = full;
                modsFolder = Path.Combine(full, "SPT_Runtime", "user", "mods");
            }
            else if (dir.Name.Equals("mods", StringComparison.OrdinalIgnoreCase) &&
                     dir.Parent?.Name.Equals("user", StringComparison.OrdinalIgnoreCase) == true && dir.Parent.Parent?.Parent != null)
            {
                gameRoot = dir.Parent.Parent.Parent.FullName;
                modsFolder = full;
            }
            else
            {
                error = "That isn't an SPT mods folder: pick <game>\\SPT_Runtime\\user\\mods.";
                return false;
            }

            if (!Directory.Exists(Path.Combine(gameRoot, "BepInEx")))
            {
                error = $"No BepInEx folder in {gameRoot}: is that an SPT game folder?";
                return false;
            }
            return true;
        }

        public static bool Install(string picked, out string message)
        {
            if (!TryResolve(picked, out var modsFolder, out var gameRoot, out var error))
            {
                message = "Not installed: " + error;
                return false;
            }
            if (!Directory.Exists(StagingDir))
            {
                message = "Not installed: the build left nothing in " + StagingDir;
                return false;
            }

            var stagedMods = Path.Combine(StagingDir, "SPT_Runtime", "user", "mods");
            var copied = 0;
            var locked = new List<string>();
            var targets = new List<string>();
            foreach (var top in Directory.GetDirectories(StagingDir))
            {
                var name = Path.GetFileName(top);
                var (from, to) = name.Equals("SPT_Runtime", StringComparison.OrdinalIgnoreCase) && Directory.Exists(stagedMods)
                    ? (stagedMods, modsFolder)
                    : (top, Path.Combine(gameRoot, name));
                foreach (var sub in Directory.GetDirectories(from))
                    targets.Add(Path.Combine(to, Path.GetFileName(sub)));
                copied += CopyTree(from, to, locked);
            }

            if (locked.Count > 0)
            {
                message = $"Installed {copied} file(s), but {locked.Count} are in use and were not replaced (close the SPT server / the game " +
                          "and build again):\n  " + string.Join("\n  ", locked.Take(10));
                return false;
            }
            message = (copied == 0 ? "Already up to date in:\n  " : $"Installed {copied} changed file(s) into:\n  ") + string.Join("\n  ", targets);
            return true;
        }

        private static int CopyTree(string from, string to, List<string> locked)
        {
            var count = 0;
            foreach (var file in Directory.GetFiles(from, "*", SearchOption.AllDirectories))
            {
                var target = Path.Combine(to, file.Substring(from.Length).TrimStart('\\', '/'));
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                if (SameFile(file, target)) continue;
                try
                {
                    File.Copy(file, target, overwrite: true);
                    count++;
                }
                catch (IOException)
                {
                    locked.Add(target);
                }
            }
            return count;
        }

        private static bool SameFile(string a, string b)
        {
            var x = new FileInfo(a);
            var y = new FileInfo(b);
            if (!y.Exists || x.Length != y.Length) return false;
            if (x.LastWriteTimeUtc == y.LastWriteTimeUtc) return true;
            try
            {
                using var sa = new FileStream(a, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                using var sb = new FileStream(b, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                var ba = new byte[1 << 16];
                var bb = new byte[1 << 16];
                int read;
                while ((read = sa.Read(ba, 0, ba.Length)) > 0)
                {
                    var offset = 0;
                    while (offset < read)
                    {
                        var got = sb.Read(bb, offset, read - offset);
                        if (got == 0) return false;
                        offset += got;
                    }
                    for (var i = 0; i < read; i++)
                        if (ba[i] != bb[i]) return false;
                }
                return true;
            }
            catch (IOException)
            {
                return false;
            }
        }
    }

    public class ModsFolderAttribute : PropertyAttribute { }

    [CustomPropertyDrawer(typeof(ModsFolderAttribute))]
    public class ModsFolderDrawer : PropertyDrawer
    {
        private const float ButtonWidth = 70f;

        private static string Note(string value, out MessageType type)
        {
            if (!ModInstaller.TryResolve(value, out var mods, out var game, out var error))
            {
                type = MessageType.Warning;
                return error;
            }
            type = MessageType.None;
            return $"Server mod → {mods}\nClient plugin → {Path.Combine(game, "BepInEx", "plugins")}";
        }

        public override float GetPropertyHeight(SerializedProperty property, GUIContent label) =>
            EditorGUIUtility.singleLineHeight + 2 + EditorGUIUtility.singleLineHeight * 2 + 8;

        public override void OnGUI(Rect position, SerializedProperty property, GUIContent label)
        {
            var line = new Rect(position.x, position.y, position.width, EditorGUIUtility.singleLineHeight);
            EditorGUI.BeginProperty(line, label, property);
            var field = new Rect(line.x, line.y, line.width - ButtonWidth - 4, line.height);
            property.stringValue = EditorGUI.TextField(field, label, property.stringValue);
            if (GUI.Button(new Rect(field.xMax + 4, line.y, ButtonWidth, line.height), "Browse…"))
            {
                var start = Directory.Exists(property.stringValue) ? property.stringValue : "";
                var picked = EditorUtility.OpenFolderPanel("SPT mods folder (<game>\\SPT_Runtime\\user\\mods)", start, "");
                if (!string.IsNullOrEmpty(picked))
                {
                    property.stringValue = picked.Replace('/', Path.DirectorySeparatorChar);
                    property.serializedObject.ApplyModifiedProperties();
                }
                GUIUtility.ExitGUI();
            }
            EditorGUI.EndProperty();

            var note = new Rect(position.x, line.yMax + 2, position.width, EditorGUIUtility.singleLineHeight * 2 + 6);
            EditorGUI.indentLevel++;
            EditorGUI.HelpBox(EditorGUI.IndentedRect(note), Note(property.stringValue, out var type), type);
            EditorGUI.indentLevel--;
        }
    }
}
