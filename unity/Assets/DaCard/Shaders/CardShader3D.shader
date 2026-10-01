// Made with Amplify Shader Editor v1.9.9.9
// Available at the Unity Asset Store - http://u3d.as/y3X 
Shader "AmplifyCardShader3D"
{
	Properties
	{
		_MainTex( "Card Art", 2D ) = "white" {}
		_CARD_FRONT_MASK( "CARD_FRONT_MASK", 2D ) = "white" {}
		_CARD_BACK( "CARD_BACK", 2D ) = "white" {}
		_CARD_FRONT_BORDER( "CARD_FRONT_BORDER", 2D ) = "white" {}
		_HeightMap( "Height Map", 2D ) = "white" {}
		_heightMax( "heightMax", Float ) = 1
		_heightMin( "heightMin", Float ) = 0
		_edgeFade( "edgeFade", Float ) = 0.06
		_farDepth( "farDepth", Float ) = 0.25
		_skyScale( "skyScale", Float ) = 6
		_depthDarken( "depthDarken", Float ) = 0.5
		_skyBrightness( "skyBrightness", Float ) = 1
		_RarityColor( "Rarity Color", Color ) = ( 0.25, 0.55, 1, 1 )
		_nearDepth( "nearDepth", Float ) = 0.01
		_Steps( "Steps", Float ) = 128
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
		_Roughness( "Roughness", Range( 0, 1 ) ) = 1


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

				#define ASE_NEEDS_TEXTURE_COORDINATES1
				#define ASE_NEEDS_TEXTURE_COORDINATES0
				#define ASE_NEEDS_WORLD_POSITION
				#define ASE_NEEDS_FRAG_WORLD_POSITION
				#define ASE_NEEDS_WORLD_TANGENT
				#define ASE_NEEDS_FRAG_WORLD_TANGENT
				#define ASE_NEEDS_WORLD_NORMAL
				#define ASE_NEEDS_FRAG_WORLD_NORMAL
				#define ASE_NEEDS_FRAG_WORLD_BITANGENT
				#define ASE_NEEDS_FRAG_TEXTURE_COORDINATES0


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
				uniform sampler2D _HeightMap;
				uniform float _Steps;
				uniform float _nearDepth;
				uniform float _farDepth;
				uniform float _heightMin;
				uniform float _heightMax;
				uniform sampler2D _MainTex;
				uniform float _edgeFade;
				uniform float _depthDarken;
				uniform float _skyScale;
				uniform float _skyBrightness;
				uniform float4 _RarityColor;
				uniform sampler2D _CARD_FRONT_BORDER;
				uniform sampler2D _CARD_FRONT_MASK;
				uniform float _ArtGlow;
				uniform float _BorderGlow;
				uniform sampler2D _LayerFoil;
				uniform sampler2D _BackFoil;
				uniform sampler2D _FoilMask;
				uniform float _FoilStrength;
				uniform float _FoilScale;
				uniform float _FoilShift;
				uniform sampler2D _NormalMap;
				uniform float _NormalStrength;
				uniform sampler2D _LayerNormal;
				uniform sampler2D _BackNormal;
				uniform float _DaCardWorld;
				uniform float _WorldGlow;
				uniform float _Roughness;


				float4 ParallaxWindow87( float2 uv, float3 viewTS, sampler2D heightMap, float steps, float4 windowRect, float nearDepth, float farDepth, float heightMin, float heightMax, sampler2D albedo, float edgeFade, float depthDarken, float skyScale, float skyBrightness, float4 rarityColor, out float3 hit )
				{
					// Art box behind the card's window (parallax occlusion inside a recessed frame).
					// Depth-map white sits at nearDepth (just behind the glass), black at farDepth; heightMin/heightMax stretch its contrast.
					// Returns the art colour: sampled at the parallax hit, darkened with depth (depthDarken = brightness at the back of the box)
					// and faded to black toward the box walls over edgeFade (card-width units).
					const float aspect = 63.0 / 88.0;
					float3 v = normalize(viewTS);
					float2 shift = -v.xy / max(v.z, 0.15);
					shift.y *= aspect;
					float2 dx = ddx(uv), dy = ddy(uv);
					int   n     = clamp((int)steps, 1, 64);
					float stepD = (farDepth - nearDepth) / n;
					float  d = nearDepth;
					float2 p = uv;
					float4 art = 0;
					{
					    // ---------- One height map ----------
					    float range = max(heightMax - heightMin, 1e-4);
					    p = uv + shift * d;
					    float  scene = lerp(farDepth, nearDepth, saturate((tex2Dgrad(heightMap, p, dx, dy).r - heightMin) / range));
					    float  prevD = d, prevDiff = scene - d;
					    [loop] for (int i = 0; i < 64; i++)
					    {
					        if (i >= n || d >= scene) break;
					        prevD = d; prevDiff = scene - d;
					        d += stepD;
					        p = uv + shift * d;
					        scene = lerp(farDepth, nearDepth, saturate((tex2Dgrad(heightMap, p, dx, dy).r - heightMin) / range));
					    }
					    float t = prevDiff / max(prevDiff - (scene - d), 1e-5);
					    d = lerp(prevD, d, saturate(t));
					    p = uv + shift * d;
					    art = tex2Dgrad(albedo, p, dx, dy);
					}
					float depth01 = saturate((d - nearDepth) / max(farDepth - nearDepth, 1e-5));
					// ---------- Box walls ----------
					// The art sits on the back of a box: windowRect is the opening, the side walls go straight down.
					// Where the view ray reaches a side wall before it reaches the art, that wall is visible instead.
					float2 toWall = float2(
					    shift.x > 1e-5 ? (windowRect.z - uv.x) / shift.x : (shift.x < -1e-5 ? (windowRect.x - uv.x) / shift.x : 1e5),
					    shift.y > 1e-5 ? (windowRect.w - uv.y) / shift.y : (shift.y < -1e-5 ? (windowRect.y - uv.y) / shift.y : 1e5));
					float dWall = max(min(toWall.x, toWall.y), 0.0);
					float soft = max(edgeFade, 1e-4);
					float wallAmount = 1.0 - smoothstep(-soft, soft, dWall - d);   // 0 = art, 1 = wall (soft crease where they meet)
					float3 artCol = art.rgb * lerp(1.0, depthDarken, depth01);    // deeper parts of the art darker
					// ---------- Wall surface: interior sky (port of Blender material interior_sky, tower9.blend) ----------
					// Starts at the point where the ray meets the wall: sphere-traced FBM nebula + star field + glints + rim,
					// tinted by the card rarity colour. Only evaluated where a wall is visible.
					float3 wall = 0;
					#define SKY_H1(q) frac(sin(dot(q, float3(12.9898, 78.233, 37.719))) * 43758.5453)
					#define SKY_H3(q) frac(sin(float3(dot(q, float3(127.1, 311.7, 74.7)), dot(q, float3(269.5, 183.3, 246.1)), dot(q, float3(113.5, 271.9, 124.6)))) * 43758.5453)
					[branch] if (wallAmount > 0.001)
					{
					    float3 I  = v;                                          // towards the viewer (Blender Incoming)
					    float2 pw = uv + shift * dWall;                         // where the ray meets the wall (UV)
					    float3 wp = float3(pw.x, pw.y / aspect, -dWall);        // wall point, card-width units
					    float3 p0 = wp * skyScale;
					    float3 rc = pow(saturate(rarityColor.rgb), 2.2);        // rarity colour, gamma -> linear
					    // Nebula: 8 steps of ro -= I * (fbm(ro) - 0.45)
					    float3 ro = p0;
					    [loop] for (int s = 0; s < 8; s++)
					    {
					        float3 q = ro * 0.54;
					        float fbm = 0.0, amp = 1.0, norm = 0.0;
					        [unroll] for (int o = 0; o < 6; o++)
					        {
					            float3 i0 = floor(q), f0 = frac(q), w3 = f0 * f0 * (3.0 - 2.0 * f0);
					            float nv = lerp(lerp(lerp(SKY_H1(i0), SKY_H1(i0 + float3(1, 0, 0)), w3.x),
					                                 lerp(SKY_H1(i0 + float3(0, 1, 0)), SKY_H1(i0 + float3(1, 1, 0)), w3.x), w3.y),
					                            lerp(lerp(SKY_H1(i0 + float3(0, 0, 1)), SKY_H1(i0 + float3(1, 0, 1)), w3.x),
					                                 lerp(SKY_H1(i0 + float3(0, 1, 1)), SKY_H1(i0 + float3(1, 1, 1)), w3.x), w3.y), w3.z);
					            fbm += nv * amp; norm += amp; amp *= 0.472; q *= 1.91;
					        }
					        ro -= I * (fbm / norm - 0.45);
					    }
					    float nebulaDepth = saturate(distance(p0, ro));
					    wall = rc * lerp(0.35, 0.07, nebulaDepth);               // clouds: bright where thin, dark where deep
					    // Rim (Layer Weight fresnel)
					    wall += rc * pow(1.0 - saturate(I.z), 5.0) * 0.5;
					    // Glints on the wall: Voronoi cells with a random direction that light up when you look along it
					    float3 gq1 = wp * 2.0, gq2 = wp * 89.2;
					    float3 c1 = 0, c2 = 0; float d1 = 8.0, d2 = 8.0;
					    [unroll] for (int gz = -1; gz <= 1; gz++)
					    [unroll] for (int gy = -1; gy <= 1; gy++)
					    [unroll] for (int gx = -1; gx <= 1; gx++)
					    {
					        float3 o3 = float3(gx, gy, gz);
					        float3 k1 = floor(gq1) + o3;
					        float  e1 = length(k1 + SKY_H3(k1) - gq1);
					        if (e1 < d1) { d1 = e1; c1 = SKY_H3(k1 + 17.0); }
					        float3 k2 = floor(gq2) + o3;
					        float3 a2 = pow(abs(k2 + SKY_H3(k2) - gq2), 0.38);  // Minkowski 0.38: star-shaped cells
					        float  e2 = pow(a2.x + a2.y + a2.z, 1.0 / 0.38);
					        if (e2 < d2) { d2 = e2; c2 = SKY_H3(k2 + 17.0); }
					    }
					    wall += float3(0.045, 0.016, 0.0065) * pow(saturate(dot(I, c1 * 2.0 - 1.0) * 0.5 + 0.5), 10.0);
					    wall += float3(1.0, 0.288, 0.082) * pow(saturate(dot(I, c2 * 2.0 - 1.0) * 0.5 + 0.5), 10.0) * (d2 < 0.8 ? 1.0 : 0.0);
					    // Star field: 16 steps through a field of points (Voronoi F1 * 0.19); rays that pass a star stall
					    float3 rs = p0;
					    [loop] for (int k = 0; k < 16; k++)
					    {
					        float3 sq = rs * 4.53, sc = floor(sq);
					        float dm = 8.0;
					        [unroll] for (int sz = -1; sz <= 1; sz++)
					        [unroll] for (int sy = -1; sy <= 1; sy++)
					        [unroll] for (int sx = -1; sx <= 1; sx++)
					        {
					            float3 cc = sc + float3(sx, sy, sz);
					            dm = min(dm, length(cc + SKY_H3(cc) - sq));
					        }
					        rs -= I * (dm * 0.19);
					    }
					    float star = saturate(pow(1.25 / (distance(p0, rs) + 1.0), lerp(30.0, 10.0, nebulaDepth)) * 5.0);
					    float3 starCol = star < 0.089 ? lerp(float3(0, 0, 0), float3(0.5, 0.292, 0.196), saturate((star - 0.027) / 0.062))
					                   : star < 0.359 ? lerp(float3(0.5, 0.292, 0.196), float3(1, 1, 1), (star - 0.089) / 0.27)
					                   : star < 0.5   ? lerp(float3(1, 1, 1), float3(0.5, 0, 0), (star - 0.359) / 0.141)
					                   :                lerp(float3(0.5, 0, 0), float3(0.258, 0.528, 1.0), (star - 0.5) / 0.5);
					    wall += starCol * star;
					    wall *= lerp(1.0, depthDarken, saturate(dWall / max(farDepth, 1e-5)));   // deeper down the wall = darker
					    wall = pow(saturate(wall * skyBrightness), 1.0 / 2.2);                    // linear -> this project gamma space
					}
					hit = float3( p, 1.0 - wallAmount );             // for the normal map: hit UV, share of art (not wall)
					return float4(lerp(artCol, wall, wallAmount), art.a);
				}
				
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
				
				float CardFoilMetal130( float frontMask, float4 foilMask, float border, float strength )
				{
					return foilMask.r * saturate( strength * 1.5 );
				}
				
				float CardSmoothness132( float4 surface, float strength, float roughness )
				{
					float rough = lerp( roughness, surface.g, surface.a );
					return lerp( 1.0 - rough, 0.9, surface.r * saturate( strength * 1.5 ) );
				}
				
				float CardMetallic154( float4 surface, float foilMetal )
				{
					return max( surface.b, foilMetal );
				}
				
				float3 CardFoilAlbedo131( float4 albedo, float metal, float2 uv, float3 viewTS, float scale, float tiltShift )
				{
					// Albedo of the foil area. Where the card is metallic (metal, from CardFoilMetal) the albedo is the colour of its
					// reflections, so this gives the lights' highlights and the reflections the same sliding rainbow bands as CardFoil.
					float3 v = normalize(viewTS);
					float2 tilt = v.xy / max(v.z, 0.25);
					float grain = sin(dot(uv, float2(173.1, 61.7))) * sin(dot(uv, float2(-47.3, 211.9)));
					float phase = dot(uv, float2(0.6, 1.0)) * scale + dot(tilt, float2(0.8, 0.5)) * tiltShift + grain * 0.06;
					float3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + float3(0.0, 0.333, 0.667)));
					float3 foil = saturate(rainbow * 0.85 + albedo.rgb * 0.35);
					return lerp(albedo.rgb, foil, metal);
				}
				
				float3 CardNormal126( float3 hit, float2 uv, sampler2D normalMap, float strength, float frontMask, float border, sampler2D layerNormal, sampler2D backNormal )
				{
					// Bump detail, tangent space (OpenGL / Unity convention: green = up), so the card catches the game's lights. Front: the
					// card layers' normals (_LayerNormal, stacked by the client, on the glass) over the picture's normal map at the parallax
					// hit (hit = ParallaxWindow's hit, xy: UV, z: how much art, not box wall, is seen there; flat on the walls) where no layer
					// covers it (border = the layers' coverage). Back: the back layers' (_BackNormal). Default textures "bump" = flat.
					float3 base = tex2Dgrad( normalMap, hit.xy, ddx( uv ), ddy( uv ) ).xyz * 2.0 - 1.0;
					base = lerp( float3( 0, 0, 1 ), base, saturate( hit.z ) );
					float3 layer = tex2D( layerNormal, uv ).xyz * 2.0 - 1.0;
					float3 back = tex2D( backNormal, uv ).xyz * 2.0 - 1.0;
					float3 n = lerp( back, lerp( base, layer, border ), saturate( frontMask ) );
					n.xy *= strength;
					return normalize( n );
				}
				
				float3 CardFoil120( float2 uv, float3 viewTS, float frontMask, float4 foilMask, float border, float4 baseColor, float strength, float scale, float tiltShift )
				{
					// Holographic foil on the card art: rainbow bands that slide across the card as it tilts,
					// plus a brighter glint band sweeping diagonally. Added on top of emission.
					// Only where frontMask is set (not the back), not under the frame (border = frame alpha), and inside
					// foilMask (card.foil.png: white/opaque = foil, black/transparent = plain print, default white = the whole art).
					float area = foilMask.r;   // CardLayerFoil: layers and picture, front and back
					float3 v = normalize(viewTS);
					float2 tilt = v.xy / max(v.z, 0.25);
					float grain = sin(dot(uv, float2(173.1, 61.7))) * sin(dot(uv, float2(-47.3, 211.9)));
					float phase = dot(uv, float2(0.6, 1.0)) * scale + dot(tilt, float2(0.8, 0.5)) * tiltShift + grain * 0.06;
					float3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + float3(0.0, 0.333, 0.667)));
					float sweep = dot(uv - 0.5, float2(0.8, 0.6)) + dot(tilt, float2(0.45, 0.3)) * tiltShift;
					float glint = pow(saturate(1.0 - abs(sweep) * 2.5), 4.0);
					float luma = dot(baseColor.rgb, float3(0.299, 0.587, 0.114));
					float3 foil = rainbow * (0.3 + 0.7 * luma) * (0.35 + 0.65 * glint) + glint * 0.25;
					return foil * strength * area;
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

					o.ase_texcoord6.xy = v.texcoord1.xyzw.xy;
					o.ase_texcoord6.zw = v.texcoord.xyzw.xy;

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
					float2 texCoord95 = IN.ase_texcoord6.zw * float2( 1,1 ) + float2( 0,0 );
					float2 uv87 = texCoord95;
					float3 tanToWorld0 = float3( TangentWS.x, BitangentWS.x, NormalWS.x );
					float3 tanToWorld1 = float3( TangentWS.y, BitangentWS.y, NormalWS.y );
					float3 tanToWorld2 = float3( TangentWS.z, BitangentWS.z, NormalWS.z );
					float3 ase_viewVectorTS =  tanToWorld0 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - PositionWS : UNITY_MATRIX_V[ 2 ].xyz ).x + tanToWorld1 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - PositionWS : UNITY_MATRIX_V[ 2 ].xyz ).y  + tanToWorld2 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - PositionWS : UNITY_MATRIX_V[ 2 ].xyz ).z;
					float3 ase_viewDirTS = normalize( ase_viewVectorTS );
					float3 viewTS87 = ase_viewDirTS;
					sampler2D heightMap87 = _HeightMap;
					float steps87 = _Steps;
					float4 windowRect87 = float4( 0.031,0.022,0.969,0.978 );
					float nearDepth87 = _nearDepth;
					float farDepth87 = _farDepth;
					float heightMin87 = _heightMin;
					float heightMax87 = _heightMax;
					sampler2D albedo87 = _MainTex;
					float edgeFade87 = _edgeFade;
					float depthDarken87 = _depthDarken;
					float skyScale87 = _skyScale;
					float skyBrightness87 = _skyBrightness;
					float4 rarityColor87 = _RarityColor;
					float3 hit87 = float3( 0,0,0 );
					float4 localParallaxWindow87 = ParallaxWindow87( uv87 , viewTS87 , heightMap87 , steps87 , windowRect87 , nearDepth87 , farDepth87 , heightMin87 , heightMax87 , albedo87 , edgeFade87 , depthDarken87 , skyScale87 , skyBrightness87 , rarityColor87 , hit87 );
					float2 texCoord69 = IN.ase_texcoord6.zw * float2( 1,1 ) + float2( 0,0 );
					float4 tex2DNode70 = tex2D( _CARD_FRONT_BORDER, texCoord69 );
					float4 lerpResult77 = lerp( localParallaxWindow87 , tex2DNode70 , tex2DNode70.a);
					float4 tex2DNode41 = tex2D( _CARD_FRONT_MASK, texCoord43 );
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
					float4 baseFoil144 = tex2D( _FoilMask, texCoord95 );
					float4 layerFoil144 = tex2DNode140;
					float layers144 = tex2DNode70.a;
					float4 backFoil144 = tex2DNode141;
					float frontMask144 = tex2DNode41.r;
					float4 localCardLayerFoil144 = CardLayerFoil144( baseFoil144 , layerFoil144 , layers144 , backFoil144 , frontMask144 );
					float4 foilMask130 = localCardLayerFoil144;
					float border130 = tex2DNode70.a;
					float strength130 = _FoilStrength;
					float localCardFoilMetal130 = CardFoilMetal130( frontMask130 , foilMask130 , border130 , strength130 );
					float metal131 = localCardFoilMetal130;
					float2 uv131 = texCoord95;
					float3 viewTS131 = ase_viewDirTS;
					float scale131 = _FoilScale;
					float tiltShift131 = _FoilShift;
					float3 localCardFoilAlbedo131 = CardFoilAlbedo131( albedo131 , metal131 , uv131 , viewTS131 , scale131 , tiltShift131 );
					
					float3 hit126 = hit87;
					float2 uv126 = texCoord95;
					sampler2D normalMap126 = _NormalMap;
					float strength126 = _NormalStrength;
					float frontMask126 = tex2DNode41.r;
					float border126 = tex2DNode70.a;
					sampler2D layerNormal126 = _LayerNormal;
					sampler2D backNormal126 = _BackNormal;
					float3 localCardNormal126 = CardNormal126( hit126 , uv126 , normalMap126 , strength126 , frontMask126 , border126 , layerNormal126 , backNormal126 );
					
					float4 surface132 = localCardLayerFoil144;
					float strength132 = _FoilStrength;
					float roughness132 = _Roughness;
					float localCardSmoothness132 = CardSmoothness132( surface132 , strength132 , roughness132 );
					float4 surface154 = localCardLayerFoil144;
					float foilMetal154 = localCardFoilMetal130;
					float localCardMetallic154 = CardMetallic154( surface154 , foilMetal154 );
					
					float2 uv120 = texCoord95;
					float3 viewTS120 = ase_viewDirTS;
					float frontMask120 = tex2DNode41.r;
					float4 foilMask120 = localCardLayerFoil144;
					float border120 = tex2DNode70.a;
					float4 baseColor120 = lerpResult109;
					float strength120 = _FoilStrength;
					float scale120 = _FoilScale;
					float tiltShift120 = _FoilShift;
					float3 localCardFoil120 = CardFoil120( uv120 , viewTS120 , frontMask120 , foilMask120 , border120 , baseColor120 , strength120 , scale120 , tiltShift120 );
					float3 emission152 = ( ( lerpResult109 * lerpResult112 ) + float4( localCardFoil120 , 0.0 ) ).rgb;
					float world152 = _DaCardWorld;
					float worldGlow152 = _WorldGlow;
					float3 localCardWorldEmission152 = CardWorldEmission152( emission152 , world152 , worldGlow152 );
					

					o.Albedo = localCardFoilAlbedo131;
					o.Normal = localCardNormal126;

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

				#define ASE_NEEDS_TEXTURE_COORDINATES1
				#define ASE_NEEDS_TEXTURE_COORDINATES0
				#define ASE_NEEDS_WORLD_POSITION
				#define ASE_NEEDS_FRAG_WORLD_POSITION
				#define ASE_NEEDS_FRAG_WORLD_TANGENT
				#define ASE_NEEDS_WORLD_NORMAL
				#define ASE_NEEDS_FRAG_WORLD_NORMAL
				#define ASE_NEEDS_FRAG_WORLD_BITANGENT
				#define ASE_NEEDS_FRAG_TEXTURE_COORDINATES0


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
				uniform sampler2D _HeightMap;
				uniform float _Steps;
				uniform float _nearDepth;
				uniform float _farDepth;
				uniform float _heightMin;
				uniform float _heightMax;
				uniform sampler2D _MainTex;
				uniform float _edgeFade;
				uniform float _depthDarken;
				uniform float _skyScale;
				uniform float _skyBrightness;
				uniform float4 _RarityColor;
				uniform sampler2D _CARD_FRONT_BORDER;
				uniform sampler2D _CARD_FRONT_MASK;
				uniform float _ArtGlow;
				uniform float _BorderGlow;
				uniform sampler2D _LayerFoil;
				uniform sampler2D _BackFoil;
				uniform sampler2D _FoilMask;
				uniform float _FoilStrength;
				uniform float _FoilScale;
				uniform float _FoilShift;
				uniform sampler2D _NormalMap;
				uniform float _NormalStrength;
				uniform sampler2D _LayerNormal;
				uniform sampler2D _BackNormal;
				uniform float _DaCardWorld;
				uniform float _WorldGlow;
				uniform float _Roughness;


				float4 ParallaxWindow87( float2 uv, float3 viewTS, sampler2D heightMap, float steps, float4 windowRect, float nearDepth, float farDepth, float heightMin, float heightMax, sampler2D albedo, float edgeFade, float depthDarken, float skyScale, float skyBrightness, float4 rarityColor, out float3 hit )
				{
					// Art box behind the card's window (parallax occlusion inside a recessed frame).
					// Depth-map white sits at nearDepth (just behind the glass), black at farDepth; heightMin/heightMax stretch its contrast.
					// Returns the art colour: sampled at the parallax hit, darkened with depth (depthDarken = brightness at the back of the box)
					// and faded to black toward the box walls over edgeFade (card-width units).
					const float aspect = 63.0 / 88.0;
					float3 v = normalize(viewTS);
					float2 shift = -v.xy / max(v.z, 0.15);
					shift.y *= aspect;
					float2 dx = ddx(uv), dy = ddy(uv);
					int   n     = clamp((int)steps, 1, 64);
					float stepD = (farDepth - nearDepth) / n;
					float  d = nearDepth;
					float2 p = uv;
					float4 art = 0;
					{
					    // ---------- One height map ----------
					    float range = max(heightMax - heightMin, 1e-4);
					    p = uv + shift * d;
					    float  scene = lerp(farDepth, nearDepth, saturate((tex2Dgrad(heightMap, p, dx, dy).r - heightMin) / range));
					    float  prevD = d, prevDiff = scene - d;
					    [loop] for (int i = 0; i < 64; i++)
					    {
					        if (i >= n || d >= scene) break;
					        prevD = d; prevDiff = scene - d;
					        d += stepD;
					        p = uv + shift * d;
					        scene = lerp(farDepth, nearDepth, saturate((tex2Dgrad(heightMap, p, dx, dy).r - heightMin) / range));
					    }
					    float t = prevDiff / max(prevDiff - (scene - d), 1e-5);
					    d = lerp(prevD, d, saturate(t));
					    p = uv + shift * d;
					    art = tex2Dgrad(albedo, p, dx, dy);
					}
					float depth01 = saturate((d - nearDepth) / max(farDepth - nearDepth, 1e-5));
					// ---------- Box walls ----------
					// The art sits on the back of a box: windowRect is the opening, the side walls go straight down.
					// Where the view ray reaches a side wall before it reaches the art, that wall is visible instead.
					float2 toWall = float2(
					    shift.x > 1e-5 ? (windowRect.z - uv.x) / shift.x : (shift.x < -1e-5 ? (windowRect.x - uv.x) / shift.x : 1e5),
					    shift.y > 1e-5 ? (windowRect.w - uv.y) / shift.y : (shift.y < -1e-5 ? (windowRect.y - uv.y) / shift.y : 1e5));
					float dWall = max(min(toWall.x, toWall.y), 0.0);
					float soft = max(edgeFade, 1e-4);
					float wallAmount = 1.0 - smoothstep(-soft, soft, dWall - d);   // 0 = art, 1 = wall (soft crease where they meet)
					float3 artCol = art.rgb * lerp(1.0, depthDarken, depth01);    // deeper parts of the art darker
					// ---------- Wall surface: interior sky (port of Blender material interior_sky, tower9.blend) ----------
					// Starts at the point where the ray meets the wall: sphere-traced FBM nebula + star field + glints + rim,
					// tinted by the card rarity colour. Only evaluated where a wall is visible.
					float3 wall = 0;
					#define SKY_H1(q) frac(sin(dot(q, float3(12.9898, 78.233, 37.719))) * 43758.5453)
					#define SKY_H3(q) frac(sin(float3(dot(q, float3(127.1, 311.7, 74.7)), dot(q, float3(269.5, 183.3, 246.1)), dot(q, float3(113.5, 271.9, 124.6)))) * 43758.5453)
					[branch] if (wallAmount > 0.001)
					{
					    float3 I  = v;                                          // towards the viewer (Blender Incoming)
					    float2 pw = uv + shift * dWall;                         // where the ray meets the wall (UV)
					    float3 wp = float3(pw.x, pw.y / aspect, -dWall);        // wall point, card-width units
					    float3 p0 = wp * skyScale;
					    float3 rc = pow(saturate(rarityColor.rgb), 2.2);        // rarity colour, gamma -> linear
					    // Nebula: 8 steps of ro -= I * (fbm(ro) - 0.45)
					    float3 ro = p0;
					    [loop] for (int s = 0; s < 8; s++)
					    {
					        float3 q = ro * 0.54;
					        float fbm = 0.0, amp = 1.0, norm = 0.0;
					        [unroll] for (int o = 0; o < 6; o++)
					        {
					            float3 i0 = floor(q), f0 = frac(q), w3 = f0 * f0 * (3.0 - 2.0 * f0);
					            float nv = lerp(lerp(lerp(SKY_H1(i0), SKY_H1(i0 + float3(1, 0, 0)), w3.x),
					                                 lerp(SKY_H1(i0 + float3(0, 1, 0)), SKY_H1(i0 + float3(1, 1, 0)), w3.x), w3.y),
					                            lerp(lerp(SKY_H1(i0 + float3(0, 0, 1)), SKY_H1(i0 + float3(1, 0, 1)), w3.x),
					                                 lerp(SKY_H1(i0 + float3(0, 1, 1)), SKY_H1(i0 + float3(1, 1, 1)), w3.x), w3.y), w3.z);
					            fbm += nv * amp; norm += amp; amp *= 0.472; q *= 1.91;
					        }
					        ro -= I * (fbm / norm - 0.45);
					    }
					    float nebulaDepth = saturate(distance(p0, ro));
					    wall = rc * lerp(0.35, 0.07, nebulaDepth);               // clouds: bright where thin, dark where deep
					    // Rim (Layer Weight fresnel)
					    wall += rc * pow(1.0 - saturate(I.z), 5.0) * 0.5;
					    // Glints on the wall: Voronoi cells with a random direction that light up when you look along it
					    float3 gq1 = wp * 2.0, gq2 = wp * 89.2;
					    float3 c1 = 0, c2 = 0; float d1 = 8.0, d2 = 8.0;
					    [unroll] for (int gz = -1; gz <= 1; gz++)
					    [unroll] for (int gy = -1; gy <= 1; gy++)
					    [unroll] for (int gx = -1; gx <= 1; gx++)
					    {
					        float3 o3 = float3(gx, gy, gz);
					        float3 k1 = floor(gq1) + o3;
					        float  e1 = length(k1 + SKY_H3(k1) - gq1);
					        if (e1 < d1) { d1 = e1; c1 = SKY_H3(k1 + 17.0); }
					        float3 k2 = floor(gq2) + o3;
					        float3 a2 = pow(abs(k2 + SKY_H3(k2) - gq2), 0.38);  // Minkowski 0.38: star-shaped cells
					        float  e2 = pow(a2.x + a2.y + a2.z, 1.0 / 0.38);
					        if (e2 < d2) { d2 = e2; c2 = SKY_H3(k2 + 17.0); }
					    }
					    wall += float3(0.045, 0.016, 0.0065) * pow(saturate(dot(I, c1 * 2.0 - 1.0) * 0.5 + 0.5), 10.0);
					    wall += float3(1.0, 0.288, 0.082) * pow(saturate(dot(I, c2 * 2.0 - 1.0) * 0.5 + 0.5), 10.0) * (d2 < 0.8 ? 1.0 : 0.0);
					    // Star field: 16 steps through a field of points (Voronoi F1 * 0.19); rays that pass a star stall
					    float3 rs = p0;
					    [loop] for (int k = 0; k < 16; k++)
					    {
					        float3 sq = rs * 4.53, sc = floor(sq);
					        float dm = 8.0;
					        [unroll] for (int sz = -1; sz <= 1; sz++)
					        [unroll] for (int sy = -1; sy <= 1; sy++)
					        [unroll] for (int sx = -1; sx <= 1; sx++)
					        {
					            float3 cc = sc + float3(sx, sy, sz);
					            dm = min(dm, length(cc + SKY_H3(cc) - sq));
					        }
					        rs -= I * (dm * 0.19);
					    }
					    float star = saturate(pow(1.25 / (distance(p0, rs) + 1.0), lerp(30.0, 10.0, nebulaDepth)) * 5.0);
					    float3 starCol = star < 0.089 ? lerp(float3(0, 0, 0), float3(0.5, 0.292, 0.196), saturate((star - 0.027) / 0.062))
					                   : star < 0.359 ? lerp(float3(0.5, 0.292, 0.196), float3(1, 1, 1), (star - 0.089) / 0.27)
					                   : star < 0.5   ? lerp(float3(1, 1, 1), float3(0.5, 0, 0), (star - 0.359) / 0.141)
					                   :                lerp(float3(0.5, 0, 0), float3(0.258, 0.528, 1.0), (star - 0.5) / 0.5);
					    wall += starCol * star;
					    wall *= lerp(1.0, depthDarken, saturate(dWall / max(farDepth, 1e-5)));   // deeper down the wall = darker
					    wall = pow(saturate(wall * skyBrightness), 1.0 / 2.2);                    // linear -> this project gamma space
					}
					hit = float3( p, 1.0 - wallAmount );             // for the normal map: hit UV, share of art (not wall)
					return float4(lerp(artCol, wall, wallAmount), art.a);
				}
				
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
				
				float CardFoilMetal130( float frontMask, float4 foilMask, float border, float strength )
				{
					return foilMask.r * saturate( strength * 1.5 );
				}
				
				float CardSmoothness132( float4 surface, float strength, float roughness )
				{
					float rough = lerp( roughness, surface.g, surface.a );
					return lerp( 1.0 - rough, 0.9, surface.r * saturate( strength * 1.5 ) );
				}
				
				float CardMetallic154( float4 surface, float foilMetal )
				{
					return max( surface.b, foilMetal );
				}
				
				float3 CardFoilAlbedo131( float4 albedo, float metal, float2 uv, float3 viewTS, float scale, float tiltShift )
				{
					// Albedo of the foil area. Where the card is metallic (metal, from CardFoilMetal) the albedo is the colour of its
					// reflections, so this gives the lights' highlights and the reflections the same sliding rainbow bands as CardFoil.
					float3 v = normalize(viewTS);
					float2 tilt = v.xy / max(v.z, 0.25);
					float grain = sin(dot(uv, float2(173.1, 61.7))) * sin(dot(uv, float2(-47.3, 211.9)));
					float phase = dot(uv, float2(0.6, 1.0)) * scale + dot(tilt, float2(0.8, 0.5)) * tiltShift + grain * 0.06;
					float3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + float3(0.0, 0.333, 0.667)));
					float3 foil = saturate(rainbow * 0.85 + albedo.rgb * 0.35);
					return lerp(albedo.rgb, foil, metal);
				}
				
				float3 CardNormal126( float3 hit, float2 uv, sampler2D normalMap, float strength, float frontMask, float border, sampler2D layerNormal, sampler2D backNormal )
				{
					// Bump detail, tangent space (OpenGL / Unity convention: green = up), so the card catches the game's lights. Front: the
					// card layers' normals (_LayerNormal, stacked by the client, on the glass) over the picture's normal map at the parallax
					// hit (hit = ParallaxWindow's hit, xy: UV, z: how much art, not box wall, is seen there; flat on the walls) where no layer
					// covers it (border = the layers' coverage). Back: the back layers' (_BackNormal). Default textures "bump" = flat.
					float3 base = tex2Dgrad( normalMap, hit.xy, ddx( uv ), ddy( uv ) ).xyz * 2.0 - 1.0;
					base = lerp( float3( 0, 0, 1 ), base, saturate( hit.z ) );
					float3 layer = tex2D( layerNormal, uv ).xyz * 2.0 - 1.0;
					float3 back = tex2D( backNormal, uv ).xyz * 2.0 - 1.0;
					float3 n = lerp( back, lerp( base, layer, border ), saturate( frontMask ) );
					n.xy *= strength;
					return normalize( n );
				}
				
				float3 CardFoil120( float2 uv, float3 viewTS, float frontMask, float4 foilMask, float border, float4 baseColor, float strength, float scale, float tiltShift )
				{
					// Holographic foil on the card art: rainbow bands that slide across the card as it tilts,
					// plus a brighter glint band sweeping diagonally. Added on top of emission.
					// Only where frontMask is set (not the back), not under the frame (border = frame alpha), and inside
					// foilMask (card.foil.png: white/opaque = foil, black/transparent = plain print, default white = the whole art).
					float area = foilMask.r;   // CardLayerFoil: layers and picture, front and back
					float3 v = normalize(viewTS);
					float2 tilt = v.xy / max(v.z, 0.25);
					float grain = sin(dot(uv, float2(173.1, 61.7))) * sin(dot(uv, float2(-47.3, 211.9)));
					float phase = dot(uv, float2(0.6, 1.0)) * scale + dot(tilt, float2(0.8, 0.5)) * tiltShift + grain * 0.06;
					float3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + float3(0.0, 0.333, 0.667)));
					float sweep = dot(uv - 0.5, float2(0.8, 0.6)) + dot(tilt, float2(0.45, 0.3)) * tiltShift;
					float glint = pow(saturate(1.0 - abs(sweep) * 2.5), 4.0);
					float luma = dot(baseColor.rgb, float3(0.299, 0.587, 0.114));
					float3 foil = rainbow * (0.3 + 0.7 * luma) * (0.35 + 0.65 * glint) + glint * 0.25;
					return foil * strength * area;
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

					o.ase_texcoord5.xy = v.texcoord1.xyzw.xy;
					o.ase_texcoord5.zw = v.texcoord.xyzw.xy;

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
					float2 texCoord95 = IN.ase_texcoord5.zw * float2( 1,1 ) + float2( 0,0 );
					float2 uv87 = texCoord95;
					float3 tanToWorld0 = float3( TangentWS.x, BitangentWS.x, NormalWS.x );
					float3 tanToWorld1 = float3( TangentWS.y, BitangentWS.y, NormalWS.y );
					float3 tanToWorld2 = float3( TangentWS.z, BitangentWS.z, NormalWS.z );
					float3 ase_viewVectorTS =  tanToWorld0 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - PositionWS : UNITY_MATRIX_V[ 2 ].xyz ).x + tanToWorld1 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - PositionWS : UNITY_MATRIX_V[ 2 ].xyz ).y  + tanToWorld2 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - PositionWS : UNITY_MATRIX_V[ 2 ].xyz ).z;
					float3 ase_viewDirTS = normalize( ase_viewVectorTS );
					float3 viewTS87 = ase_viewDirTS;
					sampler2D heightMap87 = _HeightMap;
					float steps87 = _Steps;
					float4 windowRect87 = float4( 0.031,0.022,0.969,0.978 );
					float nearDepth87 = _nearDepth;
					float farDepth87 = _farDepth;
					float heightMin87 = _heightMin;
					float heightMax87 = _heightMax;
					sampler2D albedo87 = _MainTex;
					float edgeFade87 = _edgeFade;
					float depthDarken87 = _depthDarken;
					float skyScale87 = _skyScale;
					float skyBrightness87 = _skyBrightness;
					float4 rarityColor87 = _RarityColor;
					float3 hit87 = float3( 0,0,0 );
					float4 localParallaxWindow87 = ParallaxWindow87( uv87 , viewTS87 , heightMap87 , steps87 , windowRect87 , nearDepth87 , farDepth87 , heightMin87 , heightMax87 , albedo87 , edgeFade87 , depthDarken87 , skyScale87 , skyBrightness87 , rarityColor87 , hit87 );
					float2 texCoord69 = IN.ase_texcoord5.zw * float2( 1,1 ) + float2( 0,0 );
					float4 tex2DNode70 = tex2D( _CARD_FRONT_BORDER, texCoord69 );
					float4 lerpResult77 = lerp( localParallaxWindow87 , tex2DNode70 , tex2DNode70.a);
					float4 tex2DNode41 = tex2D( _CARD_FRONT_MASK, texCoord43 );
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
					float4 baseFoil144 = tex2D( _FoilMask, texCoord95 );
					float4 layerFoil144 = tex2DNode140;
					float layers144 = tex2DNode70.a;
					float4 backFoil144 = tex2DNode141;
					float frontMask144 = tex2DNode41.r;
					float4 localCardLayerFoil144 = CardLayerFoil144( baseFoil144 , layerFoil144 , layers144 , backFoil144 , frontMask144 );
					float4 foilMask130 = localCardLayerFoil144;
					float border130 = tex2DNode70.a;
					float strength130 = _FoilStrength;
					float localCardFoilMetal130 = CardFoilMetal130( frontMask130 , foilMask130 , border130 , strength130 );
					float metal131 = localCardFoilMetal130;
					float2 uv131 = texCoord95;
					float3 viewTS131 = ase_viewDirTS;
					float scale131 = _FoilScale;
					float tiltShift131 = _FoilShift;
					float3 localCardFoilAlbedo131 = CardFoilAlbedo131( albedo131 , metal131 , uv131 , viewTS131 , scale131 , tiltShift131 );
					
					float3 hit126 = hit87;
					float2 uv126 = texCoord95;
					sampler2D normalMap126 = _NormalMap;
					float strength126 = _NormalStrength;
					float frontMask126 = tex2DNode41.r;
					float border126 = tex2DNode70.a;
					sampler2D layerNormal126 = _LayerNormal;
					sampler2D backNormal126 = _BackNormal;
					float3 localCardNormal126 = CardNormal126( hit126 , uv126 , normalMap126 , strength126 , frontMask126 , border126 , layerNormal126 , backNormal126 );
					
					float4 surface132 = localCardLayerFoil144;
					float strength132 = _FoilStrength;
					float roughness132 = _Roughness;
					float localCardSmoothness132 = CardSmoothness132( surface132 , strength132 , roughness132 );
					float4 surface154 = localCardLayerFoil144;
					float foilMetal154 = localCardFoilMetal130;
					float localCardMetallic154 = CardMetallic154( surface154 , foilMetal154 );
					
					float2 uv120 = texCoord95;
					float3 viewTS120 = ase_viewDirTS;
					float frontMask120 = tex2DNode41.r;
					float4 foilMask120 = localCardLayerFoil144;
					float border120 = tex2DNode70.a;
					float4 baseColor120 = lerpResult109;
					float strength120 = _FoilStrength;
					float scale120 = _FoilScale;
					float tiltShift120 = _FoilShift;
					float3 localCardFoil120 = CardFoil120( uv120 , viewTS120 , frontMask120 , foilMask120 , border120 , baseColor120 , strength120 , scale120 , tiltShift120 );
					float3 emission152 = ( ( lerpResult109 * lerpResult112 ) + float4( localCardFoil120 , 0.0 ) ).rgb;
					float world152 = _DaCardWorld;
					float worldGlow152 = _WorldGlow;
					float3 localCardWorldEmission152 = CardWorldEmission152( emission152 , world152 , worldGlow152 );
					

					o.Albedo = localCardFoilAlbedo131;
					o.Normal = localCardNormal126;

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

				#define ASE_NEEDS_TEXTURE_COORDINATES1
				#define ASE_NEEDS_TEXTURE_COORDINATES0
				#define ASE_NEEDS_WORLD_POSITION
				#define ASE_NEEDS_FRAG_WORLD_POSITION
				#define ASE_NEEDS_WORLD_TANGENT
				#define ASE_NEEDS_FRAG_WORLD_TANGENT
				#define ASE_NEEDS_WORLD_NORMAL
				#define ASE_NEEDS_FRAG_WORLD_NORMAL
				#define ASE_NEEDS_FRAG_WORLD_BITANGENT
				#define ASE_NEEDS_FRAG_TEXTURE_COORDINATES0


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
				uniform sampler2D _HeightMap;
				uniform float _Steps;
				uniform float _nearDepth;
				uniform float _farDepth;
				uniform float _heightMin;
				uniform float _heightMax;
				uniform sampler2D _MainTex;
				uniform float _edgeFade;
				uniform float _depthDarken;
				uniform float _skyScale;
				uniform float _skyBrightness;
				uniform float4 _RarityColor;
				uniform sampler2D _CARD_FRONT_BORDER;
				uniform sampler2D _CARD_FRONT_MASK;
				uniform float _ArtGlow;
				uniform float _BorderGlow;
				uniform sampler2D _LayerFoil;
				uniform sampler2D _BackFoil;
				uniform sampler2D _FoilMask;
				uniform float _FoilStrength;
				uniform float _FoilScale;
				uniform float _FoilShift;
				uniform sampler2D _NormalMap;
				uniform float _NormalStrength;
				uniform sampler2D _LayerNormal;
				uniform sampler2D _BackNormal;
				uniform float _DaCardWorld;
				uniform float _WorldGlow;
				uniform float _Roughness;


				float4 ParallaxWindow87( float2 uv, float3 viewTS, sampler2D heightMap, float steps, float4 windowRect, float nearDepth, float farDepth, float heightMin, float heightMax, sampler2D albedo, float edgeFade, float depthDarken, float skyScale, float skyBrightness, float4 rarityColor, out float3 hit )
				{
					// Art box behind the card's window (parallax occlusion inside a recessed frame).
					// Depth-map white sits at nearDepth (just behind the glass), black at farDepth; heightMin/heightMax stretch its contrast.
					// Returns the art colour: sampled at the parallax hit, darkened with depth (depthDarken = brightness at the back of the box)
					// and faded to black toward the box walls over edgeFade (card-width units).
					const float aspect = 63.0 / 88.0;
					float3 v = normalize(viewTS);
					float2 shift = -v.xy / max(v.z, 0.15);
					shift.y *= aspect;
					float2 dx = ddx(uv), dy = ddy(uv);
					int   n     = clamp((int)steps, 1, 64);
					float stepD = (farDepth - nearDepth) / n;
					float  d = nearDepth;
					float2 p = uv;
					float4 art = 0;
					{
					    // ---------- One height map ----------
					    float range = max(heightMax - heightMin, 1e-4);
					    p = uv + shift * d;
					    float  scene = lerp(farDepth, nearDepth, saturate((tex2Dgrad(heightMap, p, dx, dy).r - heightMin) / range));
					    float  prevD = d, prevDiff = scene - d;
					    [loop] for (int i = 0; i < 64; i++)
					    {
					        if (i >= n || d >= scene) break;
					        prevD = d; prevDiff = scene - d;
					        d += stepD;
					        p = uv + shift * d;
					        scene = lerp(farDepth, nearDepth, saturate((tex2Dgrad(heightMap, p, dx, dy).r - heightMin) / range));
					    }
					    float t = prevDiff / max(prevDiff - (scene - d), 1e-5);
					    d = lerp(prevD, d, saturate(t));
					    p = uv + shift * d;
					    art = tex2Dgrad(albedo, p, dx, dy);
					}
					float depth01 = saturate((d - nearDepth) / max(farDepth - nearDepth, 1e-5));
					// ---------- Box walls ----------
					// The art sits on the back of a box: windowRect is the opening, the side walls go straight down.
					// Where the view ray reaches a side wall before it reaches the art, that wall is visible instead.
					float2 toWall = float2(
					    shift.x > 1e-5 ? (windowRect.z - uv.x) / shift.x : (shift.x < -1e-5 ? (windowRect.x - uv.x) / shift.x : 1e5),
					    shift.y > 1e-5 ? (windowRect.w - uv.y) / shift.y : (shift.y < -1e-5 ? (windowRect.y - uv.y) / shift.y : 1e5));
					float dWall = max(min(toWall.x, toWall.y), 0.0);
					float soft = max(edgeFade, 1e-4);
					float wallAmount = 1.0 - smoothstep(-soft, soft, dWall - d);   // 0 = art, 1 = wall (soft crease where they meet)
					float3 artCol = art.rgb * lerp(1.0, depthDarken, depth01);    // deeper parts of the art darker
					// ---------- Wall surface: interior sky (port of Blender material interior_sky, tower9.blend) ----------
					// Starts at the point where the ray meets the wall: sphere-traced FBM nebula + star field + glints + rim,
					// tinted by the card rarity colour. Only evaluated where a wall is visible.
					float3 wall = 0;
					#define SKY_H1(q) frac(sin(dot(q, float3(12.9898, 78.233, 37.719))) * 43758.5453)
					#define SKY_H3(q) frac(sin(float3(dot(q, float3(127.1, 311.7, 74.7)), dot(q, float3(269.5, 183.3, 246.1)), dot(q, float3(113.5, 271.9, 124.6)))) * 43758.5453)
					[branch] if (wallAmount > 0.001)
					{
					    float3 I  = v;                                          // towards the viewer (Blender Incoming)
					    float2 pw = uv + shift * dWall;                         // where the ray meets the wall (UV)
					    float3 wp = float3(pw.x, pw.y / aspect, -dWall);        // wall point, card-width units
					    float3 p0 = wp * skyScale;
					    float3 rc = pow(saturate(rarityColor.rgb), 2.2);        // rarity colour, gamma -> linear
					    // Nebula: 8 steps of ro -= I * (fbm(ro) - 0.45)
					    float3 ro = p0;
					    [loop] for (int s = 0; s < 8; s++)
					    {
					        float3 q = ro * 0.54;
					        float fbm = 0.0, amp = 1.0, norm = 0.0;
					        [unroll] for (int o = 0; o < 6; o++)
					        {
					            float3 i0 = floor(q), f0 = frac(q), w3 = f0 * f0 * (3.0 - 2.0 * f0);
					            float nv = lerp(lerp(lerp(SKY_H1(i0), SKY_H1(i0 + float3(1, 0, 0)), w3.x),
					                                 lerp(SKY_H1(i0 + float3(0, 1, 0)), SKY_H1(i0 + float3(1, 1, 0)), w3.x), w3.y),
					                            lerp(lerp(SKY_H1(i0 + float3(0, 0, 1)), SKY_H1(i0 + float3(1, 0, 1)), w3.x),
					                                 lerp(SKY_H1(i0 + float3(0, 1, 1)), SKY_H1(i0 + float3(1, 1, 1)), w3.x), w3.y), w3.z);
					            fbm += nv * amp; norm += amp; amp *= 0.472; q *= 1.91;
					        }
					        ro -= I * (fbm / norm - 0.45);
					    }
					    float nebulaDepth = saturate(distance(p0, ro));
					    wall = rc * lerp(0.35, 0.07, nebulaDepth);               // clouds: bright where thin, dark where deep
					    // Rim (Layer Weight fresnel)
					    wall += rc * pow(1.0 - saturate(I.z), 5.0) * 0.5;
					    // Glints on the wall: Voronoi cells with a random direction that light up when you look along it
					    float3 gq1 = wp * 2.0, gq2 = wp * 89.2;
					    float3 c1 = 0, c2 = 0; float d1 = 8.0, d2 = 8.0;
					    [unroll] for (int gz = -1; gz <= 1; gz++)
					    [unroll] for (int gy = -1; gy <= 1; gy++)
					    [unroll] for (int gx = -1; gx <= 1; gx++)
					    {
					        float3 o3 = float3(gx, gy, gz);
					        float3 k1 = floor(gq1) + o3;
					        float  e1 = length(k1 + SKY_H3(k1) - gq1);
					        if (e1 < d1) { d1 = e1; c1 = SKY_H3(k1 + 17.0); }
					        float3 k2 = floor(gq2) + o3;
					        float3 a2 = pow(abs(k2 + SKY_H3(k2) - gq2), 0.38);  // Minkowski 0.38: star-shaped cells
					        float  e2 = pow(a2.x + a2.y + a2.z, 1.0 / 0.38);
					        if (e2 < d2) { d2 = e2; c2 = SKY_H3(k2 + 17.0); }
					    }
					    wall += float3(0.045, 0.016, 0.0065) * pow(saturate(dot(I, c1 * 2.0 - 1.0) * 0.5 + 0.5), 10.0);
					    wall += float3(1.0, 0.288, 0.082) * pow(saturate(dot(I, c2 * 2.0 - 1.0) * 0.5 + 0.5), 10.0) * (d2 < 0.8 ? 1.0 : 0.0);
					    // Star field: 16 steps through a field of points (Voronoi F1 * 0.19); rays that pass a star stall
					    float3 rs = p0;
					    [loop] for (int k = 0; k < 16; k++)
					    {
					        float3 sq = rs * 4.53, sc = floor(sq);
					        float dm = 8.0;
					        [unroll] for (int sz = -1; sz <= 1; sz++)
					        [unroll] for (int sy = -1; sy <= 1; sy++)
					        [unroll] for (int sx = -1; sx <= 1; sx++)
					        {
					            float3 cc = sc + float3(sx, sy, sz);
					            dm = min(dm, length(cc + SKY_H3(cc) - sq));
					        }
					        rs -= I * (dm * 0.19);
					    }
					    float star = saturate(pow(1.25 / (distance(p0, rs) + 1.0), lerp(30.0, 10.0, nebulaDepth)) * 5.0);
					    float3 starCol = star < 0.089 ? lerp(float3(0, 0, 0), float3(0.5, 0.292, 0.196), saturate((star - 0.027) / 0.062))
					                   : star < 0.359 ? lerp(float3(0.5, 0.292, 0.196), float3(1, 1, 1), (star - 0.089) / 0.27)
					                   : star < 0.5   ? lerp(float3(1, 1, 1), float3(0.5, 0, 0), (star - 0.359) / 0.141)
					                   :                lerp(float3(0.5, 0, 0), float3(0.258, 0.528, 1.0), (star - 0.5) / 0.5);
					    wall += starCol * star;
					    wall *= lerp(1.0, depthDarken, saturate(dWall / max(farDepth, 1e-5)));   // deeper down the wall = darker
					    wall = pow(saturate(wall * skyBrightness), 1.0 / 2.2);                    // linear -> this project gamma space
					}
					hit = float3( p, 1.0 - wallAmount );             // for the normal map: hit UV, share of art (not wall)
					return float4(lerp(artCol, wall, wallAmount), art.a);
				}
				
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
				
				float CardFoilMetal130( float frontMask, float4 foilMask, float border, float strength )
				{
					return foilMask.r * saturate( strength * 1.5 );
				}
				
				float CardSmoothness132( float4 surface, float strength, float roughness )
				{
					float rough = lerp( roughness, surface.g, surface.a );
					return lerp( 1.0 - rough, 0.9, surface.r * saturate( strength * 1.5 ) );
				}
				
				float CardMetallic154( float4 surface, float foilMetal )
				{
					return max( surface.b, foilMetal );
				}
				
				float3 CardFoilAlbedo131( float4 albedo, float metal, float2 uv, float3 viewTS, float scale, float tiltShift )
				{
					// Albedo of the foil area. Where the card is metallic (metal, from CardFoilMetal) the albedo is the colour of its
					// reflections, so this gives the lights' highlights and the reflections the same sliding rainbow bands as CardFoil.
					float3 v = normalize(viewTS);
					float2 tilt = v.xy / max(v.z, 0.25);
					float grain = sin(dot(uv, float2(173.1, 61.7))) * sin(dot(uv, float2(-47.3, 211.9)));
					float phase = dot(uv, float2(0.6, 1.0)) * scale + dot(tilt, float2(0.8, 0.5)) * tiltShift + grain * 0.06;
					float3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + float3(0.0, 0.333, 0.667)));
					float3 foil = saturate(rainbow * 0.85 + albedo.rgb * 0.35);
					return lerp(albedo.rgb, foil, metal);
				}
				
				float3 CardNormal126( float3 hit, float2 uv, sampler2D normalMap, float strength, float frontMask, float border, sampler2D layerNormal, sampler2D backNormal )
				{
					// Bump detail, tangent space (OpenGL / Unity convention: green = up), so the card catches the game's lights. Front: the
					// card layers' normals (_LayerNormal, stacked by the client, on the glass) over the picture's normal map at the parallax
					// hit (hit = ParallaxWindow's hit, xy: UV, z: how much art, not box wall, is seen there; flat on the walls) where no layer
					// covers it (border = the layers' coverage). Back: the back layers' (_BackNormal). Default textures "bump" = flat.
					float3 base = tex2Dgrad( normalMap, hit.xy, ddx( uv ), ddy( uv ) ).xyz * 2.0 - 1.0;
					base = lerp( float3( 0, 0, 1 ), base, saturate( hit.z ) );
					float3 layer = tex2D( layerNormal, uv ).xyz * 2.0 - 1.0;
					float3 back = tex2D( backNormal, uv ).xyz * 2.0 - 1.0;
					float3 n = lerp( back, lerp( base, layer, border ), saturate( frontMask ) );
					n.xy *= strength;
					return normalize( n );
				}
				
				float3 CardFoil120( float2 uv, float3 viewTS, float frontMask, float4 foilMask, float border, float4 baseColor, float strength, float scale, float tiltShift )
				{
					// Holographic foil on the card art: rainbow bands that slide across the card as it tilts,
					// plus a brighter glint band sweeping diagonally. Added on top of emission.
					// Only where frontMask is set (not the back), not under the frame (border = frame alpha), and inside
					// foilMask (card.foil.png: white/opaque = foil, black/transparent = plain print, default white = the whole art).
					float area = foilMask.r;   // CardLayerFoil: layers and picture, front and back
					float3 v = normalize(viewTS);
					float2 tilt = v.xy / max(v.z, 0.25);
					float grain = sin(dot(uv, float2(173.1, 61.7))) * sin(dot(uv, float2(-47.3, 211.9)));
					float phase = dot(uv, float2(0.6, 1.0)) * scale + dot(tilt, float2(0.8, 0.5)) * tiltShift + grain * 0.06;
					float3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + float3(0.0, 0.333, 0.667)));
					float sweep = dot(uv - 0.5, float2(0.8, 0.6)) + dot(tilt, float2(0.45, 0.3)) * tiltShift;
					float glint = pow(saturate(1.0 - abs(sweep) * 2.5), 4.0);
					float luma = dot(baseColor.rgb, float3(0.299, 0.587, 0.114));
					float3 foil = rainbow * (0.3 + 0.7 * luma) * (0.35 + 0.65 * glint) + glint * 0.25;
					return foil * strength * area;
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

					o.ase_texcoord4.xy = v.texcoord1.xyzw.xy;
					o.ase_texcoord4.zw = v.texcoord.xyzw.xy;

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
					float2 texCoord95 = IN.ase_texcoord4.zw * float2( 1,1 ) + float2( 0,0 );
					float2 uv87 = texCoord95;
					float3 tanToWorld0 = float3( TangentWS.x, BitangentWS.x, NormalWS.x );
					float3 tanToWorld1 = float3( TangentWS.y, BitangentWS.y, NormalWS.y );
					float3 tanToWorld2 = float3( TangentWS.z, BitangentWS.z, NormalWS.z );
					float3 ase_viewVectorTS =  tanToWorld0 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - PositionWS : UNITY_MATRIX_V[ 2 ].xyz ).x + tanToWorld1 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - PositionWS : UNITY_MATRIX_V[ 2 ].xyz ).y  + tanToWorld2 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - PositionWS : UNITY_MATRIX_V[ 2 ].xyz ).z;
					float3 ase_viewDirTS = normalize( ase_viewVectorTS );
					float3 viewTS87 = ase_viewDirTS;
					sampler2D heightMap87 = _HeightMap;
					float steps87 = _Steps;
					float4 windowRect87 = float4( 0.031,0.022,0.969,0.978 );
					float nearDepth87 = _nearDepth;
					float farDepth87 = _farDepth;
					float heightMin87 = _heightMin;
					float heightMax87 = _heightMax;
					sampler2D albedo87 = _MainTex;
					float edgeFade87 = _edgeFade;
					float depthDarken87 = _depthDarken;
					float skyScale87 = _skyScale;
					float skyBrightness87 = _skyBrightness;
					float4 rarityColor87 = _RarityColor;
					float3 hit87 = float3( 0,0,0 );
					float4 localParallaxWindow87 = ParallaxWindow87( uv87 , viewTS87 , heightMap87 , steps87 , windowRect87 , nearDepth87 , farDepth87 , heightMin87 , heightMax87 , albedo87 , edgeFade87 , depthDarken87 , skyScale87 , skyBrightness87 , rarityColor87 , hit87 );
					float2 texCoord69 = IN.ase_texcoord4.zw * float2( 1,1 ) + float2( 0,0 );
					float4 tex2DNode70 = tex2D( _CARD_FRONT_BORDER, texCoord69 );
					float4 lerpResult77 = lerp( localParallaxWindow87 , tex2DNode70 , tex2DNode70.a);
					float4 tex2DNode41 = tex2D( _CARD_FRONT_MASK, texCoord43 );
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
					float4 baseFoil144 = tex2D( _FoilMask, texCoord95 );
					float4 layerFoil144 = tex2DNode140;
					float layers144 = tex2DNode70.a;
					float4 backFoil144 = tex2DNode141;
					float frontMask144 = tex2DNode41.r;
					float4 localCardLayerFoil144 = CardLayerFoil144( baseFoil144 , layerFoil144 , layers144 , backFoil144 , frontMask144 );
					float4 foilMask130 = localCardLayerFoil144;
					float border130 = tex2DNode70.a;
					float strength130 = _FoilStrength;
					float localCardFoilMetal130 = CardFoilMetal130( frontMask130 , foilMask130 , border130 , strength130 );
					float metal131 = localCardFoilMetal130;
					float2 uv131 = texCoord95;
					float3 viewTS131 = ase_viewDirTS;
					float scale131 = _FoilScale;
					float tiltShift131 = _FoilShift;
					float3 localCardFoilAlbedo131 = CardFoilAlbedo131( albedo131 , metal131 , uv131 , viewTS131 , scale131 , tiltShift131 );
					
					float3 hit126 = hit87;
					float2 uv126 = texCoord95;
					sampler2D normalMap126 = _NormalMap;
					float strength126 = _NormalStrength;
					float frontMask126 = tex2DNode41.r;
					float border126 = tex2DNode70.a;
					sampler2D layerNormal126 = _LayerNormal;
					sampler2D backNormal126 = _BackNormal;
					float3 localCardNormal126 = CardNormal126( hit126 , uv126 , normalMap126 , strength126 , frontMask126 , border126 , layerNormal126 , backNormal126 );
					
					float4 surface132 = localCardLayerFoil144;
					float strength132 = _FoilStrength;
					float roughness132 = _Roughness;
					float localCardSmoothness132 = CardSmoothness132( surface132 , strength132 , roughness132 );
					float4 surface154 = localCardLayerFoil144;
					float foilMetal154 = localCardFoilMetal130;
					float localCardMetallic154 = CardMetallic154( surface154 , foilMetal154 );
					
					float2 uv120 = texCoord95;
					float3 viewTS120 = ase_viewDirTS;
					float frontMask120 = tex2DNode41.r;
					float4 foilMask120 = localCardLayerFoil144;
					float border120 = tex2DNode70.a;
					float4 baseColor120 = lerpResult109;
					float strength120 = _FoilStrength;
					float scale120 = _FoilScale;
					float tiltShift120 = _FoilShift;
					float3 localCardFoil120 = CardFoil120( uv120 , viewTS120 , frontMask120 , foilMask120 , border120 , baseColor120 , strength120 , scale120 , tiltShift120 );
					float3 emission152 = ( ( lerpResult109 * lerpResult112 ) + float4( localCardFoil120 , 0.0 ) ).rgb;
					float world152 = _DaCardWorld;
					float worldGlow152 = _WorldGlow;
					float3 localCardWorldEmission152 = CardWorldEmission152( emission152 , world152 , worldGlow152 );
					

					o.Albedo = localCardFoilAlbedo131;
					o.Normal = localCardNormal126;

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

				#define ASE_NEEDS_TEXTURE_COORDINATES1
				#define ASE_NEEDS_TEXTURE_COORDINATES0
				#define ASE_NEEDS_VERT_TANGENT
				#define ASE_NEEDS_VERT_NORMAL
				#define ASE_NEEDS_FRAG_TEXTURE_COORDINATES0


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
				uniform sampler2D _HeightMap;
				uniform float _Steps;
				uniform float _nearDepth;
				uniform float _farDepth;
				uniform float _heightMin;
				uniform float _heightMax;
				uniform sampler2D _MainTex;
				uniform float _edgeFade;
				uniform float _depthDarken;
				uniform float _skyScale;
				uniform float _skyBrightness;
				uniform float4 _RarityColor;
				uniform sampler2D _CARD_FRONT_BORDER;
				uniform sampler2D _CARD_FRONT_MASK;
				uniform float _ArtGlow;
				uniform float _BorderGlow;
				uniform sampler2D _LayerFoil;
				uniform sampler2D _BackFoil;
				uniform sampler2D _FoilMask;
				uniform float _FoilStrength;
				uniform float _FoilScale;
				uniform float _FoilShift;
				uniform float _DaCardWorld;
				uniform float _WorldGlow;


				float4 ParallaxWindow87( float2 uv, float3 viewTS, sampler2D heightMap, float steps, float4 windowRect, float nearDepth, float farDepth, float heightMin, float heightMax, sampler2D albedo, float edgeFade, float depthDarken, float skyScale, float skyBrightness, float4 rarityColor, out float3 hit )
				{
					// Art box behind the card's window (parallax occlusion inside a recessed frame).
					// Depth-map white sits at nearDepth (just behind the glass), black at farDepth; heightMin/heightMax stretch its contrast.
					// Returns the art colour: sampled at the parallax hit, darkened with depth (depthDarken = brightness at the back of the box)
					// and faded to black toward the box walls over edgeFade (card-width units).
					const float aspect = 63.0 / 88.0;
					float3 v = normalize(viewTS);
					float2 shift = -v.xy / max(v.z, 0.15);
					shift.y *= aspect;
					float2 dx = ddx(uv), dy = ddy(uv);
					int   n     = clamp((int)steps, 1, 64);
					float stepD = (farDepth - nearDepth) / n;
					float  d = nearDepth;
					float2 p = uv;
					float4 art = 0;
					{
					    // ---------- One height map ----------
					    float range = max(heightMax - heightMin, 1e-4);
					    p = uv + shift * d;
					    float  scene = lerp(farDepth, nearDepth, saturate((tex2Dgrad(heightMap, p, dx, dy).r - heightMin) / range));
					    float  prevD = d, prevDiff = scene - d;
					    [loop] for (int i = 0; i < 64; i++)
					    {
					        if (i >= n || d >= scene) break;
					        prevD = d; prevDiff = scene - d;
					        d += stepD;
					        p = uv + shift * d;
					        scene = lerp(farDepth, nearDepth, saturate((tex2Dgrad(heightMap, p, dx, dy).r - heightMin) / range));
					    }
					    float t = prevDiff / max(prevDiff - (scene - d), 1e-5);
					    d = lerp(prevD, d, saturate(t));
					    p = uv + shift * d;
					    art = tex2Dgrad(albedo, p, dx, dy);
					}
					float depth01 = saturate((d - nearDepth) / max(farDepth - nearDepth, 1e-5));
					// ---------- Box walls ----------
					// The art sits on the back of a box: windowRect is the opening, the side walls go straight down.
					// Where the view ray reaches a side wall before it reaches the art, that wall is visible instead.
					float2 toWall = float2(
					    shift.x > 1e-5 ? (windowRect.z - uv.x) / shift.x : (shift.x < -1e-5 ? (windowRect.x - uv.x) / shift.x : 1e5),
					    shift.y > 1e-5 ? (windowRect.w - uv.y) / shift.y : (shift.y < -1e-5 ? (windowRect.y - uv.y) / shift.y : 1e5));
					float dWall = max(min(toWall.x, toWall.y), 0.0);
					float soft = max(edgeFade, 1e-4);
					float wallAmount = 1.0 - smoothstep(-soft, soft, dWall - d);   // 0 = art, 1 = wall (soft crease where they meet)
					float3 artCol = art.rgb * lerp(1.0, depthDarken, depth01);    // deeper parts of the art darker
					// ---------- Wall surface: interior sky (port of Blender material interior_sky, tower9.blend) ----------
					// Starts at the point where the ray meets the wall: sphere-traced FBM nebula + star field + glints + rim,
					// tinted by the card rarity colour. Only evaluated where a wall is visible.
					float3 wall = 0;
					#define SKY_H1(q) frac(sin(dot(q, float3(12.9898, 78.233, 37.719))) * 43758.5453)
					#define SKY_H3(q) frac(sin(float3(dot(q, float3(127.1, 311.7, 74.7)), dot(q, float3(269.5, 183.3, 246.1)), dot(q, float3(113.5, 271.9, 124.6)))) * 43758.5453)
					[branch] if (wallAmount > 0.001)
					{
					    float3 I  = v;                                          // towards the viewer (Blender Incoming)
					    float2 pw = uv + shift * dWall;                         // where the ray meets the wall (UV)
					    float3 wp = float3(pw.x, pw.y / aspect, -dWall);        // wall point, card-width units
					    float3 p0 = wp * skyScale;
					    float3 rc = pow(saturate(rarityColor.rgb), 2.2);        // rarity colour, gamma -> linear
					    // Nebula: 8 steps of ro -= I * (fbm(ro) - 0.45)
					    float3 ro = p0;
					    [loop] for (int s = 0; s < 8; s++)
					    {
					        float3 q = ro * 0.54;
					        float fbm = 0.0, amp = 1.0, norm = 0.0;
					        [unroll] for (int o = 0; o < 6; o++)
					        {
					            float3 i0 = floor(q), f0 = frac(q), w3 = f0 * f0 * (3.0 - 2.0 * f0);
					            float nv = lerp(lerp(lerp(SKY_H1(i0), SKY_H1(i0 + float3(1, 0, 0)), w3.x),
					                                 lerp(SKY_H1(i0 + float3(0, 1, 0)), SKY_H1(i0 + float3(1, 1, 0)), w3.x), w3.y),
					                            lerp(lerp(SKY_H1(i0 + float3(0, 0, 1)), SKY_H1(i0 + float3(1, 0, 1)), w3.x),
					                                 lerp(SKY_H1(i0 + float3(0, 1, 1)), SKY_H1(i0 + float3(1, 1, 1)), w3.x), w3.y), w3.z);
					            fbm += nv * amp; norm += amp; amp *= 0.472; q *= 1.91;
					        }
					        ro -= I * (fbm / norm - 0.45);
					    }
					    float nebulaDepth = saturate(distance(p0, ro));
					    wall = rc * lerp(0.35, 0.07, nebulaDepth);               // clouds: bright where thin, dark where deep
					    // Rim (Layer Weight fresnel)
					    wall += rc * pow(1.0 - saturate(I.z), 5.0) * 0.5;
					    // Glints on the wall: Voronoi cells with a random direction that light up when you look along it
					    float3 gq1 = wp * 2.0, gq2 = wp * 89.2;
					    float3 c1 = 0, c2 = 0; float d1 = 8.0, d2 = 8.0;
					    [unroll] for (int gz = -1; gz <= 1; gz++)
					    [unroll] for (int gy = -1; gy <= 1; gy++)
					    [unroll] for (int gx = -1; gx <= 1; gx++)
					    {
					        float3 o3 = float3(gx, gy, gz);
					        float3 k1 = floor(gq1) + o3;
					        float  e1 = length(k1 + SKY_H3(k1) - gq1);
					        if (e1 < d1) { d1 = e1; c1 = SKY_H3(k1 + 17.0); }
					        float3 k2 = floor(gq2) + o3;
					        float3 a2 = pow(abs(k2 + SKY_H3(k2) - gq2), 0.38);  // Minkowski 0.38: star-shaped cells
					        float  e2 = pow(a2.x + a2.y + a2.z, 1.0 / 0.38);
					        if (e2 < d2) { d2 = e2; c2 = SKY_H3(k2 + 17.0); }
					    }
					    wall += float3(0.045, 0.016, 0.0065) * pow(saturate(dot(I, c1 * 2.0 - 1.0) * 0.5 + 0.5), 10.0);
					    wall += float3(1.0, 0.288, 0.082) * pow(saturate(dot(I, c2 * 2.0 - 1.0) * 0.5 + 0.5), 10.0) * (d2 < 0.8 ? 1.0 : 0.0);
					    // Star field: 16 steps through a field of points (Voronoi F1 * 0.19); rays that pass a star stall
					    float3 rs = p0;
					    [loop] for (int k = 0; k < 16; k++)
					    {
					        float3 sq = rs * 4.53, sc = floor(sq);
					        float dm = 8.0;
					        [unroll] for (int sz = -1; sz <= 1; sz++)
					        [unroll] for (int sy = -1; sy <= 1; sy++)
					        [unroll] for (int sx = -1; sx <= 1; sx++)
					        {
					            float3 cc = sc + float3(sx, sy, sz);
					            dm = min(dm, length(cc + SKY_H3(cc) - sq));
					        }
					        rs -= I * (dm * 0.19);
					    }
					    float star = saturate(pow(1.25 / (distance(p0, rs) + 1.0), lerp(30.0, 10.0, nebulaDepth)) * 5.0);
					    float3 starCol = star < 0.089 ? lerp(float3(0, 0, 0), float3(0.5, 0.292, 0.196), saturate((star - 0.027) / 0.062))
					                   : star < 0.359 ? lerp(float3(0.5, 0.292, 0.196), float3(1, 1, 1), (star - 0.089) / 0.27)
					                   : star < 0.5   ? lerp(float3(1, 1, 1), float3(0.5, 0, 0), (star - 0.359) / 0.141)
					                   :                lerp(float3(0.5, 0, 0), float3(0.258, 0.528, 1.0), (star - 0.5) / 0.5);
					    wall += starCol * star;
					    wall *= lerp(1.0, depthDarken, saturate(dWall / max(farDepth, 1e-5)));   // deeper down the wall = darker
					    wall = pow(saturate(wall * skyBrightness), 1.0 / 2.2);                    // linear -> this project gamma space
					}
					hit = float3( p, 1.0 - wallAmount );             // for the normal map: hit UV, share of art (not wall)
					return float4(lerp(artCol, wall, wallAmount), art.a);
				}
				
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
				
				float CardFoilMetal130( float frontMask, float4 foilMask, float border, float strength )
				{
					return foilMask.r * saturate( strength * 1.5 );
				}
				
				float3 CardFoilAlbedo131( float4 albedo, float metal, float2 uv, float3 viewTS, float scale, float tiltShift )
				{
					// Albedo of the foil area. Where the card is metallic (metal, from CardFoilMetal) the albedo is the colour of its
					// reflections, so this gives the lights' highlights and the reflections the same sliding rainbow bands as CardFoil.
					float3 v = normalize(viewTS);
					float2 tilt = v.xy / max(v.z, 0.25);
					float grain = sin(dot(uv, float2(173.1, 61.7))) * sin(dot(uv, float2(-47.3, 211.9)));
					float phase = dot(uv, float2(0.6, 1.0)) * scale + dot(tilt, float2(0.8, 0.5)) * tiltShift + grain * 0.06;
					float3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + float3(0.0, 0.333, 0.667)));
					float3 foil = saturate(rainbow * 0.85 + albedo.rgb * 0.35);
					return lerp(albedo.rgb, foil, metal);
				}
				
				float3 CardFoil120( float2 uv, float3 viewTS, float frontMask, float4 foilMask, float border, float4 baseColor, float strength, float scale, float tiltShift )
				{
					// Holographic foil on the card art: rainbow bands that slide across the card as it tilts,
					// plus a brighter glint band sweeping diagonally. Added on top of emission.
					// Only where frontMask is set (not the back), not under the frame (border = frame alpha), and inside
					// foilMask (card.foil.png: white/opaque = foil, black/transparent = plain print, default white = the whole art).
					float area = foilMask.r;   // CardLayerFoil: layers and picture, front and back
					float3 v = normalize(viewTS);
					float2 tilt = v.xy / max(v.z, 0.25);
					float grain = sin(dot(uv, float2(173.1, 61.7))) * sin(dot(uv, float2(-47.3, 211.9)));
					float phase = dot(uv, float2(0.6, 1.0)) * scale + dot(tilt, float2(0.8, 0.5)) * tiltShift + grain * 0.06;
					float3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + float3(0.0, 0.333, 0.667)));
					float sweep = dot(uv - 0.5, float2(0.8, 0.6)) + dot(tilt, float2(0.45, 0.3)) * tiltShift;
					float glint = pow(saturate(1.0 - abs(sweep) * 2.5), 4.0);
					float luma = dot(baseColor.rgb, float3(0.299, 0.587, 0.114));
					float3 foil = rainbow * (0.3 + 0.7 * luma) * (0.35 + 0.65 * glint) + glint * 0.25;
					return foil * strength * area;
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
					
					o.ase_texcoord2.xy = v.texcoord1.xyzw.xy;
					o.ase_texcoord2.zw = v.texcoord.xyzw.xy;
					
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
					float2 texCoord95 = IN.ase_texcoord2.zw * float2( 1,1 ) + float2( 0,0 );
					float2 uv87 = texCoord95;
					float3 ase_positionWS = IN.ase_texcoord3.xyz;
					float3 ase_tangentWS = IN.ase_texcoord4.xyz;
					float3 ase_normalWS = IN.ase_texcoord5.xyz;
					float3 ase_bitangentWS = IN.ase_texcoord6.xyz;
					float3 tanToWorld0 = float3( ase_tangentWS.x, ase_bitangentWS.x, ase_normalWS.x );
					float3 tanToWorld1 = float3( ase_tangentWS.y, ase_bitangentWS.y, ase_normalWS.y );
					float3 tanToWorld2 = float3( ase_tangentWS.z, ase_bitangentWS.z, ase_normalWS.z );
					float3 ase_viewVectorTS =  tanToWorld0 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - ase_positionWS : UNITY_MATRIX_V[ 2 ].xyz ).x + tanToWorld1 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - ase_positionWS : UNITY_MATRIX_V[ 2 ].xyz ).y  + tanToWorld2 * ( ( unity_OrthoParams.w == 0 ) ? _WorldSpaceCameraPos - ase_positionWS : UNITY_MATRIX_V[ 2 ].xyz ).z;
					float3 ase_viewDirTS = normalize( ase_viewVectorTS );
					float3 viewTS87 = ase_viewDirTS;
					sampler2D heightMap87 = _HeightMap;
					float steps87 = _Steps;
					float4 windowRect87 = float4( 0.031,0.022,0.969,0.978 );
					float nearDepth87 = _nearDepth;
					float farDepth87 = _farDepth;
					float heightMin87 = _heightMin;
					float heightMax87 = _heightMax;
					sampler2D albedo87 = _MainTex;
					float edgeFade87 = _edgeFade;
					float depthDarken87 = _depthDarken;
					float skyScale87 = _skyScale;
					float skyBrightness87 = _skyBrightness;
					float4 rarityColor87 = _RarityColor;
					float3 hit87 = float3( 0,0,0 );
					float4 localParallaxWindow87 = ParallaxWindow87( uv87 , viewTS87 , heightMap87 , steps87 , windowRect87 , nearDepth87 , farDepth87 , heightMin87 , heightMax87 , albedo87 , edgeFade87 , depthDarken87 , skyScale87 , skyBrightness87 , rarityColor87 , hit87 );
					float2 texCoord69 = IN.ase_texcoord2.zw * float2( 1,1 ) + float2( 0,0 );
					float4 tex2DNode70 = tex2D( _CARD_FRONT_BORDER, texCoord69 );
					float4 lerpResult77 = lerp( localParallaxWindow87 , tex2DNode70 , tex2DNode70.a);
					float4 tex2DNode41 = tex2D( _CARD_FRONT_MASK, texCoord43 );
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
					float4 baseFoil144 = tex2D( _FoilMask, texCoord95 );
					float4 layerFoil144 = tex2DNode140;
					float layers144 = tex2DNode70.a;
					float4 backFoil144 = tex2DNode141;
					float frontMask144 = tex2DNode41.r;
					float4 localCardLayerFoil144 = CardLayerFoil144( baseFoil144 , layerFoil144 , layers144 , backFoil144 , frontMask144 );
					float4 foilMask130 = localCardLayerFoil144;
					float border130 = tex2DNode70.a;
					float strength130 = _FoilStrength;
					float localCardFoilMetal130 = CardFoilMetal130( frontMask130 , foilMask130 , border130 , strength130 );
					float metal131 = localCardFoilMetal130;
					float2 uv131 = texCoord95;
					float3 viewTS131 = ase_viewDirTS;
					float scale131 = _FoilScale;
					float tiltShift131 = _FoilShift;
					float3 localCardFoilAlbedo131 = CardFoilAlbedo131( albedo131 , metal131 , uv131 , viewTS131 , scale131 , tiltShift131 );
					
					float2 uv120 = texCoord95;
					float3 viewTS120 = ase_viewDirTS;
					float frontMask120 = tex2DNode41.r;
					float4 foilMask120 = localCardLayerFoil144;
					float border120 = tex2DNode70.a;
					float4 baseColor120 = lerpResult109;
					float strength120 = _FoilStrength;
					float scale120 = _FoilScale;
					float tiltShift120 = _FoilShift;
					float3 localCardFoil120 = CardFoil120( uv120 , viewTS120 , frontMask120 , foilMask120 , border120 , baseColor120 , strength120 , scale120 , tiltShift120 );
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
Node;AmplifyShaderEditor.TextureCoordinatesNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;69;-1728,944;Inherit;False;0;-1;2;3;2;SAMPLER2D;;False;0;FLOAT2;1,1;False;1;FLOAT2;0,0;False;5;FLOAT2;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4
Node;AmplifyShaderEditor.LerpOp, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;77;-384,432;Inherit;False;3;0;COLOR;0,0,0,0;False;1;COLOR;0,0,0,0;False;2;FLOAT;0;False;1;COLOR;0
Node;AmplifyShaderEditor.SamplerNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;70;-912,1072;Inherit;True;Property;_CARD_FRONT_BORDER;CARD_FRONT_BORDER;3;0;Create;True;0;0;0;False;0;False;-1;None;None;True;0;False;white;Auto;False;Object;-1;Auto;Texture2D;False;8;0;SAMPLER2D;;False;1;FLOAT2;0,0;False;2;FLOAT;0;False;3;FLOAT2;0,0;False;4;FLOAT2;0,0;False;5;FLOAT;1;False;6;FLOAT;0;False;7;SAMPLERSTATE;;False;6;COLOR;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4;FLOAT3;5
Node;AmplifyShaderEditor.SamplerNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;41;-2256,800;Inherit;True;Property;_CARD_FRONT_MASK;CARD_FRONT_MASK;1;0;Create;True;0;0;0;False;0;False;-1;c66d56fa803ca5a45bd5d36672af01db;c66d56fa803ca5a45bd5d36672af01db;True;0;False;white;Auto;False;Object;-1;Auto;Texture2D;False;8;0;SAMPLER2D;;False;1;FLOAT2;0,0;False;2;FLOAT;0;False;3;FLOAT2;0,0;False;4;FLOAT2;0,0;False;5;FLOAT;1;False;6;FLOAT;0;False;7;SAMPLERSTATE;;False;6;COLOR;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4;FLOAT3;5
Node;AmplifyShaderEditor.TexturePropertyNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;81;-1824,-176;Inherit;True;Property;_HeightMap;Height Map;4;0;Create;True;0;0;0;False;0;False;None;None;False;white;Auto;Texture2D;False;-1;0;2;SAMPLER2D;0;SAMPLERSTATE;1
Node;AmplifyShaderEditor.TexturePropertyNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;38;-1824,-432;Inherit;True;Property;_MainTex;Card Art;0;0;Create;True;0;0;0;False;0;False;None;None;False;white;Auto;Texture2D;False;-1;0;2;SAMPLER2D;0;SAMPLERSTATE;1
Node;AmplifyShaderEditor.ViewDirInputsCoordNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;88;-1504,-336;Inherit;False;Tangent;False;0;4;FLOAT3;0;FLOAT;1;FLOAT;2;FLOAT;3
Node;AmplifyShaderEditor.TextureCoordinatesNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;43;-2448,592;Inherit;False;1;-1;2;3;2;SAMPLER2D;;False;0;FLOAT2;1,1;False;1;FLOAT2;0,0;False;5;FLOAT2;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;94;-1552,224;Inherit;False;Property;_heightMax;heightMax;5;0;Create;True;0;0;0;False;0;False;1;1;0;0;0;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;98;-1552,464;Inherit;False;Property;_skyScale;skyScale;9;0;Create;True;0;0;0;False;0;False;6;6;0;0;0;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;99;-1552,544;Inherit;False;Property;_skyBrightness;skyBrightness;11;0;Create;True;0;0;0;False;0;False;1;1;0;0;0;1;FLOAT;0
Node;AmplifyShaderEditor.ColorNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;100;-1552,624;Inherit;False;Property;_RarityColor;Rarity Color;12;0;Create;True;0;0;0;False;0;False;0.25,0.55,1,1;0.25,0.55,1,1;False;True;0;6;COLOR;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4;FLOAT3;5
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;96;-1552,304;Inherit;False;Property;_edgeFade;edgeFade;7;0;Create;True;0;0;0;False;0;False;0.06;0.02;0;0;0;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;97;-1552,384;Inherit;False;Property;_depthDarken;depthDarken;10;0;Create;True;0;0;0;False;0;False;0.5;0.3;0;0;0;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;93;-1552,144;Inherit;False;Property;_heightMin;heightMin;6;0;Create;True;0;0;0;False;0;False;0;0;0;0;0;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;92;-1568,64;Inherit;False;Property;_farDepth;farDepth;8;0;Create;True;0;0;0;False;0;False;0.25;0.5;0;0;0;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;91;-1552,-16;Inherit;False;Property;_nearDepth;nearDepth;13;0;Create;True;0;0;0;False;0;False;0.01;0;0;0;0;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;89;-1552,-80;Inherit;False;Property;_Steps;Steps;14;0;Create;True;0;0;0;False;0;False;128;128;0;0;0;1;FLOAT;0
Node;AmplifyShaderEditor.TextureCoordinatesNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;95;-1344,32;Inherit;False;0;-1;2;3;2;SAMPLER2D;;False;0;FLOAT2;1,1;False;1;FLOAT2;0,0;False;5;FLOAT2;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;87;-1008,-160;Inherit;False;// Art box behind the card's window (parallax occlusion inside a recessed frame).$// Depth-map white sits at nearDepth (just behind the glass), black at farDepth@ heightMin/heightMax stretch its contrast.$// Returns the art colour: sampled at the parallax hit, darkened with depth (depthDarken = brightness at the back of the box)$// and faded to black toward the box walls over edgeFade (card-width units).$const float aspect = 63.0 / 88.0@$float3 v = normalize(viewTS)@$float2 shift = -v.xy / max(v.z, 0.15)@$shift.y *= aspect@$float2 dx = ddx(uv), dy = ddy(uv)@$$int   n     = clamp((int)steps, 1, 64)@$float stepD = (farDepth - nearDepth) / n@$float  d = nearDepth@$float2 p = uv@$float4 art = 0@$${$    // ---------- One height map ----------$    float range = max(heightMax - heightMin, 1e-4)@$    p = uv + shift * d@$    float  scene = lerp(farDepth, nearDepth, saturate((tex2Dgrad(heightMap, p, dx, dy).r - heightMin) / range))@$    float  prevD = d, prevDiff = scene - d@$    [loop] for (int i = 0@ i < 64@ i++)$    {$        if (i >= n || d >= scene) break@$        prevD = d@ prevDiff = scene - d@$        d += stepD@$        p = uv + shift * d@$        scene = lerp(farDepth, nearDepth, saturate((tex2Dgrad(heightMap, p, dx, dy).r - heightMin) / range))@$    }$    float t = prevDiff / max(prevDiff - (scene - d), 1e-5)@$    d = lerp(prevD, d, saturate(t))@$    p = uv + shift * d@$    art = tex2Dgrad(albedo, p, dx, dy)@$}$$float depth01 = saturate((d - nearDepth) / max(farDepth - nearDepth, 1e-5))@$// ---------- Box walls ----------$// The art sits on the back of a box: windowRect is the opening, the side walls go straight down.$// Where the view ray reaches a side wall before it reaches the art, that wall is visible instead.$float2 toWall = float2($    shift.x > 1e-5 ? (windowRect.z - uv.x) / shift.x : (shift.x < -1e-5 ? (windowRect.x - uv.x) / shift.x : 1e5),$    shift.y > 1e-5 ? (windowRect.w - uv.y) / shift.y : (shift.y < -1e-5 ? (windowRect.y - uv.y) / shift.y : 1e5))@$float dWall = max(min(toWall.x, toWall.y), 0.0)@$float soft = max(edgeFade, 1e-4)@$float wallAmount = 1.0 - smoothstep(-soft, soft, dWall - d)@   // 0 = art, 1 = wall (soft crease where they meet)$$float3 artCol = art.rgb * lerp(1.0, depthDarken, depth01)@    // deeper parts of the art darker$$// ---------- Wall surface: interior sky (port of Blender material interior_sky, tower9.blend) ----------$// Starts at the point where the ray meets the wall: sphere-traced FBM nebula + star field + glints + rim,$// tinted by the card rarity colour. Only evaluated where a wall is visible.$float3 wall = 0@$#define SKY_H1(q) frac(sin(dot(q, float3(12.9898, 78.233, 37.719))) * 43758.5453)$#define SKY_H3(q) frac(sin(float3(dot(q, float3(127.1, 311.7, 74.7)), dot(q, float3(269.5, 183.3, 246.1)), dot(q, float3(113.5, 271.9, 124.6)))) * 43758.5453)$[branch] if (wallAmount > 0.001)${$    float3 I  = v@                                          // towards the viewer (Blender Incoming)$    float2 pw = uv + shift * dWall@                         // where the ray meets the wall (UV)$    float3 wp = float3(pw.x, pw.y / aspect, -dWall)@        // wall point, card-width units$    float3 p0 = wp * skyScale@$    float3 rc = pow(saturate(rarityColor.rgb), 2.2)@        // rarity colour, gamma -> linear$$    // Nebula: 8 steps of ro -= I * (fbm(ro) - 0.45)$    float3 ro = p0@$    [loop] for (int s = 0@ s < 8@ s++)$    {$        float3 q = ro * 0.54@$        float fbm = 0.0, amp = 1.0, norm = 0.0@$        [unroll] for (int o = 0@ o < 6@ o++)$        {$            float3 i0 = floor(q), f0 = frac(q), w3 = f0 * f0 * (3.0 - 2.0 * f0)@$            float nv = lerp(lerp(lerp(SKY_H1(i0), SKY_H1(i0 + float3(1, 0, 0)), w3.x),$                                 lerp(SKY_H1(i0 + float3(0, 1, 0)), SKY_H1(i0 + float3(1, 1, 0)), w3.x), w3.y),$                            lerp(lerp(SKY_H1(i0 + float3(0, 0, 1)), SKY_H1(i0 + float3(1, 0, 1)), w3.x),$                                 lerp(SKY_H1(i0 + float3(0, 1, 1)), SKY_H1(i0 + float3(1, 1, 1)), w3.x), w3.y), w3.z)@$            fbm += nv * amp@ norm += amp@ amp *= 0.472@ q *= 1.91@$        }$        ro -= I * (fbm / norm - 0.45)@$    }$    float nebulaDepth = saturate(distance(p0, ro))@$    wall = rc * lerp(0.35, 0.07, nebulaDepth)@               // clouds: bright where thin, dark where deep$$    // Rim (Layer Weight fresnel)$    wall += rc * pow(1.0 - saturate(I.z), 5.0) * 0.5@$$    // Glints on the wall: Voronoi cells with a random direction that light up when you look along it$    float3 gq1 = wp * 2.0, gq2 = wp * 89.2@$    float3 c1 = 0, c2 = 0@ float d1 = 8.0, d2 = 8.0@$    [unroll] for (int gz = -1@ gz <= 1@ gz++)$    [unroll] for (int gy = -1@ gy <= 1@ gy++)$    [unroll] for (int gx = -1@ gx <= 1@ gx++)$    {$        float3 o3 = float3(gx, gy, gz)@$        float3 k1 = floor(gq1) + o3@$        float  e1 = length(k1 + SKY_H3(k1) - gq1)@$        if (e1 < d1) { d1 = e1@ c1 = SKY_H3(k1 + 17.0)@ }$        float3 k2 = floor(gq2) + o3@$        float3 a2 = pow(abs(k2 + SKY_H3(k2) - gq2), 0.38)@  // Minkowski 0.38: star-shaped cells$        float  e2 = pow(a2.x + a2.y + a2.z, 1.0 / 0.38)@$        if (e2 < d2) { d2 = e2@ c2 = SKY_H3(k2 + 17.0)@ }$    }$    wall += float3(0.045, 0.016, 0.0065) * pow(saturate(dot(I, c1 * 2.0 - 1.0) * 0.5 + 0.5), 10.0)@$    wall += float3(1.0, 0.288, 0.082) * pow(saturate(dot(I, c2 * 2.0 - 1.0) * 0.5 + 0.5), 10.0) * (d2 < 0.8 ? 1.0 : 0.0)@$$    // Star field: 16 steps through a field of points (Voronoi F1 * 0.19)@ rays that pass a star stall$    float3 rs = p0@$    [loop] for (int k = 0@ k < 16@ k++)$    {$        float3 sq = rs * 4.53, sc = floor(sq)@$        float dm = 8.0@$        [unroll] for (int sz = -1@ sz <= 1@ sz++)$        [unroll] for (int sy = -1@ sy <= 1@ sy++)$        [unroll] for (int sx = -1@ sx <= 1@ sx++)$        {$            float3 cc = sc + float3(sx, sy, sz)@$            dm = min(dm, length(cc + SKY_H3(cc) - sq))@$        }$        rs -= I * (dm * 0.19)@$    }$    float star = saturate(pow(1.25 / (distance(p0, rs) + 1.0), lerp(30.0, 10.0, nebulaDepth)) * 5.0)@$    float3 starCol = star < 0.089 ? lerp(float3(0, 0, 0), float3(0.5, 0.292, 0.196), saturate((star - 0.027) / 0.062))$                   : star < 0.359 ? lerp(float3(0.5, 0.292, 0.196), float3(1, 1, 1), (star - 0.089) / 0.27)$                   : star < 0.5   ? lerp(float3(1, 1, 1), float3(0.5, 0, 0), (star - 0.359) / 0.141)$                   :                lerp(float3(0.5, 0, 0), float3(0.258, 0.528, 1.0), (star - 0.5) / 0.5)@$    wall += starCol * star@$$    wall *= lerp(1.0, depthDarken, saturate(dWall / max(farDepth, 1e-5)))@   // deeper down the wall = darker$    wall = pow(saturate(wall * skyBrightness), 1.0 / 2.2)@                    // linear -> this project gamma space$}$$hit = float3( p, 1.0 - wallAmount )@             // for the normal map: hit UV, share of art (not wall)$return float4(lerp(artCol, wall, wallAmount), art.a)@;4;Create;16;False;uv;FLOAT2;0,0;In;;Inherit;False;False;viewTS;FLOAT3;0,0,0;In;;Inherit;False;False;heightMap;SAMPLER2D;_Sampler287;In;;Inherit;False;False;steps;FLOAT;24;In;;Inherit;False;True;windowRect;FLOAT4;0.031,0.022,0.969,0.978;In;;Inherit;False;True;nearDepth;FLOAT;0.01;In;;Inherit;False;True;farDepth;FLOAT;0.25;In;;Inherit;False;True;heightMin;FLOAT;0.75;In;;Inherit;False;True;heightMax;FLOAT;1;In;;Inherit;False;True;albedo;SAMPLER2D;_Sampler987;In;;Inherit;False;True;edgeFade;FLOAT;0.06;In;;Inherit;False;True;depthDarken;FLOAT;0.5;In;;Inherit;False;True;skyScale;FLOAT;6;In;;Inherit;False;True;skyBrightness;FLOAT;1;In;;Inherit;False;True;rarityColor;FLOAT4;0.25,0.55,1,1;In;;Inherit;False;True;hit;FLOAT3;0,0,0;Out;;Inherit;False;ParallaxWindow;True;False;0;;False;16;0;FLOAT2;0,0;False;1;FLOAT3;0,0,0;False;2;SAMPLER2D;_Sampler287;False;3;FLOAT;24;False;4;FLOAT4;0.031,0.022,0.969,0.978;False;5;FLOAT;0.01;False;6;FLOAT;0.25;False;7;FLOAT;0.75;False;8;FLOAT;1;False;9;SAMPLER2D;_Sampler987;False;10;FLOAT;0.06;False;11;FLOAT;0.5;False;12;FLOAT;6;False;13;FLOAT;1;False;14;FLOAT4;0.25,0.55,1,1;False;15;FLOAT3;0,0,0;False;2;FLOAT4;0;FLOAT3;16
Node;AmplifyShaderEditor.LerpOp, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;112;-160,720;Inherit;False;3;0;FLOAT;0;False;1;FLOAT;0;False;2;FLOAT;0;False;1;FLOAT;0
Node;AmplifyShaderEditor.OneMinusNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;114;16,624;Inherit;False;1;0;FLOAT;0;False;1;FLOAT;0
Node;AmplifyShaderEditor.SimpleMultiplyOpNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;115;176,432;Inherit;False;2;2;0;COLOR;0,0,0,0;False;1;FLOAT;0;False;1;COLOR;0
Node;AmplifyShaderEditor.SimpleMultiplyOpNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;113;176,720;Inherit;False;2;2;0;COLOR;0,0,0,0;False;1;FLOAT;0;False;1;COLOR;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;110;-496,672;Inherit;False;Property;_ArtGlow;Art Glow;15;0;Create;True;0;0;0;False;0;False;0.6;0.6;0;1;0;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;111;-496,784;Inherit;False;Property;_BorderGlow;Border Glow;16;0;Create;True;0;0;0;False;0;False;0.2;0.2;0;1;0;1;FLOAT;0
Node;AmplifyShaderEditor.SamplerNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;42;-848,512;Inherit;True;Property;_CARD_BACK;CARD_BACK;2;0;Create;True;0;0;0;False;0;False;-1;None;None;True;0;False;white;Auto;False;Object;-1;Auto;Texture2D;False;8;0;SAMPLER2D;;False;1;FLOAT2;0,0;False;2;FLOAT;0;False;3;FLOAT2;0,0;False;4;FLOAT2;0,0;False;5;FLOAT;1;False;6;FLOAT;0;False;7;SAMPLERSTATE;;False;6;COLOR;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4;FLOAT3;5
Node;AmplifyShaderEditor.LerpOp, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;109;-64,480;Inherit;False;3;0;COLOR;0,0,0,0;False;1;COLOR;0,0,0,0;False;2;COLOR;0,0,0,0;False;1;COLOR;0
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;120;176,896;Inherit;False;// Holographic foil on the card art: rainbow bands that slide across the card as it tilts,$// plus a brighter glint band sweeping diagonally. Added on top of emission.$// Only where frontMask is set (not the back), not under the frame (border = frame alpha), and inside$// foilMask (card.foil.png: white/opaque = foil, black/transparent = plain print, default white = the whole art).$float area = foilMask.r@   // CardLayerFoil: layers and picture, front and back$float3 v = normalize(viewTS)@$float2 tilt = v.xy / max(v.z, 0.25)@$float grain = sin(dot(uv, float2(173.1, 61.7))) * sin(dot(uv, float2(-47.3, 211.9)))@$float phase = dot(uv, float2(0.6, 1.0)) * scale + dot(tilt, float2(0.8, 0.5)) * tiltShift + grain * 0.06@$float3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + float3(0.0, 0.333, 0.667)))@$float sweep = dot(uv - 0.5, float2(0.8, 0.6)) + dot(tilt, float2(0.45, 0.3)) * tiltShift@$float glint = pow(saturate(1.0 - abs(sweep) * 2.5), 4.0)@$float luma = dot(baseColor.rgb, float3(0.299, 0.587, 0.114))@$float3 foil = rainbow * (0.3 + 0.7 * luma) * (0.35 + 0.65 * glint) + glint * 0.25@$return foil * strength * area@;3;Create;9;False;uv;FLOAT2;0,0;In;;Inherit;False;False;viewTS;FLOAT3;0,0,0;In;;Inherit;False;False;frontMask;FLOAT;1;In;;Inherit;False;False;foilMask;FLOAT4;1,1,1,1;In;;Inherit;False;False;border;FLOAT;0;In;;Inherit;False;False;baseColor;FLOAT4;0,0,0,0;In;;Inherit;False;False;strength;FLOAT;0.6;In;;Inherit;False;False;scale;FLOAT;1.5;In;;Inherit;False;False;tiltShift;FLOAT;1.5;In;;Inherit;False;CardFoil;True;False;0;;False;9;0;FLOAT2;0,0;False;1;FLOAT3;0,0,0;False;2;FLOAT;1;False;3;FLOAT4;1,1,1,1;False;4;FLOAT;0;False;5;FLOAT4;0,0,0,0;False;6;FLOAT;0.6;False;7;FLOAT;1.5;False;8;FLOAT;1.5;False;1;FLOAT3;0
Node;AmplifyShaderEditor.SamplerNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;125;-480,1040;Inherit;True;Property;_FoilMask;Foil Mask;17;0;Create;True;0;0;0;False;0;False;-1;None;None;True;0;False;white;Auto;False;Object;-1;Auto;Texture2D;False;8;0;SAMPLER2D;;False;1;FLOAT2;0,0;False;2;FLOAT;0;False;3;FLOAT2;0,0;False;4;FLOAT2;0,0;False;5;FLOAT;1;False;6;FLOAT;0;False;7;SAMPLERSTATE;;False;6;COLOR;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4;FLOAT3;5
Node;AmplifyShaderEditor.SimpleAddOpNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;121;448,640;Inherit;False;2;2;0;COLOR;0,0,0,0;False;1;FLOAT3;0,0,0;False;1;COLOR;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;122;-160,1280;Inherit;False;Property;_FoilStrength;Foil Strength;18;0;Create;True;0;0;0;False;0;False;0.6;0.6;0;2;0;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;123;-160,1360;Inherit;False;Property;_FoilScale;Foil Scale;19;0;Create;True;0;0;0;False;0;False;1.5;1.5;0;0;0;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;124;-160,1440;Inherit;False;Property;_FoilShift;Foil Tilt Shift;20;0;Create;True;0;0;0;False;0;False;1.5;1.5;0;0;0;1;FLOAT;0
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;126;176,1520;Inherit;False;// Bump detail, tangent space (OpenGL / Unity convention: green = up), so the card catches the game's lights. Front: the$// card layers' normals (_LayerNormal, stacked by the client, on the glass) over the picture's normal map at the parallax$// hit (hit = ParallaxWindow's hit, xy: UV, z: how much art, not box wall, is seen there@ flat on the walls) where no layer$// covers it (border = the layers' coverage). Back: the back layers' (_BackNormal). Default textures "bump" = flat.$float3 base = tex2Dgrad( normalMap, hit.xy, ddx( uv ), ddy( uv ) ).xyz * 2.0 - 1.0@$base = lerp( float3( 0, 0, 1 ), base, saturate( hit.z ) )@$float3 layer = tex2D( layerNormal, uv ).xyz * 2.0 - 1.0@$float3 back = tex2D( backNormal, uv ).xyz * 2.0 - 1.0@$float3 n = lerp( back, lerp( base, layer, border ), saturate( frontMask ) )@$n.xy *= strength@$return normalize( n )@;3;Create;8;False;hit;FLOAT3;0,0,0;In;;Inherit;False;False;uv;FLOAT2;0,0;In;;Inherit;False;False;normalMap;SAMPLER2D;_Sampler2126;In;;Inherit;False;False;strength;FLOAT;1;In;;Inherit;False;False;frontMask;FLOAT;1;In;;Inherit;False;False;border;FLOAT;0;In;;Inherit;False;False;layerNormal;SAMPLER2D;_Sampler6126;In;;Inherit;False;False;backNormal;SAMPLER2D;_Sampler7126;In;;Inherit;False;CardNormal;True;False;0;;False;8;0;FLOAT3;0,0,0;False;1;FLOAT2;0,0;False;2;SAMPLER2D;_Sampler2126;False;3;FLOAT;1;False;4;FLOAT;1;False;5;FLOAT;0;False;6;SAMPLER2D;_Sampler6126;False;7;SAMPLER2D;_Sampler7126;False;1;FLOAT3;0
Node;AmplifyShaderEditor.TexturePropertyNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;127;-480,1520;Inherit;True;Property;_NormalMap;Normal Map;21;0;Create;True;0;0;0;False;0;False;None;None;False;bump;Auto;Texture2D;False;-1;0;2;SAMPLER2D;0;SAMPLERSTATE;1
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;128;-160,1600;Inherit;False;Property;_NormalStrength;Normal Strength;22;0;Create;True;0;0;0;False;0;False;1;1;0;2;0;1;FLOAT;0
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;130;448,1040;Inherit;False;return foilMask.r * saturate( strength * 1.5 )@;1;Create;4;False;frontMask;FLOAT;1;In;;Inherit;False;False;foilMask;FLOAT4;1,1,1,1;In;;Inherit;False;False;border;FLOAT;0;In;;Inherit;False;False;strength;FLOAT;0.6;In;;Inherit;False;CardFoilMetal;True;False;0;;False;4;0;FLOAT;1;False;1;FLOAT4;1,1,1,1;False;2;FLOAT;0;False;3;FLOAT;0.6;False;1;FLOAT;0
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;131;512,224;Inherit;False;// Albedo of the foil area. Where the card is metallic (metal, from CardFoilMetal) the albedo is the colour of its$// reflections, so this gives the lights' highlights and the reflections the same sliding rainbow bands as CardFoil.$float3 v = normalize(viewTS)@$float2 tilt = v.xy / max(v.z, 0.25)@$float grain = sin(dot(uv, float2(173.1, 61.7))) * sin(dot(uv, float2(-47.3, 211.9)))@$float phase = dot(uv, float2(0.6, 1.0)) * scale + dot(tilt, float2(0.8, 0.5)) * tiltShift + grain * 0.06@$float3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + float3(0.0, 0.333, 0.667)))@$float3 foil = saturate(rainbow * 0.85 + albedo.rgb * 0.35)@$return lerp(albedo.rgb, foil, metal)@;3;Create;6;False;albedo;FLOAT4;0,0,0,0;In;;Inherit;False;False;metal;FLOAT;0;In;;Inherit;False;False;uv;FLOAT2;0,0;In;;Inherit;False;False;viewTS;FLOAT3;0,0,0;In;;Inherit;False;False;scale;FLOAT;1.5;In;;Inherit;False;False;tiltShift;FLOAT;1.5;In;;Inherit;False;CardFoilAlbedo;True;False;0;;False;6;0;FLOAT4;0,0,0,0;False;1;FLOAT;0;False;2;FLOAT2;0,0;False;3;FLOAT3;0,0,0;False;4;FLOAT;1.5;False;5;FLOAT;1.5;False;1;FLOAT3;0
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;132;512,768;Inherit;False;float rough = lerp( roughness, surface.g, surface.a )@$return lerp( 1.0 - rough, 0.9, surface.r * saturate( strength * 1.5 ) )@;1;Create;3;False;surface;FLOAT4;0,0,0,0;In;;Inherit;False;False;strength;FLOAT;0.6;In;;Inherit;False;False;roughness;FLOAT;1;In;;Inherit;False;CardSmoothness;True;False;0;;False;3;0;FLOAT4;0,0,0,0;False;1;FLOAT;0.6;False;2;FLOAT;1;False;1;FLOAT;0
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;154;640,1040;Inherit;False;return max( surface.b, foilMetal )@;1;Create;2;False;surface;FLOAT4;0,0,0,0;In;;Inherit;False;False;foilMetal;FLOAT;0;In;;Inherit;False;CardMetallic;True;False;0;;False;2;0;FLOAT4;0,0,0,0;False;1;FLOAT;0;False;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;153;256,768;Inherit;False;Property;_Roughness;Roughness;28;0;Create;True;0;0;0;False;0;False;1;1;0;1;0;1;FLOAT;0
Node;AmplifyShaderEditor.SamplerNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;140;-480,1200;Inherit;True;Property;_LayerFoil;Layer Foil;23;0;Create;True;0;0;0;False;0;False;-1;None;None;True;0;False;black;Auto;False;Object;-1;Auto;Texture2D;False;8;0;SAMPLER2D;;False;1;FLOAT2;0,0;False;2;FLOAT;0;False;3;FLOAT2;0,0;False;4;FLOAT2;0,0;False;5;FLOAT;1;False;6;FLOAT;0;False;7;SAMPLERSTATE;;False;6;COLOR;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4;FLOAT3;5
Node;AmplifyShaderEditor.SamplerNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;141;-480,1360;Inherit;True;Property;_BackFoil;Back Foil;24;0;Create;True;0;0;0;False;0;False;-1;None;None;True;0;False;black;Auto;False;Object;-1;Auto;Texture2D;False;8;0;SAMPLER2D;;False;1;FLOAT2;0,0;False;2;FLOAT;0;False;3;FLOAT2;0,0;False;4;FLOAT2;0,0;False;5;FLOAT;1;False;6;FLOAT;0;False;7;SAMPLERSTATE;;False;6;COLOR;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4;FLOAT3;5
Node;AmplifyShaderEditor.TexturePropertyNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;142;-480,1680;Inherit;True;Property;_LayerNormal;Layer Normal;25;0;Create;True;0;0;0;False;0;False;None;None;False;bump;Auto;Texture2D;False;-1;0;2;SAMPLER2D;0;SAMPLERSTATE;1
Node;AmplifyShaderEditor.TexturePropertyNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;143;-480,1840;Inherit;True;Property;_BackNormal;Back Normal;26;0;Create;True;0;0;0;False;0;False;None;None;False;bump;Auto;Texture2D;False;-1;0;2;SAMPLER2D;0;SAMPLERSTATE;1
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;144;-128,1120;Inherit;False;float front = lerp( baseFoil.r * baseFoil.a, layerFoil.r, layers )@$float k = saturate( frontMask )@$float4 surface = lerp( backFoil, layerFoil, k )@$return float4( lerp( backFoil.r, front, k ), surface.b, surface.a, lerp( 1.0, layers, k ) )@;4;Create;5;False;baseFoil;FLOAT4;0,0,0,0;In;;Inherit;False;False;layerFoil;FLOAT4;0,0,0,0;In;;Inherit;False;False;layers;FLOAT;0;In;;Inherit;False;False;backFoil;FLOAT4;0,0,0,0;In;;Inherit;False;False;frontMask;FLOAT;1;In;;Inherit;False;CardLayerFoil;True;False;0;;False;5;0;FLOAT4;0,0,0,0;False;1;FLOAT4;0,0,0,0;False;2;FLOAT;0;False;3;FLOAT4;0,0,0,0;False;4;FLOAT;1;False;1;FLOAT4;0
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;145;-352,864;Inherit;False;// Which glow: 0 = the art's (Art Glow), 1 = a frame's (Border Glow). Collection layers count as frame: the client stacks$// that into the G channel of _LayerFoil / _BackFoil.$return lerp( backFoil.g, layerFoil.g, saturate( frontMask ) )@;1;Create;3;False;layerFoil;FLOAT4;0,0,0,0;In;;Inherit;False;False;backFoil;FLOAT4;0,0,0,0;In;;Inherit;False;False;frontMask;FLOAT;1;In;;Inherit;False;CardLayerGlow;True;False;0;;False;3;0;FLOAT4;0,0,0,0;False;1;FLOAT4;0,0,0,0;False;2;FLOAT;1;False;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;150;256,896;Inherit;False;Global;_DaCardWorld;DaCard World;40;0;Create;True;0;0;0;False;0;False;0;0;0;1;0;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;151;256,976;Inherit;False;Property;_WorldGlow;Glow in the world;27;0;Create;True;0;0;0;False;0;False;0.1;0.1;0;1;0;1;FLOAT;0
Node;AmplifyShaderEditor.CustomExpressionNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;152;560,640;Inherit;False;// A card lying in the world (drawn by the game's main camera: the client sets the global _DaCardWorld then) is lit by the$// raid: its own light (art glow, foil shine) drops to worldGlow, so it is dark in the dark. Inspect views and icons: 1.$return emission * lerp( 1.0, worldGlow, saturate( world ) )@;3;Create;3;False;emission;FLOAT3;0,0,0;In;;Inherit;False;False;world;FLOAT;0;In;;Inherit;False;False;worldGlow;FLOAT;0.1;In;;Inherit;False;CardWorldEmission;True;False;0;;False;3;0;FLOAT3;0,0,0;False;1;FLOAT;0;False;2;FLOAT;0.1;False;1;FLOAT3;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;1;752,384;Float;False;True;-1;3;AmplifyShaderEditor.MaterialInspector;0;3;AmplifyCardShader3D;ed95fe726fd7b4644bb42f4d1ddd2bcd;True;ForwardBase;0;1;ForwardBase;17;False;True;0;1;False;;0;False;;0;1;False;;0;False;;True;0;False;;0;False;;False;False;False;False;False;False;False;False;False;True;0;False;;False;True;0;False;;False;True;True;True;True;True;0;False;;False;False;False;False;False;False;False;True;False;0;False;;255;False;;255;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;False;True;1;False;;True;3;False;;False;False;True;3;RenderType=Opaque=RenderType;Queue=Geometry=Queue=0;DisableBatching=False=DisableBatching;True;3;True;12;all;0;False;True;1;1;False;;0;False;;0;1;False;;0;False;;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;True;1;LightMode=ForwardBase;False;False;0;;0;0;Standard;44;Category;0;0;  Instanced Terrain Normals;1;0;Workflow;1;0;Surface;0;0;  Blend;0;0;  Dither Shadows;1;0;Two Sided;1;0;Alpha Clipping;0;0;  Use Shadow Threshold;0;0;Deferred Pass;1;0;Normal Space;0;0;Transmission;0;0;  Transmission Shadow;0.5,False,;0;Translucency;0;0;  Translucency Strength;1,False,;0;  Normal Distortion;0.5,False,;0;  Scattering;2,False,;0;  Direct;0.9,False,;0;  Ambient;0.1,False,;0;  Shadow;0.5,False,;0;Cast Shadows;1;0;Receive Shadows;1;0;Receive Specular;2;0;Receive Reflections;2;0;GPU Instancing;1;0;LOD CrossFade;1;0;Built-in Fog;1;0;Ambient Light;1;0;Meta Pass;1;0;Add Pass;1;0;Override Baked GI;0;0;Write Depth;0;0;Extra Pre Pass;0;0;Tessellation;0;0;  Phong;0;0;  Strength;0.5,False,;0;  Type;0;0;  Tess;16,False,;0;  Min;10,False,;0;  Max;25,False,;0;  Edge Length;16,False,;0;  Max Displacement;25,False,;0;Disable Batching;0;0;Vertex Position;1;0;0;8;False;True;True;True;True;True;True;True;False;;False;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;0;0,0;Float;False;False;-1;3;AmplifyShaderEditor.MaterialInspector;0;3;New Amplify Shader;ed95fe726fd7b4644bb42f4d1ddd2bcd;True;ExtraPrePass;0;0;ExtraPrePass;6;False;True;0;1;False;;0;False;;0;1;False;;0;False;;True;0;False;;0;False;;False;False;False;False;False;False;False;False;False;True;0;False;;False;True;0;False;;False;True;True;True;True;True;0;False;;False;False;False;False;False;False;False;True;False;0;False;;255;False;;255;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;False;True;1;False;;True;3;False;;False;False;True;3;RenderType=Opaque=RenderType;Queue=Geometry=Queue=0;DisableBatching=False=DisableBatching;True;3;True;12;all;0;False;True;1;1;False;;0;False;;0;1;False;;0;False;;False;False;False;False;False;False;False;False;False;False;False;False;True;0;False;;False;True;True;True;True;True;0;False;;False;False;False;False;False;False;False;True;False;0;False;;255;False;;255;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;False;True;1;False;;True;3;False;;True;True;0;False;;0;False;;False;True;1;LightMode=ForwardBase;False;False;0;;0;0;Standard;0;False;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;2;0,0;Float;False;False;-1;3;AmplifyShaderEditor.MaterialInspector;0;3;New Amplify Shader;ed95fe726fd7b4644bb42f4d1ddd2bcd;True;ForwardAdd;0;2;ForwardAdd;0;False;True;0;1;False;;0;False;;0;1;False;;0;False;;True;0;False;;0;False;;False;False;False;False;False;False;False;False;False;True;0;False;;False;True;0;False;;False;True;True;True;True;True;0;False;;False;False;False;False;False;False;False;True;False;0;False;;255;False;;255;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;False;True;1;False;;True;3;False;;False;False;True;3;RenderType=Opaque=RenderType;Queue=Geometry=Queue=0;DisableBatching=False=DisableBatching;True;3;True;12;all;0;False;True;4;1;False;;1;False;;0;1;False;;0;False;;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;True;2;False;;False;False;False;True;1;LightMode=ForwardAdd;False;False;0;;0;0;Standard;0;False;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;3;0,0;Float;False;False;-1;3;AmplifyShaderEditor.MaterialInspector;0;3;New Amplify Shader;ed95fe726fd7b4644bb42f4d1ddd2bcd;True;Deferred;0;3;Deferred;0;False;True;0;1;False;;0;False;;0;1;False;;0;False;;True;0;False;;0;False;;False;False;False;False;False;False;False;False;False;True;0;False;;False;True;0;False;;False;True;True;True;True;True;0;False;;False;False;False;False;False;False;False;True;False;0;False;;255;False;;255;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;False;True;1;False;;True;3;False;;False;False;True;3;RenderType=Opaque=RenderType;Queue=Geometry=Queue=0;DisableBatching=False=DisableBatching;True;3;True;12;all;0;False;False;False;False;False;False;False;False;False;False;False;False;True;0;False;;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;True;1;LightMode=Deferred;False;False;0;;0;0;Standard;0;False;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;4;0,0;Float;False;False;-1;3;AmplifyShaderEditor.MaterialInspector;0;3;New Amplify Shader;ed95fe726fd7b4644bb42f4d1ddd2bcd;True;Meta;0;4;Meta;0;False;True;0;1;False;;0;False;;0;1;False;;0;False;;True;0;False;;0;False;;False;False;False;False;False;False;False;False;False;True;0;False;;False;True;0;False;;False;True;True;True;True;True;0;False;;False;False;False;False;False;False;False;True;False;0;False;;255;False;;255;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;False;True;1;False;;True;3;False;;False;False;True;3;RenderType=Opaque=RenderType;Queue=Geometry=Queue=0;DisableBatching=False=DisableBatching;True;3;True;12;all;0;False;False;False;False;False;False;False;False;False;False;False;False;False;False;True;2;False;;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;True;1;LightMode=Meta;False;False;0;;0;0;Standard;0;False;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;5;0,0;Float;False;False;-1;3;AmplifyShaderEditor.MaterialInspector;0;3;New Amplify Shader;ed95fe726fd7b4644bb42f4d1ddd2bcd;True;ShadowCaster;0;5;ShadowCaster;0;False;True;0;1;False;;0;False;;0;1;False;;0;False;;True;0;False;;0;False;;False;False;False;False;False;False;False;False;False;True;0;False;;False;True;0;False;;False;True;True;True;True;True;0;False;;False;False;False;False;False;False;False;True;False;0;False;;255;False;;255;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;False;True;1;False;;True;3;False;;False;False;True;3;RenderType=Opaque=RenderType;Queue=Geometry=Queue=0;DisableBatching=False=DisableBatching;True;3;True;12;all;0;False;False;False;False;False;False;False;False;False;False;False;False;True;0;False;;False;False;False;False;False;False;False;False;False;False;False;False;False;True;1;False;;True;3;False;;False;False;True;1;LightMode=ShadowCaster;False;False;0;;0;0;Standard;0;False;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;6;0,0;Float;False;False;-1;3;AmplifyShaderEditor.MaterialInspector;0;3;New Amplify Shader;ed95fe726fd7b4644bb42f4d1ddd2bcd;True;SceneSelectionPass;0;6;SceneSelectionPass;0;False;True;0;1;False;;0;False;;0;1;False;;0;False;;True;0;False;;0;False;;False;False;False;False;False;False;False;False;False;True;0;False;;False;True;0;False;;False;True;True;True;True;True;0;False;;False;False;False;False;False;False;False;True;False;0;False;;255;False;;255;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;False;True;1;False;;True;3;False;;False;False;True;3;RenderType=Opaque=RenderType;Queue=Geometry=Queue=0;DisableBatching=False=DisableBatching;True;3;True;12;all;0;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;True;1;False;;False;False;False;True;1;LightMode=SceneSelectionPass;False;False;0;;0;0;Standard;0;False;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode, AmplifyShaderEditor, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null;7;0,0;Float;False;False;-1;3;AmplifyShaderEditor.MaterialInspector;0;3;New Amplify Shader;ed95fe726fd7b4644bb42f4d1ddd2bcd;True;ScenePickingPass;0;7;ScenePickingPass;0;False;True;0;1;False;;0;False;;0;1;False;;0;False;;True;0;False;;0;False;;False;False;False;False;False;False;False;False;False;True;0;False;;False;True;0;False;;False;True;True;True;True;True;0;False;;False;False;False;False;False;False;False;True;False;0;False;;255;False;;255;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;0;False;;False;True;1;False;;True;3;False;;False;False;True;3;RenderType=Opaque=RenderType;Queue=Geometry=Queue=0;DisableBatching=False=DisableBatching;True;3;True;12;all;0;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;False;True;1;False;;False;False;False;True;1;LightMode=Picking;False;False;0;;0;0;Standard;0;False;0
WireConnection;77;0;87;0
WireConnection;77;1;70;0
WireConnection;77;2;70;4
WireConnection;70;1;69;0
WireConnection;41;1;43;0
WireConnection;87;0;95;0
WireConnection;87;1;88;0
WireConnection;87;2;81;0
WireConnection;87;3;89;0
WireConnection;87;5;91;0
WireConnection;87;6;92;0
WireConnection;87;7;93;0
WireConnection;87;8;94;0
WireConnection;87;9;38;0
WireConnection;87;10;96;0
WireConnection;87;11;97;0
WireConnection;87;12;98;0
WireConnection;87;13;99;0
WireConnection;87;14;100;0
WireConnection;112;0;110;0
WireConnection;112;1;111;0
WireConnection;112;2;145;0
WireConnection;114;0;112;0
WireConnection;115;0;109;0
WireConnection;115;1;114;0
WireConnection;113;0;109;0
WireConnection;113;1;112;0
WireConnection;42;1;43;0
WireConnection;109;0;42;0
WireConnection;109;1;77;0
WireConnection;109;2;41;0
WireConnection;120;0;95;0
WireConnection;120;1;88;0
WireConnection;120;2;41;1
WireConnection;120;3;144;0
WireConnection;120;4;70;4
WireConnection;120;5;109;0
WireConnection;120;6;122;0
WireConnection;120;7;123;0
WireConnection;120;8;124;0
WireConnection;125;1;95;0
WireConnection;121;0;113;0
WireConnection;121;1;120;0
WireConnection;126;0;87;16
WireConnection;126;1;95;0
WireConnection;126;2;127;0
WireConnection;126;3;128;0
WireConnection;126;4;41;1
WireConnection;126;5;70;4
WireConnection;126;6;142;0
WireConnection;126;7;143;0
WireConnection;130;0;41;1
WireConnection;130;1;144;0
WireConnection;130;2;70;4
WireConnection;130;3;122;0
WireConnection;131;0;115;0
WireConnection;131;1;130;0
WireConnection;131;2;95;0
WireConnection;131;3;88;0
WireConnection;131;4;123;0
WireConnection;131;5;124;0
WireConnection;140;1;69;0
WireConnection;141;1;43;0
WireConnection;144;0;125;0
WireConnection;144;1;140;0
WireConnection;144;2;70;4
WireConnection;144;3;141;0
WireConnection;144;4;41;1
WireConnection;145;0;140;0
WireConnection;145;1;141;0
WireConnection;145;2;41;1
WireConnection;152;0;121;0
WireConnection;152;1;150;0
WireConnection;152;2;151;0
WireConnection;132;0;144;0
WireConnection;132;1;122;0
WireConnection;132;2;153;0
WireConnection;1;0;131;0
WireConnection;1;1;126;0
WireConnection;154;0;144;0
WireConnection;154;1;130;0
WireConnection;1;4;154;0
WireConnection;1;5;132;0
WireConnection;1;2;152;0
ASEEND*/
//CHKSM=F5A93EADF2F300853C5C9370F31FBE0E8F0AFE49