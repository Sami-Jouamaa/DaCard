using System;
using System.IO;
using System.IO.Compression;
using System.Text;

namespace DaCard.Client
{
    internal static class PngDecoder
    {
        internal sealed class Image
        {
            public int Width, Height, MipCount;
            public byte[] Pixels;
            public int[] MipOffsets;
        }

        private static readonly byte[] Signature = { 137, 80, 78, 71, 13, 10, 26, 10 };

        public static Image Decode(byte[] png)
        {
            if (png == null || png.Length < 8)
                return null;
            for (var i = 0; i < Signature.Length; i++)
                if (png[i] != Signature[i])
                    return null;

            int width = 0, height = 0, bitDepth = 0, colorType = -1;
            byte[] palette = null, paletteAlpha = null;
            var idat = new MemoryStream();
            var pos = 8;
            while (pos + 12 <= png.Length)
            {
                var length = ReadInt(png, pos);
                var type = Encoding.ASCII.GetString(png, pos + 4, 4);
                var data = pos + 8;
                if (length < 0 || data + length > png.Length)
                    return null;
                if (type == "IHDR")
                {
                    width = ReadInt(png, data);
                    height = ReadInt(png, data + 4);
                    bitDepth = png[data + 8];
                    colorType = png[data + 9];
                    if (png[data + 10] != 0 || png[data + 11] != 0 || png[data + 12] != 0)
                        return null;
                }
                else if (type == "PLTE")
                    palette = Slice(png, data, length);
                else if (type == "tRNS")
                    paletteAlpha = Slice(png, data, length);
                else if (type == "IDAT")
                    idat.Write(png, data, length);
                else if (type == "IEND")
                    break;
                pos = data + length + 4;
            }

            int channels;
            switch (colorType)
            {
                case 0: channels = 1; break;
                case 2: channels = 3; break;
                case 3: channels = 1; break;
                case 4: channels = 2; break;
                case 6: channels = 4; break;
                default: return null;
            }
            if (width <= 0 || height <= 0 || !(bitDepth == 8 || (bitDepth == 16 && colorType != 3)) || (colorType == 3 && palette == null))
                return null;

            var bpp = channels * bitDepth / 8;
            var stride = width * bpp;
            var raw = Inflate(idat, height * (stride + 1));
            if (raw == null)
                return null;
            Unfilter(raw, width, height, bpp, stride);

            var image = CreateChain(width, height);
            ToRgba(raw, image.Pixels, width, height, stride, colorType, bitDepth / 8, palette, paletteAlpha);
            BuildMips(image);
            return image;
        }

        private static int ReadInt(byte[] b, int i) => (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3];

        private static byte[] Slice(byte[] b, int start, int length)
        {
            var s = new byte[length];
            Buffer.BlockCopy(b, start, s, 0, length);
            return s;
        }

        private static byte[] Inflate(MemoryStream zlib, int size)
        {
            if (zlib.Length < 2)
                return null;
            var raw = new byte[size];
            using (var inflater = new DeflateStream(new MemoryStream(zlib.GetBuffer(), 2, (int)zlib.Length - 2), CompressionMode.Decompress))
            {
                var read = 0;
                while (read < size)
                {
                    var n = inflater.Read(raw, read, size - read);
                    if (n <= 0)
                        return null;
                    read += n;
                }
            }
            return raw;
        }

