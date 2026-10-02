using EFT;
using TMPro;
using UnityEngine;

namespace DaCard.Client
{
    internal static class CardText
    {
        private const string NameObject = "CardName";
        private const string DescriptionObject = "CardDescription";
        private const string MeshObject = "card_mesh";

        public static void Apply(GameObject model, CardManifestEntry card, string name)
        {
            TMP_Text nameText = null, descriptionText = null;
            foreach (var text in model.GetComponentsInChildren<TMP_Text>(true))
            {
                if (text.name == NameObject && nameText == null) nameText = text;
                else if (text.name == DescriptionObject && descriptionText == null) descriptionText = text;
            }
            if (nameText == null)
                return;
            TextLayers.Remember(nameText);

            var settings = card.Text;
            var showDescription = settings?.Description != null && settings.Description.Show;
            if (descriptionText == null && showDescription)
            {
                descriptionText = Object.Instantiate(nameText.gameObject, nameText.transform.parent, false).GetComponent<TMP_Text>();
                descriptionText.name = DescriptionObject;
            }

            var face = CardFace(model, nameText.transform.parent);
            Place(nameText, settings?.Name, name, face);
            if (descriptionText != null)
                Place(descriptionText, showDescription ? settings.Description : null, CardNames.Description(card), face);
        }

        private struct Face
        {
            public Vector3 TopLeft, Right, Down;
            public float Width, Height;
        }

        private static Face CardFace(GameObject model, Transform space)
        {
            var filter = model.transform.Find(MeshObject)?.GetComponent<MeshFilter>() ?? model.GetComponentInChildren<MeshFilter>(true);
            var b = filter.sharedMesh.bounds;
            Vector3 P(float x, float z) => space.InverseTransformPoint(filter.transform.TransformPoint(new Vector3(x, b.max.y, z)));
            var topLeft = P(b.min.x, b.max.z);
            var right = P(b.max.x, b.max.z) - topLeft;
            var down = P(b.min.x, b.min.z) - topLeft;
            return new Face { TopLeft = topLeft, Right = right, Down = down, Width = right.magnitude, Height = down.magnitude };
        }

        private static void Place(TMP_Text text, TextStyle style, string value, Face face)
        {
            var show = style != null && style.Show && !string.IsNullOrEmpty(value);
            text.gameObject.SetActive(show);
            if (!show)
                return;

            CardFonts.Use(text, style.Font);
            text.text = value;
            text.enableAutoSizing = false;
            text.enableWordWrapping = true;
            text.margin = Vector4.zero;
            text.overflowMode = TextOverflowModes.Truncate;
            text.alignment = style.Align == "left" ? TextAlignmentOptions.TopLeft
                : style.Align == "right" ? TextAlignmentOptions.TopRight
                : TextAlignmentOptions.Top;
            if (ColorUtility.TryParseHtmlString(style.Color, out var color))
                text.color = color;

            text.fontSize = 1;
            var lineAtOne = text.GetPreferredValues("Hg", 1000, 1000).y;
            if (lineAtOne > 1e-6f)
                text.fontSize = style.Size * face.Height / lineAtOne;

            var rect = text.rectTransform;
            rect.pivot = new Vector2(0.5f, 1f);
            var height = style.Height is float h && h > 0 ? h : 1 - style.Y;
            rect.sizeDelta = new Vector2(style.Width * face.Width, Mathf.Max(0.01f, height) * face.Height);
            var up = -face.Down.normalized;
            var normal = Vector3.Cross(face.Right, face.Down).normalized;
            rect.localRotation = Quaternion.LookRotation(-normal, up);
            rect.localPosition = face.TopLeft + face.Right * style.X + face.Down * style.Y + normal * (face.Height * 0.002f);
        }
    }
}
