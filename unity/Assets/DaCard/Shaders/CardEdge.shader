Shader "DaCard/Card Edge"
{
    Properties
    {
        _Color ("Colour", Color) = (0.93, 0.92, 0.9, 1)
        _Glossiness ("Smoothness", Range(0, 1)) = 0.3
    }

    SubShader
    {
        Tags { "RenderType" = "Opaque" "Queue" = "Geometry" }
        LOD 200

        CGPROGRAM
        #pragma surface surf Standard fullforwardshadows
        #pragma target 3.0

        fixed4 _Color;
        half _Glossiness;

        struct Input { float3 worldPos; };

        void surf(Input IN, inout SurfaceOutputStandard o)
        {
            o.Albedo = _Color.rgb;
            o.Metallic = 0;
            o.Smoothness = _Glossiness;
            o.Alpha = 1;
        }
        ENDCG
    }
    FallBack "Legacy Shaders/Diffuse"
}
