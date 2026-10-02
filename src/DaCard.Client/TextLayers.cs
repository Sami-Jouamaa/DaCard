using System;
using System.Text.RegularExpressions;
using EFT;
using TMPro;
using UnityEngine;
using Object = UnityEngine.Object;

namespace DaCard.Client
{
    internal static class TextLayers
    {
        private const float CardW = 490f, CardH = 684f, Unit = 0.001f, MinFit = 0.2f;
        private static readonly Vector3 Origin = new Vector3(0f, -20000f, 0f);
        private static readonly Regex Variable = new Regex(@"\$\{\s*([A-Za-z.]+)\s*\}");
        private static readonly Regex Tag = new Regex(@"<[^>]*>");
        private static readonly Regex ColorTag = new Regex(@"<color=([""']?)#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?\1>", RegexOptions.IgnoreCase);

        private static GameObject _root;
        private static TMP_Text _text;
        private static Camera _camera;
        private static TMP_FontAsset _defaultFont;
        private static Material _defaultMaterial;
        private static bool _failed;

        public static bool Ready => _text != null;

        public static void Remember(TMP_Text template)
        {
            if (_text != null && template != null && (_defaultFont == null || _defaultMaterial == null || _defaultMaterial.shader == null))
            {
                Object.Destroy(_root);
                _root = null;
                _text = null;
                _camera = null;
            }
            if (_text != null || template == null)
                return;
            var layer = FreeLayer();
            _root = new GameObject("DaCard text layers");
            _root.SetActive(false);
            Object.DontDestroyOnLoad(_root);
            _defaultFont = template.font;
            _defaultMaterial = template.fontSharedMaterial;

            var copy = Object.Instantiate(template.gameObject, _root.transform, false);
            copy.name = "DaCard text layer";
            foreach (var t in copy.GetComponentsInChildren<Transform>(true))
                t.gameObject.layer = layer;
            copy.transform.localScale = Vector3.one;
            copy.transform.localRotation = Quaternion.identity;
            copy.SetActive(true);
            _text = copy.GetComponent<TMP_Text>();

            var cameraObject = new GameObject("DaCard text camera");
            cameraObject.transform.SetParent(_root.transform, false);
            _camera = cameraObject.AddComponent<Camera>();
            _camera.enabled = false;
            _camera.orthographic = true;
            _camera.orthographicSize = CardH * Unit / 2f;
            _camera.clearFlags = CameraClearFlags.SolidColor;
            _camera.backgroundColor = new Color(0f, 0f, 0f, 0f);
            _camera.cullingMask = 1 << layer;
            _camera.nearClipPlane = 0.01f;
            _camera.farClipPlane = 10f;
            _camera.allowHDR = false;
            _camera.allowMSAA = false;
            _camera.useOcclusionCulling = false;
            _camera.transform.position = Origin + new Vector3(CardW * Unit / 2f, -CardH * Unit / 2f, -5f);
            _camera.transform.rotation = Quaternion.identity;
        }

        private static int FreeLayer()
        {
            for (var i = 31; i >= 8; i--)
                if (string.IsNullOrEmpty(LayerMask.LayerToName(i)))
                    return i;
            return 31;
        }

