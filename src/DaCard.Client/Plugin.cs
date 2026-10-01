using System;
using BepInEx;
using BepInEx.Logging;
using SPT.Reflection.Patching;

namespace DaCard.Client
{
    [BepInPlugin("com.guro.dacard", "DaCard", "1.1.0")]
    public class Plugin : BaseUnityPlugin
    {
        internal static ManualLogSource Log;
        internal static Plugin Instance;

        private void Awake()
        {
            Log = Logger;
            Instance = this;
            CardRegistry.Load();
            Enable(
                new CreateItemPatch(),
                new IconShaderPatch(),
                new StickerIconPatch(),
                new CardModelSlotsPatch(),
                new StickerSlotLookPatch(),
                new NestedStickerSlotsPatch(),
                new BinderSlotPatch(),
                new BinderWindowPatch(),
                new BinderSlotsPatch(),
                new PackButtonPatch(),
                new PackOpenPatch(),
                new GridItemNamePatch(),
                new InspectCaptionPatch());
            WorldCamera.Enable();
            Log.LogInfo($"DaCard 1.1.0 loaded, {CardRegistry.Count} card(s) from the server");
        }

        private static void Enable(params ModulePatch[] patches)
        {
            foreach (var patch in patches)
            {
                try
                {
                    patch.Enable();
                }
                catch (Exception e)
                {
                    Log.LogError($"Could not enable {patch.GetType().Name}: {e.Message}");
                }
            }
        }

        private void Update()
        {
            CardAnimator.Tick();
            CardLayers.Tick();
        }
    }
}
