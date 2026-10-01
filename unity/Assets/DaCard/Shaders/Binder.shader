Shader "DaCard/Binder"
{
    Properties
    {
        _Color ("Colour", Color) = (1, 1, 1, 1)
        _MainTex ("Colour (RGB) x AO, shine mask (A)", 2D) = "white" {}
        _SpecMap ("Gloss (R)", 2D) = "white" {}
        [Normal] _BumpMap ("Normal map", 2D) = "bump" {}
        _NormalStrength ("Normal strength", Range(0, 2)) = 1
        _Shine ("Shine (1 = as in the texture)", Range(0, 3)) = 1
        _Gloss ("Gloss (smoothness scale)", Range(0, 1.5)) = 0.8
    }

    SubShader
    {
        Tags { "RenderType" = "Opaque" "Queue" = "Geometry" }
        LOD 300

        CGPROGRAM
        #pragma surface surf StandardSpecular fullforwardshadows
        #pragma target 3.0

        sampler2D _MainTex, _SpecMap, _BumpMap;
        fixed4 _Color;
        half _NormalStrength, _Shine, _Gloss;

        struct Input { float2 uv_MainTex; };

        void surf(Input IN, inout SurfaceOutputStandardSpecular o)
        {
            fixed4 c = tex2D(_MainTex, IN.uv_MainTex);
            o.Albedo = c.rgb * _Color.rgb;
            o.Specular = saturate(c.a * _Shine * 0.16).xxx;
            o.Smoothness = saturate(tex2D(_SpecMap, IN.uv_MainTex).r * _Gloss);
            o.Normal = UnpackScaleNormal(tex2D(_BumpMap, IN.uv_MainTex), _NormalStrength);
            o.Alpha = 1;
        }
        ENDCG
    }
    FallBack "Legacy Shaders/Diffuse"
}
