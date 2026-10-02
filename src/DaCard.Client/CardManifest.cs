using System.Collections.Generic;

#pragma warning disable CS0649
using Newtonsoft.Json;

namespace DaCard.Client
{
    internal class ClientIndex
    {
        [JsonProperty("backProperty")] public string BackProperty = "_CARD_BACK";
        [JsonProperty("overlayProperty")] public string OverlayProperty = "_CARD_FRONT_BORDER";
        [JsonProperty("slots")] public List<TextureSlot> Slots = new List<TextureSlot>();
        [JsonProperty("versions")] public Dictionary<string, string> Versions = new Dictionary<string, string>();
        [JsonProperty("templates")] public Dictionary<string, CardTemplate> Templates = new Dictionary<string, CardTemplate>();
        [JsonProperty("binders")] public List<BinderManifestEntry> Binders = new List<BinderManifestEntry>();
        [JsonProperty("packs")] public List<PackManifestEntry> Packs = new List<PackManifestEntry>();
    }

    internal class CardTemplate
    {
        [JsonProperty("collection")] public string Collection;
        [JsonProperty("rarity")] public string Rarity;
        [JsonProperty("price")] public double Price;
    }

    internal class PackManifestEntry
    {
        [JsonProperty("tpl")] public string Tpl;
        [JsonProperty("cardCount")] public int CardCount = 3;
        [JsonProperty("textures")] public Dictionary<string, string> Textures = new Dictionary<string, string>();
    }

    internal class CardTextSettings
    {
        [JsonProperty("name")] public TextStyle Name;
        [JsonProperty("description")] public TextStyle Description;
    }

    internal class TextStyle
    {
        [JsonProperty("show")] public bool Show = true;
        [JsonProperty("x")] public float X = 0.5f;
        [JsonProperty("y")] public float Y = 0.05f;
        [JsonProperty("width")] public float Width = 0.8f;
        [JsonProperty("height")] public float? Height;
        [JsonProperty("size")] public float Size = 0.05f;
        [JsonProperty("align")] public string Align = "center";
        [JsonProperty("color")] public string Color = "#FFFFFF";
        [JsonProperty("font")] public string Font;
    }

    internal class BinderManifestEntry
    {
        [JsonProperty("tpl")] public string Tpl;
        [JsonProperty("collection")] public string Collection;
        [JsonProperty("stickers")] public List<BinderSticker> Stickers = new List<BinderSticker>();
        [JsonProperty("pockets")] public Dictionary<string, string> Pockets = new Dictionary<string, string>();
    }

    internal class BinderSticker
    {
        [JsonProperty("image")] public string Image;
        [JsonProperty("placement")] public StickerPlacement Placement = new StickerPlacement();
    }

    internal class StickerPlacement
    {
        [JsonProperty("x")] public float X = 0.5f;
        [JsonProperty("y")] public float Y = 0.4f;
        [JsonProperty("width")] public float Width = 0.6f;
        [JsonProperty("height")] public float Height = 0.3f;
        [JsonProperty("rotation")] public float Rotation;
    }

    internal class CardAnimationInfo
    {
        [JsonProperty("tracks")] public Dictionary<string, CardAnimationTrack> Tracks = new Dictionary<string, CardAnimationTrack>();
    }

    internal class CardAnimationTrack
    {
        [JsonProperty("url")] public string Url;
        [JsonProperty("frames")] public int Frames;
        [JsonProperty("fps")] public double Fps;
    }

    internal class CardLayer
    {
        [JsonProperty("key")] public string Key;
        [JsonProperty("layer")] public string Layer;
        [JsonProperty("group")] public string Group;
        [JsonProperty("chance")] public double Chance = 100;
        [JsonProperty("canBeFoil")] public bool CanBeFoil;
        [JsonProperty("price")] public double Price;
        [JsonProperty("pricePercent")] public double PricePercent;
        [JsonProperty("frame")] public bool Frame;