        private static void Unfilter(byte[] raw, int width, int height, int bpp, int stride)
        {
            for (var y = 0; y < height; y++)
            {
                var row = y * (stride + 1);
                var filter = raw[row];
                var cur = row + 1;
                var prev = cur - (stride + 1);
                switch (filter)
                {
                    case 0:
                        break;
                    case 1:
                        for (var x = bpp; x < stride; x++)
                            raw[cur + x] += raw[cur + x - bpp];
                        break;
                    case 2:
                        if (y > 0)
                            for (var x = 0; x < stride; x++)
                                raw[cur + x] += raw[prev + x];
                        break;
                    case 3:
                        for (var x = 0; x < stride; x++)
                        {
                            var a = x >= bpp ? raw[cur + x - bpp] : 0;
                            var b = y > 0 ? raw[prev + x] : 0;
                            raw[cur + x] += (byte)((a + b) >> 1);
                        }
                        break;
                    case 4:
                        for (var x = 0; x < stride; x++)
                        {
                            int a = x >= bpp ? raw[cur + x - bpp] : 0;
                            int b = y > 0 ? raw[prev + x] : 0;
                            int c = x >= bpp && y > 0 ? raw[prev + x - bpp] : 0;
                            var p = a + b - c;
                            var pa = Math.Abs(p - a);
                            var pb = Math.Abs(p - b);
                            var pc = Math.Abs(p - c);
                            raw[cur + x] += (byte)(pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
                        }
                        break;
                    default:
                        throw new InvalidDataException($"PNG filter {filter}");
                }
            }
        }

        private static void ToRgba(byte[] raw, byte[] dst, int width, int height, int stride, int colorType, int step,
            byte[] palette, byte[] paletteAlpha)
        {
            for (var y = 0; y < height; y++)
            {
                var s = y * (stride + 1) + 1;
                var d = (height - 1 - y) * width * 4;
                for (var x = 0; x < width; x++, d += 4)
                {
                    switch (colorType)
                    {
                        case 0:
                            dst[d] = dst[d + 1] = dst[d + 2] = raw[s]; dst[d + 3] = 255;
                            s += step;
                            break;
                        case 2:
                            dst[d] = raw[s]; dst[d + 1] = raw[s + step]; dst[d + 2] = raw[s + 2 * step]; dst[d + 3] = 255;
                            s += 3 * step;
                            break;
                        case 3:
                            var index = raw[s];
                            if (index * 3 + 2 < palette.Length)
                            {
                                dst[d] = palette[index * 3]; dst[d + 1] = palette[index * 3 + 1]; dst[d + 2] = palette[index * 3 + 2];
                            }
                            dst[d + 3] = paletteAlpha != null && index < paletteAlpha.Length ? paletteAlpha[index] : (byte)255;
                            s += 1;
                            break;
                        case 4:
                            dst[d] = dst[d + 1] = dst[d + 2] = raw[s]; dst[d + 3] = raw[s + step];
                            s += 2 * step;
                            break;
                        default:
                            dst[d] = raw[s]; dst[d + 1] = raw[s + step]; dst[d + 2] = raw[s + 2 * step]; dst[d + 3] = raw[s + 3 * step];
                            s += 4 * step;
                            break;
                    }
                }
            }
        }

        private static Image CreateChain(int width, int height)
        {
            var mips = 1;
            while ((Math.Max(width, height) >> mips) > 0)
                mips++;
            var offsets = new int[mips];
            var total = 0;
            for (var m = 0; m < mips; m++)
            {
                offsets[m] = total;
                total += Math.Max(1, width >> m) * Math.Max(1, height >> m) * 4;
            }
            return new Image { Width = width, Height = height, MipCount = mips, MipOffsets = offsets, Pixels = new byte[total] };
        }

        private static void BuildMips(Image image)
        {
            var p = image.Pixels;
            for (var m = 1; m < image.MipCount; m++)
            {
                int sw = Math.Max(1, image.Width >> (m - 1)), sh = Math.Max(1, image.Height >> (m - 1));
                int dw = Math.Max(1, image.Width >> m), dh = Math.Max(1, image.Height >> m);
                int src = image.MipOffsets[m - 1], dst = image.MipOffsets[m];
                for (var y = 0; y < dh; y++)
                {
                    var y0 = Math.Min(2 * y, sh - 1) * sw;
                    var y1 = Math.Min(2 * y + 1, sh - 1) * sw;
                    for (var x = 0; x < dw; x++)
                    {
                        var x0 = Math.Min(2 * x, sw - 1);
                        var x1 = Math.Min(2 * x + 1, sw - 1);
                        int a = src + (y0 + x0) * 4, b = src + (y0 + x1) * 4, c = src + (y1 + x0) * 4, e = src + (y1 + x1) * 4;
                        var o = dst + (y * dw + x) * 4;
                        for (var ch = 0; ch < 4; ch++)
                            p[o + ch] = (byte)((p[a + ch] + p[b + ch] + p[c + ch] + p[e + ch] + 2) >> 2);
                    }
                }
            }
        }
    }
}
