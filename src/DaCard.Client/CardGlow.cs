using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using UnityEngine;

namespace DaCard.Client
{
    internal static class CardGlow
    {
        public const string GlowObject = "card_glow";

        private static readonly int SeedId = Shader.PropertyToID("_Seed");

        private static readonly Dictionary<(Material, string), Material> Materials = new Dictionary<(Material, string), Material>();
        private static readonly Dictionary<Material, Material> CopyToBase = new Dictionary<Material, Material>();

        public static bool IsGlow(Renderer renderer) => renderer.name == GlowObject;

        public static void Apply(GameObject model, CardManifestEntry card, string itemId)
        {
            var glow = card.Glow;
            foreach (var renderer in model.GetComponentsInChildren<Renderer>(true).Where(IsGlow))
            {
                var current = renderer.sharedMaterial;
                var bundleMaterial = current != null && CopyToBase.TryGetValue(current, out var b) && b != null ? b : current;
                var on = glow != null && glow.Strength > 0 && bundleMaterial != null && bundleMaterial.shader != null && bundleMaterial.shader.isSupported;
                renderer.enabled = on;
                if (!on)
                    continue;

                // The copy's seed (where its stars and sparkles are) is on its material: a property block would be lost
                // whenever the game sets its own on the renderer (item highlighting...), making the pattern jump
                renderer.sharedMaterial = GetMaterial(bundleMaterial, glow, CardLayers.Hash(itemId ?? card.Tpl) % 1000);
            }
        }

        public static void Hide(GameObject model)
        {
            foreach (var renderer in model.GetComponentsInChildren<Renderer>(true).Where(IsGlow))
                renderer.enabled = false;
        }

        private static Material GetMaterial(Material bundleMaterial, CardGlowSettings glow, uint seed)
        {
            var key = string.Join("|", new[] { glow.Strength, glow.Line, glow.Halo, glow.Sparkles, glow.Flares, glow.Smoke, glow.Rays, glow.Drip, glow.Speed }
                .Select(v => v.ToString(CultureInfo.InvariantCulture)).Append(glow.Color).Append(glow.Color2).Append(seed.ToString()));
            if (Materials.TryGetValue((bundleMaterial, key), out var material) && material != null)
                return material;

            foreach (var stale in Materials.Keys.Where(k => k.Item1 == null).ToList())
            {
                if (Materials[stale] != null)
                {
                    CopyToBase.Remove(Materials[stale]);
                    Object.Destroy(Materials[stale]);
                }
                Materials.Remove(stale);
            }

            material = new Material(bundleMaterial) { name = bundleMaterial.name + "_" + key, hideFlags = HideFlags.DontUnloadUnusedAsset };
            var color = ColorUtility.TryParseHtmlString(glow.Color, out var c1) ? c1 : Color.white;
            material.SetColor("_Color", color);
            material.SetColor("_Color2", ColorUtility.TryParseHtmlString(glow.Color2, out var c2) ? c2 : color);
            material.SetFloat("_Strength", glow.Strength);
            material.SetFloat("_Line", glow.Line);
            material.SetFloat("_Halo", glow.Halo);
            material.SetFloat("_Sparkles", glow.Sparkles);
            material.SetFloat("_Flares", glow.Flares);
            material.SetFloat("_Smoke", glow.Smoke);
            material.SetFloat("_Rays", glow.Rays);
            material.SetFloat("_Drip", glow.Drip);
            material.SetFloat("_Speed", glow.Speed);
            material.SetFloat(SeedId, seed / 1000f);
            Materials[(bundleMaterial, key)] = material;
            CopyToBase[material] = bundleMaterial;
            return material;
        }
    }
}
