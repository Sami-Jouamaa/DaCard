using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading.Tasks;
using Newtonsoft.Json;
using SPT.Common.Http;
using TMPro;
using UnityEngine;

namespace DaCard.Client
{
    internal static class CardFonts
    {
        private static readonly Dictionary<string, TMP_FontAsset> Assets = new Dictionary<string, TMP_FontAsset>();
        private static readonly Dictionary<int, (TMP_FontAsset Font, Material Material)> Defaults = new Dictionary<int, (TMP_FontAsset, Material)>();
        private static Task<Dictionary<string, string>> _files;

        public static void Prefetch()
        {
            _files = Task.Run(() => JsonConvert.DeserializeObject<Dictionary<string, string>>(RequestHandler.GetJson("/dacard/fonts"))
                                    ?? new Dictionary<string, string>());
        }

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
                if (_files == null)
                    Prefetch();
                if (!_files.Result.TryGetValue(id, out var data))
                {
                    Plugin.Log.LogWarning($"The server has no font {id}");
                    return null;
                }
                asset = Create(id, Convert.FromBase64String(data), fallback, template);
                Assets[id] = asset;
                return asset;
            }
            catch (Exception e)
            {
                Plugin.Log.LogError($"Could not load the font {id}: {e.Message}");
                return null;
            }
        }

        private static TMP_FontAsset Create(string id, byte[] bytes, TMP_FontAsset fallback, Material template)
        {
            string hash;
            using (var sha = SHA1.Create())
                hash = BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
            var dir = Path.Combine(BepInEx.Paths.CachePath, "DaCard", "fonts");
            Directory.CreateDirectory(dir);
            var path = Path.Combine(dir, hash + ".font");
            if (!File.Exists(path))
                File.WriteAllBytes(path, bytes);

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
