using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;

namespace DaCard.Editor
{
    public class CardBuildSettings : ScriptableObject
    {
        [Serializable]
        public class CardType
        {
            [Tooltip("Card type as written in card.json \"type\" (and config.json cardTypes): 2d, 3d, ... " +
                     "Builds dacard/item_card_<type>.bundle.")]
            public string type = "3d";

            [Tooltip("Material for this type. The bundle gets a copy of it with every per-card texture slot cleared " +
                     "(those are filled at runtime from the card PNGs), so placeholder art on it is never shipped.")]
            public Material material;
        }

        public List<CardType> cardTypes = new List<CardType>();

        [Tooltip("Scale of the card in the in-game inspect (3D preview) window. The camera there sits at a fixed " +
                 "distance, so a real-size card looks tiny at 1.")]
        public float previewScale = 2.5f;

        [Tooltip("Stash icon of the collection binders: extra rotation in degrees (x = tilt, showing the bottom edge; " +
                 "y = turn, showing the right edge). 0, 0, 0 = straight on. Clear the icon cache to see changes.")]
        public Vector3 binderIconAngles = new Vector3(10f, 20f, 0f);

        [Tooltip("How much the binder stickers' edges rise off the cover (the bump along their outline). 0 = flat.")]
        [Range(0f, 2f)] public float stickerBump = 0.35f;

        [Tooltip("Stash icon of the cards: extra rotation in degrees (x = tilt, showing the bottom edge; y = turn, " +
                 "showing the right edge). 0, 0, 0 = straight on. Clear the icon cache to see changes.")]
        public Vector3 cardIconAngles = new Vector3(10f, 20f, 0f);

        [Tooltip("Stash icon of the booster packs: extra rotation in degrees (x = tilt, showing the bottom edge; y = turn, " +
                 "showing the right edge). 0, 0, 0 = straight on. Clear the icon cache to see changes.")]
        public Vector3 packIconAngles = new Vector3(8f, 18f, 0f);

        [Tooltip("Scale of the booster pack in the in-game inspect (3D preview) window.")]
        public float packPreviewScale = 1f;

        [Tooltip("Colour of the card's edge (the ridge around it). White card stock by default.")]
        public Color cardEdgeColor = new Color(0.93f, 0.92f, 0.9f, 1f);

        [Tooltip("Smoothness of the card's edge.")]
        [Range(0f, 1f)] public float cardEdgeSmoothness = 0.3f;

        [Header("Install after build")]
        [Tooltip("After DaCard > Build Mod, copy the built mod straight into the game below: the server mod into the " +
                 "mods folder, the client plugin into the game's BepInEx\\plugins. Existing files are overwritten, " +
                 "except data\\config.json (your settings); nothing is deleted, so your cards there stay. The SPT server and the game must be closed.")]
        public bool installAfterBuild;

        [Tooltip("The game's SPT mods folder: <game>\\SPT_Runtime\\user\\mods (the game folder itself works too).")]
        [ModsFolder] public string modsFolder = "";

        [SerializeField, HideInInspector] private Material sourceMaterial;

        public List<CardType> ValidTypes() => cardTypes
            .Where(t => t.material != null && !string.IsNullOrWhiteSpace(t.type))
            .Select(t => new CardType { type = Normalise(t.type), material = t.material })
            .GroupBy(t => t.type).Select(g => g.First())
            .ToList();

        public static string Normalise(string type) => Regex.Replace(type.Trim().ToLowerInvariant(), "[^a-z0-9_]", "_");

        public static CardBuildSettings LoadOrCreate()
        {
            var settings = AssetDatabase.LoadAssetAtPath<CardBuildSettings>(CardPaths.Settings);
            if (settings == null && System.IO.File.Exists(CardPaths.Settings))
            {
                // Imported before this script compiled (batch mode on a fresh import): reimport instead of
                // overwriting the file with defaults, which drops card types and would build the wrong bundles.
                AssetDatabase.ImportAsset(CardPaths.Settings, ImportAssetOptions.ForceUpdate);
                settings = AssetDatabase.LoadAssetAtPath<CardBuildSettings>(CardPaths.Settings);
                if (settings == null)
                    throw new InvalidOperationException($"[DaCard] {CardPaths.Settings} exists but doesn't load as build settings; " +
                                                        "not overwriting it. Reopen the project and build again.");
            }
            if (settings == null)
            {
                settings = CreateInstance<CardBuildSettings>();
                AssetDatabase.CreateAsset(settings, CardPaths.Settings);
            }

            if (settings.cardTypes.Count == 0)
            {
                var material = settings.sourceMaterial != null ? settings.sourceMaterial : AssetDatabase.LoadAssetAtPath<Material>(CardPaths.Material);
                if (material != null)
                    settings.cardTypes.Add(new CardType { type = "3d", material = material });
                settings.sourceMaterial = null;
                EditorUtility.SetDirty(settings);
                AssetDatabase.SaveAssetIfDirty(settings);
            }
            return settings;
        }

        [MenuItem("DaCard/Select Build Settings")]
        private static void Select() => Selection.activeObject = LoadOrCreate();

        public static void SetMaterialBatch()
        {
            var args = Environment.GetCommandLineArgs();
            string Arg(string name)
            {
                var i = Array.IndexOf(args, name);
                return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
            }

            var type = Normalise(Arg("-cardType") ?? "3d");
            var material = Arg("-cardMaterial") is { } path ? AssetDatabase.LoadAssetAtPath<Material>(path) : null;
            if (material == null)
            {
                Debug.LogError("[DaCard] -cardMaterial <asset path> not given or not a material");
                EditorApplication.Exit(1);
                return;
            }

            var settings = LoadOrCreate();
            var entry = settings.cardTypes.FirstOrDefault(t => Normalise(t.type) == type);
            if (entry == null)
                settings.cardTypes.Add(entry = new CardType { type = type });
            entry.material = material;
            EditorUtility.SetDirty(settings);
            AssetDatabase.SaveAssets();
            Debug.Log($"[DaCard] {type} cards use {AssetDatabase.GetAssetPath(material)}");
        }
    }
}
