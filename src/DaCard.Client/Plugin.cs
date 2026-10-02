using System;
using BepInEx;
using BepInEx.Logging;
using SPT.Reflection.Patching;

namespace DaCard.Client
{
    [BepInPlugin("com.guro.dacard", "DaCard", "2.0.1")]
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
                new ItemReadPatch(),
                new ItemWritePatch(),
                new CardIconHashPatch(),
                new CardPricePatch(),
                new CardNamePatch(),
                new BinderPocketPatch(),
                new BinderRaidPatch(),
                new ContainerLookupPatch(),
                new CreateItemPatch(),
                new IconShaderPatch(),
                new CardModelSlotsPatch(),
                new BinderSlotPatch(),
                new BinderWindowPatch(),
                new BinderSlotsPatch(),
                new PackButtonPatch(),
                new PackOpenPatch(),
                new GridItemNamePatch(),
                new InspectCaptionPatch());
            WorldCamera.Enable();
            Log.LogInfo($"DaCard 2.0.1 loaded, {CardRegistry.Count} card(s) from the server");
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
