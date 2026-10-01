using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace DaCard.Editor
{
    public static class CardFaceTextures
    {
        private const string BackProperty = "_CARD_BACK";
        private const string ConvertedSuffix = "_card";

        [MenuItem("DaCard/Convert Card Backs To Card Layout")]
        public static void ConvertBacks()
        {
            var mesh = AssetDatabase.LoadAllAssetsAtPath(CardPaths.Model).OfType<Mesh>().FirstOrDefault()
                       ?? throw new InvalidOperationException("No mesh in " + CardPaths.Model);
            var rect = CardBundleBuilder.FaceRect(mesh, -1);

            var done = 0;
            foreach (var type in CardBuildSettings.LoadOrCreate().ValidTypes())
            {
                var material = type.material;
                if (!material.HasProperty(BackProperty) || !(material.GetTexture(BackProperty) is Texture2D source))
                {
                    Debug.Log($"[DaCard] {type.type}: '{material.name}' has no {BackProperty} texture, nothing to convert.");
                    continue;
                }
                var sourcePath = AssetDatabase.GetAssetPath(source);
                if (Path.GetFileNameWithoutExtension(sourcePath).EndsWith(ConvertedSuffix))
                {
                    Debug.Log($"[DaCard] {type.type}: {sourcePath} is already in the card layout.");
                    continue;
                }

                var target = Path.Combine(Path.GetDirectoryName(sourcePath)!, Path.GetFileNameWithoutExtension(sourcePath) + ConvertedSuffix + ".png").Replace('\\', '/');
                if (!File.Exists(target))
                {
                    var rt = RenderTexture.GetTemporary(490, 684, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
                    var previous = RenderTexture.active;
                    try
                    {
                        Graphics.Blit(source, rt, new Vector2(rect.z, rect.w), new Vector2(rect.x, rect.y));
                        RenderTexture.active = rt;
                        var image = new Texture2D(490, 684, TextureFormat.RGBA32, false);
                        image.ReadPixels(new Rect(0, 0, 490, 684), 0, 0);
                        image.Apply();
                        File.WriteAllBytes(target, image.EncodeToPNG());
                        UnityEngine.Object.DestroyImmediate(image);
                    }
                    finally
                    {
                        RenderTexture.active = previous;
                        RenderTexture.ReleaseTemporary(rt);
                    }
                    AssetDatabase.ImportAsset(target);
                }

                Undo.RecordObject(material, "Card back in card layout");
                material.SetTexture(BackProperty, AssetDatabase.LoadAssetAtPath<Texture2D>(target));
                EditorUtility.SetDirty(material);
                done++;
                Debug.Log($"[DaCard] {type.type}: {BackProperty} of '{material.name}' is now {target} (from {sourcePath}).");
            }
            AssetDatabase.SaveAssets();
            if (done > 0)
                Debug.Log("[DaCard] Card backs converted. The shaders must sample " + BackProperty + " with UV0 (like the overlay).");
        }

        public static void ExportForCreator()
        {
            var material = CardBuildSettings.LoadOrCreate().ValidTypes().Select(t => t.material).FirstOrDefault();
            if (material == null)
                return;
            var dirs = new[] { Path.Combine(CardPaths.RepoRoot, "src", "DaCard.Dashboard", "web", "creator"), CardBundleBuilder.GameModDir() is { } mod ? Path.Combine(mod, "dashboard", "web", "creator") : null };
            foreach (var (property, file) in new[] { (BackProperty, "card_back.png") })
            {
                var texture = material.HasProperty(property) ? material.GetTexture(property) : null;
                var path = texture != null ? AssetDatabase.GetAssetPath(texture) : null;
                if (string.IsNullOrEmpty(path) || !path.EndsWith(".png", StringComparison.OrdinalIgnoreCase)
                    || !Path.GetFileNameWithoutExtension(path).EndsWith(ConvertedSuffix))
                    continue;
                foreach (var dir in dirs.Where(d => d != null))
                {
                    Directory.CreateDirectory(dir);
                    File.Copy(path, Path.Combine(dir, file), overwrite: true);
                }
            }
        }
    }
}
