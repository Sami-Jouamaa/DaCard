using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace DaCard.Editor
{
    public static class BinderBuilder
    {
        public static readonly string Model = CardPaths.Root + "/Models/BINDER_DEFAULT.fbx";
        public static readonly string Material = CardPaths.Root + "/Materials/binder.mat";
        public static readonly string TexturesDir = CardPaths.Root + "/Textures/Binder";
        public static readonly string MainTex = TexturesDir + "/EFT/binder_main.png";
        public static readonly string GlossTex = TexturesDir + "/EFT/binder_gloss.png";
        public static readonly string NormalTex = TexturesDir + "/EFT/binder_normal.png";
        public static readonly string BaseColorTex = TexturesDir + "/binder_Base_color.png";
        public static readonly string BinderShader = CardPaths.Root + "/Shaders/Binder.shader";
        public static readonly string StickerShader = CardPaths.Root + "/Shaders/BinderSticker.shader";
        public static readonly string StickerMaterial = CardPaths.Generated + "/binder_sticker.mat";
        public static readonly string StickerMesh = CardPaths.Generated + "/binder_sticker_mesh.asset";
        public const string PrefabName = "item_binder";
        public static readonly string Prefab = CardPaths.PrefabsDir + "/" + PrefabName + ".prefab";
        public const string BundleKey = CardPaths.BundleFolder + "/" + PrefabName + ".bundle";
        public const string StickerObject = "sticker";

        private struct Cover
        {
            public Vector3 Center, Right, Up, Normal;
            public float Width, Height;
            public float Thickness;
        }

        private struct Shell
        {
            public Mesh Mesh;
            public int[] Source;
            public float SpineLength;
            public float XMin;
            public float VMin, VMax;
        }

        public static GameObject BuildPrefab()
        {
            ConfigureImports();
            var mesh = AssetDatabase.LoadAllAssetsAtPath(Model).OfType<Mesh>().FirstOrDefault()
                       ?? throw new InvalidOperationException("No mesh in " + Model);
            var cover = FindCover(mesh);
            var material = LoadOrCreateMaterial();

            var root = new GameObject(PrefabName);
            try
            {
                var body = new GameObject("binder_mesh");
                body.transform.SetParent(root.transform, false);
                body.AddComponent<MeshFilter>().sharedMesh = mesh;
                var bodyRenderer = body.AddComponent<MeshRenderer>();
                bodyRenderer.sharedMaterial = material;
                CardBundleBuilder.LikeVanillaItem(bodyRenderer);
                var box = body.AddComponent<BoxCollider>();
                box.center = mesh.bounds.center;
                box.size = mesh.bounds.size;

                var sticker = new GameObject(StickerObject);
                sticker.transform.SetParent(root.transform, false);
                var shell = BuildStickerShell(mesh, cover);
                shell.Mesh = SaveGenerated(shell.Mesh, StickerMesh);
                sticker.AddComponent<MeshFilter>().sharedMesh = shell.Mesh;
                var stickerMaterial = SaveGenerated(new Material(AssetDatabase.LoadAssetAtPath<Shader>(StickerShader)
                                                                 ?? throw new InvalidOperationException("Missing " + StickerShader)), StickerMaterial);
                stickerMaterial.SetVector("_CoverSize", new Vector4(cover.Width, cover.Height, 0, 0));
                stickerMaterial.SetFloat("_EdgeStrength", CardBuildSettings.LoadOrCreate().stickerBump);
                EditorUtility.SetDirty(stickerMaterial);
                var stickerRenderer = sticker.AddComponent<MeshRenderer>();
                stickerRenderer.sharedMaterial = stickerMaterial;
                stickerRenderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                CardBundleBuilder.LikeVanillaItem(stickerRenderer);

                var toCamera = Quaternion.Inverse(Quaternion.LookRotation(-cover.Normal, cover.Up));
                PreviewPivot pivot;
                var logEnabled = Debug.unityLogger.logEnabled;
                Debug.unityLogger.logEnabled = false;
                try { pivot = root.AddComponent<PreviewPivot>(); }
                finally { Debug.unityLogger.logEnabled = logEnabled; }
                pivot.pivotPosition = mesh.bounds.center;
                pivot.pivotRotation = toCamera;
                pivot.scale = Vector3.one;
                var angles = CardBuildSettings.LoadOrCreate().binderIconAngles;
                var iconRotation = Quaternion.Euler(angles) * toCamera;
                pivot.Icon = new PreviewPivot.IconSettings { rotation = iconRotation, rotationEuler = iconRotation.eulerAngles, boundsScale = 0.9f };

                Directory.CreateDirectory(CardPaths.PrefabsDir);
                var prefab = PrefabUtility.SaveAsPrefabAsset(root, Prefab);
                if (SystemInfo.graphicsDeviceType == UnityEngine.Rendering.GraphicsDeviceType.Null)
                    Debug.LogWarning("[DaCard] No graphics device (-nographics): the Card Creator's binder views were not re-exported.");
                else
                {
                    RenderFrontPreview(mesh, cover);
                    RenderBandPreview(mesh, cover, shell);
                    ExportModelForCreator(mesh, cover, shell);
                }
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
            SetTexture(NormalTex, TextureImporterType.NormalMap, srgb: false, fadeMips: false);
            SetTexture(MainTex, TextureImporterType.Default, srgb: true, fadeMips: false);
            SetTexture(GlossTex, TextureImporterType.Default, srgb: false, fadeMips: false);
        }

        private const int Aniso = 8;
        private const int FadeStart = 1, FadeEnd = 3;

        private static void SetTexture(string path, TextureImporterType type, bool srgb, bool fadeMips)
        {
            if (AssetImporter.GetAtPath(path) is not TextureImporter importer)
                throw new InvalidOperationException($"Missing {path} (run tools/make_binder_textures.py)");
            if (importer.textureType == type && importer.sRGBTexture == srgb && importer.anisoLevel == Aniso && importer.mipmapEnabled
                && importer.fadeout == fadeMips && (!fadeMips || (importer.mipmapFadeDistanceStart == FadeStart && importer.mipmapFadeDistanceEnd == FadeEnd)))
                return;
            importer.textureType = type;
            importer.sRGBTexture = srgb;
            importer.mipmapEnabled = true;
            importer.anisoLevel = Aniso;
            importer.fadeout = fadeMips;
            if (fadeMips)
            {
                importer.mipmapFadeDistanceStart = FadeStart;
                importer.mipmapFadeDistanceEnd = FadeEnd;
            }
            importer.SaveAndReimport();
        }

        private static Material LoadOrCreateMaterial()
        {
            var material = AssetDatabase.LoadAssetAtPath<Material>(Material);
            if (material != null)
            {
                var changed = false;
                foreach (var (property, path) in new[] { ("_MainTex", MainTex), ("_SpecMap", GlossTex), ("_BumpMap", NormalTex) })
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

            var shader = AssetDatabase.LoadAssetAtPath<Shader>(BinderShader) ?? throw new InvalidOperationException("Missing " + BinderShader);
            material = new Material(shader) { name = "binder" };
            material.SetTexture("_MainTex", AssetDatabase.LoadAssetAtPath<Texture2D>(MainTex));
            material.SetTexture("_SpecMap", AssetDatabase.LoadAssetAtPath<Texture2D>(GlossTex));
            material.SetTexture("_BumpMap", AssetDatabase.LoadAssetAtPath<Texture2D>(NormalTex));
            AssetDatabase.CreateAsset(material, Material);
            Debug.Log($"[DaCard] Created {Material}. Tune colour / shine / gloss / normal strength in the inspector; it isn't overwritten.");
            return material;
        }

        private static Cover FindCover(Mesh mesh)
        {
            var verts = mesh.vertices;
            var normals = mesh.normals;
            var bounds = mesh.bounds;

            Cover Side(int sign)
            {
                var n = new Vector3(0, 0, sign);
                var face = Enumerable.Range(0, verts.Length).Where(i => Vector3.Dot(normals[i], n) > 0.98f).ToArray();
                var outer = face.Max(i => verts[i].z * sign);
                var onCover = face.Where(i => verts[i].z * sign > outer - bounds.size.z * 0.06f).Select(i => verts[i]).ToArray();
                float x0 = onCover.Min(v => v.x), x1 = onCover.Max(v => v.x), y0 = onCover.Min(v => v.y), y1 = onCover.Max(v => v.y);
                var right = new Vector3(-sign, 0, 0);
                return new Cover
                {
                    Center = new Vector3((x0 + x1) / 2, (y0 + y1) / 2, outer * sign),
                    Right = right, Up = Vector3.up, Normal = n,
                    Width = x1 - x0, Height = y1 - y0
                };
            }

            var plus = Side(+1);
            var coverMinX = plus.Center.x - plus.Width / 2;
            var coverMaxX = plus.Center.x + plus.Width / 2;
            var spineOnPlusX = bounds.max.x - coverMaxX > coverMinX - bounds.min.x;
            var cover = spineOnPlusX ? plus : Side(-1);
            var back = spineOnPlusX ? Side(-1) : plus;
            cover.Thickness = Vector3.Dot(cover.Center - back.Center, cover.Normal);
            Debug.Log($"[DaCard] Binder front cover faces {(cover.Normal.z > 0 ? "+Z" : "-Z")}, {cover.Width:0.###} x {cover.Height:0.###}, {cover.Thickness:0.###} thick");
            return cover;
        }

        private static Shell BuildStickerShell(Mesh mesh, Cover c)
        {
            var verts = mesh.vertices;
            var normals = mesh.normals;
            var triangles = mesh.triangles;
            float W = c.Width, H = c.Height, T = Mathf.Max(c.Thickness, 1e-4f);
            var toSpine = -c.Right;

            Vector2 DE(Vector3 v) => new Vector2(Vector3.Dot(v - c.Center, toSpine), Vector3.Dot(c.Center - v, c.Normal));
            var o = new Vector2(W / 2 - Mathf.Min(T / 2, W * 0.1f), T / 2);
            const int bins = 120;
            float AngleOf(Vector2 de) => Mathf.Atan2(de.y - o.y, de.x - o.x);
            var a0 = AngleOf(new Vector2(W / 2, 0));
            var a1 = AngleOf(new Vector2(W / 2, T));

            var radius = new float[bins];
            void Sample(Vector2 de)
            {
                var a = AngleOf(de);
                if (a <= a0 || a >= a1) return;
                var bin = Mathf.Clamp(Mathf.FloorToInt((a - a0) / (a1 - a0) * bins), 0, bins - 1);
                radius[bin] = Mathf.Max(radius[bin], Vector2.Distance(de, o));
            }
            var spineSide = verts.Select(v => DE(v)).ToArray();
            for (var t = 0; t < triangles.Length; t += 3)
            {
                for (var k = 0; k < 3; k++)
                {
                    Vector2 p0 = spineSide[triangles[t + k]], p1 = spineSide[triangles[t + (k + 1) % 3]];
                    if (p0.x < W / 2 - W * 0.002f || p1.x < W / 2 - W * 0.002f) continue;
                    for (var j = 0; j <= 8; j++)
                        Sample(Vector2.Lerp(p0, p1, j / 8f));
                }
            }
            var outline = new List<Vector2> { new Vector2(W / 2, 0) };
            var outlineAngle = new List<float> { a0 };
            for (var k = 0; k < bins; k++)
            {
                if (radius[k] <= 0) continue;
                var angle = a0 + (k + 0.5f) / bins * (a1 - a0);
                outline.Add(o + radius[k] * new Vector2(Mathf.Cos(angle), Mathf.Sin(angle)));
                outlineAngle.Add(angle);
            }
            outline.Add(new Vector2(W / 2, T));
            outlineAngle.Add(a1);
            var arc = new float[outline.Count];
            for (var k = 1; k < outline.Count; k++)
                arc[k] = arc[k - 1] + Vector2.Distance(outline[k - 1], outline[k]);
            var spine = arc[arc.Length - 1];

            float BandU(Vector3 v)
            {
                var de = DE(v);
                if (de.x <= W / 2)
                    return de.y < T / 2 ? 0.5f - de.x / W : -spine / W - (W / 2 - de.x) / W;
                var a = Mathf.Clamp(AngleOf(de), a0, a1);
                var i0 = 0;
                while (i0 < outlineAngle.Count - 2 && outlineAngle[i0 + 1] < a) i0++;
                var f = Mathf.InverseLerp(outlineAngle[i0], outlineAngle[i0 + 1], a);
                return -Mathf.Lerp(arc[i0], arc[i0 + 1], f) / W;
            }

            bool Outside(int i)
            {
                var n = normals[i];
                if (Mathf.Abs(Vector3.Dot(n, c.Up)) > 0.7f)
                    return false;
                var de = DE(verts[i]);
                if (de.x <= W / 2 - W * 0.002f)
                    return de.y < T / 2
                        ? Vector3.Dot(n, c.Normal) > 0.5f && de.y < T * 0.25f
                        : Vector3.Dot(n, -c.Normal) > 0.5f && de.y > T * 0.75f;
                var rel = de - o;
                var outward = (toSpine * rel.x - c.Normal * rel.y).normalized;
                return Vector3.Dot(n, outward) > 0.3f;
            }

            var lift = Mathf.Max(0.0005f, H * 0.001f);
            var map = new Dictionary<int, int>();
            var source = new List<int>();
            var positions = new List<Vector3>();
            var shellNormals = new List<Vector3>();
            var uvs = new List<Vector2>();
            var shellTriangles = new List<int>();
            for (var t = 0; t < triangles.Length; t += 3)
            {
                if (!Outside(triangles[t]) || !Outside(triangles[t + 1]) || !Outside(triangles[t + 2]))
                    continue;
                for (var k = 0; k < 3; k++)
                {
                    var i = triangles[t + k];
                    if (!map.TryGetValue(i, out var j))
                    {
                        j = positions.Count;
                        map[i] = j;
                        source.Add(i);
                        positions.Add(verts[i] + normals[i] * lift);
                        shellNormals.Add(normals[i]);
                        uvs.Add(new Vector2(BandU(verts[i]), Vector3.Dot(verts[i] - c.Center, c.Up) / H + 0.5f));
                    }
                    shellTriangles.Add(j);
                }
            }
            if (shellTriangles.Count == 0)
                throw new InvalidOperationException("The binder model has no outer front / spine / back faces for stickers.");

            var shell = new Mesh { name = "binder_sticker_mesh", indexFormat = positions.Count > 65000 ? UnityEngine.Rendering.IndexFormat.UInt32 : UnityEngine.Rendering.IndexFormat.UInt16 };
            shell.SetVertices(positions);
            shell.SetNormals(shellNormals);
            shell.SetUVs(0, uvs);
            shell.SetTriangles(shellTriangles, 0);
            shell.RecalculateTangents();
            shell.RecalculateBounds();
            var xMin = -(spine / W) - 1;
            Debug.Log($"[DaCard] Sticker shell: {shellTriangles.Count / 3} triangles; spine {spine:0.###} around; band x {xMin:0.###} .. 1 (front 0..1).");
            return new Shell
            {
                Mesh = shell, Source = source.ToArray(), SpineLength = spine, XMin = xMin,
                VMin = uvs.Min(u => u.y), VMax = uvs.Max(u => u.y)
            };
        }

        private static void RenderBandPreview(Mesh mesh, Cover cover, Shell shell)
        {
            var uvBand = new List<Vector2>();
            shell.Mesh.GetUVs(0, uvBand);
            var sourceUv = mesh.uv;
            var flat = new Mesh { indexFormat = shell.Mesh.indexFormat };
            flat.SetVertices(uvBand.Select(u => new Vector3(u.x * cover.Width, u.y * cover.Height, 0)).ToList());
            flat.SetUVs(0, shell.Source.Select(i => sourceUv[i]).ToList());
            var tris = shell.Mesh.triangles;
            var both = new List<int>(tris);
            for (var t = 0; t < tris.Length; t += 3)
                both.AddRange(new[] { tris[t], tris[t + 2], tris[t + 1] });
            flat.SetTriangles(both, 0);
            flat.RecalculateBounds();

            float x0 = shell.XMin * cover.Width, x1 = cover.Width, y0 = shell.VMin * cover.Height, y1 = shell.VMax * cover.Height;
            const int height = 900;
            var width = Mathf.RoundToInt(height * (x1 - x0) / (y1 - y0));

            var scene = EditorSceneManager.NewPreviewScene();
            var rt = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
            var material = new Material(Shader.Find("Unlit/Texture"));
            GameObject cameraObject = null;
            try
            {
                material.mainTexture = AssetDatabase.LoadAssetAtPath<Texture2D>(MainTex);
                var go = new GameObject("band", typeof(MeshFilter), typeof(MeshRenderer));
                go.GetComponent<MeshFilter>().sharedMesh = flat;
                go.GetComponent<MeshRenderer>().sharedMaterial = material;
                SceneManager.MoveGameObjectToScene(go, scene);

                cameraObject = new GameObject("camera", typeof(Camera));
                SceneManager.MoveGameObjectToScene(cameraObject, scene);
                var camera = cameraObject.GetComponent<Camera>();
                camera.scene = scene;
                camera.orthographic = true;
                camera.orthographicSize = (y1 - y0) / 2;
                camera.aspect = (float)width / height;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0, 0, 0, 0);
                camera.nearClipPlane = 0.01f;
                camera.farClipPlane = 10f;
                camera.transform.position = new Vector3((x0 + x1) / 2, (y0 + y1) / 2, -1);
                camera.transform.rotation = Quaternion.identity;
                camera.targetTexture = rt;
                camera.Render();

                var previous = RenderTexture.active;
                RenderTexture.active = rt;
                var image = new Texture2D(width, height, TextureFormat.RGBA32, false);
                image.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                image.Apply();
                RenderTexture.active = previous;

                string N(float v) => v.ToString("0.#####", System.Globalization.CultureInfo.InvariantCulture);
                var script = "// Generated by the Unity card builder (BinderBuilder): the sticker band unrolled (back | spine | front, seen from outside).\n" +
                             "// x in front-cover widths (front 0..1, spine and back negative), y in cover heights from the front's top.\n" +
                             "window.CC_BINDER_BAND = {\n" +
                             $"  \"image\": \"creator/binder_band.png\",\n  \"width\": {width},\n  \"height\": {height},\n" +
                             $"  \"xMin\": {N(shell.XMin)}, \"xMax\": 1, \"yMin\": {N(1 - shell.VMax)}, \"yMax\": {N(1 - shell.VMin)},\n" +
                             $"  \"spine\": [{N(-shell.SpineLength / cover.Width)}, 0]\n" +
                             "};\n";
                var png = image.EncodeToPNG();
                UnityEngine.Object.DestroyImmediate(image);
                var gameModDir = CardBundleBuilder.GameModDir();
                var targets = new[] { Path.Combine(CardPaths.RepoRoot, "src", "DaCard.Server", "creator"), gameModDir != null ? Path.Combine(gameModDir, "creator") : null };
                foreach (var creatorDir in targets.Where(t => t != null))
                {
                    Directory.CreateDirectory(creatorDir);
                    File.WriteAllBytes(Path.Combine(creatorDir, "binder_band.png"), png);
                    File.WriteAllText(Path.Combine(creatorDir, "binder_band.mjs"), script);
                }
            }
            finally
            {
                if (cameraObject != null)
                    cameraObject.GetComponent<Camera>().targetTexture = null;
                RenderTexture.ReleaseTemporary(rt);
                EditorSceneManager.ClosePreviewScene(scene);
                UnityEngine.Object.DestroyImmediate(material);
                UnityEngine.Object.DestroyImmediate(flat);
            }
        }

        private static void RenderFrontPreview(Mesh mesh, Cover cover)
        {
            const int height = 1200;
            var bounds = mesh.bounds;
            var viewHeight = bounds.size.y * 1.04f;
            var viewWidth = bounds.size.x * 1.04f;
            var width = Mathf.RoundToInt(height * viewWidth / viewHeight);

            var scene = EditorSceneManager.NewPreviewScene();
            var rt = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
            GameObject cameraObject = null;
            // The binder's own material (the game's texture set), like the 3D view: not the Substance base colour, which is grey
            var source = AssetDatabase.LoadAssetAtPath<Material>(Material);
            var preview = source != null ? new Material(source) : new Material(Shader.Find("Standard"));
            try
            {
                if (source == null)
                    preview.SetTexture("_MainTex", AssetDatabase.LoadAssetAtPath<Texture2D>(MainTex));

                var body = new GameObject("binder", typeof(MeshFilter), typeof(MeshRenderer));
                body.GetComponent<MeshFilter>().sharedMesh = mesh;
                body.GetComponent<MeshRenderer>().sharedMaterial = preview;
                SceneManager.MoveGameObjectToScene(body, scene);

                foreach (var (dir, intensity) in new[] { (new Vector3(0.3f, -0.4f, 1f), 1.1f), (new Vector3(-0.6f, 0.2f, 1f), 0.5f) })
                {
                    var lightObject = new GameObject("light", typeof(Light));
                    var light = lightObject.GetComponent<Light>();
                    light.type = LightType.Directional;
                    light.intensity = intensity;
                    lightObject.transform.rotation = Quaternion.LookRotation(Vector3.Scale(dir, new Vector3(1, 1, -cover.Normal.z)));
                    SceneManager.MoveGameObjectToScene(lightObject, scene);
                }

                cameraObject = new GameObject("camera", typeof(Camera));
                SceneManager.MoveGameObjectToScene(cameraObject, scene);
                var camera = cameraObject.GetComponent<Camera>();
                camera.scene = scene;
                camera.orthographic = true;
                camera.orthographicSize = viewHeight / 2;
                camera.aspect = (float)width / height;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0, 0, 0, 0);
                camera.nearClipPlane = 0.001f;
                camera.farClipPlane = bounds.size.magnitude * 4;
                camera.transform.position = new Vector3(bounds.center.x, bounds.center.y, 0) + cover.Normal * bounds.size.magnitude * 2;
                camera.transform.rotation = Quaternion.LookRotation(-cover.Normal, Vector3.up);
                camera.targetTexture = rt;
                camera.Render();

                var previous = RenderTexture.active;
                RenderTexture.active = rt;
                var image = new Texture2D(width, height, TextureFormat.RGBA32, false);
                image.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                image.Apply();
                RenderTexture.active = previous;

                var topLeft = camera.WorldToScreenPoint(cover.Center - cover.Right * cover.Width / 2 + cover.Up * cover.Height / 2);
                var bottomRight = camera.WorldToScreenPoint(cover.Center + cover.Right * cover.Width / 2 - cover.Up * cover.Height / 2);
                string N(float v) => v.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture);
                var script = "// Generated by the Unity card builder (BinderBuilder): binder front render + cover rectangle in image pixels.\n" +
                             "window.CC_BINDER = {\n" +
                             $"  \"image\": \"creator/binder_front.png\",\n  \"width\": {width},\n  \"height\": {height},\n" +
                             $"  \"cover\": {{ \"x\": {N(topLeft.x)}, \"y\": {N(height - topLeft.y)}, \"w\": {N(bottomRight.x - topLeft.x)}, \"h\": {N(topLeft.y - bottomRight.y)} }}\n" +
                             "};\n";

                var png = image.EncodeToPNG();
                var gameModDir = CardBundleBuilder.GameModDir();
                var targets = new[] { Path.Combine(CardPaths.RepoRoot, "src", "DaCard.Server", "creator"), gameModDir != null ? Path.Combine(gameModDir, "creator") : null };
                foreach (var creatorDir in targets.Where(t => t != null))
                {
                    Directory.CreateDirectory(creatorDir);
                    File.WriteAllBytes(Path.Combine(creatorDir, "binder_front.png"), png);
                    File.WriteAllText(Path.Combine(creatorDir, "binder_front.mjs"), script);
                }
                UnityEngine.Object.DestroyImmediate(image);
            }
            finally
            {
                if (cameraObject != null)
                    cameraObject.GetComponent<Camera>().targetTexture = null;
                RenderTexture.ReleaseTemporary(rt);
                EditorSceneManager.ClosePreviewScene(scene);
                UnityEngine.Object.DestroyImmediate(preview);
            }
        }

        private static void ExportModelForCreator(Mesh mesh, Cover cover, Shell shell)
        {
            string Floats(IEnumerable<float> values)
            {
                var list = values.ToList();
                var bytes = new byte[list.Count * 4];
                Buffer.BlockCopy(list.ToArray(), 0, bytes, 0, bytes.Length);
                return Convert.ToBase64String(bytes);
            }
            string N(float v) => v.ToString("0.#####", System.Globalization.CultureInfo.InvariantCulture);
            string V(Vector3 v) => $"[{N(-v.x)}, {N(v.y)}, {N(v.z)}]";

            var positions = Floats(mesh.vertices.SelectMany(v => new[] { -v.x, v.y, v.z }));
            var normals = Floats(mesh.normals.SelectMany(n => new[] { -n.x, n.y, n.z }));
            var uvs = Floats(mesh.uv.SelectMany(u => new[] { u.x, u.y }));
            var triangles = Enumerable.Range(0, mesh.subMeshCount).SelectMany(mesh.GetTriangles).ToArray();
            string Ints(int[] values)
            {
                var bytes = new byte[values.Length * 4];
                Buffer.BlockCopy(values, 0, bytes, 0, bytes.Length);
                return Convert.ToBase64String(bytes);
            }
            var shellUv = new List<Vector2>();
            shell.Mesh.GetUVs(0, shellUv);

            var source = AssetDatabase.LoadAssetAtPath<Texture2D>(MainTex);
            var scale = Mathf.Min(1f, 1024f / Mathf.Max(source.width, source.height));
            int w = Mathf.Max(1, Mathf.RoundToInt(source.width * scale)), h = Mathf.Max(1, Mathf.RoundToInt(source.height * scale));
            var rt = RenderTexture.GetTemporary(w, h, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
            var previous = RenderTexture.active;
            var image = new Texture2D(w, h, TextureFormat.RGB24, false);
            string jpeg;
            try
            {
                Graphics.Blit(source, rt);
                RenderTexture.active = rt;
                image.ReadPixels(new Rect(0, 0, w, h), 0, 0);
                image.Apply();
                jpeg = Convert.ToBase64String(image.EncodeToJPG(85));
            }
            finally
            {
                RenderTexture.active = previous;
                RenderTexture.ReleaseTemporary(rt);
                UnityEngine.Object.DestroyImmediate(image);
            }

            var b = mesh.bounds;
            var lift = Mathf.Max(0.0005f, cover.Height * 0.001f);
            var script = "// Generated by the Unity card builder (BinderBuilder): the binder for the Card Creator's 3D view.\n" +
                         "window.CC_BINDER_MODEL = {\n" +
                         $"  \"vertexCount\": {mesh.vertexCount},\n" +
                         $"  \"positions\": \"{positions}\",\n  \"normals\": \"{normals}\",\n  \"uvs\": \"{uvs}\",\n  \"indices\": \"{Ints(triangles)}\",\n" +
                         "  \"shell\": {\n" +
                         $"    \"positions\": \"{Floats(shell.Mesh.vertices.SelectMany(v => new[] { -v.x, v.y, v.z }))}\",\n" +
                         $"    \"normals\": \"{Floats(shell.Mesh.normals.SelectMany(n => new[] { -n.x, n.y, n.z }))}\",\n" +
                         $"    \"uvs\": \"{Floats(shellUv.SelectMany(u => new[] { u.x, u.y }))}\",\n" +
                         $"    \"indices\": \"{Ints(shell.Mesh.triangles)}\"\n  }},\n" +
                         $"  \"band\": {{ \"xMin\": {N(shell.XMin)}, \"xMax\": 1 }},\n" +
                         $"  \"texture\": \"data:image/jpeg;base64,{jpeg}\",\n" +
                         $"  \"bounds\": {{ \"center\": {V(b.center)}, \"size\": [{N(b.size.x)}, {N(b.size.y)}, {N(b.size.z)}] }},\n" +
                         $"  \"cover\": {{ \"center\": {V(cover.Center)}, \"right\": {V(cover.Right)}, \"up\": {V(cover.Up)}, \"normal\": {V(cover.Normal)}, " +
                         $"\"width\": {N(cover.Width)}, \"height\": {N(cover.Height)}, \"lift\": {N(lift)} }},\n" +
                         $"  \"stickerBump\": {N(CardBuildSettings.LoadOrCreate().stickerBump)}\n" +
                         "};\n";

            var gameModDir = CardBundleBuilder.GameModDir();
            var targets = new[] { Path.Combine(CardPaths.RepoRoot, "src", "DaCard.Server", "creator"), gameModDir != null ? Path.Combine(gameModDir, "creator") : null };
            foreach (var creatorDir in targets.Where(t => t != null))
            {
                Directory.CreateDirectory(creatorDir);
                File.WriteAllText(Path.Combine(creatorDir, "binder_model.mjs"), script);
            }
            Debug.Log($"[DaCard] Binder 3D model for the Card Creator: {mesh.vertexCount} vertices, {triangles.Length / 3} triangles, {script.Length / 1024} KB.");
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
    }
}
