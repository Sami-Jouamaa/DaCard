using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace DaCard.Editor
{
    public static class PackBuilder
    {
        public static readonly string Model = CardPaths.Root + "/Models/pack.fbx";
        public static readonly string Material = CardPaths.Root + "/Materials/pack.mat";
        public static readonly string TexturesDir = CardPaths.Root + "/Textures/Pack";
        public static readonly string AlbedoTex = TexturesDir + "/pack_Base_color.png";
        public static readonly string NormalTex = TexturesDir + "/pack_Normal_OpenGL.png";
        public static readonly string MetallicTex = TexturesDir + "/pack_Metallic.png";
        public static readonly string RoughnessTex = TexturesDir + "/pack_Roughness.png";
        public static readonly string OcclusionTex = TexturesDir + "/pack_Mixed_AO.png";
        public static readonly string PackShader = CardPaths.Root + "/Shaders/Pack.shader";
        public const string PrefabName = "item_pack";
        public static readonly string Prefab = CardPaths.PrefabsDir + "/" + PrefabName + ".prefab";
        public const string BundleKey = CardPaths.BundleFolder + "/" + PrefabName + ".bundle";

        private static readonly (string Property, string Path, string CreatorName, int PreviewSize)[] Maps =
        {
            ("_MainTex", AlbedoTex, "albedo", 1024),
            ("_BumpMap", NormalTex, "normal", 1024),
            ("_MetallicMap", MetallicTex, "metallic", 512),
            ("_RoughnessMap", RoughnessTex, "roughness", 512),
            ("_OcclusionMap", OcclusionTex, "ao", 512)
        };

        public static GameObject BuildPrefab()
        {
            ConfigureImports();
            var mesh = AssetDatabase.LoadAllAssetsAtPath(Model).OfType<Mesh>().FirstOrDefault()
                       ?? throw new InvalidOperationException("No mesh in " + Model);
            var front = FrontNormal(mesh);
            var material = LoadOrCreateMaterial();

            var root = new GameObject(PrefabName);
            try
            {
                var body = new GameObject("pack_mesh");
                body.transform.SetParent(root.transform, false);
                body.AddComponent<MeshFilter>().sharedMesh = mesh;
                var renderer = body.AddComponent<MeshRenderer>();
                renderer.sharedMaterial = material;
                CardBundleBuilder.LikeVanillaItem(renderer);
                var box = body.AddComponent<BoxCollider>();
                box.center = mesh.bounds.center;
                box.size = mesh.bounds.size;

                var toCamera = Quaternion.Inverse(Quaternion.LookRotation(-front, Vector3.up));
                PreviewPivot pivot;
                var logEnabled = Debug.unityLogger.logEnabled;
                Debug.unityLogger.logEnabled = false;
                try { pivot = root.AddComponent<PreviewPivot>(); }
                finally { Debug.unityLogger.logEnabled = logEnabled; }
                var settings = CardBuildSettings.LoadOrCreate();
                pivot.pivotPosition = mesh.bounds.center;
                pivot.pivotRotation = toCamera;
                pivot.scale = Vector3.one * Mathf.Max(0.1f, settings.packPreviewScale);
                var iconRotation = Quaternion.Euler(settings.packIconAngles) * toCamera;
                pivot.Icon = new PreviewPivot.IconSettings { rotation = iconRotation, rotationEuler = iconRotation.eulerAngles, boundsScale = 0.9f };

                Directory.CreateDirectory(CardPaths.PrefabsDir);
                var prefab = PrefabUtility.SaveAsPrefabAsset(root, Prefab);
                if (SystemInfo.graphicsDeviceType == UnityEngine.Rendering.GraphicsDeviceType.Null)
                    Debug.LogWarning("[DaCard] No graphics device (-nographics): the Card Creator's booster pack model was not re-exported.");
                else
                    ExportForCreator(mesh, front);
                return prefab;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static void ConfigureImports()
        {
            var model = (ModelImporter)AssetImporter.GetAtPath(Model);
            if (model.materialImportMode != ModelImporterMaterialImportMode.None || model.importCameras || model.importLights || model.importAnimation)
            {
                model.materialImportMode = ModelImporterMaterialImportMode.None;
                model.importCameras = false;
                model.importLights = false;
                model.importAnimation = false;
                model.animationType = ModelImporterAnimationType.None;
                model.SaveAndReimport();
            }
            SetTexture(AlbedoTex, TextureImporterType.Default, srgb: true);
            SetTexture(NormalTex, TextureImporterType.NormalMap, srgb: false);
            SetTexture(MetallicTex, TextureImporterType.Default, srgb: false);
            SetTexture(RoughnessTex, TextureImporterType.Default, srgb: false);
            SetTexture(OcclusionTex, TextureImporterType.Default, srgb: false);
        }

        private const int Aniso = 8;

        private static void SetTexture(string path, TextureImporterType type, bool srgb)
        {
            if (AssetImporter.GetAtPath(path) is not TextureImporter importer)
                throw new InvalidOperationException($"Missing {path} (the pack's template texture set)");
            if (importer.textureType == type && importer.sRGBTexture == srgb && importer.anisoLevel == Aniso && importer.mipmapEnabled)
                return;
            importer.textureType = type;
            importer.sRGBTexture = srgb;
            importer.mipmapEnabled = true;
            importer.anisoLevel = Aniso;
            importer.SaveAndReimport();
        }

        private static Material LoadOrCreateMaterial()
        {
            var material = AssetDatabase.LoadAssetAtPath<Material>(Material);
            if (material == null)
            {
                var shader = AssetDatabase.LoadAssetAtPath<Shader>(PackShader) ?? throw new InvalidOperationException("Missing " + PackShader);
                material = new Material(shader) { name = "pack" };
                AssetDatabase.CreateAsset(material, Material);
                Debug.Log($"[DaCard] Created {Material}. Tune metallic / smoothness / fill light in the inspector; it isn't overwritten.");
            }

            var changed = false;
            foreach (var (property, path, _, _) in Maps)
            {
                var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
                if (texture == null || material.GetTexture(property) == texture)
                    continue;
                material.SetTexture(property, texture);
                changed = true;
            }
            if (changed)
            {
                EditorUtility.SetDirty(material);
                AssetDatabase.SaveAssetIfDirty(material);
            }
            return material;
        }

        private static Vector3 FrontNormal(Mesh mesh)
        {
            var verts = mesh.vertices;
            var normals = mesh.normals;
            var uvs = mesh.uv;
            var triangles = mesh.triangles;

            double Residual(int sign)
            {
                var points = new List<int>();
                for (var t = 0; t < triangles.Length; t += 3)
                {
                    if (Enumerable.Range(0, 3).All(k => normals[triangles[t + k]].z * sign > 0.99f))
                        points.AddRange(new[] { triangles[t], triangles[t + 1], triangles[t + 2] });
                }
                if (points.Count < 3)
                    return double.MaxValue;
                var ata = new double[3, 3];
                var atu = new double[3];
                var atv = new double[3];
                foreach (var i in points)
                {
                    var row = new double[] { verts[i].x, verts[i].y, 1 };
                    for (var r = 0; r < 3; r++)
                    {
                        for (var c = 0; c < 3; c++)
                            ata[r, c] += row[r] * row[c];
                        atu[r] += row[r] * uvs[i].x;
                        atv[r] += row[r] * uvs[i].y;
                    }
                }
                var mu = Solve(ata, atu);
                var mv = Solve(ata, atv);
                if (mu == null || mv == null)
                    return double.MaxValue;
                return points.Max(i =>
                {
                    var du = mu[0] * verts[i].x + mu[1] * verts[i].y + mu[2] - uvs[i].x;
                    var dv = mv[0] * verts[i].x + mv[1] * verts[i].y + mv[2] - uvs[i].y;
                    return Math.Max(Math.Abs(du), Math.Abs(dv));
                });
            }

            var plus = Residual(+1);
            var minus = Residual(-1);
            var front = plus <= minus ? Vector3.forward : Vector3.back;
            Debug.Log($"[DaCard] Pack front faces {(front.z > 0 ? "+Z" : "-Z")} (UV fit error +Z {plus:0.####}, -Z {minus:0.####}); " +
                      $"{mesh.bounds.size.x:0.###} x {mesh.bounds.size.y:0.###} x {mesh.bounds.size.z:0.###}");
            return front;
        }

        private static double[] Solve(double[,] a, double[] b)
        {
            var m = new double[3, 4];
            for (var r = 0; r < 3; r++)
            {
                for (var c = 0; c < 3; c++)
                    m[r, c] = a[r, c];
                m[r, 3] = b[r];
            }
            for (var col = 0; col < 3; col++)
            {
                var pivot = col;
                for (var r = col + 1; r < 3; r++)
                    if (Math.Abs(m[r, col]) > Math.Abs(m[pivot, col]))
                        pivot = r;
                if (Math.Abs(m[pivot, col]) < 1e-12)
                    return null;
                for (var c = 0; c < 4; c++)
                    (m[col, c], m[pivot, c]) = (m[pivot, c], m[col, c]);
                for (var r = 0; r < 3; r++)
                {
                    if (r == col)
                        continue;
                    var f = m[r, col] / m[col, col];
                    for (var c = 0; c < 4; c++)
                        m[r, c] -= f * m[col, c];
                }
            }
            return new[] { m[0, 3] / m[0, 0], m[1, 3] / m[1, 1], m[2, 3] / m[2, 2] };
        }

        private static void ExportForCreator(Mesh mesh, Vector3 front)
        {
            string Floats(IEnumerable<float> values)
            {
                var list = values.ToArray();
                var bytes = new byte[list.Length * 4];
                Buffer.BlockCopy(list, 0, bytes, 0, bytes.Length);
                return Convert.ToBase64String(bytes);
            }
            string Ints(int[] values)
            {
                var bytes = new byte[values.Length * 4];
                Buffer.BlockCopy(values, 0, bytes, 0, bytes.Length);
                return Convert.ToBase64String(bytes);
            }
            string N(float v) => v.ToString("0.#####", System.Globalization.CultureInfo.InvariantCulture);
            string V(Vector3 v) => $"[{N(-v.x)}, {N(v.y)}, {N(v.z)}]";

            var triangles = Enumerable.Range(0, mesh.subMeshCount).SelectMany(mesh.GetTriangles).ToArray();
            var b = mesh.bounds;
            var script = "// Generated by the Unity card builder (PackBuilder): the booster pack for the Card Creator's previews.\n" +
                         "window.CC_PACK_MODEL = {\n" +
                         $"  \"vertexCount\": {mesh.vertexCount},\n" +
                         $"  \"positions\": \"{Floats(mesh.vertices.SelectMany(v => new[] { -v.x, v.y, v.z }))}\",\n" +
                         $"  \"normals\": \"{Floats(mesh.normals.SelectMany(n => new[] { -n.x, n.y, n.z }))}\",\n" +
                         $"  \"uvs\": \"{Floats(mesh.uv.SelectMany(u => new[] { u.x, u.y }))}\",\n" +
                         $"  \"indices\": \"{Ints(triangles)}\",\n" +
                         $"  \"bounds\": {{ \"center\": {V(b.center)}, \"size\": [{N(b.size.x)}, {N(b.size.y)}, {N(b.size.z)}] }},\n" +
                         $"  \"front\": {V(front)},\n" +
                         "  \"files\": { " + string.Join(", ", Maps.Select(m => $"\"{m.CreatorName}\": \"creator/pack/template_{m.CreatorName}.png\"")) + " },\n" +
                         "  \"previews\": {\n" + string.Join(",\n", Maps.Select(m => $"    \"{m.CreatorName}\": \"{PreviewUri(m.Path, m.PreviewSize)}\"")) + "\n  }\n" +
                         "};\n";

            var gameModDir = CardBundleBuilder.GameModDir();
            var targets = new[] { Path.Combine(CardPaths.RepoRoot, "src", "DaCard.Server", "creator"), gameModDir != null ? Path.Combine(gameModDir, "creator") : null };
            foreach (var creatorDir in targets.Where(t => t != null))
            {
                Directory.CreateDirectory(Path.Combine(creatorDir, "pack"));
                File.WriteAllText(Path.Combine(creatorDir, "pack_model.mjs"), script);
                foreach (var (_, path, name, _) in Maps)
                    File.Copy(Path.GetFullPath(path), Path.Combine(creatorDir, "pack", $"template_{name}.png"), overwrite: true);
            }
            Debug.Log($"[DaCard] Pack model for the Card Creator: {mesh.vertexCount} vertices, {triangles.Length / 3} triangles, {script.Length / 1024} KB.");
        }

        private static string PreviewUri(string path, int size)
        {
            var source = new Texture2D(2, 2, TextureFormat.RGBA32, false, true);
            var image = new Texture2D(size, size, TextureFormat.RGB24, false, true);
            var rt = RenderTexture.GetTemporary(size, size, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Linear);
            var previous = RenderTexture.active;
            try
            {
                source.LoadImage(File.ReadAllBytes(Path.GetFullPath(path)));
                Graphics.Blit(source, rt);
                RenderTexture.active = rt;
                image.ReadPixels(new Rect(0, 0, size, size), 0, 0);
                image.Apply();
                return "data:image/jpeg;base64," + Convert.ToBase64String(image.EncodeToJPG(88));
            }
            finally
            {
                RenderTexture.active = previous;
                RenderTexture.ReleaseTemporary(rt);
                UnityEngine.Object.DestroyImmediate(source);
                UnityEngine.Object.DestroyImmediate(image);
            }
        }
    }
}
