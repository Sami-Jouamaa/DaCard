using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using SPT.Common.Http;
using TMPro;
using UnityEngine;

namespace DaCard.Client
{
    internal static class CardRegistry
    {
        public static readonly string[] Rarities = { "Common", "Uncommon", "Rare", "Epic", "Legendary" };


        private static readonly Dictionary<string, CardManifestEntry> Cards = new Dictionary<string, CardManifestEntry>();
        private static readonly Dictionary<string, BinderManifestEntry> Binders = new Dictionary<string, BinderManifestEntry>();
        private static readonly Dictionary<string, string> StickerArt = new Dictionary<string, string>();
        private static readonly Dictionary<string, Sprite> StickerSprites = new Dictionary<string, Sprite>();

        private const string StickerObject = "sticker";
        private static readonly Dictionary<string, string> FoilToBase = new Dictionary<string, string>();
        private static readonly Dictionary<string, string> Versions = new Dictionary<string, string>();
        private static readonly Dictionary<string, Texture2D> Textures = new Dictionary<string, Texture2D>();

        private static readonly Dictionary<(Material, string), Material> Materials = new Dictionary<(Material, string), Material>();
        private static readonly Dictionary<Material, Material> CopyToBase = new Dictionary<Material, Material>();

        private static readonly HashSet<int> CardModels = new HashSet<int>();

        private static string _backProperty = "_CARD_BACK";
        private static string _overlayProperty = "_CARD_FRONT_BORDER";
        private static List<TextureSlot> _slots = new List<TextureSlot>();

        private static readonly HashSet<string> CardTpls = new HashSet<string>();
        private static int _baseCards;

        public static int Count => _baseCards;

        public static void Load()
        {
            ClientIndex index;
            try
            {
                index = JsonConvert.DeserializeObject<ClientIndex>(RequestHandler.GetJson("/dacard/index"));
            }
            catch (Exception e)
            {
                Plugin.Log.LogError("Could not get the card list from the server (is the DaCard server mod installed?): " + e.Message);
                return;
            }

            if (index?.Cards == null)
                return;
            CardCache.Init();

            if (!string.IsNullOrEmpty(index.BackProperty))
                _backProperty = index.BackProperty;
            if (!string.IsNullOrEmpty(index.OverlayProperty))
                _overlayProperty = index.OverlayProperty;
            _slots = index.Slots ?? new List<TextureSlot>();
            foreach (var tpl in index.Cards)
                CardTpls.Add(tpl);
            _baseCards = index.Cards.Count;
            foreach (var pair in index.Foils ?? new Dictionary<string, string>())
            {
                CardTpls.Add(pair.Key);
                FoilToBase[pair.Key] = pair.Value;
            }
            foreach (var pair in index.Versions ?? new Dictionary<string, string>())
                Versions[pair.Key] = pair.Value;
            foreach (var pair in index.Stickers ?? new Dictionary<string, string>())
                StickerArt[pair.Key] = pair.Value;
            foreach (var binder in index.Binders ?? new List<BinderManifestEntry>())
                Binders[binder.Tpl] = binder;
            PackRegistry.Load(index);
            CardCache.Sync(index);
        }

        public static bool IsLinear(string property) => _slots.FirstOrDefault(s => s.Property == property)?.Linear ?? false;

        public static bool IsCard(string templateId) => templateId != null && CardTpls.Contains(templateId);

        public static CardManifestEntry Card(string templateId)
        {
            if (!IsCard(templateId))
                return null;
            if (Cards.TryGetValue(templateId, out var cached))
                return cached;
            var card = FoilToBase.TryGetValue(templateId, out var baseTpl) ? Card(baseTpl)?.AsFoil(templateId) : Download(templateId);
            Cards[templateId] = card;
            return card;
        }

