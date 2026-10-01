Shader "DaCard/Pack"
{
    Properties
    {
        _Color ("Colour", Color) = (1, 1, 1, 1)
        _MainTex ("Albedo", 2D) = "white" {}
        [Normal] _BumpMap ("Normal map (OpenGL)", 2D) = "bump" {}
        _MetallicMap ("Metallic (R)", 2D) = "white" {}
        _RoughnessMap ("Roughness (R)", 2D) = "white" {}
        _OcclusionMap ("Ambient occlusion (R)", 2D) = "white" {}
        _NormalStrength ("Normal strength", Range(0, 2)) = 1
        _Metallic ("Metallic scale", Range(0, 1)) = 0.85
        _Smoothness ("Smoothness scale", Range(0, 1.5)) = 1
        _OcclusionStrength ("Occlusion strength", Range(0, 1)) = 1
        _Fill ("Fill light", Range(0, 1)) = 0.18
    }

    SubShader
    {
        Tags { "RenderType" = "Opaque" "Queue" = "Geometry" }
        LOD 300

        CGPROGRAM
        #pragma surface surf Standard fullforwardshadows
        #pragma target 3.0

        sampler2D _MainTex, _BumpMap, _MetallicMap, _RoughnessMap, _OcclusionMap;
        fixed4 _Color;
        half _NormalStrength, _Metallic, _Smoothness, _OcclusionStrength, _Fill;

        struct Input { float2 uv_MainTex; };

        void surf(Input IN, inout SurfaceOutputStandard o)
        {
            float2 uv = IN.uv_MainTex;
            fixed3 albedo = tex2D(_MainTex, uv).rgb * _Color.rgb;
            half ao = lerp(1, tex2D(_OcclusionMap, uv).r, _OcclusionStrength);
            o.Albedo = albedo;
            o.Metallic = saturate(tex2D(_MetallicMap, uv).r * _Metallic);
            o.Smoothness = saturate((1 - tex2D(_RoughnessMap, uv).r) * _Smoothness);
            o.Occlusion = ao;
            o.Normal = UnpackScaleNormal(tex2D(_BumpMap, uv), _NormalStrength);
            o.Emission = albedo * ao * _Fill;
            o.Alpha = 1;
        }
        ENDCG
    }
    FallBack "Legacy Shaders/Diffuse"
}
