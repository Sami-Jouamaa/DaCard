using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace DaCard.Editor
{
    public static class CardBundleBuilder
    {
        private static readonly Quaternion FrontFacing = Quaternion.Euler(-90f, 0f, 0f);

        [Serializable] private class ServerConfig { public Slot[] textures; public string overlayProperty; }
        [Serializable] private class Slot { public string suffix; public string property; }

        public static bool IsBuilding { get; private set; }

        [MenuItem("DaCard/Build Card Bundle", priority = 20)]
        public static void BuildBundle()
        {
            IsBuilding = true;
            try
            {
                var prefabs = BuildPrefabs();
                var bundles = prefabs.ToDictionary(p => CardPaths.BundleKey(p.Key), p => p.Value);
                bundles[BinderBuilder.BundleKey] = BinderBuilder.BuildPrefab();
                bundles[PackBuilder.BundleKey] = PackBuilder.BuildPrefab();
                var copies = BuildAssetBundles(bundles);
                CardFaceTextures.ExportForCreator();
                Debug.Log($"[DaCard] {bundles.Count} bundle(s) built (card types: {string.Join(", ", prefabs.Keys)}; binder; booster pack) and copied to:\n  " + string.Join("\n  ", copies));
            }
            finally
            {
                IsBuilding = false;
            }
        }

        public static void BuildBatch()
        {
            try
            {
                BuildBundle();
                EditorApplication.Exit(0);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                EditorApplication.Exit(1);
            }
        }

        [MenuItem("DaCard/Build Card Prefabs Only", priority = 21)]
        public static void BuildPrefabsMenu() => BuildPrefabs();

        public static Dictionary<string, GameObject> BuildPrefabs()
        {
            var types = CardBuildSettings.LoadOrCreate().ValidTypes();
            if (types.Count == 0)
                throw new InvalidOperationException("No card type has a material. Set them in DaCard ▸ Select Build Settings (Card Types: 2d, 3d).");

            var mesh = BuildMesh();
            var layout = CardLayout.LoadOrCreate();
            var prefabs = types.ToDictionary(t => t.type, t => BuildPrefab(t, mesh, layout));
            RemoveStaleOutputs(prefabs.Keys);
            return prefabs;
        }

        public static Mesh BuildMesh()
        {
            ConfigureModelImport();
            Directory.CreateDirectory(CardPaths.Generated);
            var source = AssetDatabase.LoadAllAssetsAtPath(CardPaths.Model).OfType<Mesh>().FirstOrDefault()
                         ?? throw new InvalidOperationException("No mesh in " + CardPaths.Model);
            return SaveGenerated(BuildRuntimeMesh(source), CardPaths.RuntimeMesh);
        }

        private static void RemoveStaleOutputs(ICollection<string> types)
        {
            var keep = new HashSet<string>(types.SelectMany(t => new[] { CardPaths.Prefab(t), CardPaths.RuntimeMaterial(t) }));
            var stale = AssetDatabase.FindAssets("t:Prefab", new[] { CardPaths.PrefabsDir })
                .Concat(AssetDatabase.FindAssets("t:Material", new[] { CardPaths.Generated }))
                .Select(AssetDatabase.GUIDToAssetPath)
                .Where(p => (Path.GetFileName(p).StartsWith("item_card") || Path.GetFileName(p).StartsWith("card_runtime")) && !keep.Contains(p))
                .ToList();
            foreach (var path in stale)
            {
                AssetDatabase.DeleteAsset(path);
                Debug.Log("[DaCard] Removed " + path + " (no card type uses it any more)");
            }
        }

        internal static void LikeVanillaItem(Renderer renderer)
        {
            renderer.lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.Off;
            renderer.reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.Off;
            renderer.receiveShadows = false;
        }

        private static GameObject BuildPrefab(CardBuildSettings.CardType type, Mesh mesh, GameObject layout)
        {
            var material = SaveGenerated(BuildRuntimeMaterial(type), CardPaths.RuntimeMaterial(type.type));

            var root = UnityEngine.Object.Instantiate(layout);
            root.name = CardPaths.PrefabName(type.type);
            try
            {
                var meshTransform = root.transform.Find(CardPaths.LayoutMeshObject);
                if (meshTransform == null)
                    throw new InvalidOperationException($"{CardPaths.Layout} needs a child called '{CardPaths.LayoutMeshObject}' (the card mesh).");
                var meshObject = meshTransform.gameObject;
                var filter = meshObject.GetComponent<MeshFilter>();
                if (filter == null) filter = meshObject.AddComponent<MeshFilter>();
                filter.sharedMesh = mesh;
                var meshRenderer = meshObject.GetComponent<MeshRenderer>();
                if (meshRenderer == null) meshRenderer = meshObject.AddComponent<MeshRenderer>();
                meshRenderer.sharedMaterials = new[] { material, EdgeMaterial() };
                LikeVanillaItem(meshRenderer);

                // The client stacks each card copy's layers with this shader (CardLayers.cs). A disabled renderer brings it
                // into every card bundle (an asset can't be put into two bundles by name).
                var composite = new GameObject(CardPaths.LayerCompositeObject);
                composite.transform.SetParent(root.transform, false);
                var compositeRenderer = composite.AddComponent<MeshRenderer>();
                compositeRenderer.sharedMaterial = LayerCompositeMaterial();
                compositeRenderer.enabled = false;

                var glow = new GameObject(CardPaths.GlowObject);
                glow.transform.SetParent(meshObject.transform, false);
                glow.AddComponent<MeshFilter>().sharedMesh = BuildGlowMesh(mesh);
                var glowRenderer = glow.AddComponent<MeshRenderer>();
                glowRenderer.sharedMaterial = GlowMaterial();
                glowRenderer.shadowCastingMode = ShadowCastingMode.Off;
                glowRenderer.motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
                LikeVanillaItem(glowRenderer);
                glowRenderer.enabled = false;

                var box = meshObject.GetComponent<BoxCollider>();
                if (box == null) box = meshObject.AddComponent<BoxCollider>();
                box.center = mesh.bounds.center;
                box.size = Vector3.Max(mesh.bounds.size, new Vector3(0f, 0.002f, 0f));

                foreach (var text in root.GetComponentsInChildren<TMPro.TMP_Text>(true))
                    text.fontSharedMaterial = CardTextMaterial(text.fontSharedMaterial);

                var names = root.GetComponentsInChildren<TMPro.TMP_Text>(true).Count(t => t.name == CardPaths.NameObject);
                Debug.Log($"[DaCard] {type.type}: {names} '{CardPaths.NameObject}' text(s) in the layout get the card name in game.");

                var pivot = root.GetComponent<PreviewPivot>();
                var logEnabled = Debug.unityLogger.logEnabled;
                Debug.unityLogger.logEnabled = false;
                try
                {
                    if (pivot == null)
                        pivot = root.AddComponent<PreviewPivot>();
                }
                finally
                {
                    Debug.unityLogger.logEnabled = logEnabled;
                }
                pivot.pivotPosition = mesh.bounds.center;
                pivot.pivotRotation = FrontFacing;
                pivot.scale = Vector3.one * Mathf.Max(0.1f, CardBuildSettings.LoadOrCreate().previewScale);
                var iconRotation = Quaternion.Euler(CardBuildSettings.LoadOrCreate().cardIconAngles) * FrontFacing;
                pivot.Icon = new PreviewPivot.IconSettings
                {
                    rotation = iconRotation,
                    rotationEuler = iconRotation.eulerAngles,
                    boundsScale = 0.9f
                };

                Directory.CreateDirectory(CardPaths.PrefabsDir);
                return PrefabUtility.SaveAsPrefabAsset(root, CardPaths.Prefab(type.type));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static Material CardTextMaterial(Material source)
        {
            if (source == null)
                return null;
            var shader = AssetDatabase.LoadAssetAtPath<Shader>(CardPaths.TextShader)
                         ?? throw new InvalidOperationException("Missing " + CardPaths.TextShader);
            if (source.shader == shader)
                return source;

            var copy = new Material(source) { shader = shader };
            var path = $"{CardPaths.Generated}/text_{System.Text.RegularExpressions.Regex.Replace(source.name, "[^A-Za-z0-9_-]+", "_")}.mat";
            copy.name = Path.GetFileNameWithoutExtension(path);
            return SaveGenerated(copy, path);
        }

        private static void ConfigureModelImport()
        {
            var importer = (ModelImporter)AssetImporter.GetAtPath(CardPaths.Model);
            var changed = importer.materialImportMode != ModelImporterMaterialImportMode.None
                          || importer.importCameras || importer.importLights || importer.importAnimation;
            if (!changed)
                return;

            importer.materialImportMode = ModelImporterMaterialImportMode.None;
            importer.importCameras = false;
            importer.importLights = false;
            importer.importAnimation = false;
            importer.animationType = ModelImporterAnimationType.None;
            importer.SaveAndReimport();
        }

        private static Mesh BuildRuntimeMesh(Mesh source)
        {
            var front = FaceRect(source, +1);
            var back = FaceRect(source, -1);

            var mesh = UnityEngine.Object.Instantiate(source);
            mesh.name = "card_mesh";

            var normals = mesh.normals;
            var atlas = mesh.uv;
            var uv0 = new Vector2[atlas.Length];
            var uv1 = new List<Vector4>(atlas.Length);
            for (var i = 0; i < atlas.Length; i++)
            {
                var face = normals[i].y > 0.9f ? 1 : normals[i].y < -0.9f ? -1 : 0;
                uv0[i] = face switch
                {
                    1 => Remap(atlas[i], front),
                    -1 => Remap(atlas[i], back),
                    _ => atlas[i]
                };
                uv1.Add(new Vector4(atlas[i].x, atlas[i].y, face, 0));
            }

            mesh.uv = uv0;
            mesh.SetUVs(1, uv1);

            var triangles = mesh.triangles;
            var faces = new List<int>(triangles.Length);
            var edges = new List<int>();
            for (var t = 0; t < triangles.Length; t += 3)
            {
                var onFace = Mathf.Abs(normals[triangles[t]].y) > 0.9f && Mathf.Abs(normals[triangles[t + 1]].y) > 0.9f
                             && Mathf.Abs(normals[triangles[t + 2]].y) > 0.9f;
                (onFace ? faces : edges).AddRange(new[] { triangles[t], triangles[t + 1], triangles[t + 2] });
            }
            mesh.subMeshCount = 2;
            mesh.SetTriangles(faces, 0);
            mesh.SetTriangles(edges, 1);
            Debug.Log($"[DaCard] Card mesh: {faces.Count / 3} front / back triangles, {edges.Count / 3} edge triangles.");

            mesh.RecalculateTangents();
            mesh.UploadMeshData(false);
            return mesh;
        }

        private static Vector2 Remap(Vector2 uv, Vector4 rect) => new Vector2((uv.x - rect.x) / rect.z, (uv.y - rect.y) / rect.w);

        internal static Vector4 FaceRect(Mesh mesh, int side)
        {
            var normals = mesh.normals;
            var uvs = mesh.uv;
            var verts = mesh.vertices;
            var face = Enumerable.Range(0, mesh.vertexCount).Where(i => normals[i].y * side > 0.9f).ToArray();
            if (face.Length < 3)
                throw new InvalidOperationException($"No {(side > 0 ? "+Y (front)" : "-Y (back)")} face in {CardPaths.Model}. The card must lie flat, front facing +Y in Unity (+Z in Blender).");

            var right = side > 0 ? Vector3.right : Vector3.left;
            var up = Vector3.forward;

            var uMin = face.Min(i => uvs[i].x); var uMax = face.Max(i => uvs[i].x);
            var vMin = face.Min(i => uvs[i].y); var vMax = face.Max(i => uvs[i].y);

            var uAlongRight = Correlation(face, i => Vector3.Dot(verts[i], right), i => uvs[i].x);
            var vAlongRight = Correlation(face, i => Vector3.Dot(verts[i], right), i => uvs[i].y);
            if (Mathf.Abs(vAlongRight) > Mathf.Abs(uAlongRight))
                throw new InvalidOperationException("The card face UVs are rotated 90°. Unwrap the face so U runs along the card width.");
            var vAlongUp = Correlation(face, i => Vector3.Dot(verts[i], up), i => uvs[i].y);

            return new Vector4(
                uAlongRight >= 0 ? uMin : uMax, vAlongUp >= 0 ? vMin : vMax,
                uAlongRight >= 0 ? uMax - uMin : uMin - uMax, vAlongUp >= 0 ? vMax - vMin : vMin - vMax);
        }

        private static float Correlation(int[] idx, Func<int, float> a, Func<int, float> b)
        {
            var ma = idx.Average(a); var mb = idx.Average(b);
            return idx.Sum(i => (a(i) - ma) * (b(i) - mb));
        }

        private static Material BuildRuntimeMaterial(CardBuildSettings.CardType type)
        {
            var source = type.material;
            var runtime = CleanCopy(source, "card_runtime_" + type.type);
            if (!runtime.HasProperty("_MainTex"))
                Debug.LogWarning($"[DaCard] {type.type}: shader '{source.shader.name}' has no _MainTex property. " +
                                 "The card art is put into _MainTex, so name your art texture property _MainTex (in Amplify: " +
                                 "select the texture property node, Property Name) or the card will show no art.");

            var cleared = new List<string>();
            foreach (var property in RuntimeTextureProperties())
            {
                if (runtime.HasProperty(property) && runtime.GetTexture(property) != null)
                {
                    runtime.SetTexture(property, null);
                    cleared.Add(property);
                }
            }

            var overlayProperty = OverlayProperty();
            if (runtime.HasProperty(overlayProperty))
            {
                runtime.SetTexture(overlayProperty, ClearTexture());
                cleared.Add(overlayProperty + " (no frame)");
            }

            var packed = runtime.GetTexturePropertyNames()
                .Where(p => runtime.GetTexture(p) != null && p != overlayProperty)
                .Select(p => $"{p} = {AssetDatabase.GetAssetPath(runtime.GetTexture(p))}")
                .ToList();

            Debug.Log($"[DaCard] {type.type}: material '{source.name}' ({source.shader.name}). " +
                      $"Per-card slots cleared: {(cleared.Count > 0 ? string.Join(", ", cleared) : "none")}");
            if (packed.Count > 0)
                Debug.LogWarning($"[DaCard] {type.type}: these textures on the material will be SHIPPED inside the bundle " +
                                 "(fine for shared textures like noise/foil patterns; not for card art):\n  " + string.Join("\n  ", packed));
            return runtime;
        }

        private static Material CleanCopy(Material source, string copyName)
        {
            var shader = source.shader;
            var copy = new Material(shader) { name = copyName };
            for (var i = 0; i < shader.GetPropertyCount(); i++)
            {
                var name = shader.GetPropertyName(i);
                switch (shader.GetPropertyType(i))
                {
                    case ShaderPropertyType.Color: copy.SetColor(name, source.GetColor(name)); break;
                    case ShaderPropertyType.Vector: copy.SetVector(name, source.GetVector(name)); break;
                    case ShaderPropertyType.Float:
                    case ShaderPropertyType.Range: copy.SetFloat(name, source.GetFloat(name)); break;
                    case ShaderPropertyType.Int: copy.SetInteger(name, source.GetInteger(name)); break;
                    case ShaderPropertyType.Texture:
                        copy.SetTexture(name, source.GetTexture(name));
                        copy.SetTextureScale(name, source.GetTextureScale(name));
                        copy.SetTextureOffset(name, source.GetTextureOffset(name));
                        break;
                }
            }
            copy.shaderKeywords = source.shaderKeywords;
            copy.renderQueue = source.renderQueue;
            copy.enableInstancing = source.enableInstancing;
            return copy;
        }

        private static string OverlayProperty()
        {
            try
            {
                var config = JsonUtility.FromJson<ServerConfig>(File.ReadAllText(CardPaths.ServerConfig));
                if (!string.IsNullOrEmpty(config?.overlayProperty))
                    return config.overlayProperty;
            }
            catch (Exception)
            {
            }
            return "_CARD_FRONT_BORDER";
        }

        private static Material EdgeMaterial()
        {
            var shader = AssetDatabase.LoadAssetAtPath<Shader>(CardPaths.EdgeShader)
                         ?? throw new InvalidOperationException("Missing " + CardPaths.EdgeShader);
            var settings = CardBuildSettings.LoadOrCreate();
            var material = new Material(shader) { name = "card_edge" };
            material.SetColor("_Color", settings.cardEdgeColor);
            material.SetFloat("_Glossiness", settings.cardEdgeSmoothness);
            return SaveGenerated(material, CardPaths.EdgeMaterial);
        }

        private static Material LayerCompositeMaterial()
        {
            var shader = AssetDatabase.LoadAssetAtPath<Shader>(CardPaths.LayerCompositeShader)
                         ?? throw new InvalidOperationException("Missing " + CardPaths.LayerCompositeShader);
            return SaveGenerated(new Material(shader) { name = "card_layer_composite" }, CardPaths.LayerCompositeMaterial);
        }

        private static Material GlowMaterial()
        {
            var shader = AssetDatabase.LoadAssetAtPath<Shader>(CardPaths.GlowShader)
                         ?? throw new InvalidOperationException("Missing " + CardPaths.GlowShader);
            return SaveGenerated(new Material(shader) { name = "card_glow" }, CardPaths.GlowMaterial);
        }

        internal const float GlowMargin = 0.45f;

        private static Mesh BuildGlowMesh(Mesh card)
        {
            var bounds = card.bounds;
            var centre = bounds.center;
            var halfWidth = bounds.extents.x;
            var halfHeight = bounds.extents.z;
            var margin = GlowMargin * halfHeight;
            var radius = Mathf.Clamp(CornerRadius(card, bounds), 0f, Mathf.Min(halfWidth, halfHeight));

            var outer = new Vector2(halfWidth + margin, halfHeight + margin);
            var inner = new Vector2(halfWidth - radius, halfHeight - radius) * 0.98f;
            var corners = new[] { new Vector2(-1, -1), new Vector2(-1, 1), new Vector2(1, 1), new Vector2(1, -1) };
            var points = corners.Select(c => Vector2.Scale(c, outer)).Concat(corners.Select(c => Vector2.Scale(c, inner))).ToArray();

            var glow = new Mesh { name = "card_glow_mesh" };
            glow.vertices = points.Select(p => new Vector3(centre.x + p.x, centre.y, centre.z + p.y)).ToArray();
            glow.normals = points.Select(_ => Vector3.up).ToArray();
            glow.uv = points;
            glow.SetUVs(1, points.Select(_ => new Vector4(halfWidth, halfHeight, radius, margin)).ToList());
            var triangles = new List<int>();
            for (var i = 0; i < 4; i++)
            {
                var next = (i + 1) % 4;
                triangles.AddRange(new[] { i, next, 4 + i, next, 4 + next, 4 + i });
            }
            glow.SetTriangles(triangles, 0);
            glow.bounds = bounds;
            glow.UploadMeshData(false);
            return SaveGenerated(glow, CardPaths.GlowMesh);
        }

        private static float CornerRadius(Mesh card, Bounds bounds)
        {
            var top = card.vertices.Where(v => v.z > bounds.max.z - 1e-5f).ToList();
            return top.Count == 0 ? 0f : bounds.extents.x - top.Max(v => Mathf.Abs(v.x - bounds.center.x));
        }

        private static Texture2D ClearTexture()
        {
            var path = CardPaths.Generated + "/clear.png";
            var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            if (texture != null)
                return texture;
            var clear = new Texture2D(4, 4, TextureFormat.RGBA32, false);
            clear.SetPixels(Enumerable.Repeat(new Color(0, 0, 0, 0), 16).ToArray());
            File.WriteAllBytes(path, clear.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(clear);
            AssetDatabase.ImportAsset(path);
            var importer = (TextureImporter)AssetImporter.GetAtPath(path);
            importer.alphaIsTransparency = true;
            importer.mipmapEnabled = false;
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            importer.SaveAndReimport();
            return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        }

        private static IEnumerable<string> RuntimeTextureProperties()
        {
            var properties = new List<string> { "_MainTex", "_HeightMap", "_HoloMask" };
            try
            {
                var config = JsonUtility.FromJson<ServerConfig>(File.ReadAllText(CardPaths.ServerConfig));
                if (config?.textures != null && config.textures.Length > 0)
                    properties = config.textures.Select(t => t.property).Where(p => !string.IsNullOrEmpty(p)).ToList();
            }
            catch (Exception e)
            {
                Debug.LogWarning("[DaCard] Could not read texture slots from server config.json: " + e.Message);
            }
            return properties;
        }

        private static T SaveGenerated<T>(T generated, string path) where T : UnityEngine.Object
        {
            var existing = AssetDatabase.LoadAssetAtPath<T>(path);
            if (existing == null)
            {
                AssetDatabase.CreateAsset(generated, path);
                return generated;
            }

            EditorUtility.CopySerialized(generated, existing);
            existing.name = Path.GetFileNameWithoutExtension(path);
            EditorUtility.SetDirty(existing);
            AssetDatabase.SaveAssetIfDirty(existing);
            UnityEngine.Object.DestroyImmediate(generated);
            return existing;
        }

        private static List<string> BuildAssetBundles(Dictionary<string, GameObject> bundles)
        {
            var outDir = CardPaths.BuildOutputDir;
            Directory.CreateDirectory(outDir);

            var builds = new List<AssetBundleBuild>();
            foreach (var (key, prefab) in bundles)
            {
                var assets = new List<string> { AssetDatabase.GetAssetPath(prefab) };

                var shader = prefab.GetComponentInChildren<MeshRenderer>().sharedMaterial.shader;
                var iconShader = Shader.Find(shader.name + "_Icon");
                var iconShaderPath = iconShader != null ? AssetDatabase.GetAssetPath(iconShader) : null;
                if (!string.IsNullOrEmpty(iconShaderPath) && iconShaderPath.StartsWith("Assets/"))
                {
                    assets.Add(iconShaderPath);
                    Debug.Log($"[DaCard] {key}: including icon shader '{iconShader.name}'");
                }

                builds.Add(new AssetBundleBuild { assetBundleName = key, assetNames = assets.ToArray() });
            }

            var manifest = BuildPipeline.BuildAssetBundles(outDir, builds.ToArray(),
                BuildAssetBundleOptions.ChunkBasedCompression | BuildAssetBundleOptions.StrictMode,
                BuildTarget.StandaloneWindows64);
            if (manifest == null)
                throw new InvalidOperationException("Asset bundle build failed");

            var keys = bundles.Keys.ToList();
            var bundleRoots = new List<string> { CardPaths.ServerBundlesDir };
            var gameModDir = GameModDir();
            if (gameModDir != null)
                bundleRoots.Add(Path.Combine(gameModDir, "bundles"));

            var copies = new List<string>();
            foreach (var root in bundleRoots)
            {
                foreach (var key in keys)
                {
                    var target = Path.Combine(root, key);
                    Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                    File.Copy(Path.Combine(outDir, key), target, overwrite: true);
                    copies.Add(target);
                }

                var current = new HashSet<string>(keys.Select(k => Path.GetFullPath(Path.Combine(root, k))), StringComparer.OrdinalIgnoreCase);
                foreach (var old in Directory.GetFiles(Path.Combine(root, CardPaths.BundleFolder), "item_card*.bundle"))
                {
                    if (current.Contains(Path.GetFullPath(old)))
                        continue;
                    File.Delete(old);
                    Debug.Log("[DaCard] Removed old bundle " + old);
                }
            }

            WriteBundlesJson(CardPaths.ServerBundlesJson, keys);
            if (gameModDir != null)
                WriteBundlesJson(Path.Combine(gameModDir, "bundles.json"), keys);
            return copies;
        }

        private static void WriteBundlesJson(string path, IEnumerable<string> keys)
        {
            var entries = keys.Select(k => $"    {{\n      \"key\": \"{k}\",\n      \"dependencyKeys\": []\n    }}");
            File.WriteAllText(path, "{\n  \"manifest\": [\n" + string.Join(",\n", entries) + "\n  ]\n}\n");
        }

        internal static string GameModDir()
        {
            try
            {
                var props = Path.Combine(CardPaths.RepoRoot, "Directory.Build.props");
                var group = XDocument.Load(props).Root!.Elements("PropertyGroup").First();
                string Get(string name) => group.Element(name)?.Value.Trim();
                var local = props + ".user";
                var gameDir = File.Exists(local) ? XDocument.Load(local).Descendants("SptGameDir").FirstOrDefault()?.Value.Trim() : null;
                if (string.IsNullOrEmpty(gameDir))
                    gameDir = Get("SptGameDir");
                if (string.IsNullOrEmpty(gameDir))
                    gameDir = Environment.GetEnvironmentVariable("SptGameDir");
                if (string.IsNullOrEmpty(gameDir))
                    return null;
                var dir = Path.Combine(gameDir, "SPT_Runtime", "user", "mods", $"{Get("ModAuthor")}-{Get("ModName")}");
                return Directory.Exists(dir) ? dir : null;
            }
            catch (Exception e)
            {
                Debug.LogWarning("[DaCard] Could not work out the game mod folder: " + e.Message);
                return null;
            }
        }
    }
}
