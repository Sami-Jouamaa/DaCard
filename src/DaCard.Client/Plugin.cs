using BepInEx;
using BepInEx.Logging;

namespace DaCard.Client
{
    [BepInPlugin("com.guro.dacard", "DaCard", "1.0.0")]
    public class Plugin : BaseUnityPlugin
    {
        internal static ManualLogSource Log;
        internal static Plugin Instance;

        private void Awake()
        {
            Log = Logger;
            Instance = this;
            CardRegistry.Load();
            new CreateItemPatch().Enable();
            new IconShaderPatch().Enable();
            new StickerIconPatch().Enable();
            new CardModelSlotsPatch().Enable();
            new StickerSlotLookPatch().Enable();
            new NestedStickerSlotsPatch().Enable();
            new BinderSlotPatch().Enable();
            new PackButtonPatch().Enable();
            new PackOpenPatch().Enable();
            new GridItemNamePatch().Enable();
            new InspectCaptionPatch().Enable();
            WorldCamera.Enable();
            Log.LogInfo($"DaCard 1.0.0 loaded, {CardRegistry.Count} card(s) from the server");
        }

        private void Update()
        {
            CardAnimator.Tick();
            CardLayers.Tick();
        }
    }
}
