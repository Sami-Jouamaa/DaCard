using System.Linq;
using System.Reflection;
using System.Text;
using HarmonyLib;
using SPT.Reflection.Patching;
using UnityEngine;

namespace DaCard.Client
{
    internal class IconShaderPatch : ModulePatch
    {
        private const string EftFallback = "p0/Reflective/Bumped Specular SMap_Icon";
        private static bool _loggedRig;

        protected override MethodBase GetTargetMethod() =>
            AccessTools.Method(typeof(ShaderReplacer), nameof(ShaderReplacer.Replace));

        [PatchPostfix]
        private static void Postfix(ShaderReplacer __instance, GameObject model)
        {
            if (!CardRegistry.IsCardModel(model) && !PackRegistry.IsPackModel(model))
                return;

            CardGlow.Hide(model);

            foreach (var replaced in __instance._replacedShaders)
            {
                var material = replaced.Renderer.materials[replaced.MaterialIndex];
                if (material.shader != null && material.shader.name == EftFallback && replaced.OriginalShader != null
                    && replaced.OriginalShader.name + "_Icon" != EftFallback)
                    material.shader = replaced.OriginalShader;
            }

            if (!_loggedRig)
            {
                _loggedRig = true;
                LogIconRig();
            }
        }

        private static void LogIconRig()
        {
            var camera = Resources.FindObjectsOfTypeAll<Camera>().FirstOrDefault(c => c.name.EndsWith("IconCamera") && c.gameObject.scene.IsValid());
            if (camera == null)
            {
                Plugin.Log.LogInfo("Icon rig: IconCamera not found");
                return;
            }

            var sb = new StringBuilder();
            sb.AppendLine($"Icon rig: camera '{camera.name}' renderingPath={camera.renderingPath} actual={camera.actualRenderingPath} hdr={camera.allowHDR} ortho={camera.orthographic} forward={camera.transform.forward}");
            foreach (var light in camera.GetComponentsInParent<Light>(true).Concat(camera.GetComponentsInChildren<Light>(true)).Distinct())
                sb.AppendLine($"  light '{light.name}' {light.type} color={light.color} intensity={light.intensity} dir={light.transform.forward} range={light.range} renderMode={light.renderMode} shadows={light.shadows}");
            sb.Append($"  ambient during icon render is forced to black (RenderSettings.ambientMode=Flat, ambientLight=black)");
            Plugin.Log.LogInfo(sb.ToString());
        }
    }
}
