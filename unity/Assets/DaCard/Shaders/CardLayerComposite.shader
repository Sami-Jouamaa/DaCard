Shader "Hidden/DaCard/Layer Composite"
{
    Properties
    {
        _MainTex ("Stack so far", 2D) = "black" {}
        _Layer ("Layer albedo", 2D) = "black" {}
        _MaskMap ("Layer mask", 2D) = "white" {}
        _HasMask ("Has a mask", Float) = 0
        _FoilMaskMap ("Layer foil mask", 2D) = "white" {}
        _HasFoilMask ("Has a foil mask", Float) = 0
        _NormalMap ("Layer normal map", 2D) = "bump" {}
        _HasNormal ("Has a normal map", Float) = 0
        _RoughnessMap ("Layer roughness", 2D) = "white" {}
        _HasRoughness ("Has a roughness map", Float) = 0
        _MetallicMap ("Layer metallic", 2D) = "black" {}
        _HasMetallic ("Has a metallic map", Float) = 0
        _DefaultRoughness ("Card roughness", Float) = 0.3
        _CanBeFoil ("Foiled on this copy", Float) = 1
        _FoilType ("Foil type", Float) = 0
        _HasAlbedo ("Has a picture", Float) = 1
        _Frame ("Frame glow", Float) = 0
        _Premultiplied ("Layer colour is premultiplied", Float) = 0
        _LayerU ("Layer U = x u + y v + z", Vector) = (1, 0, 0, 0)
        _LayerV ("Layer V = x u + y v + z", Vector) = (0, 1, 0, 0)
        _NormalRot ("Normal turn (cos, sin)", Vector) = (1, 0, 0, 0)
    }

    CGINCLUDE
    #include "UnityCG.cginc"

    sampler2D _MainTex, _Layer, _MaskMap, _NormalMap, _RoughnessMap, _MetallicMap, _FoilMaskMap;
    float _HasMask, _HasNormal, _HasRoughness, _HasMetallic, _DefaultRoughness, _CanBeFoil, _Frame, _Premultiplied, _FoilType, _HasAlbedo, _HasFoilMask;
    float4 _LayerU, _LayerV, _NormalRot;

    float2 LayerUV(float2 uv) { return float2(dot(_LayerU.xyz, float3(uv, 1)), dot(_LayerV.xyz, float3(uv, 1))); }
    float Inside(float2 l) { return all(l >= 0) && all(l <= 1) ? 1.0 : 0.0; }

    float Coverage(float2 l, float alpha)
    {
        float4 m = tex2D(_MaskMap, l);
        if (_HasAlbedo < 0.5) return m.r * m.a * Inside(l);
        return alpha * (_HasMask > 0.5 ? m.r * m.a : 1.0) * Inside(l);
    }

    struct v2f { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; };

    v2f vert(appdata_img v)
    {
        v2f o;
        o.pos = UnityObjectToClipPos(v.vertex);
        o.uv = v.texcoord;
        return o;
    }

    float4 fragColor(v2f i) : SV_Target
    {
        float2 l = LayerUV(i.uv);
        float4 below = tex2D(_MainTex, i.uv), layer = tex2D(_Layer, l);
        if (_HasAlbedo < 0.5) return below;
        if (_Premultiplied > 0.5) layer.rgb /= max(layer.a, 1e-5);
        layer.a = Coverage(l, layer.a);
        float a = layer.a + below.a * (1.0 - layer.a);
        float3 rgb = (layer.rgb * layer.a + below.rgb * below.a * (1.0 - layer.a)) / max(a, 1e-5);
        return float4(rgb, a);
    }

    float4 fragSurface(v2f i) : SV_Target
    {
        float2 l = LayerUV(i.uv);
        float4 below = tex2D(_MainTex, i.uv);
        float a = Coverage(l, tex2D(_Layer, l).a);
        float rough = _HasRoughness > 0.5 ? tex2D(_RoughnessMap, l).r : _DefaultRoughness;
        float metal = _HasMetallic > 0.5 ? tex2D(_MetallicMap, l).r : 0.0;
        float4 fm = tex2D(_FoilMaskMap, l);
        float foil = _CanBeFoil * (_HasFoilMask > 0.5 ? fm.r * fm.a : 1.0);
        return lerp(below, float4(foil, _Frame, rough, metal), a);
    }

    float4 fragNormal(v2f i) : SV_Target
    {
        float2 l = LayerUV(i.uv);
        float4 below = tex2D(_MainTex, i.uv);
        float a = Coverage(l, tex2D(_Layer, l).a);
        float3 n = _HasNormal > 0.5 ? tex2D(_NormalMap, l).rgb * 2 - 1 : float3(0, 0, 1);
        n.xy = float2(_NormalRot.x * n.x + _NormalRot.y * n.y, -_NormalRot.y * n.x + _NormalRot.x * n.y);
        float type = _CanBeFoil > 0.5 && a > 0.5 ? _FoilType / 255.0 : below.a;
        return float4(lerp(below.rgb, n * 0.5 + 0.5, a), type);
    }
    ENDCG

    SubShader
    {
        Cull Off ZWrite Off ZTest Always Blend Off
        Pass { CGPROGRAM
               #pragma vertex vert
               #pragma fragment fragColor
               ENDCG }
        Pass { CGPROGRAM
               #pragma vertex vert
               #pragma fragment fragSurface
               ENDCG }
        Pass { CGPROGRAM
               #pragma vertex vert
               #pragma fragment fragNormal
               ENDCG }
    }
}
