// Stacks a card's layers for the client (CardLayers.cs), one layer per blit, ping-ponging between two render textures:
// _MainTex = the stack so far, _Layer = this layer's picture (its alpha = where it covers), _Mask = its foil area / normal map.
// The layer's transform: _LayerU / _LayerV map the card's UV to the layer's (outside 0..1: not covered); _NormalRot
// (cos, sin) turns its normal map's vectors with it.
// Pass 0 colour (straight alpha), pass 1 foil (R: foil, G: 1 = frame glow), pass 2 normal map (encoded, 0.5 0.5 1 = flat;
// _Mask2: the layer's normal mask, where its normal map shows: elsewhere the layer is flat).
Shader "Hidden/DaCard/Layer Composite"
{
    Properties
    {
        _MainTex ("Stack so far", 2D) = "black" {}
        _Layer ("Layer picture", 2D) = "black" {}
        _Mask ("Layer foil area / normal map", 2D) = "white" {}
        _HasMask ("Has a mask", Float) = 0
        _Mask2 ("Layer normal mask", 2D) = "white" {}
        _HasMask2 ("Has a normal mask", Float) = 0
        _CanBeFoil ("Can be foil", Float) = 1
        _Frame ("Frame glow", Float) = 0
        _Premultiplied ("Layer colour is premultiplied", Float) = 0
        _LayerU ("Layer U = x u + y v + z", Vector) = (1, 0, 0, 0)
        _LayerV ("Layer V = x u + y v + z", Vector) = (0, 1, 0, 0)
        _NormalRot ("Normal turn (cos, sin)", Vector) = (1, 0, 0, 0)
    }

    CGINCLUDE
    #include "UnityCG.cginc"

    sampler2D _MainTex, _Layer, _Mask, _Mask2;
    float _HasMask, _HasMask2, _CanBeFoil, _Frame, _Premultiplied;
    float4 _LayerU, _LayerV, _NormalRot;

    float2 LayerUV(float2 uv) { return float2(dot(_LayerU.xyz, float3(uv, 1)), dot(_LayerV.xyz, float3(uv, 1))); }
    float Inside(float2 l) { return all(l >= 0) && all(l <= 1) ? 1.0 : 0.0; }

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
        if (_Premultiplied > 0.5) layer.rgb /= max(layer.a, 1e-5);
        layer.a *= Inside(l);
        float a = layer.a + below.a * (1.0 - layer.a);
        float3 rgb = (layer.rgb * layer.a + below.rgb * below.a * (1.0 - layer.a)) / max(a, 1e-5);
        return float4(rgb, a);
    }

    float4 fragFoil(v2f i) : SV_Target
    {
        float2 l = LayerUV(i.uv);
        float4 below = tex2D(_MainTex, i.uv), mask = tex2D(_Mask, l);
        float a = tex2D(_Layer, l).a * Inside(l);
        // Can be foil: foil inside its foil area (none: all of it). Can't: it covers the foil under it.
        float foil = _CanBeFoil * (_HasMask > 0.5 ? mask.r * mask.a : 1.0);
        return float4(lerp(below.r, foil, a), lerp(below.g, _Frame, a), 0, 1);
    }

    float4 fragNormal(v2f i) : SV_Target
    {
        float2 l = LayerUV(i.uv);
        float4 below = tex2D(_MainTex, i.uv);
        float a = tex2D(_Layer, l).a * Inside(l);
        float3 n = _HasMask > 0.5 ? tex2D(_Mask, l).rgb * 2 - 1 : float3(0, 0, 1);
        if (_HasMask2 > 0.5)
        {
            float4 m = tex2D(_Mask2, l);
            n = lerp(float3(0, 0, 1), n, m.r * m.a);
        }
        // Turned with the picture (clockwise on the card = clockwise in tangent space, y up)
        n.xy = float2(_NormalRot.x * n.x + _NormalRot.y * n.y, -_NormalRot.y * n.x + _NormalRot.x * n.y);
        return float4(lerp(below.rgb, n * 0.5 + 0.5, a), 1);
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
               #pragma fragment fragFoil
               ENDCG }
        Pass { CGPROGRAM
               #pragma vertex vert
               #pragma fragment fragNormal
               ENDCG }
    }
}
