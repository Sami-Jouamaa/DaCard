using System.Linq;
using UnityEditor;
using UnityEngine;

namespace DaCard.Editor
{
    public class CardAssetWatcher : AssetPostprocessor
    {
        private const string PrefKey = "DaCard.AutoBuild";
        private const string MenuPath = "DaCard/Auto Build Bundle On Change";
        private static bool _scheduled;

        private static bool Enabled
        {
            get => EditorPrefs.GetBool(PrefKey, true);
            set => EditorPrefs.SetBool(PrefKey, value);
        }

        [MenuItem(MenuPath)]
        private static void Toggle() => Enabled = !Enabled;

        [MenuItem(MenuPath, true)]
        private static bool ToggleValidate()
        {
            Menu.SetChecked(MenuPath, Enabled);
            return true;
        }

        private static void OnPostprocessAllAssets(string[] imported, string[] deleted, string[] moved, string[] movedFrom)
        {
            if (!Enabled || _scheduled || CardBundleBuilder.IsBuilding || Application.isBatchMode)
                return;

            var watched = AssetDatabase.GetDependencies(CardPaths.Settings, true)
                .Concat(AssetDatabase.GetDependencies(CardPaths.Layout, true))
                .Append(CardPaths.Settings)
                .Append(CardPaths.Layout)
                .Append(CardPaths.TextShader)
                .Append(CardPaths.EdgeShader)
                .Append(CardPaths.GlowShader)
                .Append(CardPaths.Model)
                .Where(p => !p.EndsWith(".cs") && !p.StartsWith(CardPaths.Generated) && !p.StartsWith(CardPaths.PrefabsDir))
                .ToHashSet();

            var changed = imported.Concat(moved).FirstOrDefault(p =>
                watched.Contains(p) || (p.EndsWith(".shader") && p.Contains("_Icon"))
                || p == BinderBuilder.Model || p == BinderBuilder.Material || p.StartsWith(BinderBuilder.TexturesDir + "/")
                || p == BinderBuilder.StickerShader || p == BinderBuilder.BinderShader
                || p == PackBuilder.Model || p == PackBuilder.Material || p.StartsWith(PackBuilder.TexturesDir + "/") || p == PackBuilder.PackShader);
            if (changed == null)
                return;

            _scheduled = true;
            Debug.Log($"[DaCard] {changed} changed, rebuilding the card bundle...");
            EditorApplication.delayCall += () =>
            {
                _scheduled = false;
                CardBundleBuilder.BuildBundle();
            };
        }
    }
}
