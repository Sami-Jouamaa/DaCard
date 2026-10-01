using System.IO;
using System.Runtime.CompilerServices;
using UnityEngine;

namespace DaCard.Editor
{
    public static class CardPaths
    {
        public static readonly string Root = FindRoot();

        private static string FindRoot([CallerFilePath] string thisFile = "")
        {
            var path = thisFile.Replace('\\', '/');
            var assets = path.LastIndexOf("/Assets/");
            var editor = path.LastIndexOf("/Editor/");
            return assets >= 0 && editor > assets ? path.Substring(assets + 1, editor - assets - 1) : "Assets/DaCard";
        }

        public static readonly string Settings = Root + "/CardBuildSettings.asset";
        public static readonly string Model = Root + "/Models/card.fbx";
        public static readonly string Shader = Root + "/Shaders/CardDiffraction.shader";

        public static readonly string Material = Root + "/Materials/card.mat";

        public static readonly string Generated = Root + "/Generated";
        public static readonly string RuntimeMesh = Generated + "/card_mesh.asset";

        public static readonly string EdgeShader = Root + "/Shaders/CardEdge.shader";
        public static readonly string EdgeMaterial = Generated + "/card_edge.mat";
        public static string RuntimeMaterial(string type) => $"{Generated}/card_runtime_{type}.mat";

        public static readonly string PrefabsDir = Root + "/Prefabs";
        public const string BundleFolder = "dacard";
        public static string PrefabName(string type) => "item_card_" + type;
        public static readonly string LayerCompositeShader = Root + "/Shaders/CardLayerComposite.shader";
        public static readonly string LayerCompositeMaterial = Generated + "/card_layer_composite.mat";
        public const string LayerCompositeObject = "layer_composite";
        public static readonly string GlowShader = Root + "/Shaders/CardGlow.shader";
        public static readonly string GlowMaterial = Generated + "/card_glow.mat";
        public static readonly string GlowMesh = Generated + "/card_glow_mesh.asset";
        public const string GlowObject = "card_glow";
        public static string Prefab(string type) => $"{PrefabsDir}/{PrefabName(type)}.prefab";
        public static string BundleKey(string type) => $"{BundleFolder}/{PrefabName(type)}.bundle";

        public static readonly string Layout = Root + "/Layout/card_layout.prefab";
        public const string LayoutMeshObject = "card_mesh";

        public static readonly string TextShader = Root + "/Shaders/CardText_SDF.shader";

        public const string NameObject = "CardName";

        public static string ServerBundlesJson => Path.Combine(RepoRoot, "src", "DaCard.Server", "bundles.json");

        public static string RepoRoot => Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));

        public static string ServerBundlesDir => Path.Combine(RepoRoot, "src", "DaCard.Server", "bundles");

        public static string ServerConfig => Path.Combine(RepoRoot, "src", "DaCard.Server", "defaults", "config.json");

        public static string BuildOutputDir =>
            Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Build", "Bundles"));
    }
}
