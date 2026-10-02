using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace DaCard.Client
{
    internal static class PackRegistry
    {
        private static readonly Dictionary<string, PackManifestEntry> Packs = new Dictionary<string, PackManifestEntry>();
        private static readonly HashSet<string> LinearProperties = new HashSet<string> { "_BumpMap", "_MetallicMap", "_RoughnessMap", "_OcclusionMap" };
        private static readonly Dictionary<string, Texture2D> Textures = new Dictionary<string, Texture2D>();
        private static readonly Dictionary<(Material, string), Material> Materials = new Dictionary<(Material, string), Material>();
        private static readonly Dictionary<Material, Material> CopyToBase = new Dictionary<Material, Material>();
        private static readonly HashSet<int> Models = new HashSet<int>();

        public static void Load(ClientIndex manifest)
        {
            foreach (var pack in manifest.Packs ?? new List<PackManifestEntry>())
            {
                if (pack?.Tpl == null)
                    continue;
                Packs[pack.Tpl] = pack;
            }
            if (Packs.Count > 0)
                Plugin.Log.LogInfo($"{Packs.Count} booster pack(s) from the server");
        }

        public static bool IsPack(string templateId) => templateId != null && Packs.ContainsKey(templateId);

        public static int CardCount(string templateId) => templateId != null && Packs.TryGetValue(templateId, out var pack) ? System.Math.Max(1, pack.CardCount) : 0;

        public static bool IsPackModel(GameObject model) => model != null && Models.Contains(model.GetInstanceID());

        public static void Apply(GameObject model, string templateId)
        {
            if (!Packs.TryGetValue(templateId, out var pack))
                return;
            Models.Add(model.GetInstanceID());
            if (pack.Textures == null || pack.Textures.Count == 0)
                return;

            foreach (var renderer in model.GetComponentsInChildren<Renderer>(true))
            {
                var materials = renderer.sharedMaterials;
                for (var i = 0; i < materials.Length; i++)
                {
                    var current = materials[i];
                    if (current == null)
                        continue;
                    var bundleMaterial = CopyToBase.TryGetValue(current, out var b) && b != null ? b : current;
                    materials[i] = GetMaterial(pack, bundleMaterial);
                }
                renderer.sharedMaterials = materials;
            }
        }

        private static Material GetMaterial(PackManifestEntry pack, Material bundleMaterial)
        {
            if (Materials.TryGetValue((bundleMaterial, pack.Tpl), out var material) && material != null)
                return material;

            foreach (var key in Materials.Keys.Where(k => k.Item1 == null).ToList())
            {
                var stale = Materials[key];
                Materials.Remove(key);
                if (stale != null)
                {
                    CopyToBase.Remove(stale);
                    Object.Destroy(stale);
                }
            }

            material = new Material(bundleMaterial) { name = bundleMaterial.name + "_" + pack.Tpl, hideFlags = HideFlags.DontUnloadUnusedAsset };
            foreach (var pair in pack.Textures)
            {
                if (!material.HasProperty(pair.Key))
                    continue;
                var texture = GetTexture(pair.Value, LinearProperties.Contains(pair.Key));
                if (texture != null)
                    material.SetTexture(pair.Key, texture);
            }
            Materials[(bundleMaterial, pack.Tpl)] = material;
            CopyToBase[material] = bundleMaterial;
            return material;
        }

        private static Texture2D GetTexture(string url, bool linear)
        {
            var key = url + (linear ? "#linear" : "");
            if (Textures.TryGetValue(key, out var texture) && texture != null)
                return texture;

            var bytes = CardRegistry.ImageData(url);
            if (bytes == null)
                return null;

            texture = new Texture2D(2, 2, TextureFormat.RGBA32, true, linear)
            {
                name = url,
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Trilinear,
                anisoLevel = 4,
                hideFlags = HideFlags.DontUnloadUnusedAsset
            };
            if (!texture.LoadImage(bytes, markNonReadable: false))
            {
                Plugin.Log.LogError("Not a valid PNG: " + url);
                CardCache.Forget(url);
                Object.Destroy(texture);
                return null;
            }
            if (texture.width % 4 == 0 && texture.height % 4 == 0)
                texture.Compress(true);
            texture.Apply(false, true);

            Textures[key] = texture;
            return texture;
        }
    }
}