        private static CardManifestEntry Download(string templateId)
        {
            var version = Versions.TryGetValue(templateId, out var v) ? v : null;
            var card = CardCache.ReadCard(templateId, version);
            if (card != null)
                return card;
            try
            {
                var json = RequestHandler.GetJson("/dacard/card/" + templateId);
                card = JsonConvert.DeserializeObject<CardManifestEntry>(json);
                if (card != null)
                    CardCache.WriteCard(templateId, version, json);
            }
            catch (Exception e)
            {
                Plugin.Log.LogError($"Could not get card {templateId} from the server: {e.Message}");
            }
            return card;
        }

        public static bool IsBinder(string templateId) => templateId != null && Binders.ContainsKey(templateId);

        public static bool IsSticker(string templateId) => templateId != null && StickerArt.ContainsKey(templateId);

        public static bool CanRoll(string cardTpl, string stickerTpl)
        {
            var card = Card(cardTpl);
            return card != null && (card.Front ?? new List<CardLayer>()).Concat(card.Back ?? new List<CardLayer>())
                .Any(l => l != null && l.Sticker == stickerTpl && l.Chance > 0);
        }

        public static Sprite StickerSprite(string templateId)
        {
            if (StickerSprites.TryGetValue(templateId, out var cached) && cached != null)
                return cached;
            var url = StickerArt.TryGetValue(templateId, out var art) ? art : null;
            var texture = url != null ? GetTexture(url, linear: false) : null;
            if (texture == null)
                return EmptyLayerSlotSprite();
            var sprite = Sprite.Create(texture, new Rect(0, 0, texture.width, texture.height), new Vector2(0.5f, 0.5f), 100f);
            sprite.name = "dacard sticker " + templateId;
            sprite.hideFlags = HideFlags.DontUnloadUnusedAsset;
            StickerSprites[templateId] = sprite;
            return sprite;
        }

        private static readonly Dictionary<string, Sprite> SlotSprites = new Dictionary<string, Sprite>();

        public static Sprite EmptySlotSprite() => SlotSprite("card_slot");

        public static Sprite EmptyLayerSlotSprite() => SlotSprite("layer_slot");

        private static Sprite SlotSprite(string name)
        {
            if (SlotSprites.TryGetValue(name, out var cached) && cached != null)
                return cached;
            using (var stream = typeof(CardRegistry).Assembly.GetManifestResourceStream($"DaCard.{name}.png"))
            {
                if (stream == null)
                {
                    Plugin.Log.LogError($"Embedded {name}.png is missing");
                    return null;
                }
                var bytes = new byte[stream.Length];
                stream.Read(bytes, 0, bytes.Length);
                var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false) { name = name, hideFlags = HideFlags.DontUnloadUnusedAsset };
                texture.LoadImage(bytes, markNonReadable: true);
                var sprite = Sprite.Create(texture, new Rect(0, 0, texture.width, texture.height), new Vector2(0.5f, 0.5f), 100f);
                sprite.name = name;
                sprite.hideFlags = HideFlags.DontUnloadUnusedAsset;
                SlotSprites[name] = sprite;
                return sprite;
            }
        }

