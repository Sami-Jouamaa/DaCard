Shader "DaCard/Card Glow"
{
    Properties
    {
        [HDR] _Color ("Colour", Color) = (1, 0.7, 0.18, 1)
        [HDR] _Color2 ("Second colour", Color) = (1, 0.95, 0.75, 1)
        _Strength ("Strength", Range(0, 4)) = 1
        _Line ("Neon line", Range(0, 3)) = 1
        _Halo ("Halo", Range(0, 3)) = 1
        _Sparkles ("Sparkles", Range(0, 3)) = 0
        _Flares ("Star flares", Range(0, 3)) = 0
        _Smoke ("Smoke", Range(0, 3)) = 0
        _Rays ("Rays", Range(0, 3)) = 0
        _Drip ("Dripping smoke", Range(0, 3)) = 0
        _Speed ("Speed", Range(0, 4)) = 1
        _Seed ("Seed", Float) = 0
        // In the world (the client sets the global _DaCardWorld while the game's main camera draws), where the raid's HDR
        // bloom and eye adaptation blow an additive glow out: weaker there, and its peaks capped. Inspect views and icons
        // keep the full glow.
        _WorldStrength ("Strength in the world", Range(0, 1)) = 0.35
    }

    SubShader
    {
        Tags { "Queue" = "Transparent+10" "RenderType" = "Transparent" "IgnoreProjector" = "True" "PreviewType" = "Plane" }

        Pass
        {
            Blend One One
            ZWrite Off
            Cull Off

            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 3.0
            #include "UnityCG.cginc"

            #define TAU 6.28318530718

            float4 _Color, _Color2;
            float _Strength, _Line, _Halo, _Sparkles, _Flares, _Smoke, _Rays, _Drip, _Speed, _Seed, _WorldStrength;
            float _DaCardWorld;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float2 pos : TEXCOORD0;
                float4 card : TEXCOORD1;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 q : TEXCOORD0;
                float4 card : TEXCOORD1;
                float3 normal : TEXCOORD2;
                float3 world : TEXCOORD3;
            };

            v2f vert(appdata v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                float halfHeight = max(v.card.y, 1e-5);
                o.q = v.pos / halfHeight;
                o.card = float4(v.card.x / halfHeight, 1, v.card.z / halfHeight, v.card.w / halfHeight);
                o.normal = UnityObjectToWorldNormal(v.normal);
                o.world = mul(unity_ObjectToWorld, v.vertex).xyz;
                return o;
            }

            float hash11(float p)
            {
                p = frac(p * 0.1031);
                p *= p + 33.33;
                p *= p + p;
                return frac(p);
            }

            float hash12(float2 p)
            {
                float3 p3 = frac(p.xyx * 0.1031);
                p3 += dot(p3, p3.yzx + 33.33);
                return frac((p3.x + p3.y) * p3.z);
            }

            float3 hash32(float2 p)
            {
                float3 p3 = frac(p.xyx * float3(0.1031, 0.1030, 0.0973));
                p3 += dot(p3, p3.yxz + 33.33);
                return frac((p3.xxy + p3.yzz) * p3.zyx);
            }

            float loopNoise(float x, float period, float seed)
            {
                float i = floor(x);
                float f = frac(x);
                float a = hash11(i - period * floor(i / period) + seed * 13.7);
                float j = i + 1;
                float b = hash11(j - period * floor(j / period) + seed * 13.7);
                return lerp(a, b, f * f * (3 - 2 * f));
            }

            float valueNoise(float2 p)
            {
                float2 i = floor(p);
                float2 f = frac(p);
                float2 u = f * f * (3 - 2 * f);
                return lerp(lerp(hash12(i), hash12(i + float2(1, 0)), u.x),
                            lerp(hash12(i + float2(0, 1)), hash12(i + 1), u.x), u.y);
            }

            float fbm(float2 p)
            {
                float v = 0, a = 0.5;
                for (int k = 0; k < 4; k++)
                {
                    v += a * valueNoise(p);
                    p = p * 2.03 + 17.1;
                    a *= 0.5;
                }
                return v;
            }

            float roundRect(float2 q, float2 halfSize, float radius)
            {
                float2 d = abs(q) - halfSize + radius;
                return length(max(d, 0)) + min(max(d.x, d.y), 0) - radius;
            }

            float2 outlinePoint(float u, float2 halfSize)
            {
                float perimeter = 4 * (halfSize.x + halfSize.y);
                float s = frac(u) * perimeter;
                float w = 2 * halfSize.x, h = 2 * halfSize.y;
                if (s < w) return float2(-halfSize.x + s, halfSize.y);
                s -= w;
                if (s < h) return float2(halfSize.x, halfSize.y - s);
                s -= h;
                if (s < w) return float2(halfSize.x - s, -halfSize.y);
                s -= w;
                return float2(-halfSize.x, -halfSize.y + s);
            }

            // One sparkle per grid cell, drifting with the grid. Whether it shows depends on how far its centre is from the
            // card, fading in and out as it drifts (not per pixel, which could cut a sparkle in half)
            float dust(float2 q, float2 offset, float cell, float drift, float t, float density, float2 halfSize, float radius, float seed, float2 pixel)
            {
                float2 g = (q + offset) / cell + float2(0, -t * drift);
                float2 id = floor(g);
                float2 f = frac(g);
                float3 h = hash32(id + seed * 71.3);
                float2 centre = 0.25 + 0.5 * h.xy;
                float2 centreQ = (id + centre + float2(0, t * drift)) * cell - offset;
                float dc = roundRect(centreQ, halfSize, radius);
                float want = density * exp(-max(dc, 0) / 0.14);
                float present = smoothstep(h.z - 0.06, h.z + 0.06, want) * smoothstep(-0.01, 0.02, dc);
                float size = lerp(0.05, 0.16, h.y * h.y);
                float footprint = max(size, 0.7 * max(pixel.x, pixel.y) / cell);
                float r = length(f - centre) / footprint;
                float twinkle = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(t * (1.3 + 3.1 * h.x) + h.z * TAU * 7), 3);
                return present * exp(-r * r * 2.5) * twinkle * (size * size) / (footprint * footprint) * lerp(0.4, 1.6, h.x);
            }

            float star(float2 v, float size, float2 pixel)
            {
                float w = max(0.005 * size, pixel.x * 0.8);
                float spike = exp(-abs(v.x) / w) * exp(-abs(v.y) / (0.2 * size))
                            + exp(-abs(v.y) / w) * exp(-abs(v.x) / (0.2 * size));
                float2 r = float2(v.x + v.y, v.x - v.y) * 0.70710678;
                float diagonal = exp(-abs(r.x) / w) * exp(-abs(r.y) / (0.07 * size))
                               + exp(-abs(r.y) / w) * exp(-abs(r.x) / (0.07 * size));
                float r2 = dot(v, v) / (size * size);
                return 1.4 * spike + 0.5 * diagonal + 3 * exp(-r2 / 0.0006) + 0.5 * exp(-r2 / 0.006);
            }

            float4 frag(v2f i) : SV_Target
            {
                float2 q = i.q;
                float2 halfSize = float2(i.card.x, 1);
                float radius = i.card.z;
                float margin = i.card.w;
                float2 pixel = fwidth(q);

                float d = roundRect(q, halfSize, radius);
                float outside = smoothstep(-0.004, 0.006, d);
                // Fades out over a wide band by the distance to the card's rounded outline (its contours round off further
                // out), and a squircle trims what's left near the mesh's edge: no straight cut-off
                float nearFade = 1 - smoothstep(margin * 0.3, margin * 0.95, max(d, 0));
                float2 e = abs(q) / (halfSize + margin);
                float squircle = pow(pow(e.x, 4) + pow(e.y, 4), 0.25);
                float border = nearFade * nearFade * (1 - smoothstep(0.85, 1.0, squircle));

                float3 view = normalize(_WorldSpaceCameraPos - i.world);
                float edgeOn = smoothstep(0.06, 0.35, abs(dot(normalize(i.normal), view)));

                float seed = _Seed;
                float t = _Time.y * _Speed + seed * 37.0;
                float s = atan2(q.y, q.x / halfSize.x) / TAU + 0.5;

                float3 c1 = _Color.rgb;
                float3 c2 = _Color2.rgb;
                float3 tint = lerp(c1, c2, loopNoise(s * 5 + t * 0.12, 5, seed));

                float lineOffset = 0.012;
                float lineWidth = max(0.0065, pixel.x * 0.9);
                float x = (d - lineOffset) / lineWidth;
                float neon = exp(-x * x);
                float pulse = 0.88 + 0.12 * sin(t * 1.7);
                float3 col = (tint * 1.6 + pow(neon, 2) * 1.4) * neon * _Line * pulse;

                float hot = 0.45 + 0.55 * loopNoise(s * 7 - t * 0.08, 7, seed + 3);
                float dOut = max(d - lineOffset, 0);
                float halo = (exp(-dOut / 0.025) * 0.6 + exp(-dOut / 0.1) * 0.45) * hot;
                col += tint * halo * _Halo * pulse;

                if (_Smoke > 0)
                {
                    float2 w = q * 3.2 + float2(0, -t * 0.16) + seed * 11.0;
                    float2 warp = float2(fbm(w * 0.8 + t * 0.05), fbm(w * 0.8 + 5.2 - t * 0.04));
                    float n = fbm(w + warp * 1.6);
                    float wisps = smoothstep(0.38, 0.85, n);
                    float reach = 0.13 + 0.12 * loopNoise(s * 6 + t * 0.05, 6, seed + 9);
                    float smoke = wisps * exp(-max(d, 0) / reach) * smoothstep(-0.01, 0.03, d);
                    col += lerp(c1, c2, n) * smoke * _Smoke * 0.9;
                }

                if (_Drip > 0)
                {
                    // Dripping smoke: thick streaks that run down the card (towards its bottom edge, -y) and hang below it
                    float2 dq = float2(q.x * 4.0, q.y * 1.1 + t * 0.35) + seed * 7.0;
                    float2 dwarp = float2(fbm(dq * 0.7 + t * 0.03), fbm(dq * 0.7 + 3.7));
                    float dn = fbm(dq + dwarp * 1.2);
                    float drips = smoothstep(0.30, 0.75, dn);
                    float lower = saturate(0.5 - 0.5 * q.y / halfSize.y);
                    float dripReach = lerp(0.12, 0.34, lower) * (0.8 + 0.4 * loopNoise(s * 5 + t * 0.04, 5, seed + 11));
                    float drip = drips * exp(-max(d, 0) / dripReach) * smoothstep(-0.01, 0.03, d) * lerp(0.5, 1.2, lower);
                    col += lerp(c1, c2, dn) * drip * _Drip * 1.2;
                }

                if (_Rays > 0)
                {
                    float streak = pow(loopNoise(s * 140, 140, seed + 5), 7) * 1.8 + pow(loopNoise(s * 61, 61, seed + 6), 5);
                    float flicker = 0.6 + 0.4 * sin(t * 2.3 + loopNoise(s * 23, 23, seed + 7) * TAU);
                    float reach = 0.06 + 0.22 * loopNoise(s * 37, 37, seed + 8);
                    float rays = streak * flicker * exp(-dOut / reach) * smoothstep(0.0, 0.02, d);
                    col += lerp(c2, c1, 0.4) * rays * _Rays;
                }

                if (_Sparkles > 0)
                {
                    float fine = dust(q, 0, 0.016, 0.9, t, 0.55 * _Sparkles, halfSize, radius, seed, pixel);
                    float coarse = dust(q, 0.37, 0.042, 0.35, t * 0.8, 0.28 * _Sparkles, halfSize, radius, seed + 1, pixel);
                    col += lerp(c1, c2, 0.5) * fine * 1.3 + lerp(c1, c2, 0.25) * coarse * 1.1;
                }

                if (_Flares > 0)
                {
                    float2 outline = halfSize + lineOffset;
                    float flares = 0;
                    for (int k = 0; k < 6; k++)
                    {
                        float period = 2.6 + 2.2 * hash11(k * 3.1 + seed);
                        float phase = t / period + hash11(k * 7.7 + seed);
                        float cycle = floor(phase);
                        float3 h = hash32(float2(k * 19.3 + seed * 5.0, cycle));
                        float env = pow(saturate(sin(frac(phase) * 3.14159265)), 3) * step(h.z, 0.35 + 0.4 * saturate(_Flares));
                        float2 at = outlinePoint(h.x, outline);
                        float size = lerp(0.6, 1.4, h.y);
                        flares += star(q - at, size, pixel) * env;
                    }
                    col += lerp(c2, float3(1, 1, 1), 0.55) * flares * _Flares;
                }

                col *= _Strength * outside * border * edgeOn;
                // In the world: weaker, and its peaks softly capped below white (nothing for the bloom to blow out)
                float peak = max(col.r, max(col.g, col.b));
                float3 world = col * _WorldStrength;
                float worldPeak = peak * _WorldStrength;
                world *= (1 - exp(-worldPeak * 1.5)) / 1.5 / max(worldPeak, 1e-4);
                col = lerp(col, world, saturate(_DaCardWorld));
                return float4(col, saturate(max(col.r, max(col.g, col.b))));
            }
            ENDCG
        }
    }
}
