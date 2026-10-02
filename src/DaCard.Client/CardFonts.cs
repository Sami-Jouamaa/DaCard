using System;
using System.Collections.Generic;
using System.Reflection;
using TMPro;
using UnityEngine;

namespace DaCard.Client
{
    internal static class CardFonts
    {
        private static readonly Dictionary<string, TMP_FontAsset> Assets = new Dictionary<string, TMP_FontAsset>();
        private static readonly Dictionary<int, (TMP_FontAsset Font, Material Material)> Defaults = new Dictionary<int, (TMP_FontAsset, Material)>();
        public static void Use(TMP_Text text, string id)
        {
            var key = text.GetInstanceID();
            if (!Defaults.TryGetValue(key, out var original))
                Defaults[key] = original = (text.font, text.fontSharedMaterial);
            var font = string.IsNullOrEmpty(id) ? null : Asset(id, original.Font, original.Material);
            if (font != null)
            {
                if (text.font != font)
                    text.font = font;
                return;
            }
            if (text.font != original.Font)
            {
                text.font = original.Font;
                text.fontSharedMaterial = original.Material;
            }
        }

        public static TMP_FontAsset Asset(string id, TMP_FontAsset fallback, Material template)
        {
            if (Assets.TryGetValue(id, out var asset))
                return asset;
            Assets[id] = null;
            try
            {
                var path = CardCache.LocalFile(id);
                if (path == null)
                {
                    Plugin.Log.LogWarning($"The server has no font {id}");
                    return null;
                }
                asset = Create(id, path, fallback, template);
                Assets[id] = asset;
                return asset;
            }
            catch (Exception e)
            {
                Plugin.Log.LogError($"Could not load the font {id}: {e.Message}");
                return null;
            }
        }

        private static TMP_FontAsset Create(string id, string path, TMP_FontAsset fallback, Material template)
        {
            var font = new Font(path) { name = id };
            var sdfShader = typeof(ShaderUtilities).GetField("k_ShaderRef_MobileSDF", BindingFlags.NonPublic | BindingFlags.Static);
            if (sdfShader != null && sdfShader.GetValue(null) == null && template != null && Shader.Find("TextMeshPro/Mobile/Distance Field") == null)
                sdfShader.SetValue(null, template.shader);

            var asset = TMP_FontAsset.CreateFontAsset(font);
            if (asset == null)
                throw new Exception("TextMeshPro could not read it (TTF or OTF fonts work)");
            asset.name = "DaCard " + id;
            if (template != null)
            {
                var material = new Material(template) { name = asset.name + " Material" };
                material.SetTexture(ShaderUtilities.ID_MainTex, asset.atlasTexture);
                material.SetFloat(ShaderUtilities.ID_TextureWidth, asset.atlasWidth);
                material.SetFloat(ShaderUtilities.ID_TextureHeight, asset.atlasHeight);
                material.SetFloat(ShaderUtilities.ID_GradientScale, asset.atlasPadding + 1);
                asset.material = material;
            }
            if (fallback != null)
                asset.fallbackFontAssetTable = new List<TMP_FontAsset> { fallback };
            return asset;
        }
    }
}