        public static void ApplyBinder(GameObject model, string templateId)
        {
            if (!Binders.TryGetValue(templateId, out var binder))
                return;

            CardModels.Add(model.GetInstanceID());
            var renderers = model.GetComponentsInChildren<Renderer>(true);
            var template = renderers.FirstOrDefault(r => r.name == StickerObject);
            if (template == null)
                return;
            var layers = new List<Renderer> { template };
            for (var i = 1; ; i++)
            {
                var copy = renderers.FirstOrDefault(r => r.name == StickerObject + "_layer" + i);
                if (copy == null) break;
                layers.Add(copy);
            }

            var stickers = binder.Stickers ?? new List<BinderSticker>();
            for (var i = 0; i < Math.Max(stickers.Count, layers.Count); i++)
            {
                var texture = i < stickers.Count && stickers[i]?.Image != null ? GetTexture(stickers[i].Image, linear: false) : null;
                if (texture == null)
                {
                    if (i < layers.Count) layers[i].enabled = false;
                    continue;
                }
                if (i >= layers.Count)
                    layers.Add(AddLayer(template, i));
                var renderer = layers[i];
                renderer.enabled = true;

                var current = renderer.sharedMaterial;
                var bundleMaterial = CopyToBase.TryGetValue(current, out var b) && b != null ? b : current;
                var key = templateId + "#" + i;
                if (!Materials.TryGetValue((bundleMaterial, key), out var material) || material == null)
                {
                    var p = stickers[i].Placement ?? new StickerPlacement();
                    material = new Material(bundleMaterial) { name = bundleMaterial.name + "_" + templateId + "_" + i, hideFlags = HideFlags.DontUnloadUnusedAsset };
                    material.SetTexture("_MainTex", texture);
                    material.SetVector("_StickerCenter", new Vector4(p.X, 1 - p.Y, 0, 0));
                    material.SetVector("_StickerSize", new Vector4(p.Width, p.Height, 0, 0));
                    material.SetFloat("_StickerAngle", p.Rotation);
                    material.SetFloat("_OffsetUnits", -1 - 4 * i);
                    material.renderQueue = bundleMaterial.renderQueue + i;
                    Materials[(bundleMaterial, key)] = material;
                    CopyToBase[material] = bundleMaterial;
                }
                renderer.sharedMaterial = material;
            }
        }

        private static Renderer AddLayer(Renderer template, int index)
        {
            var copy = UnityEngine.Object.Instantiate(template.gameObject, template.transform.parent, false);
            copy.name = StickerObject + "_layer" + index;
            return copy.GetComponent<Renderer>();
        }

        public static bool IsCardModel(GameObject model) => model != null && CardModels.Contains(model.GetInstanceID());

        public static void Apply(GameObject model, string templateId, string cardName, string itemId, ICollection<string> stickers)
        {
            var card = Card(templateId);
            if (card == null)
                return;

            CardModels.Add(model.GetInstanceID());

            CardText.Apply(model, card, cardName);

            CardLayers.TakeCompositeShader(model);
            var variant = CardLayers.Variant(card, stickers, out var front, out var back);
            var stack = CardLayers.Get(card, front, back, variant, model);

            foreach (var renderer in model.GetComponentsInChildren<Renderer>(true))
            {
                if (renderer.GetComponent<TMP_Text>() != null || CardLayers.IsCompositeHolder(renderer) || CardGlow.IsGlow(renderer))
                    continue;

                var materials = renderer.sharedMaterials;
                for (var i = 0; i < materials.Length; i++)
                {
                    var current = materials[i];
                    if (current == null || IsEdge(current))
                        continue;

                    var bundleMaterial = CopyToBase.TryGetValue(current, out var b) && b != null ? b : current;
                    materials[i] = GetMaterial(card, bundleMaterial, variant, stack);
                }
                renderer.sharedMaterials = materials;
                foreach (var material in materials)
                    if (material != null && !IsEdge(material))
                        CardAnimator.Attach(card, material, model);
            }

            CardGlow.Apply(model, card, itemId);
        }

        private const string EdgeShader = "DaCard/Card Edge";

        private static bool IsEdge(Material material) => material.shader != null && material.shader.name == EdgeShader;

