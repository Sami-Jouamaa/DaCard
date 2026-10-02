using UnityEngine;

namespace DaCard.Client
{
    internal static class CardTextures
    {
        public static Texture2D Create(PngDecoder.Image image, byte[] png, string name, bool linear)
        {
            var texture = image != null
                ? new Texture2D(image.Width, image.Height, TextureFormat.RGBA32, image.MipCount, linear)
                : new Texture2D(2, 2, TextureFormat.RGBA32, true, linear);
            texture.name = name;
            texture.wrapMode = TextureWrapMode.Clamp;
            texture.filterMode = FilterMode.Trilinear;
            texture.anisoLevel = 4;
            texture.hideFlags = HideFlags.DontUnloadUnusedAsset;

            if (image == null)
            {
                if (png != null && texture.LoadImage(png, markNonReadable: true))
                    return texture;
                Object.Destroy(texture);
                return null;
            }
            for (var m = 0; m < image.MipCount; m++)
                texture.SetPixelData(image.Pixels, m, image.MipOffsets[m]);
            texture.Apply(updateMipmaps: false, makeNoLongerReadable: true);
            return texture;
        }
    }
}
