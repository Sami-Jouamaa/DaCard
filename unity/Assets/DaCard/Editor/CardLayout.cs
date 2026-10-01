using System.IO;
using System.Linq;
using TMPro;
using UnityEditor;
using UnityEngine;

namespace DaCard.Editor
{
    public static class CardLayout
    {
        [MenuItem("DaCard/Open Card Layout")]
        private static void Open() => AssetDatabase.OpenAsset(LoadOrCreate());

        public static GameObject LoadOrCreate()
        {
            var existing = AssetDatabase.LoadAssetAtPath<GameObject>(CardPaths.Layout);
            if (existing != null)
                return existing;

            var mesh = CardBundleBuilder.BuildMesh();
            var preview = CardBuildSettings.LoadOrCreate().ValidTypes().Select(t => t.material).FirstOrDefault();

            var root = new GameObject("card_layout");
            try
            {
                var meshObject = new GameObject(CardPaths.LayoutMeshObject);
                meshObject.transform.SetParent(root.transform, false);
                meshObject.AddComponent<MeshFilter>().sharedMesh = mesh;
                meshObject.AddComponent<MeshRenderer>().sharedMaterial = preview;

                var bounds = mesh.bounds;
                var nameObject = new GameObject(CardPaths.NameObject);
                nameObject.transform.SetParent(root.transform, false);
                var text = nameObject.AddComponent<TextMeshPro>();
                text.text = "Card Name";
                text.color = Color.white;
                text.alignment = TextAlignmentOptions.Center;
                text.enableWordWrapping = false;
                text.enableAutoSizing = true;
                text.fontSizeMin = 0.001f;
                text.fontSizeMax = 1f;
                text.rectTransform.sizeDelta = new Vector2(bounds.size.x * 0.8f, bounds.size.z * 0.07f);
                nameObject.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
                nameObject.transform.localPosition = new Vector3(bounds.center.x, bounds.max.y + 0.0002f, bounds.max.z - bounds.size.z * 0.09f);

                Directory.CreateDirectory(Path.GetDirectoryName(CardPaths.Layout)!);
                var prefab = PrefabUtility.SaveAsPrefabAsset(root, CardPaths.Layout);
                Debug.Log($"[DaCard] Created {CardPaths.Layout}: open it (DaCard ▸ Open Card Layout) to place the card name.");
                return prefab;
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }
    }
}