        [JsonProperty("textures")] public Dictionary<string, string> Textures = new Dictionary<string, string>();
        [JsonProperty("animation")] public Dictionary<string, CardAnimationTrack> Animation;
        [JsonProperty("transform")] public LayerTransform Transform;
        [JsonProperty("roughness")] public float? Roughness;
        [JsonProperty("metallic")] public float? Metallic;
        [JsonProperty("id")] public string Id;
        [JsonProperty("name")] public string Name;
        [JsonProperty("text")] public LayerText Text;
    }

    internal class LayerText
    {
        [JsonProperty("value")] public string Value = "";
        [JsonProperty("x")] public float X = 0.5f;
        [JsonProperty("y")] public float Y = 0.05f;
        [JsonProperty("width")] public float Width = 0.84f;
        [JsonProperty("height")] public float Height = 0.1f;
        [JsonProperty("size")] public float Size = 0.05f;
        [JsonProperty("align")] public string Align = "center";
        [JsonProperty("valign")] public string VAlign = "top";
        [JsonProperty("color")] public string Color = "#FFFFFF";
        [JsonProperty("opacity")] public float Opacity = 1f;
        [JsonProperty("uppercase")] public bool Uppercase;
        [JsonProperty("autoSize")] public bool AutoSize;
        [JsonProperty("rotation")] public float Rotation;
        [JsonProperty("font")] public string Font;
    }

    // Centre (share of the card, y from the top), scale (1 = fits inside the card), clockwise degrees
    internal class LayerTransform
    {
        [JsonProperty("x")] public float X = 0.5f;
        [JsonProperty("y")] public float Y = 0.5f;
        [JsonProperty("scale")] public float Scale = 1f;
        [JsonProperty("rotation")] public float Rotation;
    }

    internal class CardGlowSettings
    {
        [JsonProperty("strength")] public float Strength;
        [JsonProperty("color")] public string Color;
        [JsonProperty("color2")] public string Color2;
        [JsonProperty("line")] public float Line = 1;
        [JsonProperty("halo")] public float Halo = 1;
        [JsonProperty("sparkles")] public float Sparkles;
        [JsonProperty("flares")] public float Flares;
        [JsonProperty("smoke")] public float Smoke;
        [JsonProperty("rays")] public float Rays;
        [JsonProperty("drip")] public float Drip;
        [JsonProperty("speed")] public float Speed = 1;
    }

    internal class TextureSlot
    {
        [JsonProperty("suffix")] public string Suffix;
        [JsonProperty("property")] public string Property;
        [JsonProperty("linear")] public bool Linear;
        [JsonProperty("default")] public string Default;
        [JsonProperty("flag")] public string Flag;
    }

    internal class CardManifestEntry
    {
        [JsonProperty("tpl")] public string Tpl;
        [JsonProperty("rarity")] public string Rarity;
        [JsonProperty("type")] public string Type;
        [JsonProperty("floats")] public Dictionary<string, float> Floats = new Dictionary<string, float>();
        [JsonProperty("textures")] public Dictionary<string, string> Textures = new Dictionary<string, string>();
        [JsonProperty("template")] public string Template;
        [JsonProperty("price")] public double Price;
        [JsonProperty("name")] public string Name;
        [JsonProperty("shortName")] public string ShortName;
        [JsonProperty("description")] public string Description;
        [JsonProperty("locales")] public Dictionary<string, CardLocale> Locales;
        [JsonProperty("rarityColor")] public string RarityColor;
        [JsonProperty("foilLayers")] public List<string> FoilLayers = new List<string>();
        [JsonProperty("collection")] public string Collection;
        [JsonProperty("glow")] public CardGlowSettings Glow;
        // Collection layers first, then the card's; bottom first
        [JsonProperty("front")] public List<CardLayer> Front = new List<CardLayer>();
        [JsonProperty("back")] public List<CardLayer> Back = new List<CardLayer>();
        [JsonProperty("text")] public CardTextSettings Text;
        [JsonProperty("animation")] public CardAnimationInfo Animation;
    }

    internal class CardLocale
    {
        [JsonProperty("name")] public string Name;
        [JsonProperty("shortName")] public string ShortName;
        [JsonProperty("description")] public string Description;
    }
}