        // One material per card copy variant (the layers it rolled)
        private static Material GetMaterial(CardManifestEntry card, Material bundleMaterial, string variant, CardLayers.Stack stack)
        {
            if (Materials.TryGetValue((bundleMaterial, variant), out var material) && material != null)
                return material;

            PurgeUnloaded();

            material = new Material(bundleMaterial)
            {
                name = bundleMaterial.name + "_" + card.Tpl,
                hideFlags = HideFlags.DontUnloadUnusedAsset
            };

            // card.png and its maps: a 3D card's picture behind the window. Other cards have none: all their pictures are layers.
            var picture = _slots.FirstOrDefault(s => s.Suffix == "");
            var noPicture = picture == null || !card.Textures.ContainsKey(picture.Property);
            foreach (var slot in _slots)
            {
                var own = card.Textures.TryGetValue(slot.Property, out var url);
                var texture = own
                    ? GetTexture(url, slot.Linear)
                    : noPicture && slot.Suffix == "" ? ClearTexture
                    : noPicture && slot.Suffix == "foil" ? Texture2D.blackTexture
                    : DefaultTexture(slot.Default);
                if (texture != null)
                    material.SetTexture(slot.Property, texture);
                if (!string.IsNullOrEmpty(slot.Flag))
                    material.SetFloat(slot.Flag, own && texture != null ? 1f : 0f);
            }

            if (stack != null)
                CardLayers.Apply(material, stack, _overlayProperty, _backProperty);
            else if (material.HasProperty(_overlayProperty))
                material.SetTexture(_overlayProperty, ClearTexture);

            material.SetFloat("_HoloStrength", card.HoloStrength);
            material.SetFloat("_HoloPattern", card.HoloPattern);
            material.SetFloat("_GratingAngle", card.HoloAngle);
            if (!card.Foil)
                material.SetFloat("_FoilStrength", 0f);
            material.SetFloat("_CardRarity", Math.Max(0, Array.IndexOf(Rarities, card.Rarity)));
            if (card.RarityColor != null && ColorUtility.TryParseHtmlString(card.RarityColor, out var rarityColor))
                material.SetColor("_RarityColor", rarityColor);

            if (card.Floats != null)
                foreach (var pair in card.Floats)
                    material.SetFloat(pair.Key, pair.Value);

            Materials[(bundleMaterial, variant)] = material;
            CopyToBase[material] = bundleMaterial;
            return material;
        }


        private static void PurgeUnloaded()
        {
            foreach (var key in Materials.Keys.Where(k => k.Item1 == null).ToList())
            {
                var copy = Materials[key];
                Materials.Remove(key);
                if (copy != null)
                {
                    CopyToBase.Remove(copy);
                    UnityEngine.Object.Destroy(copy);
                }
            }
        }

        private static Texture2D _clearTexture;

        private static Texture2D ClearTexture
        {
            get
            {
                if (_clearTexture != null)
                    return _clearTexture;
                _clearTexture = new Texture2D(1, 1, TextureFormat.RGBA32, false) { name = "dacard_clear", hideFlags = HideFlags.DontUnloadUnusedAsset };
                _clearTexture.SetPixel(0, 0, new Color(0, 0, 0, 0));
                _clearTexture.Apply(false, true);
                return _clearTexture;
            }
        }

        private static Texture2D DefaultTexture(string name)
        {
            switch (name?.ToLowerInvariant())
            {
                case "black": return Texture2D.blackTexture;
                case "white": return Texture2D.whiteTexture;
                case "gray":
                case "grey": return Texture2D.grayTexture;
                case "bump":
                case "normal": return Texture2D.normalTexture;
                default: return null;
            }
        }

        public static byte[] ImageData(string url)
        {
            var bytes = CardCache.Data(url);
            if (bytes == null || bytes.Length == 0)
            {
                Plugin.Log.LogError("No image data for " + url);
                return null;
            }
            return bytes;
        }

        public static Texture2D GetTexture(string url, bool linear)
        {
            if (Textures.TryGetValue(url, out var texture) && texture != null)
                return texture;

            var bytes = ImageData(url);
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

            if (!texture.LoadImage(bytes, markNonReadable: true))
            {
                Plugin.Log.LogError("Not a valid PNG: " + url);
                CardCache.Forget(url);
                UnityEngine.Object.Destroy(texture);
                return null;
            }

            Textures[url] = texture;
            return texture;
        }
    }
}
