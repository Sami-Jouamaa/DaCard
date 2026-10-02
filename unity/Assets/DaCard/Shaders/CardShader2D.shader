// Made with Amplify Shader Editor v1.9.9.9
// Available at the Unity Asset Store - http://u3d.as/y3X 
Shader "AmplifyCardShader2D"
{
	Properties
	{
		_CARD_FRONT_MASK( "CARD_FRONT_MASK", 2D ) = "white" {}
		_CARD_BACK( "CARD_BACK", 2D ) = "white" {}
		_MainTex( "_MainTex", 2D ) = "white" {}
		_CARD_FRONT_BORDER( "CARD_FRONT_BORDER", 2D ) = "white" {}
		_ArtGlow( "Art Glow", Range( 0, 1 ) ) = 0.6
		_BorderGlow( "Border Glow", Range( 0, 1 ) ) = 0.2
		_FoilMask( "Foil Mask", 2D ) = "white" {}
		_FoilStrength( "Foil Strength", Range( 0, 2 ) ) = 0.6
		_FoilScale( "Foil Scale", Float ) = 1.5
		_FoilShift( "Foil Tilt Shift", Float ) = 1.5
		_NormalMap( "Normal Map", 2D ) = "bump" {}
		_NormalStrength( "Normal Strength", Range( 0, 2 ) ) = 1
		_LayerFoil( "Layer Foil", 2D ) = "black" {}
		_BackFoil( "Back Foil", 2D ) = "black" {}
		_LayerNormal( "Layer Normal", 2D ) = "bump" {}
		_BackNormal( "Back Normal", 2D ) = "bump" {}
		_WorldGlow( "Glow in the world", Range( 0, 1 ) ) = 0.1
		_Roughness( "Roughness", Range( 0, 1 ) ) = 0.3


		//_TransmissionShadow( "Transmission Shadow", Range( 0, 1 ) ) = 0.5
		//_TransStrength( "Trans Strength", Range( 0, 50 ) ) = 1
		//_TransNormal( "Trans Normal Distortion", Range( 0, 1 ) ) = 0.5
		//_TransScattering( "Trans Scattering", Range( 1, 50 ) ) = 2
		//_TransDirect( "Trans Direct", Range( 0, 1 ) ) = 0.9
		//_TransAmbient( "Trans Ambient", Range( 0, 1 ) ) = 0.1
		//_TransShadow( "Trans Shadow", Range( 0, 1 ) ) = 0.5

		//_TessPhongStrength( "Tess Phong Strength", Range( 0, 1 ) ) = 0.5
		//_TessValue( "Tess Max Tessellation", Range( 1, 32 ) ) = 16
		//_TessMin( "Tess Min Distance", Float ) = 10
		//_TessMax( "Tess Max Distance", Float ) = 25
		//_TessEdgeLength ( "Tess Edge length", Range( 2, 50 ) ) = 16
		//_TessMaxDisp( "Tess Max Displacement", Float ) = 25

		[ToggleOff] _SpecularHighlights("Specular Highlights", Float) = 1.0
		[ToggleOff] _GlossyReflections("Reflections", Float) = 1.0

		//_InstancedTerrainNormals("Specular Highlights", Float) = 1.0
	}

	SubShader
	{
		

		

		Tags { "RenderType"="Opaque" "Queue"="Geometry" "DisableBatching"="False" }

	LOD 0

		Cull Back
		AlphaToMask Off
		ZWrite On
		ZTest LEqual
		ColorMask RGBA

		

		Blend Off
		

		CGINCLUDE
			#pragma target 3.5
			// ensure rendering platforms toggle list is visible

			float4 FixedTess( float tessValue )
			{
				return tessValue;
			}

			float CalcDistanceTessFactor (float4 vertex, float minDist, float maxDist, float tess, float4x4 o2w, float3 cameraPos )
			{
				float3 wpos = mul(o2w,vertex).xyz;
				float dist = distance (wpos, cameraPos);
				float f = clamp(1.0 - (dist - minDist) / (maxDist - minDist), 0.01, 1.0) * tess;
				return f;
			}

			float4 CalcTriEdgeTessFactors (float3 triVertexFactors)
			{
				float4 tess;
				tess.x = 0.5 * (triVertexFactors.y + triVertexFactors.z);
				tess.y = 0.5 * (triVertexFactors.x + triVertexFactors.z);
				tess.z = 0.5 * (triVertexFactors.x + triVertexFactors.y);
				tess.w = (triVertexFactors.x + triVertexFactors.y + triVertexFactors.z) / 3.0f;
				return tess;
			}

			float CalcEdgeTessFactor (float3 wpos0, float3 wpos1, float edgeLen, float3 cameraPos, float4 scParams )
			{
				float dist = distance (0.5 * (wpos0+wpos1), cameraPos);
				float len = distance(wpos0, wpos1);
				float f = max(len * scParams.y / (edgeLen * dist), 1.0);
				return f;
			}

			float DistanceFromPlane (float3 pos, float4 plane)
			{
				float d = dot (float4(pos,1.0f), plane);
				return d;
			}

			bool WorldViewFrustumCull (float3 wpos0, float3 wpos1, float3 wpos2, float cullEps, float4 planes[6] )
			{
				float4 planeTest;
				planeTest.x = (( DistanceFromPlane(wpos0, planes[0]) > -cullEps) ? 1.0f : 0.0f ) +
							  (( DistanceFromPlane(wpos1, planes[0]) > -cullEps) ? 1.0f : 0.0f ) +
							  (( DistanceFromPlane(wpos2, planes[0]) > -cullEps) ? 1.0f : 0.0f );
				planeTest.y = (( DistanceFromPlane(wpos0, planes[1]) > -cullEps) ? 1.0f : 0.0f ) +
							  (( DistanceFromPlane(wpos1, planes[1]) > -cullEps) ? 1.0f : 0.0f ) +
							  (( DistanceFromPlane(wpos2, planes[1]) > -cullEps) ? 1.0f : 0.0f );
				planeTest.z = (( DistanceFromPlane(wpos0, planes[2]) > -cullEps) ? 1.0f : 0.0f ) +
							  (( DistanceFromPlane(wpos1, planes[2]) > -cullEps) ? 1.0f : 0.0f ) +
							  (( DistanceFromPlane(wpos2, planes[2]) > -cullEps) ? 1.0f : 0.0f );
				planeTest.w = (( DistanceFromPlane(wpos0, planes[3]) > -cullEps) ? 1.0f : 0.0f ) +
							  (( DistanceFromPlane(wpos1, planes[3]) > -cullEps) ? 1.0f : 0.0f ) +
							  (( DistanceFromPlane(wpos2, planes[3]) > -cullEps) ? 1.0f : 0.0f );
				return !all (planeTest);
			}

			float4 DistanceBasedTess( float4 v0, float4 v1, float4 v2, float tess, float minDist, float maxDist, float4x4 o2w, float3 cameraPos )
			{
				float3 f;
				f.x = CalcDistanceTessFactor (v0,minDist,maxDist,tess,o2w,cameraPos);
				f.y = CalcDistanceTessFactor (v1,minDist,maxDist,tess,o2w,cameraPos);
				f.z = CalcDistanceTessFactor (v2,minDist,maxDist,tess,o2w,cameraPos);

				return CalcTriEdgeTessFactors (f);
			}

			float4 EdgeLengthBasedTess( float4 v0, float4 v1, float4 v2, float edgeLength, float4x4 o2w, float3 cameraPos, float4 scParams )
			{
				float3 pos0 = mul(o2w,v0).xyz;
				float3 pos1 = mul(o2w,v1).xyz;
				float3 pos2 = mul(o2w,v2).xyz;
				float4 tess;
				tess.x = CalcEdgeTessFactor (pos1, pos2, edgeLength, cameraPos, scParams);
				tess.y = CalcEdgeTessFactor (pos2, pos0, edgeLength, cameraPos, scParams);
				tess.z = CalcEdgeTessFactor (pos0, pos1, edgeLength, cameraPos, scParams);
				tess.w = (tess.x + tess.y + tess.z) / 3.0f;
				return tess;
			}

			float4 EdgeLengthBasedTessCull( float4 v0, float4 v1, float4 v2, float edgeLength, float maxDisplacement, float4x4 o2w, float3 cameraPos, float4 scParams, float4 planes[6] )
			{
				float3 pos0 = mul(o2w,v0).xyz;
				float3 pos1 = mul(o2w,v1).xyz;
				float3 pos2 = mul(o2w,v2).xyz;
				float4 tess;

				if (WorldViewFrustumCull(pos0, pos1, pos2, maxDisplacement, planes))
				{
					tess = 0.0f;
				}
				else
				{
					tess.x = CalcEdgeTessFactor (pos1, pos2, edgeLength, cameraPos, scParams);
					tess.y = CalcEdgeTessFactor (pos2, pos0, edgeLength, cameraPos, scParams);
					tess.z = CalcEdgeTessFactor (pos0, pos1, edgeLength, cameraPos, scParams);
					tess.w = (tess.x + tess.y + tess.z) / 3.0f;
				}
				return tess;
			}

			float4 ComputeClipSpacePosition( float2 screenPosNorm, float deviceDepth )
			{
				float4 positionCS = float4( screenPosNorm * 2.0 - 1.0, deviceDepth, 1.0 );
			#if UNITY_UV_STARTS_AT_TOP
				positionCS.y = -positionCS.y;
			#endif
				return positionCS;
			}
		ENDCG

		
		Pass
		{
			
			Name "ForwardBase"
			Tags { "LightMode"="ForwardBase" }

			Blend One Zero

			CGPROGRAM
				#define ASE_GEOMETRY
				#define ASE_FRAGMENT_NORMAL 0
				#define ASE_RECEIVE_SHADOWS
				#pragma shader_feature_local_fragment _SPECULARHIGHLIGHTS_OFF
				#pragma shader_feature_local_fragment _GLOSSYREFLECTIONS_OFF
				#pragma multi_compile_instancing
				#pragma multi_compile _ LOD_FADE_CROSSFADE
				#pragma multi_compile_fog
				#define ASE_FOG
				#define ASE_VERSION 19909

				#pragma vertex vert
				#pragma fragment frag
				#pragma multi_compile_fwdbase
				#ifndef UNITY_PASS_FORWARDBASE
					#define UNITY_PASS_FORWARDBASE
				#endif
				#include "HLSLSupport.cginc"
				#if defined( ASE_GEOMETRY ) || defined( ASE_IMPOSTOR )
					#ifndef UNITY_INSTANCED_LOD_FADE
						#define UNITY_INSTANCED_LOD_FADE
					#endif
					#ifndef UNITY_INSTANCED_SH
						#define UNITY_INSTANCED_SH
					#endif
					#ifndef UNITY_INSTANCED_LIGHTMAPSTS
						#define UNITY_INSTANCED_LIGHTMAPSTS
					#endif
				#endif
				#include "UnityShaderVariables.cginc"
				#include "UnityCG.cginc"
				#include "Lighting.cginc"
				#include "UnityPBSLighting.cginc"
				#include "AutoLight.cginc"

				#if defined( UNITY_INSTANCING_ENABLED ) && defined( ASE_INSTANCED_TERRAIN ) && ( defined(_TERRAIN_INSTANCED_PERPIXEL_NORMAL) || defined(_INSTANCEDTERRAINNORMALS_PIXEL) )
					#define ENABLE_TERRAIN_PERPIXEL_NORMAL
				#endif

				#define ASE_NEEDS_TEXTURE_COORDINATES0
				#define ASE_NEEDS_FRAG_TEXTURE_COORDINATES0
				#define ASE_NEEDS_TEXTURE_COORDINATES1
				#define ASE_NEEDS_WORLD_POSITION
				#define ASE_NEEDS_FRAG_WORLD_POSITION
				#define ASE_NEEDS_WORLD_TANGENT
				#define ASE_NEEDS_FRAG_WORLD_TANGENT
				#define ASE_NEEDS_WORLD_NORMAL
				#define ASE_NEEDS_FRAG_WORLD_NORMAL
				#define ASE_NEEDS_FRAG_WORLD_BITANGENT


				struct appdata
				{
					float4 vertex : POSITION;
					half3 normal : NORMAL;
					half4 tangent : TANGENT;
					float4 texcoord : TEXCOORD0;
					float4 texcoord1 : TEXCOORD1;
					float4 texcoord2 : TEXCOORD2;
					
					UNITY_VERTEX_INPUT_INSTANCE_ID
				};

				struct v2f
				{
					float4 pos : SV_POSITION;
					float4 worldPos : TEXCOORD0; // xyz = positionWS, w = fogCoord
					half3 normalWS : TEXCOORD1;
					float4 tangentWS : TEXCOORD2; // holds terrainUV ifdef ENABLE_TERRAIN_PERPIXEL_NORMAL
					half4 ambientOrLightmapUV : TEXCOORD3;
					UNITY_LIGHTING_COORDS( 4, 5 )
					float4 ase_texcoord6 : TEXCOORD6;
					UNITY_VERTEX_INPUT_INSTANCE_ID
					UNITY_VERTEX_OUTPUT_STEREO
				};

				#ifdef ASE_TRANSMISSION
					float _TransmissionShadow;
				#endif
				#ifdef ASE_TRANSLUCENCY
					float _TransStrength;
					float _TransNormal;
					float _TransScattering;
					float _TransDirect;
					float _TransAmbient;
					float _TransShadow;
				#endif
				#ifdef ASE_TESSELLATION
					float _TessPhongStrength;
					float _TessValue;
					float _TessMin;
					float _TessMax;
					float _TessEdgeLength;
					float _TessMaxDisp;
				#endif

				uniform sampler2D _CARD_BACK;
				uniform sampler2D _MainTex;
				uniform sampler2D _CARD_FRONT_BORDER;
				uniform sampler2D _CARD_FRONT_MASK;
				uniform float _ArtGlow;
				uniform float _BorderGlow;
				uniform sampler2D _LayerFoil;
				uniform sampler2D _BackFoil;
				uniform sampler2D _FoilMask;
				uniform float _FoilStrength;
				uniform sampler2D _LayerNormal;
				uniform sampler2D _BackNormal;
				uniform sampler2D _NormalMap;
				uniform float _NormalStrength;
				uniform float _FoilShift;
				uniform float _FoilScale;
				uniform float _Roughness;
				uniform float _DaCardWorld;
				uniform float _WorldGlow;


				float CardLayerGlow145( float4 layerFoil, float4 backFoil, float frontMask )
				{
					// Which glow: 0 = the art's (Art Glow), 1 = a frame's (Border Glow). Collection layers count as frame: the client stacks
					// that into the G channel of _LayerFoil / _BackFoil.
					return lerp( backFoil.g, layerFoil.g, saturate( frontMask ) );
				}
				
				float4 CardLayerFoil144( float4 baseFoil, float4 layerFoil, float layers, float4 backFoil, float frontMask )
				{
					float front = lerp( baseFoil.r * baseFoil.a, layerFoil.r, layers );
					float k = saturate( frontMask );
					float4 surface = lerp( backFoil, layerFoil, k );
					return float4( lerp( backFoil.r, front, k ), surface.b, surface.a, lerp( 1.0, layers, k ) );
				}
				
				float CardFoilType163( float2 uv, float frontMask, sampler2D layerNormal, sampler2D backNormal )
				{
					float2 size = float2( 735.0, 1026.0 );
					float4 uvc = float4( ( clamp( floor( uv * size ), 0.0, size - 1.0 ) + 0.5 ) / size, 0.0, 0.0 );
					float a = frontMask > 0.5 ? tex2Dlod( layerNormal, uvc ).a : tex2Dlod( backNormal, uvc ).a;
					return round( a * 255.0 );
				}
				
				float3 CardNormal127( float2 uv, sampler2D normalMap, float strength, float frontMask, float border, sampler2D layerNormal, sampler2D backNormal )
				{
					// Bump detail, tangent space (OpenGL / Unity convention: green = up), so the card catches the game's lights. Front: the
					// card layers' normals (_LayerNormal, stacked by the client) over card.normal.png where no layer covers it (border = the
					// layers' coverage). Back: the back layers' (_BackNormal). Default textures "bump" = flat.
					float3 base = tex2D( normalMap, uv ).xyz * 2.0 - 1.0;
					float3 layer = tex2D( layerNormal, uv ).xyz * 2.0 - 1.0;
					float3 back = tex2D( backNormal, uv ).xyz * 2.0 - 1.0;
					float3 n = lerp( back, lerp( base, layer, border ), saturate( frontMask ) );
					n.xy *= strength;
					return normalize( n );
				}
				
				float4 CardFoilPattern170( float2 uv, float3 viewTS, float type, float3 normalTS )
				{
					#define DC_HASH(c) frac((frac((c).x * 123.34) + dot(frac((c) * float2(123.34, 456.21)), frac((c) * float2(123.34, 456.21)) + 45.32)) * (frac((c).y * 456.21) + dot(frac((c) * float2(123.34, 456.21)), frac((c) * float2(123.34, 456.21)) + 45.32)))
					#define DC_BUMP(x, c, o, y) saturate(1.0 - ((c) * ((x) - (o))) * ((c) * ((x) - (o))) - (y))
					#define DC_SPEC(t) (DC_BUMP(frac(t), float3(3.54585104, 2.93225262, 2.41593945), float3(0.69549072, 0.49228336, 0.27699880), float3(0.02312639, 0.15225084, 0.52607955)) + DC_BUMP(frac(t), float3(3.90307140, 3.21182957, 3.96587128), float3(0.11748627, 0.86755042, 0.66077860), float3(0.84897130, 0.88445281, 0.73949448)))
					#define DC_COUNT(s, m, k) ((m) + ((s) - (m)) * rsqrt(max((k), 1.0)))
					float3 nb = normalize(normalTS);
					float3 v = normalize(viewTS);
					float3 p = float3(uv.x - 0.5, (uv.y - 0.5) * 1.397, 0.0);
					float3 up = normalize(float3(0.0, 1.0, 0.0) - v * v.y);
					float3 eye = v * 2.0;
					float3 V = normalize(eye - p);
					float3 L = normalize(eye + (up * 0.7 + cross(up, v) * 0.35) * 2.0 - p);
					float2 h = (L - nb * dot(L, nb)).xy + (V - nb * dot(V, nb)).xy;
					float2 nh = normalize(h + 1e-5);
					float vn = dot(v, nb);
					float2 tilt = (v - nb * vn).xy / max(vn, 0.25);
					float lit = 0.55 + 0.75 * pow(saturate(dot(nb, normalize(L + V))), 12.0);
					float fw = max(fwidth(uv.x), 1e-6);
					float2 dir = float2(0.866, 0.5);
					float gate = 1.0;
					float sheen = 0.0;
					float3 col = 0.0;
					float glint = 0.0;
					bool grating = type > 0.5 && type < 11.5;
					if (type > 10.5)
					{
					    float2 q = uv * float2(9.0, 12.573);
					    float2 b = floor(q);
					    float d1 = 8.0;
					    float2 id = b;
					    [unroll] for (int j = -1; j <= 1; j++)
					    [unroll] for (int i = -1; i <= 1; i++)
					    {
					        float2 nc = b + float2(i, j);
					        float2 o = nc + 0.1 + 0.8 * float2(DC_HASH(nc + float2(0.0, 3.3)), DC_HASH(nc + float2(5.7, 0.0)));
					        float d = length(q - o);
					        if (d < d1) { d1 = d; id = nc; }
					    }
					    float turn = DC_HASH(id + float2(1.7, 9.2)) * 6.2831853;
					    dir = float2(cos(turn), sin(turn));
					    gate = 0.45 + 0.55 * DC_HASH(id + float2(6.6, 2.2));
					    sheen = 0.25;
					}
					else if (type > 9.5)
					{
					    grating = false;
					    float2 cn = uv * float2(7.0, 9.779);
					    float2 ci = floor(cn);
					    float2 cf = frac(cn);
					    cf = cf * cf * (3.0 - 2.0 * cf);
					    float dens = lerp(lerp(DC_HASH(ci), DC_HASH(ci + float2(1.0, 0.0)), cf.x), lerp(DC_HASH(ci + float2(0.0, 1.0)), DC_HASH(ci + float2(1.0, 1.0)), cf.x), cf.y);
					    dens = 0.45 + 0.3 * dens;
					    float2 pp = float2(uv.x, uv.y * 1.397);
					    [unroll] for (int k = 0; k < 3; k++)
					    {
					        float s = k == 0 ? 113.0 : (k == 1 ? 139.0 : 167.0);
					        float an = k == 0 ? 0.31 : (k == 1 ? 1.13 : 2.07);
					        float2 q = float2(cos(an) * pp.x - sin(an) * pp.y, sin(an) * pp.x + cos(an) * pp.y) * s + float2(0.37, 0.61) * k;
					        float2 c = floor(q) + float2(41.3, 27.1) * k;
					        float rad = 0.0026 * s * (0.85 + 0.3 * DC_HASH(c + float2(7.7, 3.3)));
					        float2 o = (float2(DC_HASH(c + float2(1.3, 0.0)), DC_HASH(c + float2(0.0, 2.9))) - 0.5) * (1.0 - 2.0 * rad);
					        float d = length(frac(q) - 0.5 - o);
					        float turn = DC_HASH(c + float2(4.1, 2.3)) * 6.2831853;
					        float tw = pow(saturate(dot(float2(cos(turn), sin(turn)), nh)), 3.0);
					        float dotMask = saturate((rad - d) / max(fw * s * 1.5, 0.05) + 0.5) * step(1.0 - dens, DC_HASH(c));
					        float3 tint = DC_SPEC(uv.x * 0.35 + uv.y * 0.75 + dot(tilt, float2(0.6, 0.5)) + DC_HASH(c + float2(8.8, 0.0)) * 0.15);
					        float kk = fw * s * fw * s;
					        float mn = dens * 3.14159 * rad * rad * 0.6;
					        col += tint * DC_COUNT(dotMask * (0.45 + 1.1 * tw), mn, kk) * 1.7;
					        glint += DC_COUNT(dotMask * tw * tw * tw, mn * 0.1, kk) * 0.45;
					    }
					}
					else if (type > 8.5)
					{
					    grating = false;
					    float ph = length(p.xy - float2(-0.45, 1.0)) * 2.4 - dot(tilt, float2(0.8, 0.6)) * 0.9;
					    col = DC_SPEC(ph) * (0.6 + 0.4 * cos(6.2831853 * ph * 0.5)) * 1.6;
					    glint = pow(saturate(1.0 - abs(frac(ph * 0.5) - 0.5) * 8.0), 3.0) * 0.5;
					}
					else if (type > 7.5)
					{
					    grating = false;
					    float ph = dot(p.xy, float2(0.8, 0.6)) * 1.4 + dot(tilt, float2(1.1, 0.8)) * 1.6;
					    float band = pow(0.5 + 0.5 * cos(6.2831853 * ph), 3.0);
					    float band2 = pow(0.5 + 0.5 * cos(6.2831853 * (ph * 2.7 + 0.3)), 10.0) * 0.6;
					    col = DC_SPEC(ph * 0.8 + p.y * 0.25) * (band + band2) * 2.0;
					    glint = pow(band, 6.0) * 0.5;
					}
					else if (type > 6.5)
					{
					    float2 q = uv * float2(8.0, 11.176);
					    float2 fa = frac(q) - 0.5;
					    float2 fb = frac(q + 0.5) - 0.5;
					    float2 f = length(fb) < 0.5 ? fb : fa;
					    float d = length(f);
					    float rings = 0.5 + 0.5 * cos(d * 6.2831853 * 9.0);
					    dir = f / max(d, 1e-4);
					    gate = 0.45 + 0.55 * rings;
					    sheen = 0.35;
					}
					else if (type > 4.5)
					{
					    float cells = type > 5.5 ? 12.0 : 10.0;
					    float2 q = uv * float2(cells, cells * 1.397);
					    float2 c = floor(q);
					    float2 f = frac(q) - 0.5;
					    if (type < 5.5)
					    {
					        float sec = floor(frac(atan2(f.y, f.x) / 6.2831853 + DC_HASH(c)) * 7.0);
					        float turn = DC_HASH(c + sec * float2(3.7, 1.9)) * 6.2831853;
					        dir = float2(cos(turn), sin(turn));
					        gate = 0.55 + 0.45 * DC_HASH(c + sec * float2(5.3, 0.0) + float2(1.1, 2.2));
					        sheen = 0.25;
					    }
					    else
					    {
					        dir = normalize(f + 1e-5);
					        gate = 0.65 + 0.35 * saturate(max(abs(f.x), abs(f.y)) * 2.5);
					    }
					}
					else if (type > 3.5)
					{
					    grating = false;
					    [unroll] for (int k = 0; k < 3; k++)
					    {
					        float s = k == 0 ? 6.0 : (k == 1 ? 20.0 : 64.0);
					        float prob = k == 0 ? 0.35 : (k == 1 ? 0.55 : 0.7);
					        float r0 = k == 0 ? 0.18 : (k == 1 ? 0.14 : 0.16);
					        float r1 = k == 0 ? 0.4 : (k == 1 ? 0.34 : 0.36);
					        float br = k == 0 ? 2.8 : (k == 1 ? 2.5 : 2.4);
					        float2 q = uv * float2(s, s * 1.397);
					        float2 c = floor(q) + float2(31.7, 17.9) * k;
					        float2 f = frac(q) - 0.5;
					        float r = lerp(r0, r1, DC_HASH(c + float2(3.1, 7.7)));
					        float2 o = (float2(DC_HASH(c + float2(11.3, 0.0)), DC_HASH(c + float2(0.0, 5.9))) - 0.5) * (1.0 - 2.0 * r);
					        float d = length(f - o);
					        float disc = saturate((r - d) / max(fw * s * 1.5, 0.02) + 0.5 * saturate(fw * s * 1.5 / r - 1.0)) * step(1.0 - prob, DC_HASH(c));
					        float3 dotCol = DC_SPEC(DC_HASH(c + float2(2.7, 1.3)) + uv.y * 0.6 + dot(tilt, float2(0.6, 0.45))) * (0.7 + 0.3 * cos(d / max(r, 1e-3) * 4.0 + dot(tilt, float2(2.0, 1.5))));
					        float kk = fw * s * fw * s;
					        float mn = prob * 3.14159 * (r0 + r1) * (r0 + r1) * 0.25 * 0.35;
					        col += DC_COUNT(dotCol * disc, mn, kk) * br;
					        if (k == 2)
					            glint = DC_COUNT(disc * step(0.7, DC_HASH(c + float2(9.1, 4.4))), mn * 0.3, kk) * 0.5;
					    }
					    [unroll] for (int m = 0; m < 2; m++)
					    {
					        float2 sd = p.xy - (m == 0 ? float2(0.25, 0.55) : float2(-0.3, -0.2));
					        float sr = length(sd) + 1e-4;
					        float swirl = pow(saturate(sin(atan2(sd.y, sd.x) * 2.0 - log(sr) * 7.0 + tilt.x + tilt.y)), 8.0) * saturate(1.0 - sr * 5.0);
					        col += DC_SPEC(sr * 3.0 + dot(tilt, float2(0.5, 0.5))) * swirl * (m == 0 ? 0.6 : 0.5);
					    }
					}
					else if (type > 2.5)
					{
					    float2 cell = floor(uv * float2(60.0, 83.8));
					    float2 q = frac(cell * float2(123.34, 456.21));
					    q += dot(q, q + 45.32);
					    float turn = frac(q.x * q.y) * 6.2831853;
					    q = frac((cell + 17.13) * float2(123.34, 456.21));
					    q += dot(q, q + 45.32);
					    gate = DC_COUNT(step(0.4, frac(q.x * q.y)), 0.6, fw * 60.0 * fw * 60.0);
					    dir = float2(cos(turn), sin(turn));
					    sheen = 0.2;
					}
					else if (type > 1.5)
					    dir = normalize(p.xy + 1e-5);
					if (grating)
					{
					    float g = abs(dot(h, dir));
					    float3 diff = 0.0;
					    [unroll] for (int n = 1; n <= 8; n++)
					    {
					        float w = g * 1600.0 / n;
					        float x = saturate((w - 400.0) / 300.0);
					        float3 a = float3(3.54585104, 2.93225262, 2.41593945) * (x - float3(0.69549072, 0.49228336, 0.27699880));
					        float3 b = float3(3.90307140, 3.21182957, 3.96587128) * (x - float3(0.11748627, 0.86755042, 0.66077860));
					        diff += (w >= 400.0 && w <= 700.0) ? saturate(1.0 - a * a - float3(0.02312639, 0.15225084, 0.52607955)) + saturate(1.0 - b * b - float3(0.84897130, 0.88445281, 0.73949448)) : 0.0;
					    }
					    col = saturate(diff) * gate + sheen * gate * pow(saturate(dot(dir, nh) * 0.5 + 0.5), 16.0);
					    glint = pow(saturate(1.0 - g * 4.0), 4.0) * gate;
					}
					return float4(col, glint) * lit;
				}
				
				float CardFoilMetal130( float frontMask, float4 foilMask, float border, float strength, float type, float4 pattern, float2 uv, float3 viewTS, float tiltShift )
				{
					float m = foilMask.r * saturate( strength * 1.5 );
					float3 v = normalize( viewTS );
					float2 tilt = v.xy / max( v.z, 0.25 );
					float sweep = dot( uv - 0.5, float2( 0.8, 0.6 ) ) + dot( tilt, float2( 0.45, 0.3 ) ) * tiltShift;
					float glint = pow( saturate( 1.0 - abs( sweep ) * 2.5 ), 4.0 );
					float lum = dot( pattern.rgb, float3( 0.299, 0.587, 0.114 ) ) + pattern.a;
					return m * ( type > 0.5 && type < 11.5 ? saturate( lum * 2.5 ) : 0.25 + 0.75 * glint );
				}
				
				float3 CardFoilAlbedo131( float4 albedo, float metal, float2 uv, float3 viewTS, float scale, float tiltShift, float type, float4 pattern )
				{
					// Albedo of the foil area. Where the card is metallic (metal, from CardFoilMetal) the albedo is the colour of its
					// reflections, so this gives the lights' highlights and the reflections the same foil pattern (type) as CardFoil.
					float3 v = normalize(viewTS);
					float3 holo = saturate(0.35 + pattern.rgb * 0.6 + albedo.rgb * 0.3);
					float2 tilt = v.xy / max(v.z, 0.25);
					float grain = sin(dot(uv, float2(173.1, 61.7))) * sin(dot(uv, float2(-47.3, 211.9)));
					float phase = dot(uv, float2(0.6, 1.0)) * scale + dot(tilt, float2(0.8, 0.5)) * tiltShift + grain * 0.06;
					float3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + float3(0.0, 0.333, 0.667)));
					float3 foil = saturate(rainbow * 0.85 + albedo.rgb * 0.35);
					return lerp(albedo.rgb, type > 0.5 && type < 11.5 ? holo : foil, metal);
				}
				
				float CardMetallic154( float4 surface, float foilMetal )
				{
					return max( surface.b, foilMetal );
				}
				
				float CardSmoothness132( float4 surface, float roughness, float foilMetal )
				{
					float rough = lerp( roughness, surface.g, surface.a );
					return lerp( 1.0 - rough, 0.9, foilMetal );
				}
				
				float3 CardFoil120( float2 uv, float3 viewTS, float frontMask, float4 foilMask, float border, float4 baseColor, float strength, float scale, float tiltShift, float type, float4 pattern )
				{
					// Holographic foil on the card art, added on top of emission. type 0 (rainbow): rainbow bands that slide across the
					// card as it tilts, plus a brighter glint band sweeping diagonally. 1 to 11: the CardFoilPattern foils (pattern).
					// Only where frontMask is set (not the back), not under the frame (border = frame alpha), and inside
					// foilMask (card.foil.png: white/opaque = foil, black/transparent = plain print, default white = the whole art).
					float area = foilMask.r;   // CardLayerFoil: layers and picture, front and back
					float3 v = normalize(viewTS);
					float patternLuma = dot(baseColor.rgb, float3(0.299, 0.587, 0.114));
					float3 holo = (pattern.rgb * (0.3 + 0.7 * patternLuma) * (abs(type - 3.0) < 0.5 ? 1.4 : 1.0) + pattern.a * 0.25) * strength * area;
					float2 tilt = v.xy / max(v.z, 0.25);
					float grain = sin(dot(uv, float2(173.1, 61.7))) * sin(dot(uv, float2(-47.3, 211.9)));
					float phase = dot(uv, float2(0.6, 1.0)) * scale + dot(tilt, float2(0.8, 0.5)) * tiltShift + grain * 0.06;
					float3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + float3(0.0, 0.333, 0.667)));
					float sweep = dot(uv - 0.5, float2(0.8, 0.6)) + dot(tilt, float2(0.45, 0.3)) * tiltShift;
					float glint = pow(saturate(1.0 - abs(sweep) * 2.5), 4.0);
					float luma = dot(baseColor.rgb, float3(0.299, 0.587, 0.114));
					float3 foil = rainbow * (0.3 + 0.7 * luma) * (0.35 + 0.65 * glint) + glint * 0.25;
					return type > 0.5 && type < 11.5 ? holo : foil * strength * area;
				}
				
				float3 CardWorldEmission152( float3 emission, float world, float worldGlow )
				{
					// A card lying in the world (drawn by the game's main camera: the client sets the global _DaCardWorld then) is lit by the
					// raid: its own light (art glow, foil shine) drops to worldGlow, so it is dark in the dark. Inspect views and icons: 1.
					return emission * lerp( 1.0, worldGlow, saturate( world ) );
				}
				

				v2f VertexFunction( appdata v  )
				{
					UNITY_SETUP_INSTANCE_ID(v);
					v2f o;
					UNITY_INITIALIZE_OUTPUT(v2f,o);
					UNITY_TRANSFER_INSTANCE_ID(v,o);
					UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

					o.ase_texcoord6.xy = v.texcoord.xyzw.xy;
					o.ase_texcoord6.zw = v.texcoord1.xyzw.xy;

					#ifdef ASE_ABSOLUTE_VERTEX_POS
						float3 defaultVertexValue = v.vertex.xyz;
					#else
						float3 defaultVertexValue = float3(0, 0, 0);
					#endif
					float3 vertexValue = defaultVertexValue;
					#ifdef ASE_ABSOLUTE_VERTEX_POS
						v.vertex.xyz = vertexValue;
					#else
						v.vertex.xyz += vertexValue;
					#endif
					v.vertex.w = 1;
					v.normal = v.normal;
					v.tangent = v.tangent;

					float3 positionWS = mul( unity_ObjectToWorld, v.vertex ).xyz;
					half3 normalWS = UnityObjectToWorldNormal( v.normal );
					half3 tangentWS = UnityObjectToWorldDir( v.tangent.xyz );

					o.pos = UnityObjectToClipPos( v.vertex );
					o.worldPos.xyz = positionWS;
					o.normalWS = normalWS;
					o.tangentWS = half4( tangentWS, v.tangent.w );

					o.ambientOrLightmapUV = 0;
					#ifdef LIGHTMAP_ON
						o.ambientOrLightmapUV.xy = v.texcoord1.xy * unity_LightmapST.xy + unity_LightmapST.zw;
					#elif UNITY_SHOULD_SAMPLE_SH
						#ifdef VERTEXLIGHT_ON
							o.ambientOrLightmapUV.rgb += Shade4PointLights(
								unity_4LightPosX0, unity_4LightPosY0, unity_4LightPosZ0,
								unity_LightColor[0].rgb, unity_LightColor[1].rgb, unity_LightColor[2].rgb, unity_LightColor[3].rgb,
								unity_4LightAtten0, positionWS, normalWS );
						#endif
						o.ambientOrLightmapUV.rgb = ShadeSHPerVertex( normalWS, o.ambientOrLightmapUV.rgb );
					#endif
					#ifdef DYNAMICLIGHTMAP_ON
						o.ambientOrLightmapUV.zw = v.texcoord2.xy * unity_DynamicLightmapST.xy + unity_DynamicLightmapST.zw;
					#endif

					#if defined(ENABLE_TERRAIN_PERPIXEL_NORMAL)
						o.tangentWS.zw = v.texcoord.xy;
						o.tangentWS.xy = v.texcoord.xy * unity_LightmapST.xy + unity_LightmapST.zw;
					#endif

					UNITY_TRANSFER_LIGHTING(o, v.texcoord1.xy);
					#if defined( ASE_FOG )
						UNITY_TRANSFER_FOG_COMBINED_WITH_WORLD_POS( o, o.pos );
					#endif
					return o;
				}

				#if defined(ASE_TESSELLATION)
				struct VertexControl
				{
					float4 vertex : INTERNALTESSPOS;
					half4 tangent : TANGENT;
					half3 normal : NORMAL;
					float4 texcoord : TEXCOORD0;
					float4 texcoord1 : TEXCOORD1;
					float4 texcoord2 : TEXCOORD2;
					
					UNITY_VERTEX_INPUT_INSTANCE_ID
				};

				struct TessellationFactors
				{
					float edge[3] : SV_TessFactor;
					float inside : SV_InsideTessFactor;
				};

				VertexControl vert ( appdata v )
				{
					VertexControl o;
					UNITY_SETUP_INSTANCE_ID(v);
					UNITY_TRANSFER_INSTANCE_ID(v, o);
					o.vertex = v.vertex;
					o.tangent = v.tangent;
					o.normal = v.normal;
					o.texcoord = v.texcoord;
					o.texcoord1 = v.texcoord1;
					o.texcoord2 = v.texcoord2;
					
					return o;
				}

				TessellationFactors TessellationFunction (InputPatch<VertexControl,3> v)
				{
					TessellationFactors o;
					float4 tf = 1;
					float tessValue = _TessValue; float tessMin = _TessMin; float tessMax = _TessMax;
					float edgeLength = _TessEdgeLength; float tessMaxDisp = _TessMaxDisp;
					#if defined(ASE_FIXED_TESSELLATION)
					tf = FixedTess( tessValue );
					#elif defined(ASE_DISTANCE_TESSELLATION)
					tf = DistanceBasedTess(v[0].vertex, v[1].vertex, v[2].vertex, tessValue, tessMin, tessMax, UNITY_MATRIX_M, _WorldSpaceCameraPos );
					#elif defined(ASE_LENGTH_TESSELLATION)
					tf = EdgeLengthBasedTess(v[0].vertex, v[1].vertex, v[2].vertex, edgeLength, UNITY_MATRIX_M, _WorldSpaceCameraPos, _ScreenParams );
					#elif defined(ASE_LENGTH_CULL_TESSELLATION)
					tf = EdgeLengthBasedTessCull(v[0].vertex, v[1].vertex, v[2].vertex, edgeLength, tessMaxDisp, UNITY_MATRIX_M, _WorldSpaceCameraPos, _ScreenParams, unity_CameraWorldClipPlanes );
					#endif
					o.edge[0] = tf.x; o.edge[1] = tf.y; o.edge[2] = tf.z; o.inside = tf.w;
					return o;
				}

				[domain("tri")]
				[partitioning("fractional_odd")]
				[outputtopology("triangle_cw")]
				[patchconstantfunc("TessellationFunction")]
				[outputcontrolpoints(3)]
				VertexControl HullFunction(InputPatch<VertexControl, 3> patch, uint id : SV_OutputControlPointID)
				{
				   return patch[id];
				}

				[domain("tri")]
				v2f DomainFunction(TessellationFactors factors, OutputPatch<VertexControl, 3> patch, float3 bary : SV_DomainLocation)
				{
					appdata o = (appdata) 0;
					o.vertex = patch[0].vertex * bary.x + patch[1].vertex * bary.y + patch[2].vertex * bary.z;
					o.tangent = patch[0].tangent * bary.x + patch[1].tangent * bary.y + patch[2].tangent * bary.z;
					o.normal = patch[0].normal * bary.x + patch[1].normal * bary.y + patch[2].normal * bary.z;
					o.texcoord = patch[0].texcoord * bary.x + patch[1].texcoord * bary.y + patch[2].texcoord * bary.z;
					o.texcoord1 = patch[0].texcoord1 * bary.x + patch[1].texcoord1 * bary.y + patch[2].texcoord1 * bary.z;
					o.texcoord2 = patch[0].texcoord2 * bary.x + patch[1].texcoord2 * bary.y + patch[2].texcoord2 * bary.z;
					
					#if defined(ASE_PHONG_TESSELLATION)
					float3 pp[3];
					for (int i = 0; i < 3; ++i)
						pp[i] = o.vertex.xyz - patch[i].normal * (dot(o.vertex.xyz, patch[i].normal) - dot(patch[i].vertex.xyz, patch[i].normal));
					float phongStrength = _TessPhongStrength;
					o.vertex.xyz = phongStrength * (pp[0]*bary.x + pp[1]*bary.y + pp[2]*bary.z) + (1.0f-phongStrength) * o.vertex.xyz;
					#endif
					UNITY_TRANSFER_INSTANCE_ID(patch[0], o);
					return VertexFunction(o);
				}
				#else
				v2f vert ( appdata v )
				{
					return VertexFunction( v );
				}
				#endif

				half4 frag( v2f IN 
							#if defined( ASE_DEPTH_WRITE_ON )
								, out float outputDepth : SV_Depth
							#endif
							) : SV_Target
				{
					UNITY_SETUP_INSTANCE_ID(IN);

					#ifdef LOD_FADE_CROSSFADE
						UNITY_APPLY_DITHER_CROSSFADE(IN.pos.xy);
					#endif

					#if defined(ASE_LIGHTING_SIMPLE)
						SurfaceOutput o = (SurfaceOutput)0;
					#else
						#if defined(_SPECULAR_SETUP)
							SurfaceOutputStandardSpecular o = (SurfaceOutputStandardSpecular)0;
						#else
							SurfaceOutputStandard o = (SurfaceOutputStandard)0;
						#endif
					#endif

					half atten;
					{
						#if defined( ASE_RECEIVE_SHADOWS )
							UNITY_LIGHT_ATTENUATION( temp, IN, IN.worldPos.xyz )
							atten = temp;
						#else
							atten = 1;
						#endif
					}

					float3 PositionWS = IN.worldPos.xyz;
					half3 ViewDirWS = normalize( UnityWorldSpaceViewDir( PositionWS ) );
					float4 ScreenPosNorm = float4( IN.pos.xy * ( _ScreenParams.zw - 1.0 ), IN.pos.zw );
					float4 ClipPos = ComputeClipSpacePosition( ScreenPosNorm.xy, IN.pos.z ) * IN.pos.w;
					float4 ScreenPos = ComputeScreenPos( ClipPos );
					half3 NormalWS = IN.normalWS;
					half3 TangentWS = IN.tangentWS.xyz;
					half3 BitangentWS = cross( IN.normalWS, IN.tangentWS.xyz ) * IN.tangentWS.w * unity_WorldTransformParams.w;
					half3 LightAtten = atten;

					#if defined(ENABLE_TERRAIN_PERPIXEL_NORMAL)
						float2 sampleCoords = (IN.tangentWS.zw / _TerrainHeightmapRecipSize.zw + 0.5f) * _TerrainHeightmapRecipSize.xy;
						NormalWS = UnityObjectToWorldNormal(normalize(tex2D(_TerrainNormalmapTexture, sampleCoords).rgb * 2 - 1));
						TangentWS = -cross(unity_ObjectToWorld._13_23_33, NormalWS);
						BitangentWS = cross(NormalWS, -TangentWS);
					#endif

					float2 texCoord43 = IN.ase_texcoord6.xy * float2( 1,1 ) + float2( 0,0 );
					float2 texCoord117 = IN.ase_texcoord6.xy * float2( 1,1 ) + float2( 0,0 );
					float2 texCoord69 = IN.ase_texcoord6.xy * float2( 1,1 ) + float2( 0,0 );
					float4 tex2DNode70 = tex2D( _CARD_FRONT_BORDER, texCoord69 );
					float4 lerpResult77 = lerp( tex2D( _MainTex, texCoord117 ) , tex2DNode70 , tex2DNode70.a);
					float2 texCoord118 = IN.ase_texcoord6.zw * float2( 1,1 ) + float2( 0,0 );
					float4 tex2DNode41 = tex2D( _CARD_FRONT_MASK, texCoord118 );
					float4 lerpResult109 = lerp( tex2D( _CARD_BACK, texCoord43 ) , lerpResult77 , tex2DNode41);
					float4 tex2DNode140 = tex2D( _LayerFoil, texCoord69 );
					float4 layerFoil145 = tex2DNode140;
					float4 tex2DNode141 = tex2D( _BackFoil, texCoord43 );
					float4 backFoil145 = tex2DNode141;
					float frontMask145 = tex2DNode41.r;
					float localCardLayerGlow145 = CardLayerGlow145( layerFoil145 , backFoil145 , frontMask145 );
					float lerpResult112 = lerp( _ArtGlow , _BorderGlow , localCardLayerGlow145);
					float4 albedo131 = ( lerpResult109 * ( 1.0 - lerpResult112 ) );
					float frontMask130 = tex2DNode41.r;
					float4 baseFoil144 = tex2D( _FoilMask, texCoord117 );
					float4 layerFoil144 = tex2DNode140;
					float layers144 = tex2DNode70.a;
					float4 backFoil144 = tex2DNode141;
					float frontMask144 = tex2DNode41.r;
					float4 localCardLayerFoil144 = CardLayerFoil144( baseFoil144 , layerFoil144 , layers144 , backFoil144 , frontMask144 );
					float4 foilMask130 = localCardLayerFoil144;
					float border130 = tex2DNode70.a;
					float strength130 = _FoilStrength;
					float2 uv163 = texCoord117;
					float frontMask163 = tex2DNode41.r;
					sampler2D layerNormal163 = _LayerNormal;
					sampler2D backNormal163 = _BackNormal;
					float localCardFoilType163 = CardFoilType163( uv163 , frontMask163 , layerNormal163 , backNormal163 );
					float type130 = localCardFoilType163;
					float2 uv170 = texCoord117;
					float3 tanToWorld0 = float3( TangentWS.x, BitangentWS.x, NormalWS.x );
					float3 tanToWorld1 = float3( TangentWS.y, BitangentWS.y, NormalWS.y );
					float3 tanToWorld2 = float3( TangentWS.z, BitangentWS.z, NormalWS.z );
					float3 ase_viewVectorTS =  tanToWorld0 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - PositionWS : UNITY_MATRIX_V[ 2 ].xyz ).x + tanToWorld1 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - PositionWS : UNITY_MATRIX_V[ 2 ].xyz ).y  + tanToWorld2 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - PositionWS : UNITY_MATRIX_V[ 2 ].xyz ).z;
					float3 ase_viewDirTS = normalize( ase_viewVectorTS );
					float3 viewTS170 = ase_viewDirTS;
					float type170 = localCardFoilType163;
					float2 uv127 = texCoord117;
					sampler2D normalMap127 = _NormalMap;
					float strength127 = _NormalStrength;
					float frontMask127 = tex2DNode41.r;
					float border127 = tex2DNode70.a;
					sampler2D layerNormal127 = _LayerNormal;
					sampler2D backNormal127 = _BackNormal;
					float3 localCardNormal127 = CardNormal127( uv127 , normalMap127 , strength127 , frontMask127 , border127 , layerNormal127 , backNormal127 );
					float3 normalTS170 = localCardNormal127;
					float4 localCardFoilPattern170 = CardFoilPattern170( uv170 , viewTS170 , type170 , normalTS170 );
					float4 pattern130 = localCardFoilPattern170;
					float2 uv130 = texCoord117;
					float3 viewTS130 = ase_viewDirTS;
					float tiltShift130 = _FoilShift;
					float localCardFoilMetal130 = CardFoilMetal130( frontMask130 , foilMask130 , border130 , strength130 , type130 , pattern130 , uv130 , viewTS130 , tiltShift130 );
					float metal131 = localCardFoilMetal130;
					float2 uv131 = texCoord117;
					float3 viewTS131 = ase_viewDirTS;
					float scale131 = _FoilScale;
					float tiltShift131 = _FoilShift;
					float type131 = localCardFoilType163;
					float4 pattern131 = localCardFoilPattern170;
					float3 localCardFoilAlbedo131 = CardFoilAlbedo131( albedo131 , metal131 , uv131 , viewTS131 , scale131 , tiltShift131 , type131 , pattern131 );
					
					float4 surface154 = localCardLayerFoil144;
					float foilMetal154 = localCardFoilMetal130;
					float localCardMetallic154 = CardMetallic154( surface154 , foilMetal154 );
					
					float4 surface132 = localCardLayerFoil144;
					float roughness132 = _Roughness;
					float foilMetal132 = localCardFoilMetal130;
					float localCardSmoothness132 = CardSmoothness132( surface132 , roughness132 , foilMetal132 );
					
					float2 uv120 = texCoord117;
					float3 viewTS120 = ase_viewDirTS;
					float frontMask120 = tex2DNode41.r;
					float4 foilMask120 = localCardLayerFoil144;
					float border120 = tex2DNode70.a;
					float4 baseColor120 = lerpResult109;
					float strength120 = _FoilStrength;
					float scale120 = _FoilScale;
					float tiltShift120 = _FoilShift;
					float type120 = localCardFoilType163;
					float4 pattern120 = localCardFoilPattern170;
					float3 localCardFoil120 = CardFoil120( uv120 , viewTS120 , frontMask120 , foilMask120 , border120 , baseColor120 , strength120 , scale120 , tiltShift120 , type120 , pattern120 );
					float3 emission152 = ( ( lerpResult109 * lerpResult112 ) + float4( localCardFoil120 , 0.0 ) ).rgb;
					float world152 = _DaCardWorld;
					float worldGlow152 = _WorldGlow;
					float3 localCardWorldEmission152 = CardWorldEmission152( emission152 , world152 , worldGlow152 );
					

					o.Albedo = localCardFoilAlbedo131;
					o.Normal = localCardNormal127;

					half3 Specular = half3( 0, 0, 0 );
					half Metallic = localCardMetallic154;
					half Smoothness = localCardSmoothness132;
					half Occlusion = 1;

					#if defined(ASE_LIGHTING_SIMPLE)
						o.Specular = Specular.x;
						o.Gloss = Smoothness;
					#else
						#if defined(_SPECULAR_SETUP)
							o.Specular = Specular;
						#else
							o.Metallic = Metallic;
						#endif
						o.Occlusion = Occlusion;
						o.Smoothness = Smoothness;
					#endif

					o.Emission = localCardWorldEmission152;
					o.Alpha = 1;
					half AlphaClipThreshold = 0.5;
					half AlphaClipThresholdShadow = 0.5;
					half3 BakedGI = 0;
					half3 Transmission = 1;
					half3 Translucency = 1;

					#if defined( ASE_DEPTH_WRITE_ON )
						IN.pos.z = IN.pos.z;
					#endif

					#ifdef _ALPHATEST_ON
						clip( o.Alpha - AlphaClipThreshold );
					#endif

					#if defined( ASE_CHANGES_WORLD_POS )
					{
						#if defined( ASE_RECEIVE_SHADOWS )
							UNITY_LIGHT_ATTENUATION( temp, IN, PositionWS )
							LightAtten = temp;
						#else
							LightAtten = 1;
						#endif
					}
					#endif

					#if ( ASE_FRAGMENT_NORMAL == 0 )
						o.Normal = normalize( o.Normal.x * TangentWS + o.Normal.y * BitangentWS + o.Normal.z * NormalWS );
					#elif ( ASE_FRAGMENT_NORMAL == 1 )
						o.Normal = UnityObjectToWorldNormal( o.Normal );
					#elif ( ASE_FRAGMENT_NORMAL == 2 )
						// @diogo: already in world-space; do nothing
					#endif

					#if defined( ASE_DEPTH_WRITE_ON )
						outputDepth = IN.pos.z;
					#endif

					#ifndef USING_DIRECTIONAL_LIGHT
						half3 lightDir = normalize( UnityWorldSpaceLightDir( PositionWS ) );
					#else
						half3 lightDir = _WorldSpaceLightPos0.xyz;
					#endif

					UnityGI gi;
					UNITY_INITIALIZE_OUTPUT(UnityGI, gi);
					gi.indirect.diffuse = 0;
					gi.indirect.specular = 0;
					gi.light.color = _LightColor0.rgb;
					gi.light.dir = lightDir;

					UnityGIInput giInput;
					UNITY_INITIALIZE_OUTPUT(UnityGIInput, giInput);
					giInput.light = gi.light;
					giInput.worldPos = PositionWS;
					giInput.worldViewDir = ViewDirWS;
					giInput.atten = atten;
					#if defined(LIGHTMAP_ON) || defined(DYNAMICLIGHTMAP_ON)
						giInput.lightmapUV = IN.ambientOrLightmapUV;
					#else
						giInput.lightmapUV = 0.0;
					#endif
					#if UNITY_SHOULD_SAMPLE_SH && !UNITY_SAMPLE_FULL_SH_PER_PIXEL
						giInput.ambient = IN.ambientOrLightmapUV.rgb;
					#else
						giInput.ambient.rgb = 0.0;
					#endif
					giInput.probeHDR[0] = unity_SpecCube0_HDR;
					giInput.probeHDR[1] = unity_SpecCube1_HDR;
					#if defined(UNITY_SPECCUBE_BLENDING) || defined(UNITY_SPECCUBE_BOX_PROJECTION)
						giInput.boxMin[0] = unity_SpecCube0_BoxMin;
					#endif
					#ifdef UNITY_SPECCUBE_BOX_PROJECTION
						giInput.boxMax[0] = unity_SpecCube0_BoxMax;
						giInput.probePosition[0] = unity_SpecCube0_ProbePosition;
						giInput.boxMax[1] = unity_SpecCube1_BoxMax;
						giInput.boxMin[1] = unity_SpecCube1_BoxMin;
						giInput.probePosition[1] = unity_SpecCube1_ProbePosition;
					#endif

					#if defined(ASE_LIGHTING_SIMPLE)
						#if defined(_SPECULAR_SETUP)
							LightingBlinnPhong_GI(o, giInput, gi);
						#else
							LightingLambert_GI(o, giInput, gi);
						#endif
					#else
						#if defined(_SPECULAR_SETUP)
							LightingStandardSpecular_GI(o, giInput, gi);
						#else
							LightingStandard_GI(o, giInput, gi);
						#endif
					#endif

					#ifdef ASE_BAKEDGI
						gi.indirect.diffuse = BakedGI;
					#endif

					#if UNITY_SHOULD_SAMPLE_SH && !defined(LIGHTMAP_ON) && defined(ASE_NO_AMBIENT)
						gi.indirect.diffuse = 0;
					#endif

					half4 c = 0;
					#if defined(ASE_LIGHTING_SIMPLE)
						#if defined(_SPECULAR_SETUP)
							c += LightingBlinnPhong (o, ViewDirWS, gi);
						#else
							c += LightingLambert( o, gi );
						#endif
					#else
						#if defined(_SPECULAR_SETUP)
							c += LightingStandardSpecular (o, ViewDirWS, gi);
						#else
							c += LightingStandard(o, ViewDirWS, gi);
						#endif
					#endif

					#ifdef ASE_TRANSMISSION
					{
						half shadow = _TransmissionShadow;
						#ifdef DIRECTIONAL
							half3 lightAtten = lerp( _LightColor0.rgb, gi.light.color, shadow );
						#else
							half3 lightAtten = gi.light.color;
						#endif
						half3 transmission = max(0 , -dot(o.Normal, gi.light.dir)) * lightAtten * Transmission;
						c.rgb += o.Albedo * transmission;
					}
					#endif

					#ifdef ASE_TRANSLUCENCY
					{
						half shadow = _TransShadow;
						half normal = _TransNormal;
						half scattering = _TransScattering;
						half direct = _TransDirect;
						half ambient = _TransAmbient;
						half strength = _TransStrength;

						#ifdef DIRECTIONAL
							half3 lightAtten = lerp( _LightColor0.rgb, gi.light.color, shadow );
						#else
							half3 lightAtten = gi.light.color;
						#endif
						half3 lightDir = gi.light.dir + o.Normal * normal;
						half transVdotL = pow( saturate( dot( ViewDirWS, -lightDir ) ), scattering );
						half3 translucency = lightAtten * (transVdotL * direct + gi.indirect.diffuse * ambient) * Translucency;
						c.rgb += o.Albedo * translucency * strength;
					}
					#endif

					c.rgb += o.Emission;

					#if defined( ASE_FOG )
						UNITY_EXTRACT_FOG_FROM_WORLD_POS( IN );
						UNITY_APPLY_FOG(_unity_fogCoord, c.rgb);
					#endif
					return c;
				}
			ENDCG
		}

		
		Pass
		{
			
			Name "ForwardAdd"
			Tags { "LightMode"="ForwardAdd" }
			ZWrite Off
			Blend One One

			CGPROGRAM
				#define ASE_GEOMETRY
				#define ASE_FRAGMENT_NORMAL 0
				#define ASE_RECEIVE_SHADOWS
				#pragma shader_feature_local_fragment _SPECULARHIGHLIGHTS_OFF
				#pragma multi_compile_instancing
				#pragma multi_compile _ LOD_FADE_CROSSFADE
				#pragma multi_compile_fog
				#define ASE_FOG
				#define ASE_VERSION 19909

				#pragma vertex vert
				#pragma fragment frag
				#pragma skip_variants INSTANCING_ON
				#pragma multi_compile_fwdadd_fullshadows
				#ifndef UNITY_PASS_FORWARDADD
					#define UNITY_PASS_FORWARDADD
				#endif
				#include "HLSLSupport.cginc"
				#if defined( ASE_GEOMETRY ) || defined( ASE_IMPOSTOR )
					#ifndef UNITY_INSTANCED_LOD_FADE
						#define UNITY_INSTANCED_LOD_FADE
					#endif
					#ifndef UNITY_INSTANCED_SH
						#define UNITY_INSTANCED_SH
					#endif
					#ifndef UNITY_INSTANCED_LIGHTMAPSTS
						#define UNITY_INSTANCED_LIGHTMAPSTS
					#endif
				#endif
				#include "UnityShaderVariables.cginc"
				#include "UnityCG.cginc"
				#include "Lighting.cginc"
				#include "UnityPBSLighting.cginc"
				#include "AutoLight.cginc"

				#if defined( UNITY_INSTANCING_ENABLED ) && defined( ASE_INSTANCED_TERRAIN ) && ( defined(_TERRAIN_INSTANCED_PERPIXEL_NORMAL) || defined(_INSTANCEDTERRAINNORMALS_PIXEL) )
					#define ENABLE_TERRAIN_PERPIXEL_NORMAL
				#endif

				#define ASE_NEEDS_TEXTURE_COORDINATES0
				#define ASE_NEEDS_FRAG_TEXTURE_COORDINATES0
				#define ASE_NEEDS_TEXTURE_COORDINATES1
				#define ASE_NEEDS_WORLD_POSITION
				#define ASE_NEEDS_FRAG_WORLD_POSITION
				#define ASE_NEEDS_FRAG_WORLD_TANGENT
				#define ASE_NEEDS_WORLD_NORMAL
				#define ASE_NEEDS_FRAG_WORLD_NORMAL
				#define ASE_NEEDS_FRAG_WORLD_BITANGENT


				struct appdata
				{
					float4 vertex : POSITION;
					half3 normal : NORMAL;
					half4 tangent : TANGENT;
					float4 texcoord : TEXCOORD0;
					float4 texcoord1 : TEXCOORD1;
					float4 texcoord2 : TEXCOORD2;
					
					UNITY_VERTEX_INPUT_INSTANCE_ID
				};

				struct v2f
				{
					float4 pos : SV_POSITION;
					float4 worldPos : TEXCOORD0; // xyz = positionWS, w = fogCoord
					half3 normalWS : TEXCOORD1;
					float4 tangentWS : TEXCOORD2; // holds terrainUV ifdef ENABLE_TERRAIN_PERPIXEL_NORMAL
					UNITY_LIGHTING_COORDS( 3, 4 )
					float4 ase_texcoord5 : TEXCOORD5;
					UNITY_VERTEX_INPUT_INSTANCE_ID
					UNITY_VERTEX_OUTPUT_STEREO
				};

				#ifdef ASE_TRANSMISSION
					float _TransmissionShadow;
				#endif
				#ifdef ASE_TRANSLUCENCY
					float _TransStrength;
					float _TransNormal;
					float _TransScattering;
					float _TransDirect;
					float _TransAmbient;
					float _TransShadow;
				#endif
				#ifdef ASE_TESSELLATION
					float _TessPhongStrength;
					float _TessValue;
					float _TessMin;
					float _TessMax;
					float _TessEdgeLength;
					float _TessMaxDisp;
				#endif

				uniform sampler2D _CARD_BACK;
				uniform sampler2D _MainTex;
				uniform sampler2D _CARD_FRONT_BORDER;
				uniform sampler2D _CARD_FRONT_MASK;
				uniform float _ArtGlow;
				uniform float _BorderGlow;
				uniform sampler2D _LayerFoil;
				uniform sampler2D _BackFoil;
				uniform sampler2D _FoilMask;
				uniform float _FoilStrength;
				uniform sampler2D _LayerNormal;
				uniform sampler2D _BackNormal;
				uniform sampler2D _NormalMap;
				uniform float _NormalStrength;
				uniform float _FoilShift;
				uniform float _FoilScale;
				uniform float _Roughness;
				uniform float _DaCardWorld;
				uniform float _WorldGlow;


				float CardLayerGlow145( float4 layerFoil, float4 backFoil, float frontMask )
				{
					// Which glow: 0 = the art's (Art Glow), 1 = a frame's (Border Glow). Collection layers count as frame: the client stacks
					// that into the G channel of _LayerFoil / _BackFoil.
					return lerp( backFoil.g, layerFoil.g, saturate( frontMask ) );
				}
				
				float4 CardLayerFoil144( float4 baseFoil, float4 layerFoil, float layers, float4 backFoil, float frontMask )
				{
					float front = lerp( baseFoil.r * baseFoil.a, layerFoil.r, layers );
					float k = saturate( frontMask );
					float4 surface = lerp( backFoil, layerFoil, k );
					return float4( lerp( backFoil.r, front, k ), surface.b, surface.a, lerp( 1.0, layers, k ) );
				}
				
				float CardFoilType163( float2 uv, float frontMask, sampler2D layerNormal, sampler2D backNormal )
				{
					float2 size = float2( 735.0, 1026.0 );
					float4 uvc = float4( ( clamp( floor( uv * size ), 0.0, size - 1.0 ) + 0.5 ) / size, 0.0, 0.0 );
					float a = frontMask > 0.5 ? tex2Dlod( layerNormal, uvc ).a : tex2Dlod( backNormal, uvc ).a;
					return round( a * 255.0 );
				}
				
				float3 CardNormal127( float2 uv, sampler2D normalMap, float strength, float frontMask, float border, sampler2D layerNormal, sampler2D backNormal )
				{
					// Bump detail, tangent space (OpenGL / Unity convention: green = up), so the card catches the game's lights. Front: the
					// card layers' normals (_LayerNormal, stacked by the client) over card.normal.png where no layer covers it (border = the
					// layers' coverage). Back: the back layers' (_BackNormal). Default textures "bump" = flat.
					float3 base = tex2D( normalMap, uv ).xyz * 2.0 - 1.0;
					float3 layer = tex2D( layerNormal, uv ).xyz * 2.0 - 1.0;
					float3 back = tex2D( backNormal, uv ).xyz * 2.0 - 1.0;
					float3 n = lerp( back, lerp( base, layer, border ), saturate( frontMask ) );
					n.xy *= strength;
					return normalize( n );
				}
				
				float4 CardFoilPattern170( float2 uv, float3 viewTS, float type, float3 normalTS )
				{
					#define DC_HASH(c) frac((frac((c).x * 123.34) + dot(frac((c) * float2(123.34, 456.21)), frac((c) * float2(123.34, 456.21)) + 45.32)) * (frac((c).y * 456.21) + dot(frac((c) * float2(123.34, 456.21)), frac((c) * float2(123.34, 456.21)) + 45.32)))
					#define DC_BUMP(x, c, o, y) saturate(1.0 - ((c) * ((x) - (o))) * ((c) * ((x) - (o))) - (y))
					#define DC_SPEC(t) (DC_BUMP(frac(t), float3(3.54585104, 2.93225262, 2.41593945), float3(0.69549072, 0.49228336, 0.27699880), float3(0.02312639, 0.15225084, 0.52607955)) + DC_BUMP(frac(t), float3(3.90307140, 3.21182957, 3.96587128), float3(0.11748627, 0.86755042, 0.66077860), float3(0.84897130, 0.88445281, 0.73949448)))
					#define DC_COUNT(s, m, k) ((m) + ((s) - (m)) * rsqrt(max((k), 1.0)))
					float3 nb = normalize(normalTS);
					float3 v = normalize(viewTS);
					float3 p = float3(uv.x - 0.5, (uv.y - 0.5) * 1.397, 0.0);
					float3 up = normalize(float3(0.0, 1.0, 0.0) - v * v.y);
					float3 eye = v * 2.0;
					float3 V = normalize(eye - p);
					float3 L = normalize(eye + (up * 0.7 + cross(up, v) * 0.35) * 2.0 - p);
					float2 h = (L - nb * dot(L, nb)).xy + (V - nb * dot(V, nb)).xy;
					float2 nh = normalize(h + 1e-5);
					float vn = dot(v, nb);
					float2 tilt = (v - nb * vn).xy / max(vn, 0.25);
					float lit = 0.55 + 0.75 * pow(saturate(dot(nb, normalize(L + V))), 12.0);
					float fw = max(fwidth(uv.x), 1e-6);
					float2 dir = float2(0.866, 0.5);
					float gate = 1.0;
					float sheen = 0.0;
					float3 col = 0.0;
					float glint = 0.0;
					bool grating = type > 0.5 && type < 11.5;
					if (type > 10.5)
					{
					    float2 q = uv * float2(9.0, 12.573);
					    float2 b = floor(q);
					    float d1 = 8.0;
					    float2 id = b;
					    [unroll] for (int j = -1; j <= 1; j++)
					    [unroll] for (int i = -1; i <= 1; i++)
					    {
					        float2 nc = b + float2(i, j);
					        float2 o = nc + 0.1 + 0.8 * float2(DC_HASH(nc + float2(0.0, 3.3)), DC_HASH(nc + float2(5.7, 0.0)));
					        float d = length(q - o);
					        if (d < d1) { d1 = d; id = nc; }
					    }
					    float turn = DC_HASH(id + float2(1.7, 9.2)) * 6.2831853;
					    dir = float2(cos(turn), sin(turn));
					    gate = 0.45 + 0.55 * DC_HASH(id + float2(6.6, 2.2));
					    sheen = 0.25;
					}
					else if (type > 9.5)
					{
					    grating = false;
					    float2 cn = uv * float2(7.0, 9.779);
					    float2 ci = floor(cn);
					    float2 cf = frac(cn);
					    cf = cf * cf * (3.0 - 2.0 * cf);
					    float dens = lerp(lerp(DC_HASH(ci), DC_HASH(ci + float2(1.0, 0.0)), cf.x), lerp(DC_HASH(ci + float2(0.0, 1.0)), DC_HASH(ci + float2(1.0, 1.0)), cf.x), cf.y);
					    dens = 0.45 + 0.3 * dens;
					    float2 pp = float2(uv.x, uv.y * 1.397);
					    [unroll] for (int k = 0; k < 3; k++)
					    {
					        float s = k == 0 ? 113.0 : (k == 1 ? 139.0 : 167.0);
					        float an = k == 0 ? 0.31 : (k == 1 ? 1.13 : 2.07);
					        float2 q = float2(cos(an) * pp.x - sin(an) * pp.y, sin(an) * pp.x + cos(an) * pp.y) * s + float2(0.37, 0.61) * k;
					        float2 c = floor(q) + float2(41.3, 27.1) * k;
					        float rad = 0.0026 * s * (0.85 + 0.3 * DC_HASH(c + float2(7.7, 3.3)));
					        float2 o = (float2(DC_HASH(c + float2(1.3, 0.0)), DC_HASH(c + float2(0.0, 2.9))) - 0.5) * (1.0 - 2.0 * rad);
					        float d = length(frac(q) - 0.5 - o);
					        float turn = DC_HASH(c + float2(4.1, 2.3)) * 6.2831853;
					        float tw = pow(saturate(dot(float2(cos(turn), sin(turn)), nh)), 3.0);
					        float dotMask = saturate((rad - d) / max(fw * s * 1.5, 0.05) + 0.5) * step(1.0 - dens, DC_HASH(c));
					        float3 tint = DC_SPEC(uv.x * 0.35 + uv.y * 0.75 + dot(tilt, float2(0.6, 0.5)) + DC_HASH(c + float2(8.8, 0.0)) * 0.15);
					        float kk = fw * s * fw * s;
					        float mn = dens * 3.14159 * rad * rad * 0.6;
					        col += tint * DC_COUNT(dotMask * (0.45 + 1.1 * tw), mn, kk) * 1.7;
					        glint += DC_COUNT(dotMask * tw * tw * tw, mn * 0.1, kk) * 0.45;
					    }
					}
					else if (type > 8.5)
					{
					    grating = false;
					    float ph = length(p.xy - float2(-0.45, 1.0)) * 2.4 - dot(tilt, float2(0.8, 0.6)) * 0.9;
					    col = DC_SPEC(ph) * (0.6 + 0.4 * cos(6.2831853 * ph * 0.5)) * 1.6;
					    glint = pow(saturate(1.0 - abs(frac(ph * 0.5) - 0.5) * 8.0), 3.0) * 0.5;
					}
					else if (type > 7.5)
					{
					    grating = false;
					    float ph = dot(p.xy, float2(0.8, 0.6)) * 1.4 + dot(tilt, float2(1.1, 0.8)) * 1.6;
					    float band = pow(0.5 + 0.5 * cos(6.2831853 * ph), 3.0);
					    float band2 = pow(0.5 + 0.5 * cos(6.2831853 * (ph * 2.7 + 0.3)), 10.0) * 0.6;
					    col = DC_SPEC(ph * 0.8 + p.y * 0.25) * (band + band2) * 2.0;
					    glint = pow(band, 6.0) * 0.5;
					}
					else if (type > 6.5)
					{
					    float2 q = uv * float2(8.0, 11.176);
					    float2 fa = frac(q) - 0.5;
					    float2 fb = frac(q + 0.5) - 0.5;
					    float2 f = length(fb) < 0.5 ? fb : fa;
					    float d = length(f);
					    float rings = 0.5 + 0.5 * cos(d * 6.2831853 * 9.0);
					    dir = f / max(d, 1e-4);
					    gate = 0.45 + 0.55 * rings;
					    sheen = 0.35;
					}
					else if (type > 4.5)
					{
					    float cells = type > 5.5 ? 12.0 : 10.0;
					    float2 q = uv * float2(cells, cells * 1.397);
					    float2 c = floor(q);
					    float2 f = frac(q) - 0.5;
					    if (type < 5.5)
					    {
					        float sec = floor(frac(atan2(f.y, f.x) / 6.2831853 + DC_HASH(c)) * 7.0);
					        float turn = DC_HASH(c + sec * float2(3.7, 1.9)) * 6.2831853;
					        dir = float2(cos(turn), sin(turn));
					        gate = 0.55 + 0.45 * DC_HASH(c + sec * float2(5.3, 0.0) + float2(1.1, 2.2));
					        sheen = 0.25;
					    }
					    else
					    {
					        dir = normalize(f + 1e-5);
					        gate = 0.65 + 0.35 * saturate(max(abs(f.x), abs(f.y)) * 2.5);
					    }
					}
					else if (type > 3.5)
					{
					    grating = false;
					    [unroll] for (int k = 0; k < 3; k++)
					    {
					        float s = k == 0 ? 6.0 : (k == 1 ? 20.0 : 64.0);
					        float prob = k == 0 ? 0.35 : (k == 1 ? 0.55 : 0.7);
					        float r0 = k == 0 ? 0.18 : (k == 1 ? 0.14 : 0.16);
					        float r1 = k == 0 ? 0.4 : (k == 1 ? 0.34 : 0.36);
					        float br = k == 0 ? 2.8 : (k == 1 ? 2.5 : 2.4);
					        float2 q = uv * float2(s, s * 1.397);
					        float2 c = floor(q) + float2(31.7, 17.9) * k;
					        float2 f = frac(q) - 0.5;
					        float r = lerp(r0, r1, DC_HASH(c + float2(3.1, 7.7)));
					        float2 o = (float2(DC_HASH(c + float2(11.3, 0.0)), DC_HASH(c + float2(0.0, 5.9))) - 0.5) * (1.0 - 2.0 * r);
					        float d = length(f - o);
					        float disc = saturate((r - d) / max(fw * s * 1.5, 0.02) + 0.5 * saturate(fw * s * 1.5 / r - 1.0)) * step(1.0 - prob, DC_HASH(c));
					        float3 dotCol = DC_SPEC(DC_HASH(c + float2(2.7, 1.3)) + uv.y * 0.6 + dot(tilt, float2(0.6, 0.45))) * (0.7 + 0.3 * cos(d / max(r, 1e-3) * 4.0 + dot(tilt, float2(2.0, 1.5))));
					        float kk = fw * s * fw * s;
					        float mn = prob * 3.14159 * (r0 + r1) * (r0 + r1) * 0.25 * 0.35;
					        col += DC_COUNT(dotCol * disc, mn, kk) * br;
					        if (k == 2)
					            glint = DC_COUNT(disc * step(0.7, DC_HASH(c + float2(9.1, 4.4))), mn * 0.3, kk) * 0.5;
					    }
					    [unroll] for (int m = 0; m < 2; m++)
					    {
					        float2 sd = p.xy - (m == 0 ? float2(0.25, 0.55) : float2(-0.3, -0.2));
					        float sr = length(sd) + 1e-4;
					        float swirl = pow(saturate(sin(atan2(sd.y, sd.x) * 2.0 - log(sr) * 7.0 + tilt.x + tilt.y)), 8.0) * saturate(1.0 - sr * 5.0);
					        col += DC_SPEC(sr * 3.0 + dot(tilt, float2(0.5, 0.5))) * swirl * (m == 0 ? 0.6 : 0.5);
					    }
					}
					else if (type > 2.5)
					{
					    float2 cell = floor(uv * float2(60.0, 83.8));
					    float2 q = frac(cell * float2(123.34, 456.21));
					    q += dot(q, q + 45.32);
					    float turn = frac(q.x * q.y) * 6.2831853;
					    q = frac((cell + 17.13) * float2(123.34, 456.21));
					    q += dot(q, q + 45.32);
					    gate = DC_COUNT(step(0.4, frac(q.x * q.y)), 0.6, fw * 60.0 * fw * 60.0);
					    dir = float2(cos(turn), sin(turn));
					    sheen = 0.2;
					}
					else if (type > 1.5)
					    dir = normalize(p.xy + 1e-5);
					if (grating)
					{
					    float g = abs(dot(h, dir));
					    float3 diff = 0.0;
					    [unroll] for (int n = 1; n <= 8; n++)
					    {
					        float w = g * 1600.0 / n;
					        float x = saturate((w - 400.0) / 300.0);
					        float3 a = float3(3.54585104, 2.93225262, 2.41593945) * (x - float3(0.69549072, 0.49228336, 0.27699880));
					        float3 b = float3(3.90307140, 3.21182957, 3.96587128) * (x - float3(0.11748627, 0.86755042, 0.66077860));
					        diff += (w >= 400.0 && w <= 700.0) ? saturate(1.0 - a * a - float3(0.02312639, 0.15225084, 0.52607955)) + saturate(1.0 - b * b - float3(0.84897130, 0.88445281, 0.73949448)) : 0.0;
					    }
					    col = saturate(diff) * gate + sheen * gate * pow(saturate(dot(dir, nh) * 0.5 + 0.5), 16.0);
					    glint = pow(saturate(1.0 - g * 4.0), 4.0) * gate;
					}
					return float4(col, glint) * lit;
				}
				
				float CardFoilMetal130( float frontMask, float4 foilMask, float border, float strength, float type, float4 pattern, float2 uv, float3 viewTS, float tiltShift )
				{
					float m = foilMask.r * saturate( strength * 1.5 );
					float3 v = normalize( viewTS );
					float2 tilt = v.xy / max( v.z, 0.25 );
					float sweep = dot( uv - 0.5, float2( 0.8, 0.6 ) ) + dot( tilt, float2( 0.45, 0.3 ) ) * tiltShift;
					float glint = pow( saturate( 1.0 - abs( sweep ) * 2.5 ), 4.0 );
					float lum = dot( pattern.rgb, float3( 0.299, 0.587, 0.114 ) ) + pattern.a;
					return m * ( type > 0.5 && type < 11.5 ? saturate( lum * 2.5 ) : 0.25 + 0.75 * glint );
				}
				
				float3 CardFoilAlbedo131( float4 albedo, float metal, float2 uv, float3 viewTS, float scale, float tiltShift, float type, float4 pattern )
				{
					// Albedo of the foil area. Where the card is metallic (metal, from CardFoilMetal) the albedo is the colour of its
					// reflections, so this gives the lights' highlights and the reflections the same foil pattern (type) as CardFoil.
					float3 v = normalize(viewTS);
					float3 holo = saturate(0.35 + pattern.rgb * 0.6 + albedo.rgb * 0.3);
					float2 tilt = v.xy / max(v.z, 0.25);
					float grain = sin(dot(uv, float2(173.1, 61.7))) * sin(dot(uv, float2(-47.3, 211.9)));
					float phase = dot(uv, float2(0.6, 1.0)) * scale + dot(tilt, float2(0.8, 0.5)) * tiltShift + grain * 0.06;
					float3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + float3(0.0, 0.333, 0.667)));
					float3 foil = saturate(rainbow * 0.85 + albedo.rgb * 0.35);
					return lerp(albedo.rgb, type > 0.5 && type < 11.5 ? holo : foil, metal);
				}
				
				float CardMetallic154( float4 surface, float foilMetal )
				{
					return max( surface.b, foilMetal );
				}
				
				float CardSmoothness132( float4 surface, float roughness, float foilMetal )
				{
					float rough = lerp( roughness, surface.g, surface.a );
					return lerp( 1.0 - rough, 0.9, foilMetal );
				}
				
				float3 CardFoil120( float2 uv, float3 viewTS, float frontMask, float4 foilMask, float border, float4 baseColor, float strength, float scale, float tiltShift, float type, float4 pattern )
				{
					// Holographic foil on the card art, added on top of emission. type 0 (rainbow): rainbow bands that slide across the
					// card as it tilts, plus a brighter glint band sweeping diagonally. 1 to 11: the CardFoilPattern foils (pattern).
					// Only where frontMask is set (not the back), not under the frame (border = frame alpha), and inside
					// foilMask (card.foil.png: white/opaque = foil, black/transparent = plain print, default white = the whole art).
					float area = foilMask.r;   // CardLayerFoil: layers and picture, front and back
					float3 v = normalize(viewTS);
					float patternLuma = dot(baseColor.rgb, float3(0.299, 0.587, 0.114));
					float3 holo = (pattern.rgb * (0.3 + 0.7 * patternLuma) * (abs(type - 3.0) < 0.5 ? 1.4 : 1.0) + pattern.a * 0.25) * strength * area;
					float2 tilt = v.xy / max(v.z, 0.25);
					float grain = sin(dot(uv, float2(173.1, 61.7))) * sin(dot(uv, float2(-47.3, 211.9)));
					float phase = dot(uv, float2(0.6, 1.0)) * scale + dot(tilt, float2(0.8, 0.5)) * tiltShift + grain * 0.06;
					float3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + float3(0.0, 0.333, 0.667)));
					float sweep = dot(uv - 0.5, float2(0.8, 0.6)) + dot(tilt, float2(0.45, 0.3)) * tiltShift;
					float glint = pow(saturate(1.0 - abs(sweep) * 2.5), 4.0);
					float luma = dot(baseColor.rgb, float3(0.299, 0.587, 0.114));
					float3 foil = rainbow * (0.3 + 0.7 * luma) * (0.35 + 0.65 * glint) + glint * 0.25;
					return type > 0.5 && type < 11.5 ? holo : foil * strength * area;
				}
				
				float3 CardWorldEmission152( float3 emission, float world, float worldGlow )
				{
					// A card lying in the world (drawn by the game's main camera: the client sets the global _DaCardWorld then) is lit by the
					// raid: its own light (art glow, foil shine) drops to worldGlow, so it is dark in the dark. Inspect views and icons: 1.
					return emission * lerp( 1.0, worldGlow, saturate( world ) );
				}
				

				v2f VertexFunction (appdata v  ) {
					UNITY_SETUP_INSTANCE_ID(v);
					v2f o;
					UNITY_INITIALIZE_OUTPUT(v2f,o);
					UNITY_TRANSFER_INSTANCE_ID(v,o);
					UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

					o.ase_texcoord5.xy = v.texcoord.xyzw.xy;
					o.ase_texcoord5.zw = v.texcoord1.xyzw.xy;

					#ifdef ASE_ABSOLUTE_VERTEX_POS
						float3 defaultVertexValue = v.vertex.xyz;
					#else
						float3 defaultVertexValue = float3(0, 0, 0);
					#endif
					float3 vertexValue = defaultVertexValue;
					#ifdef ASE_ABSOLUTE_VERTEX_POS
						v.vertex.xyz = vertexValue;
					#else
						v.vertex.xyz += vertexValue;
					#endif
					v.vertex.w = 1;
					v.normal = v.normal;
					v.tangent = v.tangent;

					float3 positionWS = mul( unity_ObjectToWorld, v.vertex ).xyz;
					half3 normalWS = UnityObjectToWorldNormal( v.normal );
					half3 tangentWS = UnityObjectToWorldDir( v.tangent.xyz );

					o.pos = UnityObjectToClipPos( v.vertex );
					o.worldPos.xyz = positionWS;
					o.normalWS = normalWS;
					o.tangentWS = half4( tangentWS, v.tangent.w );

					UNITY_TRANSFER_LIGHTING(o, v.texcoord1.xy);
					#if defined( ASE_FOG )
						UNITY_TRANSFER_FOG_COMBINED_WITH_WORLD_POS( o, o.pos );
					#endif

					#if defined(ENABLE_TERRAIN_PERPIXEL_NORMAL)
						o.tangentWS.zw = v.texcoord.xy;
						o.tangentWS.xy = v.texcoord.xy * unity_LightmapST.xy + unity_LightmapST.zw;
					#endif
					return o;
				}

				#if defined(ASE_TESSELLATION)
				struct VertexControl
				{
					float4 vertex : INTERNALTESSPOS;
					half4 tangent : TANGENT;
					half3 normal : NORMAL;
					float4 texcoord : TEXCOORD0;
					float4 texcoord1 : TEXCOORD1;
					float4 texcoord2 : TEXCOORD2;
					
					UNITY_VERTEX_INPUT_INSTANCE_ID
				};

				struct TessellationFactors
				{
					float edge[3] : SV_TessFactor;
					float inside : SV_InsideTessFactor;
				};

				VertexControl vert ( appdata v )
				{
					VertexControl o;
					UNITY_SETUP_INSTANCE_ID(v);
					UNITY_TRANSFER_INSTANCE_ID(v, o);
					o.vertex = v.vertex;
					o.tangent = v.tangent;
					o.normal = v.normal;
					o.texcoord = v.texcoord;
					o.texcoord1 = v.texcoord1;
					o.texcoord2 = v.texcoord2;
					
					return o;
				}

				TessellationFactors TessellationFunction (InputPatch<VertexControl,3> v)
				{
					TessellationFactors o;
					float4 tf = 1;
					float tessValue = _TessValue; float tessMin = _TessMin; float tessMax = _TessMax;
					float edgeLength = _TessEdgeLength; float tessMaxDisp = _TessMaxDisp;
					#if defined(ASE_FIXED_TESSELLATION)
					tf = FixedTess( tessValue );
					#elif defined(ASE_DISTANCE_TESSELLATION)
					tf = DistanceBasedTess(v[0].vertex, v[1].vertex, v[2].vertex, tessValue, tessMin, tessMax, UNITY_MATRIX_M, _WorldSpaceCameraPos );
					#elif defined(ASE_LENGTH_TESSELLATION)
					tf = EdgeLengthBasedTess(v[0].vertex, v[1].vertex, v[2].vertex, edgeLength, UNITY_MATRIX_M, _WorldSpaceCameraPos, _ScreenParams );
					#elif defined(ASE_LENGTH_CULL_TESSELLATION)
					tf = EdgeLengthBasedTessCull(v[0].vertex, v[1].vertex, v[2].vertex, edgeLength, tessMaxDisp, UNITY_MATRIX_M, _WorldSpaceCameraPos, _ScreenParams, unity_CameraWorldClipPlanes );
					#endif
					o.edge[0] = tf.x; o.edge[1] = tf.y; o.edge[2] = tf.z; o.inside = tf.w;
					return o;
				}

				[domain("tri")]
				[partitioning("fractional_odd")]
				[outputtopology("triangle_cw")]
				[patchconstantfunc("TessellationFunction")]
				[outputcontrolpoints(3)]
				VertexControl HullFunction(InputPatch<VertexControl, 3> patch, uint id : SV_OutputControlPointID)
				{
				   return patch[id];
				}

				[domain("tri")]
				v2f DomainFunction(TessellationFactors factors, OutputPatch<VertexControl, 3> patch, float3 bary : SV_DomainLocation)
				{
					appdata o = (appdata) 0;
					o.vertex = patch[0].vertex * bary.x + patch[1].vertex * bary.y + patch[2].vertex * bary.z;
					o.tangent = patch[0].tangent * bary.x + patch[1].tangent * bary.y + patch[2].tangent * bary.z;
					o.normal = patch[0].normal * bary.x + patch[1].normal * bary.y + patch[2].normal * bary.z;
					o.texcoord = patch[0].texcoord * bary.x + patch[1].texcoord * bary.y + patch[2].texcoord * bary.z;
					o.texcoord1 = patch[0].texcoord1 * bary.x + patch[1].texcoord1 * bary.y + patch[2].texcoord1 * bary.z;
					o.texcoord2 = patch[0].texcoord2 * bary.x + patch[1].texcoord2 * bary.y + patch[2].texcoord2 * bary.z;
					
					#if defined(ASE_PHONG_TESSELLATION)
					float3 pp[3];
					for (int i = 0; i < 3; ++i)
						pp[i] = o.vertex.xyz - patch[i].normal * (dot(o.vertex.xyz, patch[i].normal) - dot(patch[i].vertex.xyz, patch[i].normal));
					float phongStrength = _TessPhongStrength;
					o.vertex.xyz = phongStrength * (pp[0]*bary.x + pp[1]*bary.y + pp[2]*bary.z) + (1.0f-phongStrength) * o.vertex.xyz;
					#endif
					UNITY_TRANSFER_INSTANCE_ID(patch[0], o);
					return VertexFunction(o);
				}
				#else
				v2f vert ( appdata v )
				{
					return VertexFunction( v );
				}
				#endif

				half4 frag ( v2f IN 
					#if defined( ASE_DEPTH_WRITE_ON )
					, out float outputDepth : SV_Depth
					#endif
					) : SV_Target
				{
					UNITY_SETUP_INSTANCE_ID(IN);

					#ifdef LOD_FADE_CROSSFADE
						UNITY_APPLY_DITHER_CROSSFADE(IN.pos.xy);
					#endif

					#if defined(ASE_LIGHTING_SIMPLE)
						SurfaceOutput o = (SurfaceOutput)0;
					#else
						#if defined(_SPECULAR_SETUP)
							SurfaceOutputStandardSpecular o = (SurfaceOutputStandardSpecular)0;
						#else
							SurfaceOutputStandard o = (SurfaceOutputStandard)0;
						#endif
					#endif

					half atten;
					{
						#if defined( ASE_RECEIVE_SHADOWS )
							UNITY_LIGHT_ATTENUATION( temp, IN, IN.worldPos.xyz )
							atten = temp;
						#else
							atten = 1;
						#endif
					}

					float3 PositionWS = IN.worldPos.xyz;
					half3 ViewDirWS = normalize( UnityWorldSpaceViewDir( PositionWS ) );
					float4 ScreenPosNorm = float4( IN.pos.xy * ( _ScreenParams.zw - 1.0 ), IN.pos.zw );
					float4 ClipPos = ComputeClipSpacePosition( ScreenPosNorm.xy, IN.pos.z ) * IN.pos.w;
					float4 ScreenPos = ComputeScreenPos( ClipPos );
					half3 NormalWS = IN.normalWS;
					half3 TangentWS = IN.tangentWS.xyz;
					half3 BitangentWS = cross( IN.normalWS, IN.tangentWS.xyz ) * IN.tangentWS.w * unity_WorldTransformParams.w;
					half3 LightAtten = atten;

					#if defined(ENABLE_TERRAIN_PERPIXEL_NORMAL)
						float2 sampleCoords = (IN.tangentWS.zw / _TerrainHeightmapRecipSize.zw + 0.5f) * _TerrainHeightmapRecipSize.xy;
						NormalWS = UnityObjectToWorldNormal(normalize(tex2D(_TerrainNormalmapTexture, sampleCoords).rgb * 2 - 1));
						TangentWS = -cross(unity_ObjectToWorld._13_23_33, NormalWS);
						BitangentWS = cross(NormalWS, -TangentWS);
					#endif

					float2 texCoord43 = IN.ase_texcoord5.xy * float2( 1,1 ) + float2( 0,0 );
					float2 texCoord117 = IN.ase_texcoord5.xy * float2( 1,1 ) + float2( 0,0 );
					float2 texCoord69 = IN.ase_texcoord5.xy * float2( 1,1 ) + float2( 0,0 );
					float4 tex2DNode70 = tex2D( _CARD_FRONT_BORDER, texCoord69 );
					float4 lerpResult77 = lerp( tex2D( _MainTex, texCoord117 ) , tex2DNode70 , tex2DNode70.a);
					float2 texCoord118 = IN.ase_texcoord5.zw * float2( 1,1 ) + float2( 0,0 );
					float4 tex2DNode41 = tex2D( _CARD_FRONT_MASK, texCoord118 );
					float4 lerpResult109 = lerp( tex2D( _CARD_BACK, texCoord43 ) , lerpResult77 , tex2DNode41);
					float4 tex2DNode140 = tex2D( _LayerFoil, texCoord69 );
					float4 layerFoil145 = tex2DNode140;
					float4 tex2DNode141 = tex2D( _BackFoil, texCoord43 );
					float4 backFoil145 = tex2DNode141;
					float frontMask145 = tex2DNode41.r;
					float localCardLayerGlow145 = CardLayerGlow145( layerFoil145 , backFoil145 , frontMask145 );
					float lerpResult112 = lerp( _ArtGlow , _BorderGlow , localCardLayerGlow145);
					float4 albedo131 = ( lerpResult109 * ( 1.0 - lerpResult112 ) );
					float frontMask130 = tex2DNode41.r;
					float4 baseFoil144 = tex2D( _FoilMask, texCoord117 );
					float4 layerFoil144 = tex2DNode140;
					float layers144 = tex2DNode70.a;
					float4 backFoil144 = tex2DNode141;
					float frontMask144 = tex2DNode41.r;
					float4 localCardLayerFoil144 = CardLayerFoil144( baseFoil144 , layerFoil144 , layers144 , backFoil144 , frontMask144 );
					float4 foilMask130 = localCardLayerFoil144;
					float border130 = tex2DNode70.a;
					float strength130 = _FoilStrength;
					float2 uv163 = texCoord117;
					float frontMask163 = tex2DNode41.r;
					sampler2D layerNormal163 = _LayerNormal;
					sampler2D backNormal163 = _BackNormal;
					float localCardFoilType163 = CardFoilType163( uv163 , frontMask163 , layerNormal163 , backNormal163 );
					float type130 = localCardFoilType163;
					float2 uv170 = texCoord117;
					float3 tanToWorld0 = float3( TangentWS.x, BitangentWS.x, NormalWS.x );
					float3 tanToWorld1 = float3( TangentWS.y, BitangentWS.y, NormalWS.y );
					float3 tanToWorld2 = float3( TangentWS.z, BitangentWS.z, NormalWS.z );
					float3 ase_viewVectorTS =  tanToWorld0 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - PositionWS : UNITY_MATRIX_V[ 2 ].xyz ).x + tanToWorld1 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - PositionWS : UNITY_MATRIX_V[ 2 ].xyz ).y  + tanToWorld2 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - PositionWS : UNITY_MATRIX_V[ 2 ].xyz ).z;
					float3 ase_viewDirTS = normalize( ase_viewVectorTS );
					float3 viewTS170 = ase_viewDirTS;
					float type170 = localCardFoilType163;
					float2 uv127 = texCoord117;
					sampler2D normalMap127 = _NormalMap;
					float strength127 = _NormalStrength;
					float frontMask127 = tex2DNode41.r;
					float border127 = tex2DNode70.a;
					sampler2D layerNormal127 = _LayerNormal;
					sampler2D backNormal127 = _BackNormal;
					float3 localCardNormal127 = CardNormal127( uv127 , normalMap127 , strength127 , frontMask127 , border127 , layerNormal127 , backNormal127 );
					float3 normalTS170 = localCardNormal127;
					float4 localCardFoilPattern170 = CardFoilPattern170( uv170 , viewTS170 , type170 , normalTS170 );
					float4 pattern130 = localCardFoilPattern170;
					float2 uv130 = texCoord117;
					float3 viewTS130 = ase_viewDirTS;
					float tiltShift130 = _FoilShift;
					float localCardFoilMetal130 = CardFoilMetal130( frontMask130 , foilMask130 , border130 , strength130 , type130 , pattern130 , uv130 , viewTS130 , tiltShift130 );
					float metal131 = localCardFoilMetal130;
					float2 uv131 = texCoord117;
					float3 viewTS131 = ase_viewDirTS;
					float scale131 = _FoilScale;
					float tiltShift131 = _FoilShift;
					float type131 = localCardFoilType163;
					float4 pattern131 = localCardFoilPattern170;
					float3 localCardFoilAlbedo131 = CardFoilAlbedo131( albedo131 , metal131 , uv131 , viewTS131 , scale131 , tiltShift131 , type131 , pattern131 );
					
					float4 surface154 = localCardLayerFoil144;
					float foilMetal154 = localCardFoilMetal130;
					float localCardMetallic154 = CardMetallic154( surface154 , foilMetal154 );
					
					float4 surface132 = localCardLayerFoil144;
					float roughness132 = _Roughness;
					float foilMetal132 = localCardFoilMetal130;
					float localCardSmoothness132 = CardSmoothness132( surface132 , roughness132 , foilMetal132 );
					
					float2 uv120 = texCoord117;
					float3 viewTS120 = ase_viewDirTS;
					float frontMask120 = tex2DNode41.r;
					float4 foilMask120 = localCardLayerFoil144;
					float border120 = tex2DNode70.a;
					float4 baseColor120 = lerpResult109;
					float strength120 = _FoilStrength;
					float scale120 = _FoilScale;
					float tiltShift120 = _FoilShift;
					float type120 = localCardFoilType163;
					float4 pattern120 = localCardFoilPattern170;
					float3 localCardFoil120 = CardFoil120( uv120 , viewTS120 , frontMask120 , foilMask120 , border120 , baseColor120 , strength120 , scale120 , tiltShift120 , type120 , pattern120 );
					float3 emission152 = ( ( lerpResult109 * lerpResult112 ) + float4( localCardFoil120 , 0.0 ) ).rgb;
					float world152 = _DaCardWorld;
					float worldGlow152 = _WorldGlow;
					float3 localCardWorldEmission152 = CardWorldEmission152( emission152 , world152 , worldGlow152 );
					

					o.Albedo = localCardFoilAlbedo131;
					o.Normal = localCardNormal127;

					half3 Specular = half3( 0, 0, 0 );
					half Metallic = localCardMetallic154;
					half Smoothness = localCardSmoothness132;
					half Occlusion = 1;

					#if defined(ASE_LIGHTING_SIMPLE)
						o.Specular = Specular.x;
						o.Gloss = Smoothness;
					#else
						#if defined(_SPECULAR_SETUP)
							o.Specular = Specular;
						#else
							o.Metallic = Metallic;
						#endif
						o.Occlusion = Occlusion;
						o.Smoothness = Smoothness;
					#endif

					o.Emission = localCardWorldEmission152;
					o.Alpha = 1;
					half AlphaClipThreshold = 0.5;
					half3 Transmission = 1;
					half3 Translucency = 1;

					#if defined( ASE_DEPTH_WRITE_ON )
						IN.pos.z = IN.pos.z;
					#endif

					#ifdef _ALPHATEST_ON
						clip( o.Alpha - AlphaClipThreshold );
					#endif

					#if defined( ASE_CHANGES_WORLD_POS )
					{
						#if defined( ASE_RECEIVE_SHADOWS )
							UNITY_LIGHT_ATTENUATION( temp, IN, PositionWS )
							LightAtten = temp;
						#else
							LightAtten = 1;
						#endif
					}
					#endif

					#if ( ASE_FRAGMENT_NORMAL == 0 )
						o.Normal = normalize( o.Normal.x * TangentWS + o.Normal.y * BitangentWS + o.Normal.z * NormalWS );
					#elif ( ASE_FRAGMENT_NORMAL == 1 )
						o.Normal = UnityObjectToWorldNormal( o.Normal );
					#elif ( ASE_FRAGMENT_NORMAL == 2 )
						// @diogo: already in world-space; do nothing
					#endif

					#if defined( ASE_DEPTH_WRITE_ON )
						outputDepth = IN.pos.z;
					#endif

					#ifndef USING_DIRECTIONAL_LIGHT
						half3 lightDir = normalize( UnityWorldSpaceLightDir( PositionWS ) );
					#else
						half3 lightDir = _WorldSpaceLightPos0.xyz;
					#endif

					UnityGI gi;
					UNITY_INITIALIZE_OUTPUT(UnityGI, gi);
					gi.indirect.diffuse = 0;
					gi.indirect.specular = 0;
					gi.light.color = _LightColor0.rgb;
					gi.light.dir = lightDir;
					gi.light.color *= atten;

					half4 c = 0;
					#if defined(ASE_LIGHTING_SIMPLE)
						#if defined(_SPECULAR_SETUP)
							c += LightingBlinnPhong (o, ViewDirWS, gi);
						#else
							c += LightingLambert( o, gi );
						#endif
					#else
						#if defined(_SPECULAR_SETUP)
							c += LightingStandardSpecular(o, ViewDirWS, gi);
						#else
							c += LightingStandard(o, ViewDirWS, gi);
						#endif
					#endif

					#ifdef ASE_TRANSMISSION
					{
						half shadow = _TransmissionShadow;
						#ifdef DIRECTIONAL
							half3 lightAtten = lerp( _LightColor0.rgb, gi.light.color, shadow );
						#else
							half3 lightAtten = gi.light.color;
						#endif
						half3 transmission = max(0 , -dot(o.Normal, gi.light.dir)) * lightAtten * Transmission;
						c.rgb += o.Albedo * transmission;
					}
					#endif

					#ifdef ASE_TRANSLUCENCY
					{
						half shadow = _TransShadow;
						half normal = _TransNormal;
						half scattering = _TransScattering;
						half direct = _TransDirect;
						half ambient = _TransAmbient;
						half strength = _TransStrength;

						#ifdef DIRECTIONAL
							half3 lightAtten = lerp( _LightColor0.rgb, gi.light.color, shadow );
						#else
							half3 lightAtten = gi.light.color;
						#endif
						half3 lightDir = gi.light.dir + o.Normal * normal;
						half transVdotL = pow( saturate( dot( ViewDirWS, -lightDir ) ), scattering );
						half3 translucency = lightAtten * (transVdotL * direct + gi.indirect.diffuse * ambient) * Translucency;
						c.rgb += o.Albedo * translucency * strength;
					}
					#endif

					#if defined( ASE_FOG )
						UNITY_EXTRACT_FOG_FROM_WORLD_POS( IN );
						UNITY_APPLY_FOG(_unity_fogCoord, c.rgb);
					#endif
					return c;
				}
			ENDCG
		}

		
		Pass
		{
			
			Name "Deferred"
			Tags { "LightMode"="Deferred" }

			AlphaToMask Off

			CGPROGRAM
				#define ASE_GEOMETRY
				#define ASE_FRAGMENT_NORMAL 0
				#define ASE_RECEIVE_SHADOWS
				#pragma shader_feature_local_fragment _SPECULARHIGHLIGHTS_OFF
				#pragma shader_feature_local_fragment _GLOSSYREFLECTIONS_OFF
				#pragma multi_compile_instancing
				#pragma multi_compile _ LOD_FADE_CROSSFADE
				#define ASE_FOG
				#define ASE_VERSION 19909

				#pragma vertex vert
				#pragma fragment frag
				#pragma skip_variants FOG_LINEAR FOG_EXP FOG_EXP2
				#pragma multi_compile_prepassfinal
				#ifndef UNITY_PASS_DEFERRED
					#define UNITY_PASS_DEFERRED
				#endif
				#include "HLSLSupport.cginc"
				#if defined( ASE_GEOMETRY ) || defined( ASE_IMPOSTOR )
					#ifndef UNITY_INSTANCED_LOD_FADE
						#define UNITY_INSTANCED_LOD_FADE
					#endif
					#ifndef UNITY_INSTANCED_SH
						#define UNITY_INSTANCED_SH
					#endif
					#ifndef UNITY_INSTANCED_LIGHTMAPSTS
						#define UNITY_INSTANCED_LIGHTMAPSTS
					#endif
				#endif
				#include "UnityShaderVariables.cginc"
				#include "UnityCG.cginc"
				#include "Lighting.cginc"
				#include "UnityPBSLighting.cginc"

				#if defined( UNITY_INSTANCING_ENABLED ) && defined( ASE_INSTANCED_TERRAIN ) && ( defined(_TERRAIN_INSTANCED_PERPIXEL_NORMAL) || defined(_INSTANCEDTERRAINNORMALS_PIXEL) )
					#define ENABLE_TERRAIN_PERPIXEL_NORMAL
				#endif

				#define ASE_NEEDS_TEXTURE_COORDINATES0
				#define ASE_NEEDS_FRAG_TEXTURE_COORDINATES0
				#define ASE_NEEDS_TEXTURE_COORDINATES1
				#define ASE_NEEDS_WORLD_POSITION
				#define ASE_NEEDS_FRAG_WORLD_POSITION
				#define ASE_NEEDS_WORLD_TANGENT
				#define ASE_NEEDS_FRAG_WORLD_TANGENT
				#define ASE_NEEDS_WORLD_NORMAL
				#define ASE_NEEDS_FRAG_WORLD_NORMAL
				#define ASE_NEEDS_FRAG_WORLD_BITANGENT


				struct appdata
				{
					float4 vertex : POSITION;
					half3 normal : NORMAL;
					half4 tangent : TANGENT;
					float4 texcoord : TEXCOORD0;
					float4 texcoord1 : TEXCOORD1;
					float4 texcoord2 : TEXCOORD2;
					
					UNITY_VERTEX_INPUT_INSTANCE_ID
				};

				struct v2f
				{
					float4 pos : SV_POSITION;
					float4 worldPos : TEXCOORD0; // xyz = positionWS, w = fogCoord
					half3 normalWS : TEXCOORD1;
					float4 tangentWS : TEXCOORD2; // holds terrainUV ifdef ENABLE_TERRAIN_PERPIXEL_NORMAL
					half4 ambientOrLightmapUV : TEXCOORD3;
					float4 ase_texcoord4 : TEXCOORD4;
					UNITY_VERTEX_INPUT_INSTANCE_ID
					UNITY_VERTEX_OUTPUT_STEREO
				};

				#ifdef LIGHTMAP_ON
				float4 unity_LightmapFade;
				#endif
				half4 unity_Ambient;
				#ifdef ASE_TESSELLATION
					float _TessPhongStrength;
					float _TessValue;
					float _TessMin;
					float _TessMax;
					float _TessEdgeLength;
					float _TessMaxDisp;
				#endif

				uniform sampler2D _CARD_BACK;
				uniform sampler2D _MainTex;
				uniform sampler2D _CARD_FRONT_BORDER;
				uniform sampler2D _CARD_FRONT_MASK;
				uniform float _ArtGlow;
				uniform float _BorderGlow;
				uniform sampler2D _LayerFoil;
				uniform sampler2D _BackFoil;
				uniform sampler2D _FoilMask;
				uniform float _FoilStrength;
				uniform sampler2D _LayerNormal;
				uniform sampler2D _BackNormal;
				uniform sampler2D _NormalMap;
				uniform float _NormalStrength;
				uniform float _FoilShift;
				uniform float _FoilScale;
				uniform float _Roughness;
				uniform float _DaCardWorld;
				uniform float _WorldGlow;


				float CardLayerGlow145( float4 layerFoil, float4 backFoil, float frontMask )
				{
					// Which glow: 0 = the art's (Art Glow), 1 = a frame's (Border Glow). Collection layers count as frame: the client stacks
					// that into the G channel of _LayerFoil / _BackFoil.
					return lerp( backFoil.g, layerFoil.g, saturate( frontMask ) );
				}
				
				float4 CardLayerFoil144( float4 baseFoil, float4 layerFoil, float layers, float4 backFoil, float frontMask )
				{
					float front = lerp( baseFoil.r * baseFoil.a, layerFoil.r, layers );
					float k = saturate( frontMask );
					float4 surface = lerp( backFoil, layerFoil, k );
					return float4( lerp( backFoil.r, front, k ), surface.b, surface.a, lerp( 1.0, layers, k ) );
				}
				
				float CardFoilType163( float2 uv, float frontMask, sampler2D layerNormal, sampler2D backNormal )
				{
					float2 size = float2( 735.0, 1026.0 );
					float4 uvc = float4( ( clamp( floor( uv * size ), 0.0, size - 1.0 ) + 0.5 ) / size, 0.0, 0.0 );
					float a = frontMask > 0.5 ? tex2Dlod( layerNormal, uvc ).a : tex2Dlod( backNormal, uvc ).a;
					return round( a * 255.0 );
				}
				
				float3 CardNormal127( float2 uv, sampler2D normalMap, float strength, float frontMask, float border, sampler2D layerNormal, sampler2D backNormal )
				{
					// Bump detail, tangent space (OpenGL / Unity convention: green = up), so the card catches the game's lights. Front: the
					// card layers' normals (_LayerNormal, stacked by the client) over card.normal.png where no layer covers it (border = the
					// layers' coverage). Back: the back layers' (_BackNormal). Default textures "bump" = flat.
					float3 base = tex2D( normalMap, uv ).xyz * 2.0 - 1.0;
					float3 layer = tex2D( layerNormal, uv ).xyz * 2.0 - 1.0;
					float3 back = tex2D( backNormal, uv ).xyz * 2.0 - 1.0;
					float3 n = lerp( back, lerp( base, layer, border ), saturate( frontMask ) );
					n.xy *= strength;
					return normalize( n );
				}
				
				float4 CardFoilPattern170( float2 uv, float3 viewTS, float type, float3 normalTS )
				{
					#define DC_HASH(c) frac((frac((c).x * 123.34) + dot(frac((c) * float2(123.34, 456.21)), frac((c) * float2(123.34, 456.21)) + 45.32)) * (frac((c).y * 456.21) + dot(frac((c) * float2(123.34, 456.21)), frac((c) * float2(123.34, 456.21)) + 45.32)))
					#define DC_BUMP(x, c, o, y) saturate(1.0 - ((c) * ((x) - (o))) * ((c) * ((x) - (o))) - (y))
					#define DC_SPEC(t) (DC_BUMP(frac(t), float3(3.54585104, 2.93225262, 2.41593945), float3(0.69549072, 0.49228336, 0.27699880), float3(0.02312639, 0.15225084, 0.52607955)) + DC_BUMP(frac(t), float3(3.90307140, 3.21182957, 3.96587128), float3(0.11748627, 0.86755042, 0.66077860), float3(0.84897130, 0.88445281, 0.73949448)))
					#define DC_COUNT(s, m, k) ((m) + ((s) - (m)) * rsqrt(max((k), 1.0)))
					float3 nb = normalize(normalTS);
					float3 v = normalize(viewTS);
					float3 p = float3(uv.x - 0.5, (uv.y - 0.5) * 1.397, 0.0);
					float3 up = normalize(float3(0.0, 1.0, 0.0) - v * v.y);
					float3 eye = v * 2.0;
					float3 V = normalize(eye - p);
					float3 L = normalize(eye + (up * 0.7 + cross(up, v) * 0.35) * 2.0 - p);
					float2 h = (L - nb * dot(L, nb)).xy + (V - nb * dot(V, nb)).xy;
					float2 nh = normalize(h + 1e-5);
					float vn = dot(v, nb);
					float2 tilt = (v - nb * vn).xy / max(vn, 0.25);
					float lit = 0.55 + 0.75 * pow(saturate(dot(nb, normalize(L + V))), 12.0);
					float fw = max(fwidth(uv.x), 1e-6);
					float2 dir = float2(0.866, 0.5);
					float gate = 1.0;
					float sheen = 0.0;
					float3 col = 0.0;
					float glint = 0.0;
					bool grating = type > 0.5 && type < 11.5;
					if (type > 10.5)
					{
					    float2 q = uv * float2(9.0, 12.573);
					    float2 b = floor(q);
					    float d1 = 8.0;
					    float2 id = b;
					    [unroll] for (int j = -1; j <= 1; j++)
					    [unroll] for (int i = -1; i <= 1; i++)
					    {
					        float2 nc = b + float2(i, j);
					        float2 o = nc + 0.1 + 0.8 * float2(DC_HASH(nc + float2(0.0, 3.3)), DC_HASH(nc + float2(5.7, 0.0)));
					        float d = length(q - o);
					        if (d < d1) { d1 = d; id = nc; }
					    }
					    float turn = DC_HASH(id + float2(1.7, 9.2)) * 6.2831853;
					    dir = float2(cos(turn), sin(turn));
					    gate = 0.45 + 0.55 * DC_HASH(id + float2(6.6, 2.2));
					    sheen = 0.25;
					}
					else if (type > 9.5)
					{
					    grating = false;
					    float2 cn = uv * float2(7.0, 9.779);
					    float2 ci = floor(cn);
					    float2 cf = frac(cn);
					    cf = cf * cf * (3.0 - 2.0 * cf);
					    float dens = lerp(lerp(DC_HASH(ci), DC_HASH(ci + float2(1.0, 0.0)), cf.x), lerp(DC_HASH(ci + float2(0.0, 1.0)), DC_HASH(ci + float2(1.0, 1.0)), cf.x), cf.y);
					    dens = 0.45 + 0.3 * dens;
					    float2 pp = float2(uv.x, uv.y * 1.397);
					    [unroll] for (int k = 0; k < 3; k++)
					    {
					        float s = k == 0 ? 113.0 : (k == 1 ? 139.0 : 167.0);
					        float an = k == 0 ? 0.31 : (k == 1 ? 1.13 : 2.07);
					        float2 q = float2(cos(an) * pp.x - sin(an) * pp.y, sin(an) * pp.x + cos(an) * pp.y) * s + float2(0.37, 0.61) * k;
					        float2 c = floor(q) + float2(41.3, 27.1) * k;
					        float rad = 0.0026 * s * (0.85 + 0.3 * DC_HASH(c + float2(7.7, 3.3)));
					        float2 o = (float2(DC_HASH(c + float2(1.3, 0.0)), DC_HASH(c + float2(0.0, 2.9))) - 0.5) * (1.0 - 2.0 * rad);
					        float d = length(frac(q) - 0.5 - o);
					        float turn = DC_HASH(c + float2(4.1, 2.3)) * 6.2831853;
					        float tw = pow(saturate(dot(float2(cos(turn), sin(turn)), nh)), 3.0);
					        float dotMask = saturate((rad - d) / max(fw * s * 1.5, 0.05) + 0.5) * step(1.0 - dens, DC_HASH(c));
					        float3 tint = DC_SPEC(uv.x * 0.35 + uv.y * 0.75 + dot(tilt, float2(0.6, 0.5)) + DC_HASH(c + float2(8.8, 0.0)) * 0.15);
					        float kk = fw * s * fw * s;
					        float mn = dens * 3.14159 * rad * rad * 0.6;
					        col += tint * DC_COUNT(dotMask * (0.45 + 1.1 * tw), mn, kk) * 1.7;
					        glint += DC_COUNT(dotMask * tw * tw * tw, mn * 0.1, kk) * 0.45;
					    }
					}
					else if (type > 8.5)
					{
					    grating = false;
					    float ph = length(p.xy - float2(-0.45, 1.0)) * 2.4 - dot(tilt, float2(0.8, 0.6)) * 0.9;
					    col = DC_SPEC(ph) * (0.6 + 0.4 * cos(6.2831853 * ph * 0.5)) * 1.6;
					    glint = pow(saturate(1.0 - abs(frac(ph * 0.5) - 0.5) * 8.0), 3.0) * 0.5;
					}
					else if (type > 7.5)
					{
					    grating = false;
					    float ph = dot(p.xy, float2(0.8, 0.6)) * 1.4 + dot(tilt, float2(1.1, 0.8)) * 1.6;
					    float band = pow(0.5 + 0.5 * cos(6.2831853 * ph), 3.0);
					    float band2 = pow(0.5 + 0.5 * cos(6.2831853 * (ph * 2.7 + 0.3)), 10.0) * 0.6;
					    col = DC_SPEC(ph * 0.8 + p.y * 0.25) * (band + band2) * 2.0;
					    glint = pow(band, 6.0) * 0.5;
					}
					else if (type > 6.5)
					{
					    float2 q = uv * float2(8.0, 11.176);
					    float2 fa = frac(q) - 0.5;
					    float2 fb = frac(q + 0.5) - 0.5;
					    float2 f = length(fb) < 0.5 ? fb : fa;
					    float d = length(f);
					    float rings = 0.5 + 0.5 * cos(d * 6.2831853 * 9.0);
					    dir = f / max(d, 1e-4);
					    gate = 0.45 + 0.55 * rings;
					    sheen = 0.35;
					}
					else if (type > 4.5)
					{
					    float cells = type > 5.5 ? 12.0 : 10.0;
					    float2 q = uv * float2(cells, cells * 1.397);
					    float2 c = floor(q);
					    float2 f = frac(q) - 0.5;
					    if (type < 5.5)
					    {
					        float sec = floor(frac(atan2(f.y, f.x) / 6.2831853 + DC_HASH(c)) * 7.0);
					        float turn = DC_HASH(c + sec * float2(3.7, 1.9)) * 6.2831853;
					        dir = float2(cos(turn), sin(turn));
					        gate = 0.55 + 0.45 * DC_HASH(c + sec * float2(5.3, 0.0) + float2(1.1, 2.2));
					        sheen = 0.25;
					    }
					    else
					    {
					        dir = normalize(f + 1e-5);
					        gate = 0.65 + 0.35 * saturate(max(abs(f.x), abs(f.y)) * 2.5);
					    }
					}
					else if (type > 3.5)
					{
					    grating = false;
					    [unroll] for (int k = 0; k < 3; k++)
					    {
					        float s = k == 0 ? 6.0 : (k == 1 ? 20.0 : 64.0);
					        float prob = k == 0 ? 0.35 : (k == 1 ? 0.55 : 0.7);
					        float r0 = k == 0 ? 0.18 : (k == 1 ? 0.14 : 0.16);
					        float r1 = k == 0 ? 0.4 : (k == 1 ? 0.34 : 0.36);
					        float br = k == 0 ? 2.8 : (k == 1 ? 2.5 : 2.4);
					        float2 q = uv * float2(s, s * 1.397);
					        float2 c = floor(q) + float2(31.7, 17.9) * k;
					        float2 f = frac(q) - 0.5;
					        float r = lerp(r0, r1, DC_HASH(c + float2(3.1, 7.7)));
					        float2 o = (float2(DC_HASH(c + float2(11.3, 0.0)), DC_HASH(c + float2(0.0, 5.9))) - 0.5) * (1.0 - 2.0 * r);
					        float d = length(f - o);
					        float disc = saturate((r - d) / max(fw * s * 1.5, 0.02) + 0.5 * saturate(fw * s * 1.5 / r - 1.0)) * step(1.0 - prob, DC_HASH(c));
					        float3 dotCol = DC_SPEC(DC_HASH(c + float2(2.7, 1.3)) + uv.y * 0.6 + dot(tilt, float2(0.6, 0.45))) * (0.7 + 0.3 * cos(d / max(r, 1e-3) * 4.0 + dot(tilt, float2(2.0, 1.5))));
					        float kk = fw * s * fw * s;
					        float mn = prob * 3.14159 * (r0 + r1) * (r0 + r1) * 0.25 * 0.35;
					        col += DC_COUNT(dotCol * disc, mn, kk) * br;
					        if (k == 2)
					            glint = DC_COUNT(disc * step(0.7, DC_HASH(c + float2(9.1, 4.4))), mn * 0.3, kk) * 0.5;
					    }
					    [unroll] for (int m = 0; m < 2; m++)
					    {
					        float2 sd = p.xy - (m == 0 ? float2(0.25, 0.55) : float2(-0.3, -0.2));
					        float sr = length(sd) + 1e-4;
					        float swirl = pow(saturate(sin(atan2(sd.y, sd.x) * 2.0 - log(sr) * 7.0 + tilt.x + tilt.y)), 8.0) * saturate(1.0 - sr * 5.0);
					        col += DC_SPEC(sr * 3.0 + dot(tilt, float2(0.5, 0.5))) * swirl * (m == 0 ? 0.6 : 0.5);
					    }
					}
					else if (type > 2.5)
					{
					    float2 cell = floor(uv * float2(60.0, 83.8));
					    float2 q = frac(cell * float2(123.34, 456.21));
					    q += dot(q, q + 45.32);
					    float turn = frac(q.x * q.y) * 6.2831853;
					    q = frac((cell + 17.13) * float2(123.34, 456.21));
					    q += dot(q, q + 45.32);
					    gate = DC_COUNT(step(0.4, frac(q.x * q.y)), 0.6, fw * 60.0 * fw * 60.0);
					    dir = float2(cos(turn), sin(turn));
					    sheen = 0.2;
					}
					else if (type > 1.5)
					    dir = normalize(p.xy + 1e-5);
					if (grating)
					{
					    float g = abs(dot(h, dir));
					    float3 diff = 0.0;
					    [unroll] for (int n = 1; n <= 8; n++)
					    {
					        float w = g * 1600.0 / n;
					        float x = saturate((w - 400.0) / 300.0);
					        float3 a = float3(3.54585104, 2.93225262, 2.41593945) * (x - float3(0.69549072, 0.49228336, 0.27699880));
					        float3 b = float3(3.90307140, 3.21182957, 3.96587128) * (x - float3(0.11748627, 0.86755042, 0.66077860));
					        diff += (w >= 400.0 && w <= 700.0) ? saturate(1.0 - a * a - float3(0.02312639, 0.15225084, 0.52607955)) + saturate(1.0 - b * b - float3(0.84897130, 0.88445281, 0.73949448)) : 0.0;
					    }
					    col = saturate(diff) * gate + sheen * gate * pow(saturate(dot(dir, nh) * 0.5 + 0.5), 16.0);
					    glint = pow(saturate(1.0 - g * 4.0), 4.0) * gate;
					}
					return float4(col, glint) * lit;
				}
				
				float CardFoilMetal130( float frontMask, float4 foilMask, float border, float strength, float type, float4 pattern, float2 uv, float3 viewTS, float tiltShift )
				{
					float m = foilMask.r * saturate( strength * 1.5 );
					float3 v = normalize( viewTS );
					float2 tilt = v.xy / max( v.z, 0.25 );
					float sweep = dot( uv - 0.5, float2( 0.8, 0.6 ) ) + dot( tilt, float2( 0.45, 0.3 ) ) * tiltShift;
					float glint = pow( saturate( 1.0 - abs( sweep ) * 2.5 ), 4.0 );
					float lum = dot( pattern.rgb, float3( 0.299, 0.587, 0.114 ) ) + pattern.a;
					return m * ( type > 0.5 && type < 11.5 ? saturate( lum * 2.5 ) : 0.25 + 0.75 * glint );
				}
				
				float3 CardFoilAlbedo131( float4 albedo, float metal, float2 uv, float3 viewTS, float scale, float tiltShift, float type, float4 pattern )
				{
					// Albedo of the foil area. Where the card is metallic (metal, from CardFoilMetal) the albedo is the colour of its
					// reflections, so this gives the lights' highlights and the reflections the same foil pattern (type) as CardFoil.
					float3 v = normalize(viewTS);
					float3 holo = saturate(0.35 + pattern.rgb * 0.6 + albedo.rgb * 0.3);
					float2 tilt = v.xy / max(v.z, 0.25);
					float grain = sin(dot(uv, float2(173.1, 61.7))) * sin(dot(uv, float2(-47.3, 211.9)));
					float phase = dot(uv, float2(0.6, 1.0)) * scale + dot(tilt, float2(0.8, 0.5)) * tiltShift + grain * 0.06;
					float3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + float3(0.0, 0.333, 0.667)));
					float3 foil = saturate(rainbow * 0.85 + albedo.rgb * 0.35);
					return lerp(albedo.rgb, type > 0.5 && type < 11.5 ? holo : foil, metal);
				}
				
				float CardMetallic154( float4 surface, float foilMetal )
				{
					return max( surface.b, foilMetal );
				}
				
				float CardSmoothness132( float4 surface, float roughness, float foilMetal )
				{
					float rough = lerp( roughness, surface.g, surface.a );
					return lerp( 1.0 - rough, 0.9, foilMetal );
				}
				
				float3 CardFoil120( float2 uv, float3 viewTS, float frontMask, float4 foilMask, float border, float4 baseColor, float strength, float scale, float tiltShift, float type, float4 pattern )
				{
					// Holographic foil on the card art, added on top of emission. type 0 (rainbow): rainbow bands that slide across the
					// card as it tilts, plus a brighter glint band sweeping diagonally. 1 to 11: the CardFoilPattern foils (pattern).
					// Only where frontMask is set (not the back), not under the frame (border = frame alpha), and inside
					// foilMask (card.foil.png: white/opaque = foil, black/transparent = plain print, default white = the whole art).
					float area = foilMask.r;   // CardLayerFoil: layers and picture, front and back
					float3 v = normalize(viewTS);
					float patternLuma = dot(baseColor.rgb, float3(0.299, 0.587, 0.114));
					float3 holo = (pattern.rgb * (0.3 + 0.7 * patternLuma) * (abs(type - 3.0) < 0.5 ? 1.4 : 1.0) + pattern.a * 0.25) * strength * area;
					float2 tilt = v.xy / max(v.z, 0.25);
					float grain = sin(dot(uv, float2(173.1, 61.7))) * sin(dot(uv, float2(-47.3, 211.9)));
					float phase = dot(uv, float2(0.6, 1.0)) * scale + dot(tilt, float2(0.8, 0.5)) * tiltShift + grain * 0.06;
					float3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + float3(0.0, 0.333, 0.667)));
					float sweep = dot(uv - 0.5, float2(0.8, 0.6)) + dot(tilt, float2(0.45, 0.3)) * tiltShift;
					float glint = pow(saturate(1.0 - abs(sweep) * 2.5), 4.0);
					float luma = dot(baseColor.rgb, float3(0.299, 0.587, 0.114));
					float3 foil = rainbow * (0.3 + 0.7 * luma) * (0.35 + 0.65 * glint) + glint * 0.25;
					return type > 0.5 && type < 11.5 ? holo : foil * strength * area;
				}
				
				float3 CardWorldEmission152( float3 emission, float world, float worldGlow )
				{
					// A card lying in the world (drawn by the game's main camera: the client sets the global _DaCardWorld then) is lit by the
					// raid: its own light (art glow, foil shine) drops to worldGlow, so it is dark in the dark. Inspect views and icons: 1.
					return emission * lerp( 1.0, worldGlow, saturate( world ) );
				}
				

				v2f VertexFunction (appdata v  ) {
					UNITY_SETUP_INSTANCE_ID(v);
					v2f o;
					UNITY_INITIALIZE_OUTPUT(v2f,o);
					UNITY_TRANSFER_INSTANCE_ID(v,o);
					UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

					o.ase_texcoord4.xy = v.texcoord.xyzw.xy;
					o.ase_texcoord4.zw = v.texcoord1.xyzw.xy;

					#ifdef ASE_ABSOLUTE_VERTEX_POS
						float3 defaultVertexValue = v.vertex.xyz;
					#else
						float3 defaultVertexValue = float3(0, 0, 0);
					#endif
					float3 vertexValue = defaultVertexValue;
					#ifdef ASE_ABSOLUTE_VERTEX_POS
						v.vertex.xyz = vertexValue;
					#else
						v.vertex.xyz += vertexValue;
					#endif
					v.vertex.w = 1;
					v.normal = v.normal;
					v.tangent = v.tangent;

					float3 positionWS = mul( unity_ObjectToWorld, v.vertex ).xyz;
					half3 normalWS = UnityObjectToWorldNormal( v.normal );
					half3 tangentWS = UnityObjectToWorldDir( v.tangent.xyz );

					o.pos = UnityObjectToClipPos( v.vertex );
					o.worldPos.xyz = positionWS;
					o.normalWS = normalWS;
					o.tangentWS = half4( tangentWS, v.tangent.w );

					o.ambientOrLightmapUV = 0;
					#ifdef LIGHTMAP_ON
						o.ambientOrLightmapUV.xy = v.texcoord1.xy * unity_LightmapST.xy + unity_LightmapST.zw;
					#elif UNITY_SHOULD_SAMPLE_SH
						#ifdef VERTEXLIGHT_ON
							o.ambientOrLightmapUV.rgb += Shade4PointLights(
								unity_4LightPosX0, unity_4LightPosY0, unity_4LightPosZ0,
								unity_LightColor[0].rgb, unity_LightColor[1].rgb, unity_LightColor[2].rgb, unity_LightColor[3].rgb,
								unity_4LightAtten0, positionWS, normalWS );
						#endif
						o.ambientOrLightmapUV.rgb = ShadeSHPerVertex( normalWS, o.ambientOrLightmapUV.rgb );
					#endif
					#ifdef DYNAMICLIGHTMAP_ON
						o.ambientOrLightmapUV.zw = v.texcoord2.xy * unity_DynamicLightmapST.xy + unity_DynamicLightmapST.zw;
					#endif

					#if defined(ENABLE_TERRAIN_PERPIXEL_NORMAL)
						o.tangentWS.zw = v.texcoord.xy;
						o.tangentWS.xy = v.texcoord.xy * unity_LightmapST.xy + unity_LightmapST.zw;
					#endif
					return o;
				}

				#if defined(ASE_TESSELLATION)
				struct VertexControl
				{
					float4 vertex : INTERNALTESSPOS;
					half4 tangent : TANGENT;
					half3 normal : NORMAL;
					float4 texcoord : TEXCOORD0;
					float4 texcoord1 : TEXCOORD1;
					float4 texcoord2 : TEXCOORD2;
					
					UNITY_VERTEX_INPUT_INSTANCE_ID
				};

				struct TessellationFactors
				{
					float edge[3] : SV_TessFactor;
					float inside : SV_InsideTessFactor;
				};

				VertexControl vert ( appdata v )
				{
					VertexControl o;
					UNITY_SETUP_INSTANCE_ID(v);
					UNITY_TRANSFER_INSTANCE_ID(v, o);
					o.vertex = v.vertex;
					o.tangent = v.tangent;
					o.normal = v.normal;
					o.texcoord = v.texcoord;
					o.texcoord1 = v.texcoord1;
					o.texcoord2 = v.texcoord2;
					
					return o;
				}

				TessellationFactors TessellationFunction (InputPatch<VertexControl,3> v)
				{
					TessellationFactors o;
					float4 tf = 1;
					float tessValue = _TessValue; float tessMin = _TessMin; float tessMax = _TessMax;
					float edgeLength = _TessEdgeLength; float tessMaxDisp = _TessMaxDisp;
					#if defined(ASE_FIXED_TESSELLATION)
					tf = FixedTess( tessValue );
					#elif defined(ASE_DISTANCE_TESSELLATION)
					tf = DistanceBasedTess(v[0].vertex, v[1].vertex, v[2].vertex, tessValue, tessMin, tessMax, UNITY_MATRIX_M, _WorldSpaceCameraPos );
					#elif defined(ASE_LENGTH_TESSELLATION)
					tf = EdgeLengthBasedTess(v[0].vertex, v[1].vertex, v[2].vertex, edgeLength, UNITY_MATRIX_M, _WorldSpaceCameraPos, _ScreenParams );
					#elif defined(ASE_LENGTH_CULL_TESSELLATION)
					tf = EdgeLengthBasedTessCull(v[0].vertex, v[1].vertex, v[2].vertex, edgeLength, tessMaxDisp, UNITY_MATRIX_M, _WorldSpaceCameraPos, _ScreenParams, unity_CameraWorldClipPlanes );
					#endif
					o.edge[0] = tf.x; o.edge[1] = tf.y; o.edge[2] = tf.z; o.inside = tf.w;
					return o;
				}

				[domain("tri")]
				[partitioning("fractional_odd")]
				[outputtopology("triangle_cw")]
				[patchconstantfunc("TessellationFunction")]
				[outputcontrolpoints(3)]
				VertexControl HullFunction(InputPatch<VertexControl, 3> patch, uint id : SV_OutputControlPointID)
				{
				   return patch[id];
				}

				[domain("tri")]
				v2f DomainFunction(TessellationFactors factors, OutputPatch<VertexControl, 3> patch, float3 bary : SV_DomainLocation)
				{
					appdata o = (appdata) 0;
					o.vertex = patch[0].vertex * bary.x + patch[1].vertex * bary.y + patch[2].vertex * bary.z;
					o.tangent = patch[0].tangent * bary.x + patch[1].tangent * bary.y + patch[2].tangent * bary.z;
					o.normal = patch[0].normal * bary.x + patch[1].normal * bary.y + patch[2].normal * bary.z;
					o.texcoord = patch[0].texcoord * bary.x + patch[1].texcoord * bary.y + patch[2].texcoord * bary.z;
					o.texcoord1 = patch[0].texcoord1 * bary.x + patch[1].texcoord1 * bary.y + patch[2].texcoord1 * bary.z;
					o.texcoord2 = patch[0].texcoord2 * bary.x + patch[1].texcoord2 * bary.y + patch[2].texcoord2 * bary.z;
					
					#if defined(ASE_PHONG_TESSELLATION)
					float3 pp[3];
					for (int i = 0; i < 3; ++i)
						pp[i] = o.vertex.xyz - patch[i].normal * (dot(o.vertex.xyz, patch[i].normal) - dot(patch[i].vertex.xyz, patch[i].normal));
					float phongStrength = _TessPhongStrength;
					o.vertex.xyz = phongStrength * (pp[0]*bary.x + pp[1]*bary.y + pp[2]*bary.z) + (1.0f-phongStrength) * o.vertex.xyz;
					#endif
					UNITY_TRANSFER_INSTANCE_ID(patch[0], o);
					return VertexFunction(o);
				}
				#else
				v2f vert ( appdata v )
				{
					return VertexFunction( v );
				}
				#endif

				void frag (v2f IN 
					, out half4 outGBuffer0 : SV_Target0
					, out half4 outGBuffer1 : SV_Target1
					, out half4 outGBuffer2 : SV_Target2
					, out half4 outEmission : SV_Target3
					#if defined(SHADOWS_SHADOWMASK) && (UNITY_ALLOWED_MRT_COUNT > 4)
					, out half4 outShadowMask : SV_Target4
					#endif
					#if defined( ASE_DEPTH_WRITE_ON )
					, out float outputDepth : SV_Depth
					#endif
				)
				{
					UNITY_SETUP_INSTANCE_ID(IN);

					#ifdef LOD_FADE_CROSSFADE
						UNITY_APPLY_DITHER_CROSSFADE(IN.pos.xy);
					#endif

					#if defined(ASE_LIGHTING_SIMPLE)
						SurfaceOutput o = (SurfaceOutput)0;
					#else
						#if defined(_SPECULAR_SETUP)
							SurfaceOutputStandardSpecular o = (SurfaceOutputStandardSpecular)0;
						#else
							SurfaceOutputStandard o = (SurfaceOutputStandard)0;
						#endif
					#endif

					float3 PositionWS = IN.worldPos.xyz;
					half3 ViewDirWS = normalize( UnityWorldSpaceViewDir( PositionWS ) );
					float4 ScreenPosNorm = float4( IN.pos.xy * ( _ScreenParams.zw - 1.0 ), IN.pos.zw );
					float4 ClipPos = ComputeClipSpacePosition( ScreenPosNorm.xy, IN.pos.z ) * IN.pos.w;
					float4 ScreenPos = ComputeScreenPos( ClipPos );
					half3 NormalWS = IN.normalWS;
					half3 TangentWS = IN.tangentWS.xyz;
					half3 BitangentWS = cross( IN.normalWS, IN.tangentWS.xyz ) * IN.tangentWS.w * unity_WorldTransformParams.w;

					#if defined(ENABLE_TERRAIN_PERPIXEL_NORMAL)
						float2 sampleCoords = (IN.tangentWS.zw / _TerrainHeightmapRecipSize.zw + 0.5f) * _TerrainHeightmapRecipSize.xy;
						NormalWS = UnityObjectToWorldNormal(normalize(tex2D(_TerrainNormalmapTexture, sampleCoords).rgb * 2 - 1));
						TangentWS = -cross(unity_ObjectToWorld._13_23_33, NormalWS);
						BitangentWS = cross(NormalWS, -TangentWS);
					#endif

					float2 texCoord43 = IN.ase_texcoord4.xy * float2( 1,1 ) + float2( 0,0 );
					float2 texCoord117 = IN.ase_texcoord4.xy * float2( 1,1 ) + float2( 0,0 );
					float2 texCoord69 = IN.ase_texcoord4.xy * float2( 1,1 ) + float2( 0,0 );
					float4 tex2DNode70 = tex2D( _CARD_FRONT_BORDER, texCoord69 );
					float4 lerpResult77 = lerp( tex2D( _MainTex, texCoord117 ) , tex2DNode70 , tex2DNode70.a);
					float2 texCoord118 = IN.ase_texcoord4.zw * float2( 1,1 ) + float2( 0,0 );
					float4 tex2DNode41 = tex2D( _CARD_FRONT_MASK, texCoord118 );
					float4 lerpResult109 = lerp( tex2D( _CARD_BACK, texCoord43 ) , lerpResult77 , tex2DNode41);
					float4 tex2DNode140 = tex2D( _LayerFoil, texCoord69 );
					float4 layerFoil145 = tex2DNode140;
					float4 tex2DNode141 = tex2D( _BackFoil, texCoord43 );
					float4 backFoil145 = tex2DNode141;
					float frontMask145 = tex2DNode41.r;
					float localCardLayerGlow145 = CardLayerGlow145( layerFoil145 , backFoil145 , frontMask145 );
					float lerpResult112 = lerp( _ArtGlow , _BorderGlow , localCardLayerGlow145);
					float4 albedo131 = ( lerpResult109 * ( 1.0 - lerpResult112 ) );
					float frontMask130 = tex2DNode41.r;
					float4 baseFoil144 = tex2D( _FoilMask, texCoord117 );
					float4 layerFoil144 = tex2DNode140;
					float layers144 = tex2DNode70.a;
					float4 backFoil144 = tex2DNode141;
					float frontMask144 = tex2DNode41.r;
					float4 localCardLayerFoil144 = CardLayerFoil144( baseFoil144 , layerFoil144 , layers144 , backFoil144 , frontMask144 );
					float4 foilMask130 = localCardLayerFoil144;
					float border130 = tex2DNode70.a;
					float strength130 = _FoilStrength;
					float2 uv163 = texCoord117;
					float frontMask163 = tex2DNode41.r;
					sampler2D layerNormal163 = _LayerNormal;
					sampler2D backNormal163 = _BackNormal;
					float localCardFoilType163 = CardFoilType163( uv163 , frontMask163 , layerNormal163 , backNormal163 );
					float type130 = localCardFoilType163;
					float2 uv170 = texCoord117;
					float3 tanToWorld0 = float3( TangentWS.x, BitangentWS.x, NormalWS.x );
					float3 tanToWorld1 = float3( TangentWS.y, BitangentWS.y, NormalWS.y );
					float3 tanToWorld2 = float3( TangentWS.z, BitangentWS.z, NormalWS.z );
					float3 ase_viewVectorTS =  tanToWorld0 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - PositionWS : UNITY_MATRIX_V[ 2 ].xyz ).x + tanToWorld1 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - PositionWS : UNITY_MATRIX_V[ 2 ].xyz ).y  + tanToWorld2 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - PositionWS : UNITY_MATRIX_V[ 2 ].xyz ).z;
					float3 ase_viewDirTS = normalize( ase_viewVectorTS );
					float3 viewTS170 = ase_viewDirTS;
					float type170 = localCardFoilType163;
					float2 uv127 = texCoord117;
					sampler2D normalMap127 = _NormalMap;
					float strength127 = _NormalStrength;
					float frontMask127 = tex2DNode41.r;
					float border127 = tex2DNode70.a;
					sampler2D layerNormal127 = _LayerNormal;
					sampler2D backNormal127 = _BackNormal;
					float3 localCardNormal127 = CardNormal127( uv127 , normalMap127 , strength127 , frontMask127 , border127 , layerNormal127 , backNormal127 );
					float3 normalTS170 = localCardNormal127;
					float4 localCardFoilPattern170 = CardFoilPattern170( uv170 , viewTS170 , type170 , normalTS170 );
					float4 pattern130 = localCardFoilPattern170;
					float2 uv130 = texCoord117;
					float3 viewTS130 = ase_viewDirTS;
					float tiltShift130 = _FoilShift;
					float localCardFoilMetal130 = CardFoilMetal130( frontMask130 , foilMask130 , border130 , strength130 , type130 , pattern130 , uv130 , viewTS130 , tiltShift130 );
					float metal131 = localCardFoilMetal130;
					float2 uv131 = texCoord117;
					float3 viewTS131 = ase_viewDirTS;
					float scale131 = _FoilScale;
					float tiltShift131 = _FoilShift;
					float type131 = localCardFoilType163;
					float4 pattern131 = localCardFoilPattern170;
					float3 localCardFoilAlbedo131 = CardFoilAlbedo131( albedo131 , metal131 , uv131 , viewTS131 , scale131 , tiltShift131 , type131 , pattern131 );
					
					float4 surface154 = localCardLayerFoil144;
					float foilMetal154 = localCardFoilMetal130;
					float localCardMetallic154 = CardMetallic154( surface154 , foilMetal154 );
					
					float4 surface132 = localCardLayerFoil144;
					float roughness132 = _Roughness;
					float foilMetal132 = localCardFoilMetal130;
					float localCardSmoothness132 = CardSmoothness132( surface132 , roughness132 , foilMetal132 );
					
					float2 uv120 = texCoord117;
					float3 viewTS120 = ase_viewDirTS;
					float frontMask120 = tex2DNode41.r;
					float4 foilMask120 = localCardLayerFoil144;
					float border120 = tex2DNode70.a;
					float4 baseColor120 = lerpResult109;
					float strength120 = _FoilStrength;
					float scale120 = _FoilScale;
					float tiltShift120 = _FoilShift;
					float type120 = localCardFoilType163;
					float4 pattern120 = localCardFoilPattern170;
					float3 localCardFoil120 = CardFoil120( uv120 , viewTS120 , frontMask120 , foilMask120 , border120 , baseColor120 , strength120 , scale120 , tiltShift120 , type120 , pattern120 );
					float3 emission152 = ( ( lerpResult109 * lerpResult112 ) + float4( localCardFoil120 , 0.0 ) ).rgb;
					float world152 = _DaCardWorld;
					float worldGlow152 = _WorldGlow;
					float3 localCardWorldEmission152 = CardWorldEmission152( emission152 , world152 , worldGlow152 );
					

					o.Albedo = localCardFoilAlbedo131;
					o.Normal = localCardNormal127;

					half3 Specular = half3( 0, 0, 0 );
					half Metallic = localCardMetallic154;
					half Smoothness = localCardSmoothness132;
					half Occlusion = 1;

					#if defined(ASE_LIGHTING_SIMPLE)
						o.Specular = Specular.x;
						o.Gloss = Smoothness;
					#else
						#if defined(_SPECULAR_SETUP)
							o.Specular = Specular;
						#else
							o.Metallic = Metallic;
						#endif
						o.Occlusion = Occlusion;
						o.Smoothness = Smoothness;
					#endif

					o.Emission = localCardWorldEmission152;
					o.Alpha = 1;
					half AlphaClipThreshold = 0.5;
					half3 BakedGI = 0;

					#if defined( ASE_DEPTH_WRITE_ON )
						IN.pos.z = IN.pos.z;
					#endif

					#if ( ASE_FRAGMENT_NORMAL == 0 )
						o.Normal = normalize( o.Normal.x * TangentWS + o.Normal.y * BitangentWS + o.Normal.z * NormalWS );
					#elif ( ASE_FRAGMENT_NORMAL == 1 )
						o.Normal = UnityObjectToWorldNormal( o.Normal );
					#elif ( ASE_FRAGMENT_NORMAL == 2 )
						// @diogo: already in world-space; do nothing
					#endif

					#ifdef _ALPHATEST_ON
						clip( o.Alpha - AlphaClipThreshold );
					#endif

					#if defined( ASE_DEPTH_WRITE_ON )
						outputDepth = IN.pos.z;
					#endif

					#ifndef USING_DIRECTIONAL_LIGHT
						half3 lightDir = normalize( UnityWorldSpaceLightDir( PositionWS ) );
					#else
						half3 lightDir = _WorldSpaceLightPos0.xyz;
					#endif

					UnityGI gi;
					UNITY_INITIALIZE_OUTPUT(UnityGI, gi);
					gi.indirect.diffuse = 0;
					gi.indirect.specular = 0;
					gi.light.color = 0;
					gi.light.dir = half3( 0, 1, 0 );

					UnityGIInput giInput;
					UNITY_INITIALIZE_OUTPUT(UnityGIInput, giInput);
					giInput.light = gi.light;
					giInput.worldPos = PositionWS;
					giInput.worldViewDir = ViewDirWS;
					giInput.atten = 1;
					#if defined(LIGHTMAP_ON) || defined(DYNAMICLIGHTMAP_ON)
						giInput.lightmapUV = IN.ambientOrLightmapUV;
					#else
						giInput.lightmapUV = 0.0;
					#endif
					#if UNITY_SHOULD_SAMPLE_SH && !UNITY_SAMPLE_FULL_SH_PER_PIXEL
						giInput.ambient = IN.ambientOrLightmapUV.rgb;
					#else
						giInput.ambient.rgb = 0.0;
					#endif
					giInput.probeHDR[0] = unity_SpecCube0_HDR;
					giInput.probeHDR[1] = unity_SpecCube1_HDR;
					#if defined(UNITY_SPECCUBE_BLENDING) || defined(UNITY_SPECCUBE_BOX_PROJECTION)
						giInput.boxMin[0] = unity_SpecCube0_BoxMin;
					#endif
					#ifdef UNITY_SPECCUBE_BOX_PROJECTION
						giInput.boxMax[0] = unity_SpecCube0_BoxMax;
						giInput.probePosition[0] = unity_SpecCube0_ProbePosition;
						giInput.boxMax[1] = unity_SpecCube1_BoxMax;
						giInput.boxMin[1] = unity_SpecCube1_BoxMin;
						giInput.probePosition[1] = unity_SpecCube1_ProbePosition;
					#endif

					#if defined(ASE_LIGHTING_SIMPLE)
						#if defined(_SPECULAR_SETUP)
							LightingBlinnPhong_GI(o, giInput, gi);
						#else
							LightingLambert_GI(o, giInput, gi);
						#endif
					#else
						#if defined(_SPECULAR_SETUP)
							LightingStandardSpecular_GI(o, giInput, gi);
						#else
							LightingStandard_GI(o, giInput, gi);
						#endif
					#endif

					#ifdef ASE_BAKEDGI
						gi.indirect.diffuse = BakedGI;
					#endif

					#if UNITY_SHOULD_SAMPLE_SH && !defined(LIGHTMAP_ON) && defined(ASE_NO_AMBIENT)
						gi.indirect.diffuse = 0;
					#endif

					#if defined(ASE_LIGHTING_SIMPLE)
						#if defined(_SPECULAR_SETUP)
							outEmission = LightingBlinnPhong_Deferred( o, ViewDirWS, gi, outGBuffer0, outGBuffer1, outGBuffer2 );
						#else
							outEmission = LightingLambert_Deferred( o, gi, outGBuffer0, outGBuffer1, outGBuffer2 );
						#endif
					#else
						#if defined(_SPECULAR_SETUP)
							outEmission = LightingStandardSpecular_Deferred( o, ViewDirWS, gi, outGBuffer0, outGBuffer1, outGBuffer2 );
						#else
							outEmission = LightingStandard_Deferred( o, ViewDirWS, gi, outGBuffer0, outGBuffer1, outGBuffer2 );
						#endif
					#endif

					#if defined(SHADOWS_SHADOWMASK) && (UNITY_ALLOWED_MRT_COUNT > 4)
						outShadowMask = UnityGetRawBakedOcclusions( IN.ambientOrLightmapUV.xy, float3( 0, 0, 0 ) );
					#endif
					#ifndef UNITY_HDR_ON
						outEmission.rgb = exp2(-outEmission.rgb);
					#endif
				}
			ENDCG
		}

		
		Pass
		{
			
			Name "Meta"
			Tags { "LightMode"="Meta" }
			Cull Off

			CGPROGRAM
				#define ASE_GEOMETRY
				#define ASE_FRAGMENT_NORMAL 0
				#define ASE_RECEIVE_SHADOWS
				#pragma multi_compile_instancing
				#pragma multi_compile _ LOD_FADE_CROSSFADE
				#define ASE_FOG
				#define ASE_VERSION 19909

				#pragma vertex vert
				#pragma fragment frag
				#pragma skip_variants FOG_LINEAR FOG_EXP FOG_EXP2
				#pragma shader_feature EDITOR_VISUALIZATION
				#ifndef UNITY_PASS_META
					#define UNITY_PASS_META
				#endif
				#include "HLSLSupport.cginc"
				#if defined( ASE_GEOMETRY ) || defined( ASE_IMPOSTOR )
					#ifndef UNITY_INSTANCED_LOD_FADE
						#define UNITY_INSTANCED_LOD_FADE
					#endif
					#ifndef UNITY_INSTANCED_SH
						#define UNITY_INSTANCED_SH
					#endif
					#ifndef UNITY_INSTANCED_LIGHTMAPSTS
						#define UNITY_INSTANCED_LIGHTMAPSTS
					#endif
				#endif
				#include "UnityShaderVariables.cginc"
				#include "UnityCG.cginc"
				#include "Lighting.cginc"
				#include "UnityPBSLighting.cginc"
				#include "UnityMetaPass.cginc"

				#define ASE_NEEDS_TEXTURE_COORDINATES0
				#define ASE_NEEDS_FRAG_TEXTURE_COORDINATES0
				#define ASE_NEEDS_TEXTURE_COORDINATES1
				#define ASE_NEEDS_VERT_TANGENT
				#define ASE_NEEDS_VERT_NORMAL


				struct appdata
				{
					float4 vertex : POSITION;
					half3 normal : NORMAL;
					half4 tangent : TANGENT;
					float4 texcoord : TEXCOORD0;
					float4 texcoord1 : TEXCOORD1;
					float4 texcoord2 : TEXCOORD2;
					
					UNITY_VERTEX_INPUT_INSTANCE_ID
				};

				struct v2f
				{
					float4 pos : SV_POSITION;
					#ifdef EDITOR_VISUALIZATION
						float2 vizUV : TEXCOORD0;
						float4 lightCoord : TEXCOORD1;
					#endif
					float4 ase_texcoord2 : TEXCOORD2;
					float4 ase_texcoord3 : TEXCOORD3;
					float4 ase_texcoord4 : TEXCOORD4;
					float4 ase_texcoord5 : TEXCOORD5;
					float4 ase_texcoord6 : TEXCOORD6;
					UNITY_VERTEX_INPUT_INSTANCE_ID
					UNITY_VERTEX_OUTPUT_STEREO
				};

				#ifdef ASE_TESSELLATION
					float _TessPhongStrength;
					float _TessValue;
					float _TessMin;
					float _TessMax;
					float _TessEdgeLength;
					float _TessMaxDisp;
				#endif

				uniform sampler2D _CARD_BACK;
				uniform sampler2D _MainTex;
				uniform sampler2D _CARD_FRONT_BORDER;
				uniform sampler2D _CARD_FRONT_MASK;
				uniform float _ArtGlow;
				uniform float _BorderGlow;
				uniform sampler2D _LayerFoil;
				uniform sampler2D _BackFoil;
				uniform sampler2D _FoilMask;
				uniform float _FoilStrength;
				uniform sampler2D _LayerNormal;
				uniform sampler2D _BackNormal;
				uniform sampler2D _NormalMap;
				uniform float _NormalStrength;
				uniform float _FoilShift;
				uniform float _FoilScale;
				uniform float _DaCardWorld;
				uniform float _WorldGlow;


				float CardLayerGlow145( float4 layerFoil, float4 backFoil, float frontMask )
				{
					// Which glow: 0 = the art's (Art Glow), 1 = a frame's (Border Glow). Collection layers count as frame: the client stacks
					// that into the G channel of _LayerFoil / _BackFoil.
					return lerp( backFoil.g, layerFoil.g, saturate( frontMask ) );
				}
				
				float4 CardLayerFoil144( float4 baseFoil, float4 layerFoil, float layers, float4 backFoil, float frontMask )
				{
					float front = lerp( baseFoil.r * baseFoil.a, layerFoil.r, layers );
					float k = saturate( frontMask );
					float4 surface = lerp( backFoil, layerFoil, k );
					return float4( lerp( backFoil.r, front, k ), surface.b, surface.a, lerp( 1.0, layers, k ) );
				}
				
				float CardFoilType163( float2 uv, float frontMask, sampler2D layerNormal, sampler2D backNormal )
				{
					float2 size = float2( 735.0, 1026.0 );
					float4 uvc = float4( ( clamp( floor( uv * size ), 0.0, size - 1.0 ) + 0.5 ) / size, 0.0, 0.0 );
					float a = frontMask > 0.5 ? tex2Dlod( layerNormal, uvc ).a : tex2Dlod( backNormal, uvc ).a;
					return round( a * 255.0 );
				}
				
				float3 CardNormal127( float2 uv, sampler2D normalMap, float strength, float frontMask, float border, sampler2D layerNormal, sampler2D backNormal )
				{
					// Bump detail, tangent space (OpenGL / Unity convention: green = up), so the card catches the game's lights. Front: the
					// card layers' normals (_LayerNormal, stacked by the client) over card.normal.png where no layer covers it (border = the
					// layers' coverage). Back: the back layers' (_BackNormal). Default textures "bump" = flat.
					float3 base = tex2D( normalMap, uv ).xyz * 2.0 - 1.0;
					float3 layer = tex2D( layerNormal, uv ).xyz * 2.0 - 1.0;
					float3 back = tex2D( backNormal, uv ).xyz * 2.0 - 1.0;
					float3 n = lerp( back, lerp( base, layer, border ), saturate( frontMask ) );
					n.xy *= strength;
					return normalize( n );
				}
				
				float4 CardFoilPattern170( float2 uv, float3 viewTS, float type, float3 normalTS )
				{
					#define DC_HASH(c) frac((frac((c).x * 123.34) + dot(frac((c) * float2(123.34, 456.21)), frac((c) * float2(123.34, 456.21)) + 45.32)) * (frac((c).y * 456.21) + dot(frac((c) * float2(123.34, 456.21)), frac((c) * float2(123.34, 456.21)) + 45.32)))
					#define DC_BUMP(x, c, o, y) saturate(1.0 - ((c) * ((x) - (o))) * ((c) * ((x) - (o))) - (y))
					#define DC_SPEC(t) (DC_BUMP(frac(t), float3(3.54585104, 2.93225262, 2.41593945), float3(0.69549072, 0.49228336, 0.27699880), float3(0.02312639, 0.15225084, 0.52607955)) + DC_BUMP(frac(t), float3(3.90307140, 3.21182957, 3.96587128), float3(0.11748627, 0.86755042, 0.66077860), float3(0.84897130, 0.88445281, 0.73949448)))
					#define DC_COUNT(s, m, k) ((m) + ((s) - (m)) * rsqrt(max((k), 1.0)))
					float3 nb = normalize(normalTS);
					float3 v = normalize(viewTS);
					float3 p = float3(uv.x - 0.5, (uv.y - 0.5) * 1.397, 0.0);
					float3 up = normalize(float3(0.0, 1.0, 0.0) - v * v.y);
					float3 eye = v * 2.0;
					float3 V = normalize(eye - p);
					float3 L = normalize(eye + (up * 0.7 + cross(up, v) * 0.35) * 2.0 - p);
					float2 h = (L - nb * dot(L, nb)).xy + (V - nb * dot(V, nb)).xy;
					float2 nh = normalize(h + 1e-5);
					float vn = dot(v, nb);
					float2 tilt = (v - nb * vn).xy / max(vn, 0.25);
					float lit = 0.55 + 0.75 * pow(saturate(dot(nb, normalize(L + V))), 12.0);
					float fw = max(fwidth(uv.x), 1e-6);
					float2 dir = float2(0.866, 0.5);
					float gate = 1.0;
					float sheen = 0.0;
					float3 col = 0.0;
					float glint = 0.0;
					bool grating = type > 0.5 && type < 11.5;
					if (type > 10.5)
					{
					    float2 q = uv * float2(9.0, 12.573);
					    float2 b = floor(q);
					    float d1 = 8.0;
					    float2 id = b;
					    [unroll] for (int j = -1; j <= 1; j++)
					    [unroll] for (int i = -1; i <= 1; i++)
					    {
					        float2 nc = b + float2(i, j);
					        float2 o = nc + 0.1 + 0.8 * float2(DC_HASH(nc + float2(0.0, 3.3)), DC_HASH(nc + float2(5.7, 0.0)));
					        float d = length(q - o);
					        if (d < d1) { d1 = d; id = nc; }
					    }
					    float turn = DC_HASH(id + float2(1.7, 9.2)) * 6.2831853;
					    dir = float2(cos(turn), sin(turn));
					    gate = 0.45 + 0.55 * DC_HASH(id + float2(6.6, 2.2));
					    sheen = 0.25;
					}
					else if (type > 9.5)
					{
					    grating = false;
					    float2 cn = uv * float2(7.0, 9.779);
					    float2 ci = floor(cn);
					    float2 cf = frac(cn);
					    cf = cf * cf * (3.0 - 2.0 * cf);
					    float dens = lerp(lerp(DC_HASH(ci), DC_HASH(ci + float2(1.0, 0.0)), cf.x), lerp(DC_HASH(ci + float2(0.0, 1.0)), DC_HASH(ci + float2(1.0, 1.0)), cf.x), cf.y);
					    dens = 0.45 + 0.3 * dens;
					    float2 pp = float2(uv.x, uv.y * 1.397);
					    [unroll] for (int k = 0; k < 3; k++)
					    {
					        float s = k == 0 ? 113.0 : (k == 1 ? 139.0 : 167.0);
					        float an = k == 0 ? 0.31 : (k == 1 ? 1.13 : 2.07);
					        float2 q = float2(cos(an) * pp.x - sin(an) * pp.y, sin(an) * pp.x + cos(an) * pp.y) * s + float2(0.37, 0.61) * k;
					        float2 c = floor(q) + float2(41.3, 27.1) * k;
					        float rad = 0.0026 * s * (0.85 + 0.3 * DC_HASH(c + float2(7.7, 3.3)));
					        float2 o = (float2(DC_HASH(c + float2(1.3, 0.0)), DC_HASH(c + float2(0.0, 2.9))) - 0.5) * (1.0 - 2.0 * rad);
					        float d = length(frac(q) - 0.5 - o);
					        float turn = DC_HASH(c + float2(4.1, 2.3)) * 6.2831853;
					        float tw = pow(saturate(dot(float2(cos(turn), sin(turn)), nh)), 3.0);
					        float dotMask = saturate((rad - d) / max(fw * s * 1.5, 0.05) + 0.5) * step(1.0 - dens, DC_HASH(c));
					        float3 tint = DC_SPEC(uv.x * 0.35 + uv.y * 0.75 + dot(tilt, float2(0.6, 0.5)) + DC_HASH(c + float2(8.8, 0.0)) * 0.15);
					        float kk = fw * s * fw * s;
					        float mn = dens * 3.14159 * rad * rad * 0.6;
					        col += tint * DC_COUNT(dotMask * (0.45 + 1.1 * tw), mn, kk) * 1.7;
					        glint += DC_COUNT(dotMask * tw * tw * tw, mn * 0.1, kk) * 0.45;
					    }
					}
					else if (type > 8.5)
					{
					    grating = false;
					    float ph = length(p.xy - float2(-0.45, 1.0)) * 2.4 - dot(tilt, float2(0.8, 0.6)) * 0.9;
					    col = DC_SPEC(ph) * (0.6 + 0.4 * cos(6.2831853 * ph * 0.5)) * 1.6;
					    glint = pow(saturate(1.0 - abs(frac(ph * 0.5) - 0.5) * 8.0), 3.0) * 0.5;
					}
					else if (type > 7.5)
					{
					    grating = false;
					    float ph = dot(p.xy, float2(0.8, 0.6)) * 1.4 + dot(tilt, float2(1.1, 0.8)) * 1.6;
					    float band = pow(0.5 + 0.5 * cos(6.2831853 * ph), 3.0);
					    float band2 = pow(0.5 + 0.5 * cos(6.2831853 * (ph * 2.7 + 0.3)), 10.0) * 0.6;
					    col = DC_SPEC(ph * 0.8 + p.y * 0.25) * (band + band2) * 2.0;
					    glint = pow(band, 6.0) * 0.5;
					}
					else if (type > 6.5)
					{
					    float2 q = uv * float2(8.0, 11.176);
					    float2 fa = frac(q) - 0.5;
					    float2 fb = frac(q + 0.5) - 0.5;
					    float2 f = length(fb) < 0.5 ? fb : fa;
					    float d = length(f);
					    float rings = 0.5 + 0.5 * cos(d * 6.2831853 * 9.0);
					    dir = f / max(d, 1e-4);
					    gate = 0.45 + 0.55 * rings;
					    sheen = 0.35;
					}
					else if (type > 4.5)
					{
					    float cells = type > 5.5 ? 12.0 : 10.0;
					    float2 q = uv * float2(cells, cells * 1.397);
					    float2 c = floor(q);
					    float2 f = frac(q) - 0.5;
					    if (type < 5.5)
					    {
					        float sec = floor(frac(atan2(f.y, f.x) / 6.2831853 + DC_HASH(c)) * 7.0);
					        float turn = DC_HASH(c + sec * float2(3.7, 1.9)) * 6.2831853;
					        dir = float2(cos(turn), sin(turn));
					        gate = 0.55 + 0.45 * DC_HASH(c + sec * float2(5.3, 0.0) + float2(1.1, 2.2));
					        sheen = 0.25;
					    }
					    else
					    {
					        dir = normalize(f + 1e-5);
					        gate = 0.65 + 0.35 * saturate(max(abs(f.x), abs(f.y)) * 2.5);
					    }
					}
					else if (type > 3.5)
					{
					    grating = false;
					    [unroll] for (int k = 0; k < 3; k++)
					    {
					        float s = k == 0 ? 6.0 : (k == 1 ? 20.0 : 64.0);
					        float prob = k == 0 ? 0.35 : (k == 1 ? 0.55 : 0.7);
					        float r0 = k == 0 ? 0.18 : (k == 1 ? 0.14 : 0.16);
					        float r1 = k == 0 ? 0.4 : (k == 1 ? 0.34 : 0.36);
					        float br = k == 0 ? 2.8 : (k == 1 ? 2.5 : 2.4);
					        float2 q = uv * float2(s, s * 1.397);
					        float2 c = floor(q) + float2(31.7, 17.9) * k;
					        float2 f = frac(q) - 0.5;
					        float r = lerp(r0, r1, DC_HASH(c + float2(3.1, 7.7)));
					        float2 o = (float2(DC_HASH(c + float2(11.3, 0.0)), DC_HASH(c + float2(0.0, 5.9))) - 0.5) * (1.0 - 2.0 * r);
					        float d = length(f - o);
					        float disc = saturate((r - d) / max(fw * s * 1.5, 0.02) + 0.5 * saturate(fw * s * 1.5 / r - 1.0)) * step(1.0 - prob, DC_HASH(c));
					        float3 dotCol = DC_SPEC(DC_HASH(c + float2(2.7, 1.3)) + uv.y * 0.6 + dot(tilt, float2(0.6, 0.45))) * (0.7 + 0.3 * cos(d / max(r, 1e-3) * 4.0 + dot(tilt, float2(2.0, 1.5))));
					        float kk = fw * s * fw * s;
					        float mn = prob * 3.14159 * (r0 + r1) * (r0 + r1) * 0.25 * 0.35;
					        col += DC_COUNT(dotCol * disc, mn, kk) * br;
					        if (k == 2)
					            glint = DC_COUNT(disc * step(0.7, DC_HASH(c + float2(9.1, 4.4))), mn * 0.3, kk) * 0.5;
					    }
					    [unroll] for (int m = 0; m < 2; m++)
					    {
					        float2 sd = p.xy - (m == 0 ? float2(0.25, 0.55) : float2(-0.3, -0.2));
					        float sr = length(sd) + 1e-4;
					        float swirl = pow(saturate(sin(atan2(sd.y, sd.x) * 2.0 - log(sr) * 7.0 + tilt.x + tilt.y)), 8.0) * saturate(1.0 - sr * 5.0);
					        col += DC_SPEC(sr * 3.0 + dot(tilt, float2(0.5, 0.5))) * swirl * (m == 0 ? 0.6 : 0.5);
					    }
					}
					else if (type > 2.5)
					{
					    float2 cell = floor(uv * float2(60.0, 83.8));
					    float2 q = frac(cell * float2(123.34, 456.21));
					    q += dot(q, q + 45.32);
					    float turn = frac(q.x * q.y) * 6.2831853;
					    q = frac((cell + 17.13) * float2(123.34, 456.21));
					    q += dot(q, q + 45.32);
					    gate = DC_COUNT(step(0.4, frac(q.x * q.y)), 0.6, fw * 60.0 * fw * 60.0);
					    dir = float2(cos(turn), sin(turn));
					    sheen = 0.2;
					}
					else if (type > 1.5)
					    dir = normalize(p.xy + 1e-5);
					if (grating)
					{
					    float g = abs(dot(h, dir));
					    float3 diff = 0.0;
					    [unroll] for (int n = 1; n <= 8; n++)
					    {
					        float w = g * 1600.0 / n;
					        float x = saturate((w - 400.0) / 300.0);
					        float3 a = float3(3.54585104, 2.93225262, 2.41593945) * (x - float3(0.69549072, 0.49228336, 0.27699880));
					        float3 b = float3(3.90307140, 3.21182957, 3.96587128) * (x - float3(0.11748627, 0.86755042, 0.66077860));
					        diff += (w >= 400.0 && w <= 700.0) ? saturate(1.0 - a * a - float3(0.02312639, 0.15225084, 0.52607955)) + saturate(1.0 - b * b - float3(0.84897130, 0.88445281, 0.73949448)) : 0.0;
					    }
					    col = saturate(diff) * gate + sheen * gate * pow(saturate(dot(dir, nh) * 0.5 + 0.5), 16.0);
					    glint = pow(saturate(1.0 - g * 4.0), 4.0) * gate;
					}
					return float4(col, glint) * lit;
				}
				
				float CardFoilMetal130( float frontMask, float4 foilMask, float border, float strength, float type, float4 pattern, float2 uv, float3 viewTS, float tiltShift )
				{
					float m = foilMask.r * saturate( strength * 1.5 );
					float3 v = normalize( viewTS );
					float2 tilt = v.xy / max( v.z, 0.25 );
					float sweep = dot( uv - 0.5, float2( 0.8, 0.6 ) ) + dot( tilt, float2( 0.45, 0.3 ) ) * tiltShift;
					float glint = pow( saturate( 1.0 - abs( sweep ) * 2.5 ), 4.0 );
					float lum = dot( pattern.rgb, float3( 0.299, 0.587, 0.114 ) ) + pattern.a;
					return m * ( type > 0.5 && type < 11.5 ? saturate( lum * 2.5 ) : 0.25 + 0.75 * glint );
				}
				
				float3 CardFoilAlbedo131( float4 albedo, float metal, float2 uv, float3 viewTS, float scale, float tiltShift, float type, float4 pattern )
				{
					// Albedo of the foil area. Where the card is metallic (metal, from CardFoilMetal) the albedo is the colour of its
					// reflections, so this gives the lights' highlights and the reflections the same foil pattern (type) as CardFoil.
					float3 v = normalize(viewTS);
					float3 holo = saturate(0.35 + pattern.rgb * 0.6 + albedo.rgb * 0.3);
					float2 tilt = v.xy / max(v.z, 0.25);
					float grain = sin(dot(uv, float2(173.1, 61.7))) * sin(dot(uv, float2(-47.3, 211.9)));
					float phase = dot(uv, float2(0.6, 1.0)) * scale + dot(tilt, float2(0.8, 0.5)) * tiltShift + grain * 0.06;
					float3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + float3(0.0, 0.333, 0.667)));
					float3 foil = saturate(rainbow * 0.85 + albedo.rgb * 0.35);
					return lerp(albedo.rgb, type > 0.5 && type < 11.5 ? holo : foil, metal);
				}
				
				float3 CardFoil120( float2 uv, float3 viewTS, float frontMask, float4 foilMask, float border, float4 baseColor, float strength, float scale, float tiltShift, float type, float4 pattern )
				{
					// Holographic foil on the card art, added on top of emission. type 0 (rainbow): rainbow bands that slide across the
					// card as it tilts, plus a brighter glint band sweeping diagonally. 1 to 11: the CardFoilPattern foils (pattern).
					// Only where frontMask is set (not the back), not under the frame (border = frame alpha), and inside
					// foilMask (card.foil.png: white/opaque = foil, black/transparent = plain print, default white = the whole art).
					float area = foilMask.r;   // CardLayerFoil: layers and picture, front and back
					float3 v = normalize(viewTS);
					float patternLuma = dot(baseColor.rgb, float3(0.299, 0.587, 0.114));
					float3 holo = (pattern.rgb * (0.3 + 0.7 * patternLuma) * (abs(type - 3.0) < 0.5 ? 1.4 : 1.0) + pattern.a * 0.25) * strength * area;
					float2 tilt = v.xy / max(v.z, 0.25);
					float grain = sin(dot(uv, float2(173.1, 61.7))) * sin(dot(uv, float2(-47.3, 211.9)));
					float phase = dot(uv, float2(0.6, 1.0)) * scale + dot(tilt, float2(0.8, 0.5)) * tiltShift + grain * 0.06;
					float3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + float3(0.0, 0.333, 0.667)));
					float sweep = dot(uv - 0.5, float2(0.8, 0.6)) + dot(tilt, float2(0.45, 0.3)) * tiltShift;
					float glint = pow(saturate(1.0 - abs(sweep) * 2.5), 4.0);
					float luma = dot(baseColor.rgb, float3(0.299, 0.587, 0.114));
					float3 foil = rainbow * (0.3 + 0.7 * luma) * (0.35 + 0.65 * glint) + glint * 0.25;
					return type > 0.5 && type < 11.5 ? holo : foil * strength * area;
				}
				
				float3 CardWorldEmission152( float3 emission, float world, float worldGlow )
				{
					// A card lying in the world (drawn by the game's main camera: the client sets the global _DaCardWorld then) is lit by the
					// raid: its own light (art glow, foil shine) drops to worldGlow, so it is dark in the dark. Inspect views and icons: 1.
					return emission * lerp( 1.0, worldGlow, saturate( world ) );
				}
				

				v2f VertexFunction( appdata v  )
				{
					UNITY_SETUP_INSTANCE_ID(v);
					v2f o;
					UNITY_INITIALIZE_OUTPUT(v2f,o);
					UNITY_TRANSFER_INSTANCE_ID(v,o);
					UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

					float3 ase_positionWS = mul( unity_ObjectToWorld, float4( ( v.vertex ).xyz, 1 ) ).xyz;
					o.ase_texcoord3.xyz = ase_positionWS;
					float3 ase_tangentWS = UnityObjectToWorldDir( v.tangent );
					o.ase_texcoord4.xyz = ase_tangentWS;
					float3 ase_normalWS = UnityObjectToWorldNormal( v.normal );
					o.ase_texcoord5.xyz = ase_normalWS;
					float ase_tangentSign = v.tangent.w * ( unity_WorldTransformParams.w >= 0.0 ? 1.0 : -1.0 );
					float3 ase_bitangentWS = cross( ase_normalWS, ase_tangentWS ) * ase_tangentSign;
					o.ase_texcoord6.xyz = ase_bitangentWS;
					
					o.ase_texcoord2.xy = v.texcoord.xyzw.xy;
					o.ase_texcoord2.zw = v.texcoord1.xyzw.xy;
					
					//setting value to unused interpolator channels and avoid initialization warnings
					o.ase_texcoord3.w = 0;
					o.ase_texcoord4.w = 0;
					o.ase_texcoord5.w = 0;
					o.ase_texcoord6.w = 0;

					#ifdef ASE_ABSOLUTE_VERTEX_POS
						float3 defaultVertexValue = v.vertex.xyz;
					#else
						float3 defaultVertexValue = float3(0, 0, 0);
					#endif
					float3 vertexValue = defaultVertexValue;
					#ifdef ASE_ABSOLUTE_VERTEX_POS
						v.vertex.xyz = vertexValue;
					#else
						v.vertex.xyz += vertexValue;
					#endif
					v.vertex.w = 1;
					v.normal = v.normal;
					v.tangent = v.tangent;

					#ifdef EDITOR_VISUALIZATION
						o.vizUV = 0;
						o.lightCoord = 0;
						if (unity_VisualizationMode == EDITORVIZ_TEXTURE)
							o.vizUV = UnityMetaVizUV(unity_EditorViz_UVIndex, v.texcoord.xy, v.texcoord1.xy, v.texcoord2.xy, unity_EditorViz_Texture_ST);
						else if (unity_VisualizationMode == EDITORVIZ_SHOWLIGHTMASK)
						{
							o.vizUV = v.texcoord1.xy * unity_LightmapST.xy + unity_LightmapST.zw;
							o.lightCoord = mul(unity_EditorViz_WorldToLight, mul(unity_ObjectToWorld, float4(v.vertex.xyz, 1)));
						}
					#endif

					o.pos = UnityMetaVertexPosition(v.vertex, v.texcoord1.xy, v.texcoord2.xy, unity_LightmapST, unity_DynamicLightmapST);
					return o;
				}

				#if defined(ASE_TESSELLATION)
				struct VertexControl
				{
					float4 vertex : INTERNALTESSPOS;
					float4 tangent : TANGENT;
					float3 normal : NORMAL;
					float4 texcoord : TEXCOORD0;
					float4 texcoord1 : TEXCOORD1;
					float4 texcoord2 : TEXCOORD2;
					
					UNITY_VERTEX_INPUT_INSTANCE_ID
				};

				struct TessellationFactors
				{
					float edge[3] : SV_TessFactor;
					float inside : SV_InsideTessFactor;
				};

				VertexControl vert ( appdata v )
				{
					VertexControl o;
					UNITY_SETUP_INSTANCE_ID(v);
					UNITY_TRANSFER_INSTANCE_ID(v, o);
					o.vertex = v.vertex;
					o.tangent = v.tangent;
					o.normal = v.normal;
					o.texcoord = v.texcoord;
					o.texcoord1 = v.texcoord1;
					o.texcoord2 = v.texcoord2;
					
					return o;
				}

				TessellationFactors TessellationFunction (InputPatch<VertexControl,3> v)
				{
					TessellationFactors o;
					float4 tf = 1;
					float tessValue = _TessValue; float tessMin = _TessMin; float tessMax = _TessMax;
					float edgeLength = _TessEdgeLength; float tessMaxDisp = _TessMaxDisp;
					#if defined(ASE_FIXED_TESSELLATION)
					tf = FixedTess( tessValue );
					#elif defined(ASE_DISTANCE_TESSELLATION)
					tf = DistanceBasedTess(v[0].vertex, v[1].vertex, v[2].vertex, tessValue, tessMin, tessMax, UNITY_MATRIX_M, _WorldSpaceCameraPos );
					#elif defined(ASE_LENGTH_TESSELLATION)
					tf = EdgeLengthBasedTess(v[0].vertex, v[1].vertex, v[2].vertex, edgeLength, UNITY_MATRIX_M, _WorldSpaceCameraPos, _ScreenParams );
					#elif defined(ASE_LENGTH_CULL_TESSELLATION)
					tf = EdgeLengthBasedTessCull(v[0].vertex, v[1].vertex, v[2].vertex, edgeLength, tessMaxDisp, UNITY_MATRIX_M, _WorldSpaceCameraPos, _ScreenParams, unity_CameraWorldClipPlanes );
					#endif
					o.edge[0] = tf.x; o.edge[1] = tf.y; o.edge[2] = tf.z; o.inside = tf.w;
					return o;
				}

				[domain("tri")]
				[partitioning("fractional_odd")]
				[outputtopology("triangle_cw")]
				[patchconstantfunc("TessellationFunction")]
				[outputcontrolpoints(3)]
				VertexControl HullFunction(InputPatch<VertexControl, 3> patch, uint id : SV_OutputControlPointID)
				{
				   return patch[id];
				}

				[domain("tri")]
				v2f DomainFunction(TessellationFactors factors, OutputPatch<VertexControl, 3> patch, float3 bary : SV_DomainLocation)
				{
					appdata o = (appdata) 0;
					o.vertex = patch[0].vertex * bary.x + patch[1].vertex * bary.y + patch[2].vertex * bary.z;
					o.tangent = patch[0].tangent * bary.x + patch[1].tangent * bary.y + patch[2].tangent * bary.z;
					o.normal = patch[0].normal * bary.x + patch[1].normal * bary.y + patch[2].normal * bary.z;
					o.texcoord = patch[0].texcoord * bary.x + patch[1].texcoord * bary.y + patch[2].texcoord * bary.z;
					o.texcoord1 = patch[0].texcoord1 * bary.x + patch[1].texcoord1 * bary.y + patch[2].texcoord1 * bary.z;
					o.texcoord2 = patch[0].texcoord2 * bary.x + patch[1].texcoord2 * bary.y + patch[2].texcoord2 * bary.z;
					
					#if defined(ASE_PHONG_TESSELLATION)
					float3 pp[3];
					for (int i = 0; i < 3; ++i)
						pp[i] = o.vertex.xyz - patch[i].normal * (dot(o.vertex.xyz, patch[i].normal) - dot(patch[i].vertex.xyz, patch[i].normal));
					float phongStrength = _TessPhongStrength;
					o.vertex.xyz = phongStrength * (pp[0]*bary.x + pp[1]*bary.y + pp[2]*bary.z) + (1.0f-phongStrength) * o.vertex.xyz;
					#endif
					UNITY_TRANSFER_INSTANCE_ID(patch[0], o);
					return VertexFunction(o);
				}
				#else
				v2f vert( appdata v )
				{
					return VertexFunction( v );
				}
				#endif

				half4 frag( v2f IN  ) : SV_Target
				{
					UNITY_SETUP_INSTANCE_ID(IN);

					#ifdef LOD_FADE_CROSSFADE
						UNITY_APPLY_DITHER_CROSSFADE(IN.pos.xy);
					#endif

					#if defined(ASE_LIGHTING_SIMPLE)
						SurfaceOutput o = (SurfaceOutput)0;
					#else
						#if defined(_SPECULAR_SETUP)
							SurfaceOutputStandardSpecular o = (SurfaceOutputStandardSpecular)0;
						#else
							SurfaceOutputStandard o = (SurfaceOutputStandard)0;
						#endif
					#endif

					float2 texCoord43 = IN.ase_texcoord2.xy * float2( 1,1 ) + float2( 0,0 );
					float2 texCoord117 = IN.ase_texcoord2.xy * float2( 1,1 ) + float2( 0,0 );
					float2 texCoord69 = IN.ase_texcoord2.xy * float2( 1,1 ) + float2( 0,0 );
					float4 tex2DNode70 = tex2D( _CARD_FRONT_BORDER, texCoord69 );
					float4 lerpResult77 = lerp( tex2D( _MainTex, texCoord117 ) , tex2DNode70 , tex2DNode70.a);
					float2 texCoord118 = IN.ase_texcoord2.zw * float2( 1,1 ) + float2( 0,0 );
					float4 tex2DNode41 = tex2D( _CARD_FRONT_MASK, texCoord118 );
					float4 lerpResult109 = lerp( tex2D( _CARD_BACK, texCoord43 ) , lerpResult77 , tex2DNode41);
					float4 tex2DNode140 = tex2D( _LayerFoil, texCoord69 );
					float4 layerFoil145 = tex2DNode140;
					float4 tex2DNode141 = tex2D( _BackFoil, texCoord43 );
					float4 backFoil145 = tex2DNode141;
					float frontMask145 = tex2DNode41.r;
					float localCardLayerGlow145 = CardLayerGlow145( layerFoil145 , backFoil145 , frontMask145 );
					float lerpResult112 = lerp( _ArtGlow , _BorderGlow , localCardLayerGlow145);
					float4 albedo131 = ( lerpResult109 * ( 1.0 - lerpResult112 ) );
					float frontMask130 = tex2DNode41.r;
					float4 baseFoil144 = tex2D( _FoilMask, texCoord117 );
					float4 layerFoil144 = tex2DNode140;
					float layers144 = tex2DNode70.a;
					float4 backFoil144 = tex2DNode141;
					float frontMask144 = tex2DNode41.r;
					float4 localCardLayerFoil144 = CardLayerFoil144( baseFoil144 , layerFoil144 , layers144 , backFoil144 , frontMask144 );
					float4 foilMask130 = localCardLayerFoil144;
					float border130 = tex2DNode70.a;
					float strength130 = _FoilStrength;
					float2 uv163 = texCoord117;
					float frontMask163 = tex2DNode41.r;
					sampler2D layerNormal163 = _LayerNormal;
					sampler2D backNormal163 = _BackNormal;
					float localCardFoilType163 = CardFoilType163( uv163 , frontMask163 , layerNormal163 , backNormal163 );
					float type130 = localCardFoilType163;
					float2 uv170 = texCoord117;
					float3 ase_positionWS = IN.ase_texcoord3.xyz;
					float3 ase_tangentWS = IN.ase_texcoord4.xyz;
					float3 ase_normalWS = IN.ase_texcoord5.xyz;
					float3 ase_bitangentWS = IN.ase_texcoord6.xyz;
					float3 tanToWorld0 = float3( ase_tangentWS.x, ase_bitangentWS.x, ase_normalWS.x );
					float3 tanToWorld1 = float3( ase_tangentWS.y, ase_bitangentWS.y, ase_normalWS.y );
					float3 tanToWorld2 = float3( ase_tangentWS.z, ase_bitangentWS.z, ase_normalWS.z );
					float3 ase_viewVectorTS =  tanToWorld0 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - ase_positionWS : UNITY_MATRIX_V[ 2 ].xyz ).x + tanToWorld1 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - ase_positionWS : UNITY_MATRIX_V[ 2 ].xyz ).y  + tanToWorld2 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - ase_positionWS : UNITY_MATRIX_V[ 2 ].xyz ).z;
					float3 ase_viewDirTS = normalize( ase_viewVectorTS );
					float3 viewTS170 = ase_viewDirTS;
					float type170 = localCardFoilType163;
					float2 uv127 = texCoord117;
					sampler2D normalMap127 = _NormalMap;
					float strength127 = _NormalStrength;
					float frontMask127 = tex2DNode41.r;
					float border127 = tex2DNode70.a;
					sampler2D layerNormal127 = _LayerNormal;
					sampler2D backNormal127 = _BackNormal;
					float3 localCardNormal127 = CardNormal127( uv127 , normalMap127 , strength127 , frontMask127 , border127 , layerNormal127 , backNormal127 );
					float3 normalTS170 = localCardNormal127;
					float4 localCardFoilPattern170 = CardFoilPattern170( uv170 , viewTS170 , type170 , normalTS170 );
					float4 pattern130 = localCardFoilPattern170;
					float2 uv130 = texCoord117;
					float3 viewTS130 = ase_viewDirTS;
					float tiltShift130 = _FoilShift;
					float localCardFoilMetal130 = CardFoilMetal130( frontMask130 , foilMask130 , border130 , strength130 , type130 , pattern130 , uv130 , viewTS130 , tiltShift130 );
					float metal131 = localCardFoilMetal130;
					float2 uv131 = texCoord117;
					float3 viewTS131 = ase_viewDirTS;
					float scale131 = _FoilScale;
					float tiltShift131 = _FoilShift;
					float type131 = localCardFoilType163;
					float4 pattern131 = localCardFoilPattern170;
					float3 localCardFoilAlbedo131 = CardFoilAlbedo131( albedo131 , metal131 , uv131 , viewTS131 , scale131 , tiltShift131 , type131 , pattern131 );
					
					float2 uv120 = texCoord117;
					float3 viewTS120 = ase_viewDirTS;
					float frontMask120 = tex2DNode41.r;
					float4 foilMask120 = localCardLayerFoil144;
					float border120 = tex2DNode70.a;
					float4 baseColor120 = lerpResult109;
					float strength120 = _FoilStrength;
					float scale120 = _FoilScale;
					float tiltShift120 = _FoilShift;
					float type120 = localCardFoilType163;
					float4 pattern120 = localCardFoilPattern170;
					float3 localCardFoil120 = CardFoil120( uv120 , viewTS120 , frontMask120 , foilMask120 , border120 , baseColor120 , strength120 , scale120 , tiltShift120 , type120 , pattern120 );
					float3 emission152 = ( ( lerpResult109 * lerpResult112 ) + float4( localCardFoil120 , 0.0 ) ).rgb;
					float world152 = _DaCardWorld;
					float worldGlow152 = _WorldGlow;
					float3 localCardWorldEmission152 = CardWorldEmission152( emission152 , world152 , worldGlow152 );
					

					o.Albedo = localCardFoilAlbedo131;
					o.Normal = half3( 0, 0, 1 );
					o.Emission = localCardWorldEmission152;
					o.Alpha = 1;
					half AlphaClipThreshold = 0.5;

					#ifdef _ALPHATEST_ON
						clip( o.Alpha - AlphaClipThreshold );
					#endif

					UnityMetaInput metaIN;
					UNITY_INITIALIZE_OUTPUT(UnityMetaInput, metaIN);
					metaIN.Albedo = o.Albedo;
					metaIN.Emission = o.Emission;
					#ifdef EDITOR_VISUALIZATION
						metaIN.VizUV = IN.vizUV;
						metaIN.LightCoord = IN.lightCoord;
					#endif
					return UnityMetaFragment(metaIN);
				}
				ENDCG
			}

			
			Pass
			{
				
				Name "ShadowCaster"
				Tags { "LightMode"="ShadowCaster" }
				ZWrite On
				ZTest LEqual
				AlphaToMask Off

				CGPROGRAM
				#define ASE_GEOMETRY
				#define ASE_FRAGMENT_NORMAL 0
				#define ASE_RECEIVE_SHADOWS
				#pragma multi_compile_instancing
				#pragma multi_compile _ LOD_FADE_CROSSFADE
				#define ASE_FOG
				#define ASE_VERSION 19909

				#pragma vertex vert
				#pragma fragment frag
				#pragma skip_variants FOG_LINEAR FOG_EXP FOG_EXP2
				#pragma multi_compile_shadowcaster
				#ifndef UNITY_PASS_SHADOWCASTER
					#define UNITY_PASS_SHADOWCASTER
				#endif
				#include "HLSLSupport.cginc"
				#if defined( ASE_GEOMETRY ) || defined( ASE_IMPOSTOR )
					#ifndef UNITY_INSTANCED_LOD_FADE
						#define UNITY_INSTANCED_LOD_FADE
					#endif
					#ifndef UNITY_INSTANCED_SH
						#define UNITY_INSTANCED_SH
					#endif
					#ifndef UNITY_INSTANCED_LIGHTMAPSTS
						#define UNITY_INSTANCED_LIGHTMAPSTS
					#endif
				#endif
				#include "UnityShaderVariables.cginc"
				#include "UnityCG.cginc"
				#include "Lighting.cginc"
				#include "UnityPBSLighting.cginc"

				

				struct appdata
				{
					float4 vertex : POSITION;
					half3 normal : NORMAL;
					half4 tangent : TANGENT;
					float4 texcoord1 : TEXCOORD1;
					float4 texcoord2 : TEXCOORD2;
					
					UNITY_VERTEX_INPUT_INSTANCE_ID
				};

				struct v2f
				{
					V2F_SHADOW_CASTER;
					
					UNITY_VERTEX_INPUT_INSTANCE_ID
					UNITY_VERTEX_OUTPUT_STEREO
				};

				#ifdef UNITY_STANDARD_USE_DITHER_MASK
					sampler3D _DitherMaskLOD;
				#endif
				#ifdef ASE_TESSELLATION
					float _TessPhongStrength;
					float _TessValue;
					float _TessMin;
					float _TessMax;
					float _TessEdgeLength;
					float _TessMaxDisp;
				#endif

				

				
				v2f VertexFunction( appdata v  )
				{
					UNITY_SETUP_INSTANCE_ID(v);
					v2f o;
					UNITY_INITIALIZE_OUTPUT(v2f,o);
					UNITY_TRANSFER_INSTANCE_ID(v,o);
					UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

					

					#ifdef ASE_ABSOLUTE_VERTEX_POS
						float3 defaultVertexValue = v.vertex.xyz;
					#else
						float3 defaultVertexValue = float3(0, 0, 0);
					#endif
					float3 vertexValue = defaultVertexValue;
					#ifdef ASE_ABSOLUTE_VERTEX_POS
						v.vertex.xyz = vertexValue;
					#else
						v.vertex.xyz += vertexValue;
					#endif
					v.vertex.w = 1;
					v.normal = v.normal;
					v.tangent = v.tangent;

				#if defined( ASE_IMPOSTOR )
					// Disable "Normal Bias" because we're rendering billboard impostors and there's no vertex normals.
					unity_LightShadowBias.z = 0;
				#endif

					TRANSFER_SHADOW_CASTER_NORMALOFFSET(o)
					return o;
				}

				#if defined(ASE_TESSELLATION)
				struct VertexControl
				{
					float4 vertex : INTERNALTESSPOS;
					half4 tangent : TANGENT;
					half3 normal : NORMAL;
					float4 texcoord1 : TEXCOORD1;
					float4 texcoord2 : TEXCOORD2;
					
					UNITY_VERTEX_INPUT_INSTANCE_ID
				};

				struct TessellationFactors
				{
					float edge[3] : SV_TessFactor;
					float inside : SV_InsideTessFactor;
				};

				VertexControl vert ( appdata v )
				{
					VertexControl o;
					UNITY_SETUP_INSTANCE_ID(v);
					UNITY_TRANSFER_INSTANCE_ID(v, o);
					o.vertex = v.vertex;
					o.tangent = v.tangent;
					o.normal = v.normal;
					o.texcoord1 = v.texcoord1;
					o.texcoord2 = v.texcoord2;
					
					return o;
				}

				TessellationFactors TessellationFunction (InputPatch<VertexControl,3> v)
				{
					TessellationFactors o;
					float4 tf = 1;
					float tessValue = _TessValue; float tessMin = _TessMin; float tessMax = _TessMax;
					float edgeLength = _TessEdgeLength; float tessMaxDisp = _TessMaxDisp;
					#if defined(ASE_FIXED_TESSELLATION)
					tf = FixedTess( tessValue );
					#elif defined(ASE_DISTANCE_TESSELLATION)
					tf = DistanceBasedTess(v[0].vertex, v[1].vertex, v[2].vertex, tessValue, tessMin, tessMax, UNITY_MATRIX_M, _WorldSpaceCameraPos );
					#elif defined(ASE_LENGTH_TESSELLATION)
					tf = EdgeLengthBasedTess(v[0].vertex, v[1].vertex, v[2].vertex, edgeLength, UNITY_MATRIX_M, _WorldSpaceCameraPos, _ScreenParams );
					#elif defined(ASE_LENGTH_CULL_TESSELLATION)
					tf = EdgeLengthBasedTessCull(v[0].vertex, v[1].vertex, v[2].vertex, edgeLength, tessMaxDisp, UNITY_MATRIX_M, _WorldSpaceCameraPos, _ScreenParams, unity_CameraWorldClipPlanes );
					#endif
					o.edge[0] = tf.x; o.edge[1] = tf.y; o.edge[2] = tf.z; o.inside = tf.w;
					return o;
				}

				[domain("tri")]
				[partitioning("fractional_odd")]
				[outputtopology("triangle_cw")]
				[patchconstantfunc("TessellationFunction")]
				[outputcontrolpoints(3)]
				VertexControl HullFunction(InputPatch<VertexControl, 3> patch, uint id : SV_OutputControlPointID)
				{
				   return patch[id];
				}

				[domain("tri")]
				v2f DomainFunction(TessellationFactors factors, OutputPatch<VertexControl, 3> patch, float3 bary : SV_DomainLocation)
				{
					appdata o = (appdata) 0;
					o.vertex = patch[0].vertex * bary.x + patch[1].vertex * bary.y + patch[2].vertex * bary.z;
					o.tangent = patch[0].tangent * bary.x + patch[1].tangent * bary.y + patch[2].tangent * bary.z;
					o.normal = patch[0].normal * bary.x + patch[1].normal * bary.y + patch[2].normal * bary.z;
					o.texcoord1 = patch[0].texcoord1 * bary.x + patch[1].texcoord1 * bary.y + patch[2].texcoord1 * bary.z;
					o.texcoord2 = patch[0].texcoord2 * bary.x + patch[1].texcoord2 * bary.y + patch[2].texcoord2 * bary.z;
					
					#if defined(ASE_PHONG_TESSELLATION)
					float3 pp[3];
					for (int i = 0; i < 3; ++i)
						pp[i] = o.vertex.xyz - patch[i].normal * (dot(o.vertex.xyz, patch[i].normal) - dot(patch[i].vertex.xyz, patch[i].normal));
					float phongStrength = _TessPhongStrength;
					o.vertex.xyz = phongStrength * (pp[0]*bary.x + pp[1]*bary.y + pp[2]*bary.z) + (1.0f-phongStrength) * o.vertex.xyz;
					#endif
					UNITY_TRANSFER_INSTANCE_ID(patch[0], o);
					return VertexFunction(o);
				}
				#else
				v2f vert( appdata v )
				{
					return VertexFunction( v );
				}
				#endif

				half4 frag( v2f IN 
							#if defined( ASE_DEPTH_WRITE_ON )
								, out float outputDepth : SV_Depth
							#endif
							) : SV_Target
				{
					UNITY_SETUP_INSTANCE_ID(IN);

					#ifdef LOD_FADE_CROSSFADE
						UNITY_APPLY_DITHER_CROSSFADE(IN.pos.xy);
					#endif

					#if defined(ASE_LIGHTING_SIMPLE)
						SurfaceOutput o = (SurfaceOutput)0;
					#else
						#if defined(_SPECULAR_SETUP)
							SurfaceOutputStandardSpecular o = (SurfaceOutputStandardSpecular)0;
						#else
							SurfaceOutputStandard o = (SurfaceOutputStandard)0;
						#endif
						o.Occlusion = 1;
					#endif

					

					o.Normal = half3( 0, 0, 1 );

					o.Alpha = 1;
					half AlphaClipThreshold = 0.5;
					half AlphaClipThresholdShadow = 0.5;

					#if defined( ASE_DEPTH_WRITE_ON )
						IN.pos.z = IN.pos.z;
					#endif

					#ifdef _ALPHATEST_SHADOW_ON
						if (unity_LightShadowBias.z != 0.0)
							clip(o.Alpha - AlphaClipThresholdShadow);
						#ifdef _ALPHATEST_ON
						else
							clip(o.Alpha - AlphaClipThreshold);
						#endif
					#else
						#ifdef _ALPHATEST_ON
							clip(o.Alpha - AlphaClipThreshold);
						#endif
					#endif

					#ifdef UNITY_STANDARD_USE_DITHER_MASK
						half alphaRef = tex3D(_DitherMaskLOD, float3(IN.pos.xy*0.25,o.Alpha*0.9375)).a;
						clip(alphaRef - 0.01);
					#endif

					#if defined( ASE_DEPTH_WRITE_ON )
						outputDepth = IN.pos.z;
					#endif

					SHADOW_CASTER_FRAGMENT(IN)
				}
			ENDCG
		}

		
		Pass
		{
			
			Name "SceneSelectionPass"
			Tags { "LightMode"="SceneSelectionPass" }

			ZWrite On

			CGPROGRAM
				#define ASE_GEOMETRY
				#define ASE_FRAGMENT_NORMAL 0
				#define ASE_RECEIVE_SHADOWS
				#pragma multi_compile_instancing
				#pragma multi_compile _ LOD_FADE_CROSSFADE
				#define ASE_FOG
				#define ASE_VERSION 19909

				#pragma vertex vert
				#pragma fragment frag
				#pragma skip_variants FOG_LINEAR FOG_EXP FOG_EXP2

				#pragma multi_compile_fwdbase
				#ifndef UNITY_PASS_FORWARDBASE
					#define UNITY_PASS_FORWARDBASE
				#endif
				#include "HLSLSupport.cginc"
				#if defined( ASE_GEOMETRY ) || defined( ASE_IMPOSTOR )
					#ifndef UNITY_INSTANCED_LOD_FADE
						#define UNITY_INSTANCED_LOD_FADE
					#endif
					#ifndef UNITY_INSTANCED_SH
						#define UNITY_INSTANCED_SH
					#endif
					#ifndef UNITY_INSTANCED_LIGHTMAPSTS
						#define UNITY_INSTANCED_LIGHTMAPSTS
					#endif
				#endif
				#include "UnityShaderVariables.cginc"
				#include "UnityCG.cginc"
				#include "Lighting.cginc"
				#include "UnityPBSLighting.cginc"
				#include "AutoLight.cginc"

				

				int _ObjectId;
				int _PassValue;

				struct appdata
				{
					float4 vertex : POSITION;
					half3 normal : NORMAL;
					half4 tangent : TANGENT;
					
					UNITY_VERTEX_INPUT_INSTANCE_ID
				};

				struct v2f
				{
					float4 pos : SV_POSITION;
					float4 worldPos : TEXCOORD0; // xyz = positionWS
					half3 normalWS : TEXCOORD1;
					
					UNITY_VERTEX_INPUT_INSTANCE_ID
					UNITY_VERTEX_OUTPUT_STEREO
				};

				#ifdef ASE_TESSELLATION
					float _TessPhongStrength;
					float _TessValue;
					float _TessMin;
					float _TessMax;
					float _TessEdgeLength;
					float _TessMaxDisp;
				#endif

				

				
				v2f VertexFunction( appdata v  )
				{
					UNITY_SETUP_INSTANCE_ID(v);
					v2f o;
					UNITY_INITIALIZE_OUTPUT(v2f,o);
					UNITY_TRANSFER_INSTANCE_ID(v,o);
					UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

					

					#ifdef ASE_ABSOLUTE_VERTEX_POS
						float3 defaultVertexValue = v.vertex.xyz;
					#else
						float3 defaultVertexValue = float3(0, 0, 0);
					#endif
					float3 vertexValue = defaultVertexValue;
					#ifdef ASE_ABSOLUTE_VERTEX_POS
						v.vertex.xyz = vertexValue;
					#else
						v.vertex.xyz += vertexValue;
					#endif
					v.vertex.w = 1;
					v.normal = v.normal;
					v.tangent = v.tangent;

					float3 positionWS = mul( unity_ObjectToWorld, v.vertex ).xyz;
					half3 normalWS = UnityObjectToWorldNormal( v.normal );

					o.pos = UnityObjectToClipPos( v.vertex );
					o.worldPos.xyz = positionWS;
					o.normalWS = normalWS;
					return o;
				}

				#if defined(ASE_TESSELLATION)
				struct VertexControl
				{
					float4 vertex : INTERNALTESSPOS;
					half3 normal : NORMAL;
					
					UNITY_VERTEX_INPUT_INSTANCE_ID
				};

				struct TessellationFactors
				{
					float edge[3] : SV_TessFactor;
					float inside : SV_InsideTessFactor;
				};

				VertexControl vert ( appdata v )
				{
					VertexControl o;
					UNITY_SETUP_INSTANCE_ID(v);
					UNITY_TRANSFER_INSTANCE_ID(v, o);
					o.vertex = v.vertex;
					o.normal = v.normal;
					
					return o;
				}

				TessellationFactors TessellationFunction (InputPatch<VertexControl,3> v)
				{
					TessellationFactors o;
					float4 tf = 1;
					float tessValue = _TessValue; float tessMin = _TessMin; float tessMax = _TessMax;
					float edgeLength = _TessEdgeLength; float tessMaxDisp = _TessMaxDisp;
					#if defined(ASE_FIXED_TESSELLATION)
					tf = FixedTess( tessValue );
					#elif defined(ASE_DISTANCE_TESSELLATION)
					tf = DistanceBasedTess(v[0].vertex, v[1].vertex, v[2].vertex, tessValue, tessMin, tessMax, UNITY_MATRIX_M, _WorldSpaceCameraPos );
					#elif defined(ASE_LENGTH_TESSELLATION)
					tf = EdgeLengthBasedTess(v[0].vertex, v[1].vertex, v[2].vertex, edgeLength, UNITY_MATRIX_M, _WorldSpaceCameraPos, _ScreenParams );
					#elif defined(ASE_LENGTH_CULL_TESSELLATION)
					tf = EdgeLengthBasedTessCull(v[0].vertex, v[1].vertex, v[2].vertex, edgeLength, tessMaxDisp, UNITY_MATRIX_M, _WorldSpaceCameraPos, _ScreenParams, unity_CameraWorldClipPlanes );
					#endif
					o.edge[0] = tf.x; o.edge[1] = tf.y; o.edge[2] = tf.z; o.inside = tf.w;
					return o;
				}

				[domain("tri")]
				[partitioning("fractional_odd")]
				[outputtopology("triangle_cw")]
				[patchconstantfunc("TessellationFunction")]
				[outputcontrolpoints(3)]
				VertexControl HullFunction(InputPatch<VertexControl, 3> patch, uint id : SV_OutputControlPointID)
				{
				   return patch[id];
				}

				[domain("tri")]
				v2f DomainFunction(TessellationFactors factors, OutputPatch<VertexControl, 3> patch, float3 bary : SV_DomainLocation)
				{
					appdata o = (appdata) 0;
					o.vertex = patch[0].vertex * bary.x + patch[1].vertex * bary.y + patch[2].vertex * bary.z;
					o.normal = patch[0].normal * bary.x + patch[1].normal * bary.y + patch[2].normal * bary.z;
					
					#if defined(ASE_PHONG_TESSELLATION)
					float3 pp[3];
					for (int i = 0; i < 3; ++i)
						pp[i] = o.vertex.xyz - patch[i].normal * (dot(o.vertex.xyz, patch[i].normal) - dot(patch[i].vertex.xyz, patch[i].normal));
					float phongStrength = _TessPhongStrength;
					o.vertex.xyz = phongStrength * (pp[0]*bary.x + pp[1]*bary.y + pp[2]*bary.z) + (1.0f-phongStrength) * o.vertex.xyz;
					#endif
					UNITY_TRANSFER_INSTANCE_ID(patch[0], o);
					return VertexFunction(o);
				}
				#else
				v2f vert ( appdata v )
				{
					return VertexFunction( v );
				}
				#endif

				half4 frag( v2f IN 
							#if defined( ASE_DEPTH_WRITE_ON )
								, out float outputDepth : SV_Depth
							#endif
							) : SV_Target
				{
					UNITY_SETUP_INSTANCE_ID(IN);

					#ifdef LOD_FADE_CROSSFADE
						UNITY_APPLY_DITHER_CROSSFADE(IN.pos.xy);
					#endif

					

					half Alpha = 1;
					half AlphaClipThreshold = 0.5;

					#if defined( ASE_DEPTH_WRITE_ON )
						IN.pos.z = IN.pos.z;
					#endif

					#ifdef _ALPHATEST_ON
						clip( Alpha - AlphaClipThreshold );
					#endif

					#if defined( ASE_DEPTH_WRITE_ON )
						outputDepth = IN.pos.z;
					#endif

					return float4( _ObjectId, _PassValue, 1.0, 1.0 );
				}
			ENDCG
		}

		
		Pass
		{
			
			Name "ScenePickingPass"
			Tags { "LightMode"="Picking" }

			ZWrite On

			CGPROGRAM
				#define ASE_GEOMETRY
				#define ASE_FRAGMENT_NORMAL 0
				#define ASE_RECEIVE_SHADOWS
				#pragma multi_compile_instancing
				#pragma multi_compile _ LOD_FADE_CROSSFADE
				#define ASE_FOG
				#define ASE_VERSION 19909

				#pragma vertex vert
				#pragma fragment frag
				#pragma skip_variants FOG_LINEAR FOG_EXP FOG_EXP2

				#pragma multi_compile_fwdbase
				#ifndef UNITY_PASS_FORWARDBASE
					#define UNITY_PASS_FORWARDBASE
				#endif
				#include "HLSLSupport.cginc"
				#if defined( ASE_GEOMETRY ) || defined( ASE_IMPOSTOR )
					#ifndef UNITY_INSTANCED_LOD_FADE
						#define UNITY_INSTANCED_LOD_FADE
					#endif
					#ifndef UNITY_INSTANCED_SH
						#define UNITY_INSTANCED_SH
					#endif
					#ifndef UNITY_INSTANCED_LIGHTMAPSTS
						#define UNITY_INSTANCED_LIGHTMAPSTS
					#endif
				#endif
				#include "UnityShaderVariables.cginc"
				#include "UnityCG.cginc"
				#include "Lighting.cginc"
				#include "UnityPBSLighting.cginc"
				#include "AutoLight.cginc"

				

				float4 _SelectionID;

				struct appdata
				{
					float4 vertex : POSITION;
					half3 normal : NORMAL;
					half4 tangent : TANGENT;
					
					UNITY_VERTEX_INPUT_INSTANCE_ID
				};

				struct v2f
				{
					float4 pos : SV_POSITION;
					float4 worldPos : TEXCOORD0; // xyz = positionWS
					half3 normalWS : TEXCOORD1;
					
					UNITY_VERTEX_INPUT_INSTANCE_ID
					UNITY_VERTEX_OUTPUT_STEREO
				};

				#ifdef ASE_TESSELLATION
					float _TessPhongStrength;
					float _TessValue;
					float _TessMin;
					float _TessMax;
					float _TessEdgeLength;
					float _TessMaxDisp;
				#endif

				

				
				v2f VertexFunction( appdata v  )
				{
					UNITY_SETUP_INSTANCE_ID(v);
					v2f o;
					UNITY_INITIALIZE_OUTPUT(v2f,o);
					UNITY_TRANSFER_INSTANCE_ID(v,o);
					UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

					

					#ifdef ASE_ABSOLUTE_VERTEX_POS
						float3 defaultVertexValue = v.vertex.xyz;
					#else
						float3 defaultVertexValue = float3(0, 0, 0);
					#endif
					float3 vertexValue = defaultVertexValue;
					#ifdef ASE_ABSOLUTE_VERTEX_POS
						v.vertex.xyz = vertexValue;
					#else
						v.vertex.xyz += vertexValue;
					#endif
					v.vertex.w = 1;
					v.normal = v.normal;
					v.tangent = v.tangent;

					float3 positionWS = mul( unity_ObjectToWorld, v.vertex ).xyz;
					half3 normalWS = UnityObjectToWorldNormal( v.normal );

					o.pos = UnityObjectToClipPos( v.vertex );
					o.worldPos.xyz = positionWS;
					o.normalWS = normalWS;
					return o;
				}

				#if defined(ASE_TESSELLATION)
				struct VertexControl
				{
					float4 vertex : INTERNALTESSPOS;
					half3 normal : NORMAL;
					
					UNITY_VERTEX_INPUT_INSTANCE_ID
				};

				struct TessellationFactors
				{
					float edge[3] : SV_TessFactor;
					float inside : SV_InsideTessFactor;
				};

				VertexControl vert ( appdata v )
				{
					VertexControl o;
					UNITY_SETUP_INSTANCE_ID(v);
					UNITY_TRANSFER_INSTANCE_ID(v, o);
					o.vertex = v.vertex;
					o.normal = v.normal;
					
					return o;
				}

				TessellationFactors TessellationFunction (InputPatch<VertexControl,3> v)
				{
					TessellationFactors o;
					float4 tf = 1;
					float tessValue = _TessValue; float tessMin = _TessMin; float tessMax = _TessMax;
					float edgeLength = _TessEdgeLength; float tessMaxDisp = _TessMaxDisp;
					#if defined(ASE_FIXED_TESSELLATION)
					tf = FixedTess( tessValue );
					#elif defined(ASE_DISTANCE_TESSELLATION)
					tf = DistanceBasedTess(v[0].vertex, v[1].vertex, v[2].vertex, tessValue, tessMin, tessMax, UNITY_MATRIX_M, _WorldSpaceCameraPos );
					#elif defined(ASE_LENGTH_TESSELLATION)
					tf = EdgeLengthBasedTess(v[0].vertex, v[1].vertex, v[2].vertex, edgeLength, UNITY_MATRIX_M, _WorldSpaceCameraPos, _ScreenParams );
					#elif defined(ASE_LENGTH_CULL_TESSELLATION)
					tf = EdgeLengthBasedTessCull(v[0].vertex, v[1].vertex, v[2].vertex, edgeLength, tessMaxDisp, UNITY_MATRIX_M, _WorldSpaceCameraPos, _ScreenParams, unity_CameraWorldClipPlanes );
					#endif
					o.edge[0] = tf.x; o.edge[1] = tf.y; o.edge[2] = tf.z; o.inside = tf.w;
					return o;
				}

				[domain("tri")]
				[partitioning("fractional_odd")]
				[outputtopology("triangle_cw")]
				[patchconstantfunc("TessellationFunction")]
				[outputcontrolpoints(3)]
				VertexControl HullFunction(InputPatch<VertexControl, 3> patch, uint id : SV_OutputControlPointID)
				{
				   return patch[id];
				}

				[domain("tri")]
				v2f DomainFunction(TessellationFactors factors, OutputPatch<VertexControl, 3> patch, float3 bary : SV_DomainLocation)
				{
					appdata o = (appdata) 0;
					o.vertex = patch[0].vertex * bary.x + patch[1].vertex * bary.y + patch[2].vertex * bary.z;
					o.normal = patch[0].normal * bary.x + patch[1].normal * bary.y + patch[2].normal * bary.z;
					
					#if defined(ASE_PHONG_TESSELLATION)
					float3 pp[3];
					for (int i = 0; i < 3; ++i)
						pp[i] = o.vertex.xyz - patch[i].normal * (dot(o.vertex.xyz, patch[i].normal) - dot(patch[i].vertex.xyz, patch[i].normal));
					float phongStrength = _TessPhongStrength;
					o.vertex.xyz = phongStrength * (pp[0]*bary.x + pp[1]*bary.y + pp[2]*bary.z) + (1.0f-phongStrength) * o.vertex.xyz;
					#endif
					UNITY_TRANSFER_INSTANCE_ID(patch[0], o);
					return VertexFunction(o);
				}
				#else
				v2f vert ( appdata v )
				{
					return VertexFunction( v );
				}
				#endif

				half4 frag( v2f IN 
							#if defined( ASE_DEPTH_WRITE_ON )
								, out float outputDepth : SV_Depth
							#endif
							) : SV_Target
				{
					UNITY_SETUP_INSTANCE_ID(IN);

					#ifdef LOD_FADE_CROSSFADE
						UNITY_APPLY_DITHER_CROSSFADE(IN.pos.xy);
					#endif

					

					half Alpha = 1;
					half AlphaClipThreshold = 0.5;

					#if defined( ASE_DEPTH_WRITE_ON )
						IN.pos.z = IN.pos.z;
					#endif

					#ifdef _ALPHATEST_ON
						clip( Alpha - AlphaClipThreshold );
					#endif

					#if defined( ASE_DEPTH_WRITE_ON )
						outputDepth = IN.pos.z;
					#endif

					return _SelectionID;
				}
			ENDCG
		}
		
	}
	CustomEditor "AmplifyShaderEditor.MaterialInspector"
	
	Fallback Off
}
/*ASEBEGIN
Version=19909
Node;AmplifyShaderEditor.LerpOp, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;112;-160,720;Inherit;False;3;0;FLOAT;0;False;1;FLOAT;0;False;2;FLOAT;0;False;1;FLOAT;0
Node;AmplifyShaderEditor.LerpOp, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;109;-288,384;Inherit;False;3;0;COLOR;0,0,0,0;False;1;COLOR;0,0,0,0;False;2;COLOR;0,0,0,0;False;1;COLOR;0
Node;AmplifyShaderEditor.TextureCoordinatesNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;117;-1584,128;Inherit;False;0;-1;2;3;2;SAMPLER2D;;False;0;FLOAT2;1,1;False;1;FLOAT2;0,0;False;5;FLOAT2;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4
Node;AmplifyShaderEditor.LerpOp, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;77;-768,144;Inherit;False;3;0;COLOR;0,0,0,0;False;1;COLOR;0,0,0,0;False;2;FLOAT;0;False;1;COLOR;0
Node;AmplifyShaderEditor.TextureCoordinatesNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;69;-1584,320;Inherit;False;0;-1;2;3;2;SAMPLER2D;;False;0;FLOAT2;1,1;False;1;FLOAT2;0,0;False;5;FLOAT2;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4
Node;AmplifyShaderEditor.TextureCoordinatesNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;43;-1200,-96;Inherit;False;0;-1;2;3;2;SAMPLER2D;;False;0;FLOAT2;1,1;False;1;FLOAT2;0,0;False;5;FLOAT2;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4
Node;AmplifyShaderEditor.SamplerNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;41;-800,384;Inherit;True;Property;_CARD_FRONT_MASK;CARD_FRONT_MASK;0;0;Create;True;0;0;0;False;0;False;-1;c66d56fa803ca5a45bd5d36672af01db;c66d56fa803ca5a45bd5d36672af01db;True;0;False;white;Auto;False;Object;-1;Auto;Texture2D;False;8;0;SAMPLER2D;;False;1;FLOAT2;0,0;False;2;FLOAT;0;False;3;FLOAT2;0,0;False;4;FLOAT2;0,0;False;5;FLOAT;1;False;6;FLOAT;0;False;7;SAMPLERSTATE;;False;6;COLOR;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4;FLOAT3;5
Node;AmplifyShaderEditor.SamplerNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;70;-1328,320;Inherit;True;Property;_CARD_FRONT_BORDER;CARD_FRONT_BORDER;3;0;Create;True;0;0;0;False;0;False;-1;None;None;True;0;False;white;Auto;False;Object;-1;Auto;Texture2D;False;8;0;SAMPLER2D;;False;1;FLOAT2;0,0;False;2;FLOAT;0;False;3;FLOAT2;0,0;False;4;FLOAT2;0,0;False;5;FLOAT;1;False;6;FLOAT;0;False;7;SAMPLERSTATE;;False;6;COLOR;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4;FLOAT3;5
Node;AmplifyShaderEditor.TextureCoordinatesNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;118;-1280,544;Inherit;False;1;-1;2;3;2;SAMPLER2D;;False;0;FLOAT2;1,1;False;1;FLOAT2;0,0;False;5;FLOAT2;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;110;-608,704;Inherit;False;Property;_ArtGlow;Art Glow;4;0;Create;True;0;0;0;False;0;False;0.6;0.6;0;1;0;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;111;-608,784;Inherit;False;Property;_BorderGlow;Border Glow;5;0;Create;True;0;0;0;False;0;False;0.2;0.2;0;1;0;1;FLOAT;0
Node;AmplifyShaderEditor.OneMinusNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;114;32,528;Inherit;False;1;0;FLOAT;0;False;1;FLOAT;0
Node;AmplifyShaderEditor.SimpleMultiplyOpNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;113;64,640;Inherit;False;2;2;0;COLOR;0,0,0,0;False;1;FLOAT;0;False;1;COLOR;0
Node;AmplifyShaderEditor.SimpleMultiplyOpNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;115;272,432;Inherit;False;2;2;0;COLOR;0,0,0,0;False;1;FLOAT;0;False;1;COLOR;0
Node;AmplifyShaderEditor.SamplerNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;116;-1312,112;Inherit;True;Property;_MainTex;_MainTex;2;0;Create;True;0;0;0;False;0;False;-1;None;None;True;0;False;white;Auto;False;Object;-1;Auto;Texture2D;False;8;0;SAMPLER2D;;False;1;FLOAT2;0,0;False;2;FLOAT;0;False;3;FLOAT2;0,0;False;4;FLOAT2;0,0;False;5;FLOAT;1;False;6;FLOAT;0;False;7;SAMPLERSTATE;;False;6;COLOR;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4;FLOAT3;5
Node;AmplifyShaderEditor.SamplerNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;42;-832,-96;Inherit;True;Property;_CARD_BACK;CARD_BACK;1;0;Create;True;0;0;0;False;0;False;-1;None;None;True;0;False;white;Auto;False;Object;-1;Auto;Texture2D;False;8;0;SAMPLER2D;;False;1;FLOAT2;0,0;False;2;FLOAT;0;False;3;FLOAT2;0,0;False;4;FLOAT2;0,0;False;5;FLOAT;1;False;6;FLOAT;0;False;7;SAMPLERSTATE;;False;6;COLOR;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4;FLOAT3;5
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;119;256,768;Inherit;False;Property;_Roughness;Roughness;17;0;Create;True;0;0;0;False;0;False;0.3;0.3;0;1;0;1;FLOAT;0
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;127;176,1520;Inherit;False;// Bump detail, tangent space (OpenGL / Unity convention: green = up), so the card catches the game's lights. Front: the$// card layers' normals (_LayerNormal, stacked by the client) over card.normal.png where no layer covers it (border = the$// layers' coverage). Back: the back layers' (_BackNormal). Default textures "bump" = flat.$float3 base = tex2D( normalMap, uv ).xyz * 2.0 - 1.0@$float3 layer = tex2D( layerNormal, uv ).xyz * 2.0 - 1.0@$float3 back = tex2D( backNormal, uv ).xyz * 2.0 - 1.0@$float3 n = lerp( back, lerp( base, layer, border ), saturate( frontMask ) )@$n.xy *= strength@$return normalize( n )@;3;Create;7;False;uv;FLOAT2;0,0;In;;Inherit;False;False;normalMap;SAMPLER2D;_Sampler1127;In;;Inherit;False;False;strength;FLOAT;1;In;;Inherit;False;False;frontMask;FLOAT;1;In;;Inherit;False;False;border;FLOAT;0;In;;Inherit;False;False;layerNormal;SAMPLER2D;_Sampler5127;In;;Inherit;False;False;backNormal;SAMPLER2D;_Sampler6127;In;;Inherit;False;CardNormal;True;False;0;;False;7;0;FLOAT2;0,0;False;1;SAMPLER2D;_Sampler1127;False;2;FLOAT;1;False;3;FLOAT;1;False;4;FLOAT;0;False;5;SAMPLER2D;_Sampler5127;False;6;SAMPLER2D;_Sampler6127;False;1;FLOAT3;0
Node;AmplifyShaderEditor.TexturePropertyNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;128;-480,1520;Inherit;True;Property;_NormalMap;Normal Map;10;0;Create;True;0;0;0;False;0;False;None;None;False;bump;Auto;Texture2D;False;-1;0;2;SAMPLER2D;0;SAMPLERSTATE;1
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;129;-160,1600;Inherit;False;Property;_NormalStrength;Normal Strength;11;0;Create;True;0;0;0;False;0;False;1;1;0;2;0;1;FLOAT;0
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;120;176,896;Inherit;False;// Holographic foil on the card art, added on top of emission. type 0 (rainbow): rainbow bands that slide across the$// card as it tilts, plus a brighter glint band sweeping diagonally. 1 to 11: the CardFoilPattern foils (pattern).$// Only where frontMask is set (not the back), not under the frame (border = frame alpha), and inside$// foilMask (card.foil.png: white/opaque = foil, black/transparent = plain print, default white = the whole art).$float area = foilMask.r@   // CardLayerFoil: layers and picture, front and back$float3 v = normalize(viewTS)@$float patternLuma = dot(baseColor.rgb, float3(0.299, 0.587, 0.114))@$float3 holo = (pattern.rgb * (0.3 + 0.7 * patternLuma) * (abs(type - 3.0) < 0.5 ? 1.4 : 1.0) + pattern.a * 0.25) * strength * area@$float2 tilt = v.xy / max(v.z, 0.25)@$float grain = sin(dot(uv, float2(173.1, 61.7))) * sin(dot(uv, float2(-47.3, 211.9)))@$float phase = dot(uv, float2(0.6, 1.0)) * scale + dot(tilt, float2(0.8, 0.5)) * tiltShift + grain * 0.06@$float3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + float3(0.0, 0.333, 0.667)))@$float sweep = dot(uv - 0.5, float2(0.8, 0.6)) + dot(tilt, float2(0.45, 0.3)) * tiltShift@$float glint = pow(saturate(1.0 - abs(sweep) * 2.5), 4.0)@$float luma = dot(baseColor.rgb, float3(0.299, 0.587, 0.114))@$float3 foil = rainbow * (0.3 + 0.7 * luma) * (0.35 + 0.65 * glint) + glint * 0.25@$return type > 0.5 && type < 11.5 ? holo : foil * strength * area@;3;Create;11;False;uv;FLOAT2;0,0;In;;Inherit;False;False;viewTS;FLOAT3;0,0,0;In;;Inherit;False;False;frontMask;FLOAT;1;In;;Inherit;False;False;foilMask;FLOAT4;1,1,1,1;In;;Inherit;False;False;border;FLOAT;0;In;;Inherit;False;False;baseColor;FLOAT4;0,0,0,0;In;;Inherit;False;False;strength;FLOAT;0.6;In;;Inherit;False;False;scale;FLOAT;1.5;In;;Inherit;False;False;tiltShift;FLOAT;1.5;In;;Inherit;False;False;type;FLOAT;0;In;;Inherit;False;False;pattern;FLOAT4;0,0,0,0;In;;Inherit;False;CardFoil;True;False;0;;False;11;0;FLOAT2;0,0;False;1;FLOAT3;0,0,0;False;2;FLOAT;1;False;3;FLOAT4;1,1,1,1;False;4;FLOAT;0;False;5;FLOAT4;0,0,0,0;False;6;FLOAT;0.6;False;7;FLOAT;1.5;False;8;FLOAT;1.5;False;9;FLOAT;0;False;10;FLOAT4;0,0,0,0;False;1;FLOAT3;0
Node;AmplifyShaderEditor.ViewDirInputsCoordNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;121;-160,960;Inherit;False;Tangent;False;0;4;FLOAT3;0;FLOAT;1;FLOAT;2;FLOAT;3
Node;AmplifyShaderEditor.SamplerNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;126;-480,1040;Inherit;True;Property;_FoilMask;Foil Mask;6;0;Create;True;0;0;0;False;0;False;-1;None;None;True;0;False;white;Auto;False;Object;-1;Auto;Texture2D;False;8;0;SAMPLER2D;;False;1;FLOAT2;0,0;False;2;FLOAT;0;False;3;FLOAT2;0,0;False;4;FLOAT2;0,0;False;5;FLOAT;1;False;6;FLOAT;0;False;7;SAMPLERSTATE;;False;6;COLOR;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4;FLOAT3;5
Node;AmplifyShaderEditor.SimpleAddOpNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;122;448,640;Inherit;False;2;2;0;COLOR;0,0,0,0;False;1;FLOAT3;0,0,0;False;1;COLOR;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;123;-160,1280;Inherit;False;Property;_FoilStrength;Foil Strength;7;0;Create;True;0;0;0;False;0;False;0.6;0.6;0;2;0;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;124;-160,1360;Inherit;False;Property;_FoilScale;Foil Scale;8;0;Create;True;0;0;0;False;0;False;1.5;1.5;0;0;0;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;125;-160,1440;Inherit;False;Property;_FoilShift;Foil Tilt Shift;9;0;Create;True;0;0;0;False;0;False;1.5;1.5;0;0;0;1;FLOAT;0
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;130;448,1040;Inherit;False;float m = foilMask.r * saturate( strength * 1.5 )@$float3 v = normalize( viewTS )@$float2 tilt = v.xy / max( v.z, 0.25 )@$float sweep = dot( uv - 0.5, float2( 0.8, 0.6 ) ) + dot( tilt, float2( 0.45, 0.3 ) ) * tiltShift@$float glint = pow( saturate( 1.0 - abs( sweep ) * 2.5 ), 4.0 )@$float lum = dot( pattern.rgb, float3( 0.299, 0.587, 0.114 ) ) + pattern.a@$return m * ( type > 0.5 && type < 11.5 ? saturate( lum * 2.5 ) : 0.25 + 0.75 * glint )@;1;Create;9;False;frontMask;FLOAT;1;In;;Inherit;False;False;foilMask;FLOAT4;1,1,1,1;In;;Inherit;False;False;border;FLOAT;0;In;;Inherit;False;False;strength;FLOAT;0.6;In;;Inherit;False;False;type;FLOAT;0;In;;Inherit;False;False;pattern;FLOAT4;0,0,0,0;In;;Inherit;False;False;uv;FLOAT2;0,0;In;;Inherit;False;False;viewTS;FLOAT3;0,0,0;In;;Inherit;False;False;tiltShift;FLOAT;1.5;In;;Inherit;False;CardFoilMetal;True;False;0;;False;9;0;FLOAT;1;False;1;FLOAT4;1,1,1,1;False;2;FLOAT;0;False;3;FLOAT;0.6;False;4;FLOAT;0;False;5;FLOAT4;0,0,0,0;False;6;FLOAT2;0,0;False;7;FLOAT3;0,0,0;False;8;FLOAT;1.5;False;1;FLOAT;0
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;131;512,224;Inherit;False;// Albedo of the foil area. Where the card is metallic (metal, from CardFoilMetal) the albedo is the colour of its$// reflections, so this gives the lights' highlights and the reflections the same foil pattern (type) as CardFoil.$float3 v = normalize(viewTS)@$float3 holo = saturate(0.35 + pattern.rgb * 0.6 + albedo.rgb * 0.3)@$float2 tilt = v.xy / max(v.z, 0.25)@$float grain = sin(dot(uv, float2(173.1, 61.7))) * sin(dot(uv, float2(-47.3, 211.9)))@$float phase = dot(uv, float2(0.6, 1.0)) * scale + dot(tilt, float2(0.8, 0.5)) * tiltShift + grain * 0.06@$float3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + float3(0.0, 0.333, 0.667)))@$float3 foil = saturate(rainbow * 0.85 + albedo.rgb * 0.35)@$return lerp(albedo.rgb, type > 0.5 && type < 11.5 ? holo : foil, metal)@;3;Create;8;False;albedo;FLOAT4;0,0,0,0;In;;Inherit;False;False;metal;FLOAT;0;In;;Inherit;False;False;uv;FLOAT2;0,0;In;;Inherit;False;False;viewTS;FLOAT3;0,0,0;In;;Inherit;False;False;scale;FLOAT;1.5;In;;Inherit;False;False;tiltShift;FLOAT;1.5;In;;Inherit;False;False;type;FLOAT;0;In;;Inherit;False;False;pattern;FLOAT4;0,0,0,0;In;;Inherit;False;CardFoilAlbedo;True;False;0;;False;8;0;FLOAT4;0,0,0,0;False;1;FLOAT;0;False;2;FLOAT2;0,0;False;3;FLOAT3;0,0,0;False;4;FLOAT;1.5;False;5;FLOAT;1.5;False;6;FLOAT;0;False;7;FLOAT4;0,0,0,0;False;1;FLOAT3;0
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;132;512,768;Inherit;False;float rough = lerp( roughness, surface.g, surface.a )@$return lerp( 1.0 - rough, 0.9, foilMetal )@;1;Create;3;False;surface;FLOAT4;0,0,0,0;In;;Inherit;False;False;roughness;FLOAT;0.3;In;;Inherit;False;False;foilMetal;FLOAT;0;In;;Inherit;False;CardSmoothness;True;False;0;;False;3;0;FLOAT4;0,0,0,0;False;1;FLOAT;0.3;False;2;FLOAT;0;False;1;FLOAT;0
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;154;640,1040;Inherit;False;return max( surface.b, foilMetal )@;1;Create;2;False;surface;FLOAT4;0,0,0,0;In;;Inherit;False;False;foilMetal;FLOAT;0;In;;Inherit;False;CardMetallic;True;False;0;;False;2;0;FLOAT4;0,0,0,0;False;1;FLOAT;0;False;1;FLOAT;0
Node;AmplifyShaderEditor.SamplerNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;140;-480,1200;Inherit;True;Property;_LayerFoil;Layer Foil;12;0;Create;True;0;0;0;False;0;False;-1;None;None;True;0;False;black;Auto;False;Object;-1;Auto;Texture2D;False;8;0;SAMPLER2D;;False;1;FLOAT2;0,0;False;2;FLOAT;0;False;3;FLOAT2;0,0;False;4;FLOAT2;0,0;False;5;FLOAT;1;False;6;FLOAT;0;False;7;SAMPLERSTATE;;False;6;COLOR;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4;FLOAT3;5
Node;AmplifyShaderEditor.SamplerNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;141;-480,1360;Inherit;True;Property;_BackFoil;Back Foil;13;0;Create;True;0;0;0;False;0;False;-1;None;None;True;0;False;black;Auto;False;Object;-1;Auto;Texture2D;False;8;0;SAMPLER2D;;False;1;FLOAT2;0,0;False;2;FLOAT;0;False;3;FLOAT2;0,0;False;4;FLOAT2;0,0;False;5;FLOAT;1;False;6;FLOAT;0;False;7;SAMPLERSTATE;;False;6;COLOR;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4;FLOAT3;5
Node;AmplifyShaderEditor.TexturePropertyNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;142;-480,1680;Inherit;True;Property;_LayerNormal;Layer Normal;14;0;Create;True;0;0;0;False;0;False;None;None;False;bump;Auto;Texture2D;False;-1;0;2;SAMPLER2D;0;SAMPLERSTATE;1
Node;AmplifyShaderEditor.TexturePropertyNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;143;-480,1840;Inherit;True;Property;_BackNormal;Back Normal;15;0;Create;True;0;0;0;False;0;False;None;None;False;bump;Auto;Texture2D;False;-1;0;2;SAMPLER2D;0;SAMPLERSTATE;1
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;144;-128,1120;Inherit;False;float front = lerp( baseFoil.r * baseFoil.a, layerFoil.r, layers )@$float k = saturate( frontMask )@$float4 surface = lerp( backFoil, layerFoil, k )@$return float4( lerp( backFoil.r, front, k ), surface.b, surface.a, lerp( 1.0, layers, k ) )@;4;Create;5;False;baseFoil;FLOAT4;0,0,0,0;In;;Inherit;False;False;layerFoil;FLOAT4;0,0,0,0;In;;Inherit;False;False;layers;FLOAT;0;In;;Inherit;False;False;backFoil;FLOAT4;0,0,0,0;In;;Inherit;False;False;frontMask;FLOAT;1;In;;Inherit;False;CardLayerFoil;True;False;0;;False;5;0;FLOAT4;0,0,0,0;False;1;FLOAT4;0,0,0,0;False;2;FLOAT;0;False;3;FLOAT4;0,0,0,0;False;4;FLOAT;1;False;1;FLOAT4;0
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;145;-352,864;Inherit;False;// Which glow: 0 = the art's (Art Glow), 1 = a frame's (Border Glow). Collection layers count as frame: the client stacks$// that into the G channel of _LayerFoil / _BackFoil.$return lerp( backFoil.g, layerFoil.g, saturate( frontMask ) )@;1;Create;3;False;layerFoil;FLOAT4;0,0,0,0;In;;Inherit;False;False;backFoil;FLOAT4;0,0,0,0;In;;Inherit;False;False;frontMask;FLOAT;1;In;;Inherit;False;CardLayerGlow;True;False;0;;False;3;0;FLOAT4;0,0,0,0;False;1;FLOAT4;0,0,0,0;False;2;FLOAT;1;False;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;150;256,896;Inherit;False;Global;_DaCardWorld;DaCard World;40;0;Create;True;0;0;0;False;0;False;0;0;0;1;0;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;151;256,976;Inherit;False;Property;_WorldGlow;Glow in the world;16;0;Create;True;0;0;0;False;0;False;0.1;0.1;0;1;0;1;FLOAT;0
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;152;560,640;Inherit;False;// A card lying in the world (drawn by the game's main camera: the client sets the global _DaCardWorld then) is lit by the$// raid: its own light (art glow, foil shine) drops to worldGlow, so it is dark in the dark. Inspect views and icons: 1.$return emission * lerp( 1.0, worldGlow, saturate( world ) )@;3;Create;3;False;emission;FLOAT3;0,0,0;In;;Inherit;False;False;world;FLOAT;0;In;;Inherit;False;False;worldGlow;FLOAT;0.1;In;;Inherit;False;CardWorldEmission;True;False;0;;False;3;0;FLOAT3;0,0,0;False;1;FLOAT;0;False;2;FLOAT;0.1;False;1;FLOAT3;0
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;163;-128,1760;Inherit;False;float2 size = float2( 735.0, 1026.0 )@$float4 uvc = float4( ( clamp( floor( uv * size ), 0.0, size - 1.0 ) + 0.5 ) / size, 0.0, 0.0 )@$float a = frontMask > 0.5 ? tex2Dlod( layerNormal, uvc ).a : tex2Dlod( backNormal, uvc ).a@$return round( a * 255.0 )@;1;Create;4;False;uv;FLOAT2;0,0;In;;Inherit;False;False;frontMask;FLOAT;1;In;;Inherit;False;False;layerNormal;SAMPLER2D;_Sampler2163;In;;Inherit;False;False;backNormal;SAMPLER2D;_Sampler3163;In;;Inherit;False;CardFoilType;True;False;0;;False;4;0;FLOAT2;0,0;False;1;FLOAT;1;False;2;SAMPLER2D;_Sampler2163;False;3;SAMPLER2D;_Sampler3163;False;1;FLOAT;0
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;170;-128,1920;Inherit;False;#define DC_HASH(c) frac((frac((c).x * 123.34) + dot(frac((c) * float2(123.34, 456.21)), frac((c) * float2(123.34, 456.21)) + 45.32)) * (frac((c).y * 456.21) + dot(frac((c) * float2(123.34, 456.21)), frac((c) * float2(123.34, 456.21)) + 45.32)))$#define DC_BUMP(x, c, o, y) saturate(1.0 - ((c) * ((x) - (o))) * ((c) * ((x) - (o))) - (y))$#define DC_SPEC(t) (DC_BUMP(frac(t), float3(3.54585104, 2.93225262, 2.41593945), float3(0.69549072, 0.49228336, 0.27699880), float3(0.02312639, 0.15225084, 0.52607955)) + DC_BUMP(frac(t), float3(3.90307140, 3.21182957, 3.96587128), float3(0.11748627, 0.86755042, 0.66077860), float3(0.84897130, 0.88445281, 0.73949448)))$#define DC_COUNT(s, m, k) ((m) + ((s) - (m)) * rsqrt(max((k), 1.0)))$float3 nb = normalize(normalTS)@$float3 v = normalize(viewTS)@$float3 p = float3(uv.x - 0.5, (uv.y - 0.5) * 1.397, 0.0)@$float3 up = normalize(float3(0.0, 1.0, 0.0) - v * v.y)@$float3 eye = v * 2.0@$float3 V = normalize(eye - p)@$float3 L = normalize(eye + (up * 0.7 + cross(up, v) * 0.35) * 2.0 - p)@$float2 h = (L - nb * dot(L, nb)).xy + (V - nb * dot(V, nb)).xy@$float2 nh = normalize(h + 1e-5)@$float vn = dot(v, nb)@$float2 tilt = (v - nb * vn).xy / max(vn, 0.25)@$float lit = 0.55 + 0.75 * pow(saturate(dot(nb, normalize(L + V))), 12.0)@$float fw = max(fwidth(uv.x), 1e-6)@$float2 dir = float2(0.866, 0.5)@$float gate = 1.0@$float sheen = 0.0@$float3 col = 0.0@$float glint = 0.0@$bool grating = type > 0.5 && type < 11.5@$if (type > 10.5)${$    float2 q = uv * float2(9.0, 12.573)@$    float2 b = floor(q)@$    float d1 = 8.0@$    float2 id = b@$    [unroll] for (int j = -1@ j <= 1@ j++)$    [unroll] for (int i = -1@ i <= 1@ i++)$    {$        float2 nc = b + float2(i, j)@$        float2 o = nc + 0.1 + 0.8 * float2(DC_HASH(nc + float2(0.0, 3.3)), DC_HASH(nc + float2(5.7, 0.0)))@$        float d = length(q - o)@$        if (d < d1) { d1 = d@ id = nc@ }$    }$    float turn = DC_HASH(id + float2(1.7, 9.2)) * 6.2831853@$    dir = float2(cos(turn), sin(turn))@$    gate = 0.45 + 0.55 * DC_HASH(id + float2(6.6, 2.2))@$    sheen = 0.25@$}$else if (type > 9.5)${$    grating = false@$    float2 cn = uv * float2(7.0, 9.779)@$    float2 ci = floor(cn)@$    float2 cf = frac(cn)@$    cf = cf * cf * (3.0 - 2.0 * cf)@$    float dens = lerp(lerp(DC_HASH(ci), DC_HASH(ci + float2(1.0, 0.0)), cf.x), lerp(DC_HASH(ci + float2(0.0, 1.0)), DC_HASH(ci + float2(1.0, 1.0)), cf.x), cf.y)@$    dens = 0.45 + 0.3 * dens@$    float2 pp = float2(uv.x, uv.y * 1.397)@$    [unroll] for (int k = 0@ k < 3@ k++)$    {$        float s = k == 0 ? 113.0 : (k == 1 ? 139.0 : 167.0)@$        float an = k == 0 ? 0.31 : (k == 1 ? 1.13 : 2.07)@$        float2 q = float2(cos(an) * pp.x - sin(an) * pp.y, sin(an) * pp.x + cos(an) * pp.y) * s + float2(0.37, 0.61) * k@$        float2 c = floor(q) + float2(41.3, 27.1) * k@$        float rad = 0.0026 * s * (0.85 + 0.3 * DC_HASH(c + float2(7.7, 3.3)))@$        float2 o = (float2(DC_HASH(c + float2(1.3, 0.0)), DC_HASH(c + float2(0.0, 2.9))) - 0.5) * (1.0 - 2.0 * rad)@$        float d = length(frac(q) - 0.5 - o)@$        float turn = DC_HASH(c + float2(4.1, 2.3)) * 6.2831853@$        float tw = pow(saturate(dot(float2(cos(turn), sin(turn)), nh)), 3.0)@$        float dotMask = saturate((rad - d) / max(fw * s * 1.5, 0.05) + 0.5) * step(1.0 - dens, DC_HASH(c))@$        float3 tint = DC_SPEC(uv.x * 0.35 + uv.y * 0.75 + dot(tilt, float2(0.6, 0.5)) + DC_HASH(c + float2(8.8, 0.0)) * 0.15)@$        float kk = fw * s * fw * s@$        float mn = dens * 3.14159 * rad * rad * 0.6@$        col += tint * DC_COUNT(dotMask * (0.45 + 1.1 * tw), mn, kk) * 1.7@$        glint += DC_COUNT(dotMask * tw * tw * tw, mn * 0.1, kk) * 0.45@$    }$}$else if (type > 8.5)${$    grating = false@$    float ph = length(p.xy - float2(-0.45, 1.0)) * 2.4 - dot(tilt, float2(0.8, 0.6)) * 0.9@$    col = DC_SPEC(ph) * (0.6 + 0.4 * cos(6.2831853 * ph * 0.5)) * 1.6@$    glint = pow(saturate(1.0 - abs(frac(ph * 0.5) - 0.5) * 8.0), 3.0) * 0.5@$}$else if (type > 7.5)${$    grating = false@$    float ph = dot(p.xy, float2(0.8, 0.6)) * 1.4 + dot(tilt, float2(1.1, 0.8)) * 1.6@$    float band = pow(0.5 + 0.5 * cos(6.2831853 * ph), 3.0)@$    float band2 = pow(0.5 + 0.5 * cos(6.2831853 * (ph * 2.7 + 0.3)), 10.0) * 0.6@$    col = DC_SPEC(ph * 0.8 + p.y * 0.25) * (band + band2) * 2.0@$    glint = pow(band, 6.0) * 0.5@$}$else if (type > 6.5)${$    float2 q = uv * float2(8.0, 11.176)@$    float2 fa = frac(q) - 0.5@$    float2 fb = frac(q + 0.5) - 0.5@$    float2 f = length(fb) < 0.5 ? fb : fa@$    float d = length(f)@$    float rings = 0.5 + 0.5 * cos(d * 6.2831853 * 9.0)@$    dir = f / max(d, 1e-4)@$    gate = 0.45 + 0.55 * rings@$    sheen = 0.35@$}$else if (type > 4.5)${$    float cells = type > 5.5 ? 12.0 : 10.0@$    float2 q = uv * float2(cells, cells * 1.397)@$    float2 c = floor(q)@$    float2 f = frac(q) - 0.5@$    if (type < 5.5)$    {$        float sec = floor(frac(atan2(f.y, f.x) / 6.2831853 + DC_HASH(c)) * 7.0)@$        float turn = DC_HASH(c + sec * float2(3.7, 1.9)) * 6.2831853@$        dir = float2(cos(turn), sin(turn))@$        gate = 0.55 + 0.45 * DC_HASH(c + sec * float2(5.3, 0.0) + float2(1.1, 2.2))@$        sheen = 0.25@$    }$    else$    {$        dir = normalize(f + 1e-5)@$        gate = 0.65 + 0.35 * saturate(max(abs(f.x), abs(f.y)) * 2.5)@$    }$}$else if (type > 3.5)${$    grating = false@$    [unroll] for (int k = 0@ k < 3@ k++)$    {$        float s = k == 0 ? 6.0 : (k == 1 ? 20.0 : 64.0)@$        float prob = k == 0 ? 0.35 : (k == 1 ? 0.55 : 0.7)@$        float r0 = k == 0 ? 0.18 : (k == 1 ? 0.14 : 0.16)@$        float r1 = k == 0 ? 0.4 : (k == 1 ? 0.34 : 0.36)@$        float br = k == 0 ? 2.8 : (k == 1 ? 2.5 : 2.4)@$        float2 q = uv * float2(s, s * 1.397)@$        float2 c = floor(q) + float2(31.7, 17.9) * k@$        float2 f = frac(q) - 0.5@$        float r = lerp(r0, r1, DC_HASH(c + float2(3.1, 7.7)))@$        float2 o = (float2(DC_HASH(c + float2(11.3, 0.0)), DC_HASH(c + float2(0.0, 5.9))) - 0.5) * (1.0 - 2.0 * r)@$        float d = length(f - o)@$        float disc = saturate((r - d) / max(fw * s * 1.5, 0.02) + 0.5 * saturate(fw * s * 1.5 / r - 1.0)) * step(1.0 - prob, DC_HASH(c))@$        float3 dotCol = DC_SPEC(DC_HASH(c + float2(2.7, 1.3)) + uv.y * 0.6 + dot(tilt, float2(0.6, 0.45))) * (0.7 + 0.3 * cos(d / max(r, 1e-3) * 4.0 + dot(tilt, float2(2.0, 1.5))))@$        float kk = fw * s * fw * s@$        float mn = prob * 3.14159 * (r0 + r1) * (r0 + r1) * 0.25 * 0.35@$        col += DC_COUNT(dotCol * disc, mn, kk) * br@$        if (k == 2)$            glint = DC_COUNT(disc * step(0.7, DC_HASH(c + float2(9.1, 4.4))), mn * 0.3, kk) * 0.5@$    }$    [unroll] for (int m = 0@ m < 2@ m++)$    {$        float2 sd = p.xy - (m == 0 ? float2(0.25, 0.55) : float2(-0.3, -0.2))@$        float sr = length(sd) + 1e-4@$        float swirl = pow(saturate(sin(atan2(sd.y, sd.x) * 2.0 - log(sr) * 7.0 + tilt.x + tilt.y)), 8.0) * saturate(1.0 - sr * 5.0)@$        col += DC_SPEC(sr * 3.0 + dot(tilt, float2(0.5, 0.5))) * swirl * (m == 0 ? 0.6 : 0.5)@$    }$}$else if (type > 2.5)${$    float2 cell = floor(uv * float2(60.0, 83.8))@$    float2 q = frac(cell * float2(123.34, 456.21))@$    q += dot(q, q + 45.32)@$    float turn = frac(q.x * q.y) * 6.2831853@$    q = frac((cell + 17.13) * float2(123.34, 456.21))@$    q += dot(q, q + 45.32)@$    gate = DC_COUNT(step(0.4, frac(q.x * q.y)), 0.6, fw * 60.0 * fw * 60.0)@$    dir = float2(cos(turn), sin(turn))@$    sheen = 0.2@$}$else if (type > 1.5)$    dir = normalize(p.xy + 1e-5)@$if (grating)${$    float g = abs(dot(h, dir))@$    float3 diff = 0.0@$    [unroll] for (int n = 1@ n <= 8@ n++)$    {$        float w = g * 1600.0 / n@$        float x = saturate((w - 400.0) / 300.0)@$        float3 a = float3(3.54585104, 2.93225262, 2.41593945) * (x - float3(0.69549072, 0.49228336, 0.27699880))@$        float3 b = float3(3.90307140, 3.21182957, 3.96587128) * (x - float3(0.11748627, 0.86755042, 0.66077860))@$        diff += (w >= 400.0 && w <= 700.0) ? saturate(1.0 - a * a - float3(0.02312639, 0.15225084, 0.52607955)) + saturate(1.0 - b * b - float3(0.84897130, 0.88445281, 0.73949448)) : 0.0@$    }$    col = saturate(diff) * gate + sheen * gate * pow(saturate(dot(dir, nh) * 0.5 + 0.5), 16.0)@$    glint = pow(saturate(1.0 - g * 4.0), 4.0) * gate@$}$return float4(col, glint) * lit@;4;Create;4;False;uv;FLOAT2;0,0;In;;Inherit;False;False;viewTS;FLOAT3;0,0,0;In;;Inherit;False;False;type;FLOAT;0;In;;Inherit;False;False;normalTS;FLOAT3;0,0,1;In;;Inherit;False;CardFoilPattern;True;False;0;;False;4;0;FLOAT2;0,0;False;1;FLOAT3;0,0,0;False;2;FLOAT;0;False;3;FLOAT3;0,0,1;False;1;FLOAT4;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;0;0,0;Float;False;False;-1;3;AmplifyShaderEditor.MaterialInspector;0;3;New Amplify Shader;ed95fe726fd7b4644bb42f4d1ddd2bcd;True;ExtraPrePass;0;0;ExtraPrePass;6;False;True;0;1;False;;0;False;;0;1;False;;0;False;;True;0;False;;0;False;;False;False;False;False;False;False;False;False;False;True;0;False;;False;True;0;False;;False;True;True;True;True;True;0;False;;False;False;False;False;False;False;False;True;False;0;False;;255;False;;255;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;False;True;1;False;;True;3;False;;False;False;True;3;RenderType=Opaque=RenderType;Queue=Geometry=Queue=0;DisableBatching=False=DisableBatching;True;3;True;12;all;0;False;True;1;1;False;;0;False;;0;1;False;;0;False;;False;False;False;False;False;False;False;False;False;False;False;False;True;0;False;;False;True;True;True;True;True;0;False;;False;False;False;False;False;False;False;True;False;0;False;;255;False;;255;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;False;True;1;False;;True;3;False;;True;True;0;False;;0;False;;False;True;1;LightMode=ForwardBase;False;False;0;;0;0;Standard;0;False;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;2;0,0;Float;False;False;-1;3;AmplifyShaderEditor.MaterialInspector;0;3;New Amplify Shader;ed95fe726fd7b4644bb42f4d1ddd2bcd;True;ForwardAdd;0;2;ForwardAdd;0;False;True;0;1;False;;0;False;;0;1;False;;0;False;;True;0;False;;0;False;;False;False;False;False;False;False;False;False;False;True;0;False;;False;True;0;False;;False;True;True;True;True;True;0;False;;False;False;False;False;False;False;False;True;False;0;False;;255;False;;255;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;False;True;1;False;;True;3;False;;False;False;True;3;RenderType=Opaque=RenderType;Queue=Geometry=Queue=0;DisableBatching=False=DisableBatching;True;3;True;12;all;0;False;True;4;1;False;;1;False;;0;1;False;;0;False;;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;True;2;False;;False;False;False;True;1;LightMode=ForwardAdd;False;False;0;;0;0;Standard;0;False;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;3;0,0;Float;False;False;-1;3;AmplifyShaderEditor.MaterialInspector;0;3;New Amplify Shader;ed95fe726fd7b4644bb42f4d1ddd2bcd;True;Deferred;0;3;Deferred;0;False;True;0;1;False;;0;False;;0;1;False;;0;False;;True;0;False;;0;False;;False;False;False;False;False;False;False;False;False;True;0;False;;False;True;0;False;;False;True;True;True;True;True;0;False;;False;False;False;False;False;False;False;True;False;0;False;;255;False;;255;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;False;True;1;False;;True;3;False;;False;False;True;3;RenderType=Opaque=RenderType;Queue=Geometry=Queue=0;DisableBatching=False=DisableBatching;True;3;True;12;all;0;False;False;False;False;False;False;False;False;False;False;False;False;True;0;False;;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;True;1;LightMode=Deferred;False;False;0;;0;0;Standard;0;False;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;4;0,0;Float;False;False;-1;3;AmplifyShaderEditor.MaterialInspector;0;3;New Amplify Shader;ed95fe726fd7b4644bb42f4d1ddd2bcd;True;Meta;0;4;Meta;0;False;True;0;1;False;;0;False;;0;1;False;;0;False;;True;0;False;;0;False;;False;False;False;False;False;False;False;False;False;True;0;False;;False;True;0;False;;False;True;True;True;True;True;0;False;;False;False;False;False;False;False;False;True;False;0;False;;255;False;;255;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;False;True;1;False;;True;3;False;;False;False;True;3;RenderType=Opaque=RenderType;Queue=Geometry=Queue=0;DisableBatching=False=DisableBatching;True;3;True;12;all;0;False;False;False;False;False;False;False;False;False;False;False;False;False;False;True;2;False;;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;True;1;LightMode=Meta;False;False;0;;0;0;Standard;0;False;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;5;0,0;Float;False;False;-1;3;AmplifyShaderEditor.MaterialInspector;0;3;New Amplify Shader;ed95fe726fd7b4644bb42f4d1ddd2bcd;True;ShadowCaster;0;5;ShadowCaster;0;False;True;0;1;False;;0;False;;0;1;False;;0;False;;True;0;False;;0;False;;False;False;False;False;False;False;False;False;False;True;0;False;;False;True;0;False;;False;True;True;True;True;True;0;False;;False;False;False;False;False;False;False;True;False;0;False;;255;False;;255;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;False;True;1;False;;True;3;False;;False;False;True;3;RenderType=Opaque=RenderType;Queue=Geometry=Queue=0;DisableBatching=False=DisableBatching;True;3;True;12;all;0;False;False;False;False;False;False;False;False;False;False;False;False;True;0;False;;False;False;False;False;False;False;False;False;False;False;False;False;False;True;1;False;;True;3;False;;False;False;True;1;LightMode=ShadowCaster;False;False;0;;0;0;Standard;0;False;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;6;0,0;Float;False;False;-1;3;AmplifyShaderEditor.MaterialInspector;0;3;New Amplify Shader;ed95fe726fd7b4644bb42f4d1ddd2bcd;True;SceneSelectionPass;0;6;SceneSelectionPass;0;False;True;0;1;False;;0;False;;0;1;False;;0;False;;True;0;False;;0;False;;False;False;False;False;False;False;False;False;False;True;0;False;;False;True;0;False;;False;True;True;True;True;True;0;False;;False;False;False;False;False;False;False;True;False;0;False;;255;False;;255;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;False;True;1;False;;True;3;False;;False;False;True;3;RenderType=Opaque=RenderType;Queue=Geometry=Queue=0;DisableBatching=False=DisableBatching;True;3;True;12;all;0;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;True;1;False;;False;False;False;True;1;LightMode=SceneSelectionPass;False;False;0;;0;0;Standard;0;False;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;7;0,0;Float;False;False;-1;3;AmplifyShaderEditor.MaterialInspector;0;3;New Amplify Shader;ed95fe726fd7b4644bb42f4d1ddd2bcd;True;ScenePickingPass;0;7;ScenePickingPass;0;False;True;0;1;False;;0;False;;0;1;False;;0;False;;True;0;False;;0;False;;False;False;False;False;False;False;False;False;False;True;0;False;;False;True;0;False;;False;True;True;True;True;True;0;False;;False;False;False;False;False;False;False;True;False;0;False;;255;False;;255;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;False;True;1;False;;True;3;False;;False;False;True;3;RenderType=Opaque=RenderType;Queue=Geometry=Queue=0;DisableBatching=False=DisableBatching;True;3;True;12;all;0;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;True;1;False;;False;False;False;True;1;LightMode=Picking;False;False;0;;0;0;Standard;0;False;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;1;752,384;Float;False;True;-1;3;AmplifyShaderEditor.MaterialInspector;0;3;AmplifyCardShader2D;ed95fe726fd7b4644bb42f4d1ddd2bcd;True;ForwardBase;0;1;ForwardBase;17;False;True;0;1;False;;0;False;;0;1;False;;0;False;;True;0;False;;0;False;;False;False;False;False;False;False;False;False;False;True;0;False;;False;True;0;False;;False;True;True;True;True;True;0;False;;False;False;False;False;False;False;False;True;False;0;False;;255;False;;255;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;False;True;1;False;;True;3;False;;False;False;True;3;RenderType=Opaque=RenderType;Queue=Geometry=Queue=0;DisableBatching=False=DisableBatching;True;3;True;12;all;0;False;True;1;1;False;;0;False;;0;1;False;;0;False;;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;True;1;LightMode=ForwardBase;False;False;0;;0;0;Standard;44;Category;0;0;  Instanced Terrain Normals;1;0;Workflow;1;0;Surface;0;0;  Blend;0;0;  Dither Shadows;1;0;Two Sided;1;0;Alpha Clipping;0;0;  Use Shadow Threshold;0;0;Deferred Pass;1;0;Normal Space;0;0;Transmission;0;0;  Transmission Shadow;0.5,False,;0;Translucency;0;0;  Translucency Strength;1,False,;0;  Normal Distortion;0.5,False,;0;  Scattering;2,False,;0;  Direct;0.9,False,;0;  Ambient;0.1,False,;0;  Shadow;0.5,False,;0;Cast Shadows;1;0;Receive Shadows;1;0;Receive Specular;2;0;Receive Reflections;2;0;GPU Instancing;1;0;LOD CrossFade;1;0;Built-in Fog;1;0;Ambient Light;1;0;Meta Pass;1;0;Add Pass;1;0;Override Baked GI;0;0;Write Depth;0;0;Extra Pre Pass;0;0;Tessellation;0;0;  Phong;0;0;  Strength;0.5,False,;0;  Type;0;0;  Tess;16,False,;0;  Min;10,False,;0;  Max;25,False,;0;  Edge Length;16,False,;0;  Max Displacement;25,False,;0;Disable Batching;0;0;Vertex Position;1;0;0;8;False;True;True;True;True;True;True;True;False;;False;0
WireConnection;112;0;110;0
WireConnection;112;1;111;0
WireConnection;112;2;145;0
WireConnection;109;0;42;0
WireConnection;109;1;77;0
WireConnection;109;2;41;0
WireConnection;77;0;116;0
WireConnection;77;1;70;0
WireConnection;77;2;70;4
WireConnection;41;1;118;0
WireConnection;70;1;69;0
WireConnection;114;0;112;0
WireConnection;113;0;109;0
WireConnection;113;1;112;0
WireConnection;115;0;109;0
WireConnection;115;1;114;0
WireConnection;116;1;117;0
WireConnection;42;1;43;0
WireConnection;127;0;117;0
WireConnection;127;1;128;0
WireConnection;127;2;129;0
WireConnection;127;3;41;1
WireConnection;127;4;70;4
WireConnection;127;5;142;0
WireConnection;127;6;143;0
WireConnection;120;0;117;0
WireConnection;120;1;121;0
WireConnection;120;2;41;1
WireConnection;120;3;144;0
WireConnection;120;4;70;4
WireConnection;120;5;109;0
WireConnection;120;6;123;0
WireConnection;120;7;124;0
WireConnection;120;8;125;0
WireConnection;120;9;163;0
WireConnection;120;10;170;0
WireConnection;126;1;117;0
WireConnection;122;0;113;0
WireConnection;122;1;120;0
WireConnection;130;0;41;1
WireConnection;130;1;144;0
WireConnection;130;2;70;4
WireConnection;130;3;123;0
WireConnection;130;4;163;0
WireConnection;130;5;170;0
WireConnection;130;6;117;0
WireConnection;130;7;121;0
WireConnection;130;8;125;0
WireConnection;131;0;115;0
WireConnection;131;1;130;0
WireConnection;131;2;117;0
WireConnection;131;3;121;0
WireConnection;131;4;124;0
WireConnection;131;5;125;0
WireConnection;131;6;163;0
WireConnection;131;7;170;0
WireConnection;132;0;144;0
WireConnection;132;1;119;0
WireConnection;132;2;130;0
WireConnection;154;0;144;0
WireConnection;154;1;130;0
WireConnection;140;1;69;0
WireConnection;141;1;43;0
WireConnection;144;0;126;0
WireConnection;144;1;140;0
WireConnection;144;2;70;4
WireConnection;144;3;141;0
WireConnection;144;4;41;1
WireConnection;145;0;140;0
WireConnection;145;1;141;0
WireConnection;145;2;41;1
WireConnection;152;0;122;0
WireConnection;152;1;150;0
WireConnection;152;2;151;0
WireConnection;163;0;117;0
WireConnection;163;1;41;1
WireConnection;163;2;142;0
WireConnection;163;3;143;0
WireConnection;170;0;117;0
WireConnection;170;1;121;0
WireConnection;170;2;163;0
WireConnection;170;3;127;0
WireConnection;1;0;131;0
WireConnection;1;1;127;0
WireConnection;1;4;154;0
WireConnection;1;5;132;0
WireConnection;1;2;152;0
ASEEND*/
//CHKSM=16C4EBBC85786D30C32BDDBA52AC791DC377F7B6