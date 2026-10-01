using System.Collections.Generic;
using UnityEngine;

namespace DaCard.Client
{
    // Cards look different in the world than in the inventory, inspect view and icons: their own light and glow are for
    // those. While the game's main camera (the player's view) draws, the global _DaCardWorld is 1: the card shaders dim their
    // own light (lit by the raid instead) and the glow its strength. Every other camera (inspect, icons) sets it back to 0.
    internal static class WorldCamera
    {
        private static readonly int WorldId = Shader.PropertyToID("_DaCardWorld");
        private static readonly HashSet<string> Logged = new HashSet<string>();

        public static void Enable() => Camera.onPreCull += OnPreCull;

        private static void OnPreCull(Camera camera)
        {
            var world = camera.CompareTag("MainCamera");
            Shader.SetGlobalFloat(WorldId, world ? 1f : 0f);
            if (Logged.Count < 32 && Logged.Add(camera.name))
                Plugin.Log.LogInfo($"Camera '{camera.name}': cards drawn as {(world ? "in the world" : "in a preview")}");
        }
    }
}
