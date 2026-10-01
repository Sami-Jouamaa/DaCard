Shader "DaCard/CardDiffraction"
{
    Properties
    {
        [Header(Card)]
        _MainTex ("Card Art (front)", 2D) = "white" {}
        _BackTex ("Card Back", 2D) = "white" {}
        _BackColor ("Back Tint", Color) = (0.16, 0.18, 0.22, 1)
        _EdgeColor ("Edge Color", Color) = (0.85, 0.84, 0.8, 1)

        [Header(Surface)]
        _SpecColor ("Specular Color", Color) = (0.25, 0.25, 0.25, 1)
        _Gloss ("Gloss (Blinn-Phong exponent)", Range(2, 512)) = 96
        _ReflectStrength ("Environment Reflection", Range(0, 1)) = 0.15

        [Header(Holo Foil)]
        _HoloMask ("Holo Mask (white = foil)", 2D) = "white" {}
        _HoloStrength ("Holo Strength", Range(0, 3)) = 1
        [Enum(Linear, 0, Radial, 1, Sparkle, 2)] _HoloPattern ("Groove Pattern", Float) = 0
        _GratingSpacing ("Grating Spacing d (nm)", Range(400, 4000)) = 1600
        _GratingAngle ("Linear Groove Angle (deg)", Range(0, 180)) = 30
        _SparkleScale ("Sparkle Cells (per card width)", Range(4, 200)) = 60
        _SparkleDensity ("Sparkle Density", Range(0, 1)) = 0.6
        _HoloAmbient ("Ambient Holo (camera-relative light)", Range(0, 2)) = 0.6
        _FoilDarken ("Foil darkens print", Range(0, 1)) = 0.25

        [MaterialEnum(Static, 0, Characters, 1, Hands, 2)] _StencilType ("_StencilType", Float) = 0
    }

    CGINCLUDE
    #include "UnityCG.cginc"
    #include "Lighting.cginc"
    #include "AutoLight.cginc"

    sampler2D _MainTex, _BackTex, _HoloMask;
    float4 _BackColor, _EdgeColor;
    float _Gloss, _ReflectStrength;
    float _HoloStrength, _HoloPattern, _GratingSpacing, _GratingAngle, _SparkleScale, _SparkleDensity, _HoloAmbient, _FoilDarken;

    struct appdata
    {
        float4 vertex : POSITION;
        float3 normal : NORMAL;
        float4 tangent : TANGENT;
        float2 uv : TEXCOORD0;
        float4 uv1 : TEXCOORD1;
    };

    struct v2f
    {
        float4 pos : SV_POSITION;
        float3 uv : TEXCOORD0;
        float3 worldPos : TEXCOORD1;
        float3 worldNormal : TEXCOORD2;
        float3 worldTangent : TEXCOORD3;
        float3 worldBinormal : TEXCOORD4;
        half3 sh : TEXCOORD5;
        UNITY_SHADOW_COORDS(6)
    };

    v2f vert(appdata v)
    {
        v2f o;
        UNITY_INITIALIZE_OUTPUT(v2f, o);
        o.pos = UnityObjectToClipPos(v.vertex);
        o.uv = float3(v.uv, v.uv1.z);
        o.worldPos = mul(unity_ObjectToWorld, v.vertex).xyz;
        o.worldNormal = UnityObjectToWorldNormal(v.normal);
        o.worldTangent = UnityObjectToWorldDir(v.tangent.xyz);
        o.worldBinormal = cross(o.worldNormal, o.worldTangent) * v.tangent.w * unity_WorldTransformParams.w;
        o.sh = ShadeSH9(float4(o.worldNormal, 1));
        UNITY_TRANSFER_SHADOW(o, v.uv);
        return o;
    }

    float3 Bump3y(float3 x, float3 yOffset)
    {
        float3 y = 1 - x * x;
        return saturate(y - yOffset);
    }

    float3 SpectralZucconi6(float wavelengthNm)
    {
        if (wavelengthNm < 400 || wavelengthNm > 700) return 0;
        float x = saturate((wavelengthNm - 400.0) / 300.0);
        const float3 c1 = float3(3.54585104, 2.93225262, 2.41593945);
        const float3 x1 = float3(0.69549072, 0.49228336, 0.27699880);
        const float3 y1 = float3(0.02312639, 0.15225084, 0.52607955);
        const float3 c2 = float3(3.90307140, 3.21182957, 3.96587128);
        const float3 x2 = float3(0.11748627, 0.86755042, 0.66077860);
        const float3 y2 = float3(0.84897130, 0.88445281, 0.73949448);
        return Bump3y(c1 * (x - x1), y1) + Bump3y(c2 * (x - x2), y2);
    }

    float3 Diffraction(float3 L, float3 V, float3 T)
    {
        float u = abs(dot(L, T) - dot(V, T));
        if (u < 1e-4) return 0;
        float3 c = 0;
        [unroll] for (int n = 1; n <= 8; n++)
            c += SpectralZucconi6(u * _GratingSpacing / n);
        return saturate(c);
    }

    float Hash21(float2 p)
    {
        p = frac(p * float2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return frac(p.x * p.y);
    }

    float3 GratingTangentSpace(float2 faceUV)
    {
        if (_HoloPattern < 0.5)
        {
            float a = radians(_GratingAngle);
            return float3(cos(a), sin(a), 1);
        }
        if (_HoloPattern < 1.5)
        {
            float2 d = faceUV - 0.5;
            d.y *= 88.0 / 63.0;
            return float3(normalize(d + 1e-5), 1);
        }
        float2 cell = floor(faceUV * float2(_SparkleScale, _SparkleScale * 88.0 / 63.0));
        float a = Hash21(cell) * UNITY_TWO_PI;
        float gate = step(1 - _SparkleDensity, Hash21(cell + 17.13));
        return float3(cos(a), sin(a), gate);
    }

    struct CardSurface
    {
        float3 albedo;
        float holo;
        float3 T;
        float3 N;
    };

    CardSurface GetSurface(v2f i)
    {
        CardSurface s;
        s.N = normalize(i.worldNormal);
        s.holo = 0;
        s.T = normalize(i.worldTangent);

        float2 faceUV = i.uv.xy;
        bool isFront = i.uv.z > 0.5;
        bool isBack = i.uv.z < -0.5;

        if (isFront)
        {
            s.albedo = tex2D(_MainTex, faceUV).rgb;
            float3 g = GratingTangentSpace(faceUV);
            s.holo = tex2D(_HoloMask, faceUV).r * _HoloStrength * g.z;
            float3 B = normalize(i.worldBinormal);
            s.T = normalize(g.x * s.T + g.y * B);
            s.albedo *= 1 - _FoilDarken * saturate(s.holo);
        }
        else if (isBack)
        {
            s.albedo = tex2D(_BackTex, faceUV).rgb * _BackColor.rgb;
        }
        else
        {
            s.albedo = _EdgeColor.rgb;
        }
        return s;
    }

    float3 DirectLight(CardSurface s, float3 L, float3 V, float3 lightColor, float atten)
    {
        float ndl = saturate(dot(s.N, L));
        float3 H = normalize(L + V);
        float spec = pow(saturate(dot(s.N, H)), _Gloss) * ndl;
        float3 c = s.albedo * ndl + _SpecColor.rgb * spec;
        c += Diffraction(L, V, s.T) * s.holo * ndl;
        return c * lightColor * atten;
    }
    ENDCG

    SubShader
    {
        Tags { "RenderType" = "Opaque" "Queue" = "Geometry" }

        Pass
        {
            Name "FORWARD"
            Tags { "LightMode" = "ForwardBase" }
            Stencil
            {
                Ref [_StencilType]
                WriteMask 3
                Comp Always
                Pass Replace
            }

            CGPROGRAM
            #pragma vertex vert
            #pragma fragment fragBase
            #pragma target 3.0
            #pragma multi_compile_fwdbase

            fixed4 fragBase(v2f i) : SV_Target
            {
                CardSurface s = GetSurface(i);
                float3 V = normalize(_WorldSpaceCameraPos - i.worldPos);
                UNITY_LIGHT_ATTENUATION(atten, i, i.worldPos);

                float3 L = normalize(UnityWorldSpaceLightDir(i.worldPos));
                float3 c = DirectLight(s, L, V, _LightColor0.rgb, atten);

                c += s.albedo * i.sh;
                float3 R = reflect(-V, s.N);
                half4 env = UNITY_SAMPLE_TEXCUBE_LOD(unity_SpecCube0, R, 2);
                float fresnel = 0.04 + 0.96 * pow(1 - saturate(dot(s.N, V)), 5);
                c += DecodeHDR(env, unity_SpecCube0_HDR) * _ReflectStrength * fresnel;

                float3 camUp = UNITY_MATRIX_V[1].xyz;
                float3 camRight = UNITY_MATRIX_V[0].xyz;
                float3 Lv = normalize(V + camUp * 0.7 + camRight * 0.35);
                float ambientLum = max(Luminance(i.sh), 0.05);
                c += Diffraction(Lv, V, s.T) * s.holo * _HoloAmbient * ambientLum;

                return fixed4(c, 1);
            }
            ENDCG
        }

        Pass
        {
            Name "FORWARD_DELTA"
            Tags { "LightMode" = "ForwardAdd" }
            Blend One One
            ZWrite Off

            CGPROGRAM
            #pragma vertex vert
            #pragma fragment fragAdd
            #pragma target 3.0
            #pragma multi_compile_fwdadd_fullshadows

            fixed4 fragAdd(v2f i) : SV_Target
            {
                CardSurface s = GetSurface(i);
                float3 V = normalize(_WorldSpaceCameraPos - i.worldPos);
                UNITY_LIGHT_ATTENUATION(atten, i, i.worldPos);
                float3 L = normalize(UnityWorldSpaceLightDir(i.worldPos));
                return fixed4(DirectLight(s, L, V, _LightColor0.rgb, atten), 1);
            }
            ENDCG
        }

        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode" = "ShadowCaster" }

            CGPROGRAM
            #pragma vertex vertShadow
            #pragma fragment fragShadow
            #pragma target 3.0
            #pragma multi_compile_shadowcaster

            struct v2fShadow { V2F_SHADOW_CASTER; };

            v2fShadow vertShadow(appdata_base v)
            {
                v2fShadow o;
                TRANSFER_SHADOW_CASTER_NORMALOFFSET(o)
                return o;
            }

            float4 fragShadow(v2fShadow i) : SV_Target { SHADOW_CASTER_FRAGMENT(i) }
            ENDCG
        }
    }
}
