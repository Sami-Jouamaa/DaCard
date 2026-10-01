Shader "DaCard/Binder Sticker"
{
    Properties
    {
        _MainTex ("Sticker (RGBA, alpha = shape)", 2D) = "white" {}
        _StickerCenter ("Centre (cover UV, v up)", Vector) = (0.5, 0.6, 0, 0)
        _StickerSize ("Size (share of cover width, height)", Vector) = (0.6, 0.3, 0, 0)
        _StickerAngle ("Rotation (degrees, clockwise)", Float) = 0
        _CoverSize ("Cover size (world units, set by the builder)", Vector) = (1, 1.4, 0, 0)
        _Glossiness ("Smoothness", Range(0, 1)) = 0.5
        _EdgeWidth ("Edge rise width (share of cover height)", Range(0.001, 0.05)) = 0.004
        _EdgeStrength ("Edge rise strength (build settings: Sticker Bump)", Range(0, 4)) = 0.35
        _Cutoff ("Cut-out at alpha", Range(0.01, 0.99)) = 0.5
        _OffsetFactor ("Depth offset factor", Float) = -1
        _OffsetUnits ("Depth offset units (per layer, set by the client)", Float) = -1
    }

    SubShader
    {
        Tags { "Queue" = "AlphaTest" "RenderType" = "TransparentCutout" "IgnoreProjector" = "True" "ForceNoShadowCasting" = "True" }
        LOD 200
        Offset [_OffsetFactor], [_OffsetUnits]

        CGPROGRAM
        #pragma surface surf Standard alphatest:_Cutoff
        #pragma target 3.0

        sampler2D _MainTex;
        float4 _StickerCenter, _StickerSize, _CoverSize;
        float _StickerAngle, _Glossiness, _EdgeWidth, _EdgeStrength;

        struct Input { float2 uv_MainTex; };

        float2 StickerUV(float2 cover)
        {
            float2 p = (cover - _StickerCenter.xy) * _CoverSize.xy;
            float a = radians(_StickerAngle);
            float s = sin(a), c = cos(a);
            p = float2(c * p.x - s * p.y, s * p.x + c * p.y);
            return p / max(_StickerSize.xy * _CoverSize.xy, 1e-5) + 0.5;
        }

        float Coverage(float2 cover, float blur)
        {
            float2 st = StickerUV(cover);
            float2 inside = step(0, st) * step(st, 1);
            return tex2Dlod(_MainTex, float4(saturate(st), 0, blur)).a * inside.x * inside.y;
        }

        void surf(Input IN, inout SurfaceOutputStandard o)
        {
            float2 uv = IN.uv_MainTex;
            float2 st = StickerUV(uv);
            float2 inside = step(0, st) * step(st, 1);
            float4 c = tex2D(_MainTex, saturate(st));

            float e = _EdgeWidth;
            float2 du = float2(e * _CoverSize.y / _CoverSize.x, 0);
            float2 dv = float2(0, e);
            float blur = 2;
            float dx = Coverage(uv + du, blur) - Coverage(uv - du, blur);
            float dy = Coverage(uv + dv, blur) - Coverage(uv - dv, blur);

            o.Albedo = c.rgb;
            o.Normal = normalize(float3(-dx * _EdgeStrength, -dy * _EdgeStrength, 1));
            o.Metallic = 0;
            o.Smoothness = _Glossiness;
            o.Alpha = c.a * inside.x * inside.y;
        }
        ENDCG
    }
    FallBack Off
}
