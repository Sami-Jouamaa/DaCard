using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace DaCard.Client
{
    internal static class LayerMaps
    {
        public const string Albedo = "art", Normal = "normal", Roughness = "roughness", Metallic = "metallic", Mask = "mask";
    }

    internal static class CardLayers
    {
        public const string CompositeObject = "layer_composite";
        public const string LayerFoil = "_LayerFoil", LayerNormal = "_LayerNormal", BackFoil = "_BackFoil", BackNormal = "_BackNormal";

        private const float ReleaseAfterSeconds = 30f;
        // Stacks at 1.5x the card's 490 x 684: layers are placed, scaled and turned on it
        private const int StackWidth = 735, StackHeight = 1026;
        private const int ColorPass = 0, SurfacePass = 1, NormalPass = 2;
        private const float FallbackRoughness = 0.3f;
        private static readonly int RoughnessId = Shader.PropertyToID("_Roughness");
        private static readonly Color NoColor = new Color(0, 0, 0, 0), Flat = new Color(0.5f, 0.5f, 1f, 1f);

        internal class Stack
        {
            public string Key;
            public CardManifestEntry Card;
            public List<int> Front, Back;
            public float Roughness = FallbackRoughness;
            public RenderTexture FrontColor, FrontFoil, FrontNormal, BackColor, BackFoil, BackNormal;
            public readonly List<GameObject> Models = new List<GameObject>();
            public readonly Dictionary<string, RenderTexture> Texts = new Dictionary<string, RenderTexture>();
            public float LastSeen;
            public bool Dirty = true;
            // Idle: its textures' GPU memory is freed (the objects stay: the game may still draw a model that uses them)
            public bool Idle;

            public IEnumerable<RenderTexture> Textures => new[] { FrontColor, FrontFoil, FrontNormal, BackColor, BackFoil, BackNormal };
        }

        private static readonly Dictionary<string, Stack> Stacks = new Dictionary<string, Stack>();
        private static Material _composite;
        private static bool _warned;
        private static float _nextPurge;

        public static bool IsCompositeHolder(Renderer renderer) => renderer.name == CompositeObject;

        // Every card prefab carries the stacking shader on a disabled renderer
        public static void TakeCompositeShader(GameObject model)
        {
            var holder = model.GetComponentsInChildren<Renderer>(true).FirstOrDefault(IsCompositeHolder);
            if (holder == null)
                return;
            holder.enabled = false;
            var shader = holder.sharedMaterial != null ? holder.sharedMaterial.shader : null;
            if (shader == null || !shader.isSupported)
                return;
            if (_composite == null)
                _composite = new Material(shader) { name = "dacard_layer_composite", hideFlags = HideFlags.DontUnloadUnusedAsset };
            else if (_composite.shader == null || _composite.shader.name != shader.name || !_composite.shader.isSupported)
            {
                Plugin.Log.LogInfo($"Card layer shader was gone ({(_composite.shader == null ? "unloaded" : _composite.shader.name)}): taken again from {model.name}");
                _composite.shader = shader;
            }
        }

        public static string TrackKey(string side, int index, string map) => side + ":" + index + ":" + map;

        public static string Variant(CardManifestEntry card, ICollection<string> stickers, out List<int> front, out List<int> back)
        {
            front = Shown(card.Front, stickers);
            back = Shown(card.Back, stickers);
            return card.Tpl + "|" + string.Join(",", front) + "|" + string.Join(",", back);
        }

        private static List<int> Shown(List<CardLayer> layers, ICollection<string> stickers)
        {
            var shown = new List<int>();
            for (var i = 0; i < (layers?.Count ?? 0); i++)
            {
                var layer = layers[i];
                if (layer != null && (layer.Chance >= 100 || (layer.Sticker != null && stickers.Contains(layer.Sticker))))
                    shown.Add(i);
            }
            return shown;
        }

        // FNV-1a: stable across runs and machines (string.GetHashCode isn't)
        internal static uint Hash(string s)
        {
            var h = 2166136261;
            foreach (var c in s)
            {
                h ^= c;
                h *= 16777619;
            }
            return h;
        }

        public static Stack Get(CardManifestEntry card, List<int> front, List<int> back, string key, GameObject model)
        {
            if (_composite == null)
            {
                if (!_warned)
                    Plugin.Log.LogError("The card layer shader is missing from the card bundle (Hidden/DaCard/Layer Composite): cards show no layers. Rebuild the bundles.");
                _warned = true;
                return null;
            }

            if (!Stacks.TryGetValue(key, out var stack))
            {
                Stacks[key] = stack = new Stack { Key = key, Card = card, Front = front, Back = back, Roughness = CardRoughness(model) };
                Plugin.Log.LogInfo($"Card layers {key}: front {front.Count} of {card.Front.Count}, back {back.Count} of {card.Back.Count} layer(s)");
            }
            if (!stack.Models.Contains(model))
                stack.Models.Add(model);
            stack.LastSeen = Time.time;
            if (stack.FrontColor == null)
                Allocate(stack);
            stack.Idle = false;
            Restore(stack);
            if (stack.Dirty)
                Build(stack);
            return stack;
        }

        public static void Apply(Material material, Stack stack, string colorProperty, string backProperty)
        {
            if (stack == null)
                return;
            material.SetTexture(colorProperty, stack.FrontColor);
            material.SetTexture(LayerFoil, stack.FrontFoil);
            material.SetTexture(LayerNormal, stack.FrontNormal);
            material.SetTexture(backProperty, stack.BackColor);
            material.SetTexture(BackFoil, stack.BackFoil);
            material.SetTexture(BackNormal, stack.BackNormal);
        }

        // An animated layer showed a new frame
        public static void MarkDirty(string templateId)
        {
            foreach (var stack in Stacks.Values)
                if (stack.Card.Tpl == templateId)
                    stack.Dirty = true;
        }

        public static void Tick()
        {
            foreach (var stack in Stacks.Values)
            {
                stack.Models.RemoveAll(m => m == null);
                if (stack.Models.Any(m => m.activeInHierarchy))
                    stack.LastSeen = Time.time;
                if (stack.FrontColor == null)
                    continue;
                if (stack.Idle)
                {
                    // Something drew with it again (Unity recreates a released texture when it's used): stack it again
                    if (!stack.Textures.Any(t => t.IsCreated()))
                        continue;
                    stack.Idle = false;
                    stack.LastSeen = Time.time;
                    stack.Dirty = true;
                    Plugin.Log.LogInfo($"Card layers {stack.Key}: in use again, stacked again");
                }
                Restore(stack);
                if (stack.Dirty)
                    Build(stack);
            }

            if (Time.time < _nextPurge)
                return;
            _nextPurge = Time.time + 5f;
            // Unused for a while: free the GPU memory. Never destroy the textures or materials: the game can copy or pool
            // a card model without us seeing it. First check that no renderer, shown or not, still draws with its textures:
            // by texture, as the game draws with copies of our materials (the inspect preview does), which still use them.
            var idle = Stacks.Values.Where(s => !s.Idle && s.FrontColor != null && s.Models.Count == 0 && Time.time - s.LastSeen > ReleaseAfterSeconds).ToList();
            var freed = Stacks.Values.Where(s => s.Idle).ToList();
            if (idle.Count == 0 && freed.Count == 0)
                return;
            var used = TexturesInUse();
            // Freed, but something draws with it after all: stack it again
            foreach (var stack in freed.Where(s => used.Contains(s.FrontFoil) || used.Contains(s.BackFoil)))
            {
                stack.Idle = false;
                stack.LastSeen = Time.time;
                stack.Dirty = true;
                Restore(stack);
                Plugin.Log.LogInfo($"Card layers {stack.Key}: still drawn, stacked again");
            }
            foreach (var stack in idle)
            {
                if (used.Contains(stack.FrontFoil) || used.Contains(stack.BackFoil))
                {
                    stack.LastSeen = Time.time;
                    continue;
                }
                foreach (var texture in stack.Textures)
                    texture.Release();
                foreach (var texture in stack.Texts.Values)
                    if (texture != null)
                        texture.Release();
                stack.Idle = true;
                Plugin.Log.LogInfo($"Card layers {stack.Key}: unused, GPU memory freed");
            }
        }

        private static readonly List<Material> SharedMaterials = new List<Material>();

        private static readonly int LayerFoilId = Shader.PropertyToID(LayerFoil), BackFoilId = Shader.PropertyToID(BackFoil);

        // The layer stack textures that some card material (ours or a copy the game made of it) still draws with
        private static HashSet<Texture> TexturesInUse()
        {
            var used = new HashSet<Texture>();
            foreach (var renderer in Resources.FindObjectsOfTypeAll<Renderer>())
            {
                if (renderer == null)
                    continue;
                renderer.GetSharedMaterials(SharedMaterials);
                foreach (var material in SharedMaterials)
                {
                    if (material == null || !material.HasProperty(LayerFoilId))
                        continue;
                    used.Add(material.GetTexture(LayerFoilId));
                    if (material.HasProperty(BackFoilId))
                        used.Add(material.GetTexture(BackFoilId));
                }
            }
            return used;
        }

        private static float CardRoughness(GameObject model)
        {
            foreach (var renderer in model.GetComponentsInChildren<Renderer>(true))
            {
                if (IsCompositeHolder(renderer))
                    continue;
                renderer.GetSharedMaterials(SharedMaterials);
                foreach (var material in SharedMaterials)
                    if (material != null && material.HasProperty(RoughnessId))
                        return material.GetFloat(RoughnessId);
            }
            return FallbackRoughness;
        }

        // Render textures lose their contents when the graphics device resets: same objects (the materials use them), rebuilt
        private static void Restore(Stack stack)
        {
            foreach (var texture in stack.Textures)
                if (!texture.IsCreated())
                {
                    texture.Create();
                    stack.Dirty = true;
                }
        }

        private static void Allocate(Stack stack)
        {
            stack.Dirty = true;
            stack.FrontColor = NewTexture(stack.Key + " front", linear: false);
            stack.FrontFoil = NewTexture(stack.Key + " front foil", linear: true);
            stack.FrontNormal = NewTexture(stack.Key + " front normal", linear: true);
            stack.BackColor = NewTexture(stack.Key + " back", linear: false);
            stack.BackFoil = NewTexture(stack.Key + " back foil", linear: true);
            stack.BackNormal = NewTexture(stack.Key + " back normal", linear: true);
        }

        // The card UV -> layer UV map of a layer's transform (see CardLayerComposite.shader): u' = U.x u + U.y v + U.z
        private static (Vector4 U, Vector4 V, Vector4 Rot) Placement(LayerTransform t, Texture art)
        {
            t = t ?? new LayerTransform();
            float w = StackWidth, h = StackHeight, iw = Mathf.Max(1, art.width), ih = Mathf.Max(1, art.height);
            var scale = Mathf.Min(w / iw, h / ih) * Mathf.Max(1e-4f, t.Scale);
            var rad = t.Rotation * Mathf.Deg2Rad;
            float c = Mathf.Cos(rad), s = Mathf.Sin(rad);
            Vector2 Map(float u, float v)
            {
                // card pixels (y down) around the layer's centre, turned back, in the picture's pixels (y down)
                float dx = u * w - t.X * w, dy = (1 - v) * h - t.Y * h;
                float qx = (c * dx + s * dy) / scale + iw / 2, qy = (-s * dx + c * dy) / scale + ih / 2;
                return new Vector2(qx / iw, 1 - qy / ih);
            }
            var o = Map(0, 0);
            var du = Map(1, 0) - o;
            var dv = Map(0, 1) - o;
            return (new Vector4(du.x, dv.x, o.x, 0), new Vector4(du.y, dv.y, o.y, 0), new Vector4(c, s, 0, 0));
        }

        private static RenderTexture NewTexture(string name, bool linear)
        {
            var texture = new RenderTexture(StackWidth, StackHeight, 0, RenderTextureFormat.ARGB32, linear ? RenderTextureReadWrite.Linear : RenderTextureReadWrite.sRGB)
            {
                name = "dacard " + name,
                useMipMap = true,
                autoGenerateMips = false,
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Trilinear,
                anisoLevel = 4,
                hideFlags = HideFlags.DontUnloadUnusedAsset
            };
            texture.Create();
            return texture;
        }

        private static void Build(Stack stack)
        {
            stack.Dirty = false;
            var active = RenderTexture.active;
            try
            {
                BuildSide(stack, stack.Card.Front, stack.Front, "front", stack.FrontColor, stack.FrontFoil, stack.FrontNormal);
                BuildSide(stack, stack.Card.Back, stack.Back, "back", stack.BackColor, stack.BackFoil, stack.BackNormal);
            }
            finally
            {
                RenderTexture.active = active;
            }
        }

        private static void BuildSide(Stack stack, List<CardLayer> layers, List<int> shown, string side,
            RenderTexture color, RenderTexture surface, RenderTexture normal)
        {
            var card = stack.Card;
            var parts = new List<Part>();
            foreach (var i in shown)
            {
                if (layers[i].Text != null)
                {
                    var key = side + ":" + i;
                    stack.Texts.TryGetValue(key, out var text);
                    if (text == null || !text.IsCreated())
                        stack.Texts[key] = text = TextLayers.Render(card, layers[i], StackWidth, StackHeight, text);
                    if (text != null)
                        parts.Add(new Part { Layer = layers[i], Albedo = text });
                    continue;
                }
                var albedo = Current(card, layers, i, side, LayerMaps.Albedo);
                if (albedo != null)
                    parts.Add(new Part
                    {
                        Layer = layers[i],
                        Albedo = albedo,
                        Mask = Current(card, layers, i, side, LayerMaps.Mask),
                        Normal = Current(card, layers, i, side, LayerMaps.Normal),
                        Roughness = Current(card, layers, i, side, LayerMaps.Roughness),
                        Metallic = Current(card, layers, i, side, LayerMaps.Metallic)
                    });
            }

            _composite.SetFloat("_DefaultRoughness", stack.Roughness);
            Composite(color, ColorPass, NoColor, parts);
            Composite(surface, SurfacePass, new Color(0, 0, stack.Roughness, 0), parts);
            Composite(normal, NormalPass, Flat, parts);
        }

        private class Part
        {
            public CardLayer Layer;
            public Texture Albedo, Mask, Normal, Roughness, Metallic;
        }

        private static void SetMap(string property, string flag, Texture texture)
        {
            _composite.SetTexture(property, texture);
            _composite.SetFloat(flag, texture != null ? 1f : 0f);
        }

        // One blit per layer, ping-ponging between the target and a scratch texture
        private static void Composite(RenderTexture target, int pass, Color empty, List<Part> parts)
        {
            var descriptor = target.descriptor;
            descriptor.useMipMap = false;
            descriptor.autoGenerateMips = false;
            var scratch = RenderTexture.GetTemporary(descriptor);
            try
            {
                RenderTexture.active = target;
                GL.Clear(false, true, empty);
                var current = target;
                foreach (var part in parts)
                {
                    var layer = part.Layer;
                    var next = current == target ? scratch : target;
                    _composite.SetTexture("_Layer", part.Albedo);
                    SetMap("_MaskMap", "_HasMask", part.Mask);
                    SetMap("_NormalMap", "_HasNormal", part.Normal);
                    SetMap("_RoughnessMap", "_HasRoughness", part.Roughness);
                    SetMap("_MetallicMap", "_HasMetallic", part.Metallic);
                    _composite.SetFloat("_CanBeFoil", layer.CanBeFoil ? 1f : 0f);
                    _composite.SetFloat("_Frame", layer.Frame ? 1f : 0f);
                    _composite.SetFloat("_Premultiplied", layer.Text != null ? 1f : 0f);
                    var (u, v, rot) = Placement(layer.Transform, part.Albedo);
                    _composite.SetVector("_LayerU", u);
                    _composite.SetVector("_LayerV", v);
                    _composite.SetVector("_NormalRot", rot);
                    Graphics.Blit(current, next, _composite, pass);
                    current = next;
                }
                if (current != target)
                    Graphics.Blit(current, target);
                target.GenerateMips();
            }
            finally
            {
                RenderTexture.ReleaseTemporary(scratch);
            }
        }

        // The layer map now: an animated map's current frame, else its picture
        private static Texture Current(CardManifestEntry card, List<CardLayer> layers, int index, string side, string map)
        {
            var layer = layers[index];
            var frame = CardAnimator.Frame(card.Tpl, TrackKey(side, index, map));
            if (frame != null)
                return frame;
            return layer.Textures != null && layer.Textures.TryGetValue(map, out var url) && url != null
                ? CardRegistry.GetTexture(url, linear: map != LayerMaps.Albedo)
                : null;
        }
    }
}