        public static RenderTexture Render(CardManifestEntry card, CardLayer layer, int width, int height, RenderTexture target)
        {
            var style = layer.Text;
            if (_text == null || style == null)
                return null;
            var value = Faded(Expand(style.Value, card), Mathf.Clamp01(style.Opacity));
            if (string.IsNullOrWhiteSpace(Tag.Replace(value, "")))
                return null;
            try
            {
                if (target == null)
                    target = new RenderTexture(width, height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB)
                    {
                        name = "dacard text " + layer.Key,
                        wrapMode = TextureWrapMode.Clamp,
                        filterMode = FilterMode.Bilinear,
                        hideFlags = HideFlags.DontUnloadUnusedAsset
                    };
                if (!target.IsCreated())
                    target.Create();

                _root.SetActive(true);
                var text = _text;
                var font = string.IsNullOrEmpty(style.Font) ? null : CardFonts.Asset(style.Font, _defaultFont, _defaultMaterial);
                if (text.font != (font ?? _defaultFont))
                    text.font = font ?? _defaultFont;
                if (font == null)
                    text.fontSharedMaterial = _defaultMaterial;
                text.richText = true;
                text.enableAutoSizing = false;
                text.enableWordWrapping = true;
                text.overflowMode = TextOverflowModes.Truncate;
                text.margin = Vector4.zero;
                text.characterSpacing = 0;
                text.wordSpacing = 0;
                text.lineSpacing = 0;
                text.paragraphSpacing = 0;
                text.alignment = Alignment(style.Align, style.VAlign);
                var color = ParseColor(style.Color, card);
                color.a *= Mathf.Clamp01(style.Opacity);
                text.color = color;
                text.fontStyle = style.Uppercase ? FontStyles.UpperCase : FontStyles.Normal;

                var rect = text.rectTransform;
                var boxHeight = Mathf.Max(0.001f, style.Height);
                rect.pivot = new Vector2(0.5f, 0.5f);
                rect.sizeDelta = new Vector2(style.Width * CardW * Unit, boxHeight * CardH * Unit);
                rect.position = Origin + new Vector3(style.X * CardW * Unit, -(style.Y + boxHeight / 2f) * CardH * Unit, 0f);
                rect.rotation = Quaternion.Euler(0f, 0f, -style.Rotation);

                text.fontSize = 1;
                var line = text.GetPreferredValues("Hg", 1e5f, 1e5f).y;
                if (line > 1e-6f)
                    text.fontSize = style.Size * CardH * Unit / line;
                text.text = value;
                if (style.AutoSize)
                    FitSize(text);
                text.ForceMeshUpdate(true, true);

                _camera.aspect = CardW / CardH;
                _camera.targetTexture = target;
                _camera.Render();
                return target;
            }
            catch (Exception e)
            {
                if (!_failed)
                    Plugin.Log.LogError($"Could not draw the text layer {layer.Key}: {e}");
                _failed = true;
                return null;
            }
            finally
            {
                if (_camera != null)
                    _camera.targetTexture = null;
                if (_root != null)
                    _root.SetActive(false);
            }
        }

        private static void FitSize(TMP_Text text)
        {
            var max = text.fontSize;
            if (Fits(text, max))
                return;
            float lo = max * MinFit, hi = max;
            if (Fits(text, lo))
                for (var i = 0; i < 12; i++)
                {
                    var mid = (lo + hi) / 2f;
                    if (Fits(text, mid)) lo = mid;
                    else hi = mid;
                }
            text.fontSize = lo;
        }

        private static bool Fits(TMP_Text text, float size)
        {
            text.fontSize = size;
            text.ForceMeshUpdate(true, true);
            return !text.isTextTruncated && !text.isTextOverflowing;
        }

        private static string Expand(string value, CardManifestEntry card)
        {
            return Variable.Replace(value ?? "", m =>
            {
                switch (m.Groups[1].Value.ToLowerInvariant())
                {
                    case "name": return CardNames.Tinted(card, CardNames.Name(card));
                    case "description": return CardNames.Description(card);
                    case "rarity": return card.Rarity ?? "";
                    case "rarity.color": return Hex(card.RarityColor);
                    case "collection": return card.Collection ?? "";
                    default: return m.Value;
                }
            });
        }

        private static string Faded(string value, float opacity)
        {
            if (opacity >= 1f)
                return value;
            return ColorTag.Replace(value, m =>
            {
                var alpha = m.Groups[3].Success ? Convert.ToInt32(m.Groups[3].Value, 16) : 255;
                return $"<color=#{m.Groups[2].Value}{Mathf.RoundToInt(alpha * opacity):X2}>";
            });
        }

        private static string Hex(string color)
        {
            if (string.IsNullOrEmpty(color))
                return "#FFFFFF";
            return color.StartsWith("#") ? color : "#" + color;
        }

        private static TextAlignmentOptions Alignment(string align, string valign)
        {
            switch (valign)
            {
                case "middle":
                    return align == "left" ? TextAlignmentOptions.Left : align == "right" ? TextAlignmentOptions.Right : TextAlignmentOptions.Center;
                case "bottom":
                    return align == "left" ? TextAlignmentOptions.BottomLeft : align == "right" ? TextAlignmentOptions.BottomRight : TextAlignmentOptions.Bottom;
                default:
                    return align == "left" ? TextAlignmentOptions.TopLeft : align == "right" ? TextAlignmentOptions.TopRight : TextAlignmentOptions.Top;
            }
        }

        private static Color ParseColor(string value, CardManifestEntry card)
        {
            var text = string.Equals(value, "rarity", StringComparison.OrdinalIgnoreCase) ? Hex(card.RarityColor) : value;
            return ColorUtility.TryParseHtmlString(text ?? "", out var color) ? color : Color.white;
        }
    }
}
