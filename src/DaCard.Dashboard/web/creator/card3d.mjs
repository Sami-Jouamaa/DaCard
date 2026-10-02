(() => {
    'use strict';

    const CARD_W = 0.63, CARD_H = 0.88, THICK = 0.008, RADIUS = 0.03;
    const FOV = 30 * Math.PI / 180;
    const DIST = 2.3;

    const MATERIAL = {
        ArtGlow: 0.6, BorderGlow: 0.2, FoilStrength: 0.6, FoilScale: 1.5, FoilShift: 1.5,
        Steps: 128, nearDepth: 0, farDepth: 1, heightMin: 0, heightMax: 1, backPlane: 0, depthStrength: 1, pictureRoughness: 1, pictureMetallic: 0,
        edgeFade: 0.2, depthDarken: 0.75, skyScale: 6, skyBrightness: 1, NormalStrength: 1,
    };
    // card_amplify_2d.mat values that differ from the 3D material
    const MATERIAL_2D = { NormalStrength: 0.2 };
    const UNIFORMS = {
        ArtGlow: 'uArtGlow', BorderGlow: 'uBorderGlow', FoilScale: 'uFoilScale', FoilShift: 'uFoilShift',
        Steps: 'uSteps', nearDepth: 'uNear', farDepth: 'uFar', heightMin: 'uHeightMin', heightMax: 'uHeightMax', backPlane: 'uBackPlane', depthStrength: 'uStrength', pictureRoughness: 'uPictureRoughnessValue', pictureMetallic: 'uPictureMetallicValue',
        edgeFade: 'uEdgeFade', depthDarken: 'uDepthDarken', skyScale: 'uSkyScale',
        skyBrightness: 'uSkyBrightness', NormalStrength: 'uNormalStrength',
    };

    function perspective(fovy, aspect, near, far) {
        const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
        return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    }
    function mul(a, b) {
        const o = new Float32Array(16);
        for (let c = 0; c < 4; c++)
            for (let r = 0; r < 4; r++)
                o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        return o;
    }
    function rotation(yaw, pitch) {
        const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
        return new Float32Array([cy, sp * sy, -cp * sy, 0, 0, cp, sp, 0, sy, -sp * cy, cp * cy, 0, 0, 0, 0, 1]);
    }

    function cardMesh() {
        const outline = [];
        const corners = [[CARD_W / 2 - RADIUS, -CARD_H / 2 + RADIUS, -90], [CARD_W / 2 - RADIUS, CARD_H / 2 - RADIUS, 0],
            [-CARD_W / 2 + RADIUS, CARD_H / 2 - RADIUS, 90], [-CARD_W / 2 + RADIUS, -CARD_H / 2 + RADIUS, 180]];
        for (const [cx, cy, start] of corners)
            for (let i = 0; i <= 8; i++) {
                const a = (start + i * 90 / 8) * Math.PI / 180;
                outline.push([cx + Math.cos(a) * RADIUS, cy + Math.sin(a) * RADIUS, Math.cos(a), Math.sin(a)]);
            }
        const pos = [], nrm = [], uv = [], idx = [];
        const vert = (p, n, t) => { pos.push(...p); nrm.push(...n); uv.push(...t); return pos.length / 3 - 1; };
        const parts = {};
        for (const [name, z, nz] of [['front', THICK / 2, 1], ['back', -THICK / 2, -1]]) {
            const start = idx.length;
            const u = (x) => (nz > 0 ? x / CARD_W + 0.5 : 0.5 - x / CARD_W);
            const c = vert([0, 0, z], [0, 0, nz], [0.5, 0.5]);
            const ring = outline.map(([x, y]) => vert([x, y, z], [0, 0, nz], [u(x), y / CARD_H + 0.5]));
            for (let i = 0; i < ring.length; i++) {
                const a = ring[i], b = ring[(i + 1) % ring.length];
                idx.push(...(nz > 0 ? [c, a, b] : [c, b, a]));
            }
            parts[name] = [start, idx.length - start];
        }
        const start = idx.length;
        for (let i = 0; i < outline.length; i++) {
            const [x0, y0, nx0, ny0] = outline[i], [x1, y1, nx1, ny1] = outline[(i + 1) % outline.length];
            const a = vert([x0, y0, THICK / 2], [nx0, ny0, 0], [0, 0]), b = vert([x0, y0, -THICK / 2], [nx0, ny0, 0], [0, 0]);
            const c = vert([x1, y1, THICK / 2], [nx1, ny1, 0], [0, 0]), d = vert([x1, y1, -THICK / 2], [nx1, ny1, 0], [0, 0]);
            idx.push(a, b, c, c, b, d);
        }
        parts.edge = [start, idx.length - start];
        return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), idx: new Uint16Array(idx), parts };
    }

    const VS = `#version 300 es
        in vec3 aPos; in vec3 aNrm; in vec2 aUV;
        uniform mat4 uModel, uViewProj;
        out vec3 vPos; out vec3 vNrm; out vec2 vUV;
        void main() {
            vec4 p = uModel * vec4(aPos, 1.0);
            vPos = p.xyz; vNrm = mat3(uModel) * aNrm; vUV = aUV;
            gl_Position = uViewProj * p;
        }`;

    const FS = `#version 300 es
        precision highp float;
        in vec3 vPos; in vec3 vNrm; in vec2 vUV;
        uniform mat4 uModel;
        uniform vec3 uEye;
        uniform int uPart;            // 0 front, 1 back, 2 edge
        uniform bool uDeep;           // 3D card: parallax art box
        uniform float uFoil;          // foil strength, 0 = not a foil card
        uniform vec3 uRarity;
        uniform sampler2D uArt, uDepth, uFoilMask, uOverlay, uBack;
        uniform sampler2D uNormal;    // card.normal.png, flat when missing
        uniform sampler2D uLayerFoil, uLayerNormal, uBackFoil, uBackNormal, uLayerSurface, uBackSurface;
        uniform float uRoughness;
        uniform sampler2D uPictureRoughness, uPictureMetallic;
        uniform float uHasPictureRoughness, uHasPictureMetallic, uPictureRoughnessValue, uPictureMetallicValue;
        // Material floats (MATERIAL below)
        uniform float uArtGlow, uBorderGlow, uFoilScale, uFoilShift, uFoilType;
        uniform float uSteps, uNear, uFar, uHeightMin, uHeightMax, uBackPlane, uStrength;
        uniform float uEdgeFade, uDepthDarken, uSkyScale, uSkyBrightness, uNormalStrength;
        out vec4 outColor;

        const vec4 WINDOW = vec4(0.031, 0.022, 0.969, 0.978);
        const vec3 EDGE_COLOR = vec3(0.16);

        float h1(vec3 q) { return fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        vec3 h3(vec3 q) {
            return fract(sin(vec3(dot(q, vec3(127.1, 311.7, 74.7)), dot(q, vec3(269.5, 183.3, 246.1)), dot(q, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
        }

        float boxScene(vec2 q, vec2 dx, vec2 dy) {
            float range = max(uHeightMax - uHeightMin, 1e-4);
            float knee = min(uBackPlane, 0.1);
            float h = clamp((textureGrad(uDepth, q, dx, dy).r - uHeightMin) / range, 0.0, 1.0);
            h = clamp(0.5 + (h - 0.5) * uStrength, 0.0, 1.0);
            float m = max(knee - abs(h - uBackPlane), 0.0);
            return mix(uFar, uNear, max(h, uBackPlane) + m * m / max(4.0 * knee, 1e-5));
        }

        // Port of CardShader3D ParallaxWindow
        // hit (out): xy = UV the ray landed on, z = share of art (not box wall) seen there; for the normal map
        vec4 parallaxWindow(vec2 uv, vec3 viewTS, out vec3 hit) {
            const float aspect = 63.0 / 88.0;
            vec3 v = normalize(viewTS);
            vec2 shift = -v.xy / max(v.z, 0.15);
            shift.y *= aspect;
            vec2 dx = dFdx(uv), dy = dFdy(uv);
            int n = clamp(int(uSteps), 1, 128);
            float stepD = (uFar - uNear) / float(n);
            float d = uNear;
            vec2 p = uv;
            // One height map
            p = uv + shift * d;
            float scene = boxScene(p, dx, dy);
            float prevD = d, prevDiff = scene - d;
            for (int i = 0; i < 128; i++) {
                if (i >= n || d >= scene) break;
                prevD = d; prevDiff = scene - d;
                d += stepD;
                p = uv + shift * d;
                scene = boxScene(p, dx, dy);
            }
            float lo = prevD, hi = d, loDiff = prevDiff, hiDiff = scene - d;
            for (int r = 0; r < 5; r++) {
                float mid = 0.5 * (lo + hi);
                p = uv + shift * mid;
                scene = boxScene(p, dx, dy);
                if (scene > mid) { lo = mid; loDiff = scene - mid; }
                else { hi = mid; hiDiff = scene - mid; }
            }
            float t = loDiff / max(loDiff - hiDiff, 1e-5);
            d = mix(lo, hi, clamp(t, 0.0, 1.0));
            p = uv + shift * d;
            vec4 art = textureGrad(uArt, p, dx, dy);
            float depth01 = clamp((d - uNear) / max(uFar - uNear, 1e-5), 0.0, 1.0);

            vec2 toWall = vec2(
                shift.x > 1e-5 ? (WINDOW.z - uv.x) / shift.x : (shift.x < -1e-5 ? (WINDOW.x - uv.x) / shift.x : 1e5),
                shift.y > 1e-5 ? (WINDOW.w - uv.y) / shift.y : (shift.y < -1e-5 ? (WINDOW.y - uv.y) / shift.y : 1e5));
            float dWall = max(min(toWall.x, toWall.y), 0.0);
            float soft = max(uEdgeFade, 1e-4);
            float wallAmount = 1.0 - smoothstep(-soft, soft, dWall - d);
            vec3 artCol = art.rgb * mix(1.0, uDepthDarken, depth01);

            vec3 wall = vec3(0.0);
            if (wallAmount > 0.001) {
                vec3 I = v;
                vec2 pw = uv + shift * dWall;
                vec3 wp = vec3(pw.x, pw.y / aspect, -dWall);
                vec3 p0 = wp * uSkyScale;
                vec3 rc = pow(clamp(uRarity, 0.0, 1.0), vec3(2.2));
                vec3 ro = p0;
                for (int s = 0; s < 8; s++) {
                    vec3 q = ro * 0.54;
                    float fbm = 0.0, amp = 1.0, nrm = 0.0;
                    for (int o = 0; o < 6; o++) {
                        vec3 i0 = floor(q), f0 = fract(q), w3 = f0 * f0 * (3.0 - 2.0 * f0);
                        float nv = mix(mix(mix(h1(i0), h1(i0 + vec3(1, 0, 0)), w3.x),
                                           mix(h1(i0 + vec3(0, 1, 0)), h1(i0 + vec3(1, 1, 0)), w3.x), w3.y),
                                       mix(mix(h1(i0 + vec3(0, 0, 1)), h1(i0 + vec3(1, 0, 1)), w3.x),
                                           mix(h1(i0 + vec3(0, 1, 1)), h1(i0 + vec3(1, 1, 1)), w3.x), w3.y), w3.z);
                        fbm += nv * amp; nrm += amp; amp *= 0.472; q *= 1.91;
                    }
                    ro -= I * (fbm / nrm - 0.45);
                }
                float nebulaDepth = clamp(distance(p0, ro), 0.0, 1.0);
                wall = rc * mix(0.35, 0.07, nebulaDepth);
                wall += rc * pow(1.0 - clamp(I.z, 0.0, 1.0), 5.0) * 0.5;
                vec3 gq1 = wp * 2.0, gq2 = wp * 89.2;
                vec3 c1 = vec3(0.0), c2 = vec3(0.0); float d1 = 8.0, d2 = 8.0;
                for (int gz = -1; gz <= 1; gz++)
                for (int gy = -1; gy <= 1; gy++)
                for (int gx = -1; gx <= 1; gx++) {
                    vec3 o3 = vec3(gx, gy, gz);
                    vec3 k1 = floor(gq1) + o3;
                    float e1 = length(k1 + h3(k1) - gq1);
                    if (e1 < d1) { d1 = e1; c1 = h3(k1 + 17.0); }
                    vec3 k2 = floor(gq2) + o3;
                    vec3 a2 = pow(abs(k2 + h3(k2) - gq2), vec3(0.38));
                    float e2 = pow(a2.x + a2.y + a2.z, 1.0 / 0.38);
                    if (e2 < d2) { d2 = e2; c2 = h3(k2 + 17.0); }
                }
                wall += vec3(0.045, 0.016, 0.0065) * pow(clamp(dot(I, c1 * 2.0 - 1.0) * 0.5 + 0.5, 0.0, 1.0), 10.0);
                wall += vec3(1.0, 0.288, 0.082) * pow(clamp(dot(I, c2 * 2.0 - 1.0) * 0.5 + 0.5, 0.0, 1.0), 10.0) * (d2 < 0.8 ? 1.0 : 0.0);
                vec3 rs = p0;
                for (int k = 0; k < 16; k++) {
                    vec3 sq = rs * 4.53, sc = floor(sq);
                    float dm = 8.0;
                    for (int sz = -1; sz <= 1; sz++)
                    for (int sy = -1; sy <= 1; sy++)
                    for (int sx = -1; sx <= 1; sx++) {
                        vec3 cc = sc + vec3(sx, sy, sz);
                        dm = min(dm, length(cc + h3(cc) - sq));
                    }
                    rs -= I * (dm * 0.19);
                }
                float star = clamp(pow(1.25 / (distance(p0, rs) + 1.0), mix(30.0, 10.0, nebulaDepth)) * 5.0, 0.0, 1.0);
                vec3 starCol = star < 0.089 ? mix(vec3(0.0), vec3(0.5, 0.292, 0.196), clamp((star - 0.027) / 0.062, 0.0, 1.0))
                             : star < 0.359 ? mix(vec3(0.5, 0.292, 0.196), vec3(1.0), (star - 0.089) / 0.27)
                             : star < 0.5   ? mix(vec3(1.0), vec3(0.5, 0.0, 0.0), (star - 0.359) / 0.141)
                             :                mix(vec3(0.5, 0.0, 0.0), vec3(0.258, 0.528, 1.0), (star - 0.5) / 0.5);
                wall += starCol * star;
                wall *= mix(1.0, uDepthDarken, clamp(dWall / max(uFar, 1e-5), 0.0, 1.0));
                wall = pow(clamp(wall * uSkyBrightness, 0.0, 1.0), vec3(1.0 / 2.2));
            }
            hit = vec3(p, 1.0 - wallAmount);
            return vec4(mix(artCol, wall, wallAmount), art.a);
        }

        float foilKind = 0.0;

        float foilKindAt(sampler2D map, vec2 uv) {
            ivec2 size = textureSize(map, 0);
            vec4 t = texelFetch(map, clamp(ivec2(uv * vec2(size)), ivec2(0), size - 1), 0);
            float code = floor(t.b * 255.0 / 20.0 + 0.5);
            return code < 0.5 ? uFoilType : code - 1.0;
        }

        float fwUV = 1e-3;

        float dcHash(vec2 c) {
            vec2 q = fract(c * vec2(123.34, 456.21));
            q += dot(q, q + 45.32);
            return fract(q.x * q.y);
        }
        vec3 dcBump(float x, vec3 c, vec3 o, vec3 y) {
            vec3 a = c * (x - o);
            return clamp(1.0 - a * a - y, 0.0, 1.0);
        }
        vec3 dcSpectral(float x) {
            return dcBump(x, vec3(3.54585104, 2.93225262, 2.41593945), vec3(0.69549072, 0.49228336, 0.27699880), vec3(0.02312639, 0.15225084, 0.52607955))
                + dcBump(x, vec3(3.90307140, 3.21182957, 3.96587128), vec3(0.11748627, 0.86755042, 0.66077860), vec3(0.84897130, 0.88445281, 0.73949448));
        }
        vec3 dcSpec(float t) { return dcSpectral(fract(t)); }
        float dcCount(float s, float m, float k) { return m + (s - m) * inversesqrt(max(k, 1.0)); }
        vec3 dcCount3(vec3 s, float m, float k) { return vec3(m) + (s - vec3(m)) * inversesqrt(max(k, 1.0)); }
        bool patterned() { return foilKind > 0.5 && foilKind < 11.5; }

        vec4 foilPattern(vec2 uv, vec3 viewTS, float type, vec3 normalTS) {
            vec3 nb = normalize(normalTS);
            vec3 v = normalize(viewTS);
            vec3 p = vec3(uv.x - 0.5, (uv.y - 0.5) * 1.397, 0.0);
            vec3 up = normalize(vec3(0.0, 1.0, 0.0) - v * v.y);
            vec3 eye = v * 2.0;
            vec3 V = normalize(eye - p);
            vec3 L = normalize(eye + (up * 0.7 + cross(up, v) * 0.35) * 2.0 - p);
            vec2 h = (L - nb * dot(L, nb)).xy + (V - nb * dot(V, nb)).xy;
            vec2 nh = normalize(h + 1e-5);
            float vn = dot(v, nb);
            vec2 tilt = (v - nb * vn).xy / max(vn, 0.25);
            float spot = 0.55 + 0.75 * pow(clamp(dot(nb, normalize(L + V)), 0.0, 1.0), 12.0);
            float fw = fwUV;
            vec2 dir = vec2(0.866, 0.5);
            float gate = 1.0;
            float sheen = 0.0;
            vec3 col = vec3(0.0);
            float glint = 0.0;
            bool grating = type > 0.5 && type < 11.5;
            if (type > 10.5) {
                vec2 q = uv * vec2(9.0, 12.573);
                vec2 b = floor(q);
                float d1 = 8.0;
                vec2 id = b;
                for (int j = -1; j <= 1; j++)
                    for (int i = -1; i <= 1; i++) {
                        vec2 nc = b + vec2(float(i), float(j));
                        vec2 o = nc + 0.1 + 0.8 * vec2(dcHash(nc + vec2(0.0, 3.3)), dcHash(nc + vec2(5.7, 0.0)));
                        float d = length(q - o);
                        if (d < d1) { d1 = d; id = nc; }
                    }
                float turn = dcHash(id + vec2(1.7, 9.2)) * 6.2831853;
                dir = vec2(cos(turn), sin(turn));
                gate = 0.45 + 0.55 * dcHash(id + vec2(6.6, 2.2));
                sheen = 0.25;
            } else if (type > 9.5) {
                grating = false;
                vec2 cn = uv * vec2(7.0, 9.779);
                vec2 ci = floor(cn);
                vec2 cf = fract(cn);
                cf = cf * cf * (3.0 - 2.0 * cf);
                float dens = mix(mix(dcHash(ci), dcHash(ci + vec2(1.0, 0.0)), cf.x), mix(dcHash(ci + vec2(0.0, 1.0)), dcHash(ci + vec2(1.0, 1.0)), cf.x), cf.y);
                dens = 0.45 + 0.3 * dens;
                vec2 pp = vec2(uv.x, uv.y * 1.397);
                for (int k = 0; k < 3; k++) {
                    float fk = float(k);
                    float s = k == 0 ? 113.0 : (k == 1 ? 139.0 : 167.0);
                    float an = k == 0 ? 0.31 : (k == 1 ? 1.13 : 2.07);
                    vec2 q = vec2(cos(an) * pp.x - sin(an) * pp.y, sin(an) * pp.x + cos(an) * pp.y) * s + vec2(0.37, 0.61) * fk;
                    vec2 c = floor(q) + vec2(41.3, 27.1) * fk;
                    float rad = 0.0026 * s * (0.85 + 0.3 * dcHash(c + vec2(7.7, 3.3)));
                    vec2 o = (vec2(dcHash(c + vec2(1.3, 0.0)), dcHash(c + vec2(0.0, 2.9))) - 0.5) * (1.0 - 2.0 * rad);
                    float d = length(fract(q) - 0.5 - o);
                    float turn = dcHash(c + vec2(4.1, 2.3)) * 6.2831853;
                    float tw = pow(clamp(dot(vec2(cos(turn), sin(turn)), nh), 0.0, 1.0), 3.0);
                    float dotMask = clamp((rad - d) / max(fw * s * 1.5, 0.05) + 0.5, 0.0, 1.0) * step(1.0 - dens, dcHash(c));
                    vec3 tint = dcSpec(uv.x * 0.35 + uv.y * 0.75 + dot(tilt, vec2(0.6, 0.5)) + dcHash(c + vec2(8.8, 0.0)) * 0.15);
                    float kk = fw * s * fw * s;
                    float mn = dens * 3.14159 * rad * rad * 0.6;
                    col += tint * dcCount(dotMask * (0.45 + 1.1 * tw), mn, kk) * 1.7;
                    glint += dcCount(dotMask * tw * tw * tw, mn * 0.1, kk) * 0.45;
                }
            } else if (type > 8.5) {
                grating = false;
                float ph = length(p.xy - vec2(-0.45, 1.0)) * 2.4 - dot(tilt, vec2(0.8, 0.6)) * 0.9;
                col = dcSpec(ph) * (0.6 + 0.4 * cos(6.2831853 * ph * 0.5)) * 1.6;
                glint = pow(clamp(1.0 - abs(fract(ph * 0.5) - 0.5) * 8.0, 0.0, 1.0), 3.0) * 0.5;
            } else if (type > 7.5) {
                grating = false;
                float ph = dot(p.xy, vec2(0.8, 0.6)) * 1.4 + dot(tilt, vec2(1.1, 0.8)) * 1.6;
                float band = pow(0.5 + 0.5 * cos(6.2831853 * ph), 3.0);
                float band2 = pow(0.5 + 0.5 * cos(6.2831853 * (ph * 2.7 + 0.3)), 10.0) * 0.6;
                col = dcSpec(ph * 0.8 + p.y * 0.25) * (band + band2) * 2.0;
                glint = pow(band, 6.0) * 0.5;
            } else if (type > 6.5) {
                vec2 q = uv * vec2(8.0, 11.176);
                vec2 fa = fract(q) - 0.5;
                vec2 fb = fract(q + 0.5) - 0.5;
                vec2 f = length(fb) < 0.5 ? fb : fa;
                float d = length(f);
                float rings = 0.5 + 0.5 * cos(d * 6.2831853 * 9.0);
                dir = f / max(d, 1e-4);
                gate = 0.45 + 0.55 * rings;
                sheen = 0.35;
            } else if (type > 4.5) {
                float cells = type > 5.5 ? 12.0 : 10.0;
                vec2 q = uv * vec2(cells, cells * 1.397);
                vec2 c = floor(q);
                vec2 f = fract(q) - 0.5;
                if (type < 5.5) {
                    float sec = floor(fract(atan(f.y, f.x) / 6.2831853 + dcHash(c)) * 7.0);
                    float turn = dcHash(c + sec * vec2(3.7, 1.9)) * 6.2831853;
                    dir = vec2(cos(turn), sin(turn));
                    gate = 0.55 + 0.45 * dcHash(c + sec * vec2(5.3, 0.0) + vec2(1.1, 2.2));
                    sheen = 0.25;
                } else {
                    dir = normalize(f + 1e-5);
                    gate = 0.65 + 0.35 * clamp(max(abs(f.x), abs(f.y)) * 2.5, 0.0, 1.0);
                }
            } else if (type > 3.5) {
                grating = false;
                for (int k = 0; k < 3; k++) {
                    float fk = float(k);
                    float s = k == 0 ? 6.0 : (k == 1 ? 20.0 : 64.0);
                    float prob = k == 0 ? 0.35 : (k == 1 ? 0.55 : 0.7);
                    float r0 = k == 0 ? 0.18 : (k == 1 ? 0.14 : 0.16);
                    float r1 = k == 0 ? 0.4 : (k == 1 ? 0.34 : 0.36);
                    float br = k == 0 ? 2.8 : (k == 1 ? 2.5 : 2.4);
                    vec2 q = uv * vec2(s, s * 1.397);
                    vec2 c = floor(q) + vec2(31.7, 17.9) * fk;
                    vec2 f = fract(q) - 0.5;
                    float r = mix(r0, r1, dcHash(c + vec2(3.1, 7.7)));
                    vec2 o = (vec2(dcHash(c + vec2(11.3, 0.0)), dcHash(c + vec2(0.0, 5.9))) - 0.5) * (1.0 - 2.0 * r);
                    float d = length(f - o);
                    float disc = clamp((r - d) / max(fw * s * 1.5, 0.02) + 0.5 * clamp(fw * s * 1.5 / r - 1.0, 0.0, 1.0), 0.0, 1.0) * step(1.0 - prob, dcHash(c));
                    vec3 dotCol = dcSpec(dcHash(c + vec2(2.7, 1.3)) + uv.y * 0.6 + dot(tilt, vec2(0.6, 0.45))) * (0.7 + 0.3 * cos(d / max(r, 1e-3) * 4.0 + dot(tilt, vec2(2.0, 1.5))));
                    float kk = fw * s * fw * s;
                    float mn = prob * 3.14159 * (r0 + r1) * (r0 + r1) * 0.25 * 0.35;
                    col += dcCount3(dotCol * disc, mn, kk) * br;
                    if (k == 2) glint = dcCount(disc * step(0.7, dcHash(c + vec2(9.1, 4.4))), mn * 0.3, kk) * 0.5;
                }
                for (int m = 0; m < 2; m++) {
                    vec2 sd = p.xy - (m == 0 ? vec2(0.25, 0.55) : vec2(-0.3, -0.2));
                    float sr = length(sd) + 1e-4;
                    float swirl = pow(clamp(sin(atan(sd.y, sd.x) * 2.0 - log(sr) * 7.0 + tilt.x + tilt.y), 0.0, 1.0), 8.0) * clamp(1.0 - sr * 5.0, 0.0, 1.0);
                    col += dcSpec(sr * 3.0 + dot(tilt, vec2(0.5, 0.5))) * swirl * (m == 0 ? 0.6 : 0.5);
                }
            } else if (type > 2.5) {
                vec2 cell = floor(uv * vec2(60.0, 83.8));
                float turn = dcHash(cell) * 6.2831853;
                gate = dcCount(step(0.4, dcHash(cell + 17.13)), 0.6, fw * 60.0 * fw * 60.0);
                dir = vec2(cos(turn), sin(turn));
                sheen = 0.2;
            } else if (type > 1.5) {
                dir = normalize(p.xy + 1e-5);
            }
            if (grating) {
                float g = abs(dot(h, dir));
                vec3 diff = vec3(0.0);
                for (int n = 1; n <= 8; n++) {
                    float w = g * 1600.0 / float(n);
                    if (w >= 400.0 && w <= 700.0) diff += dcSpectral(clamp((w - 400.0) / 300.0, 0.0, 1.0));
                }
                col = clamp(diff, 0.0, 1.0) * gate + sheen * gate * pow(clamp(dot(dir, nh) * 0.5 + 0.5, 0.0, 1.0), 16.0);
                glint = pow(clamp(1.0 - g * 4.0, 0.0, 1.0), 4.0) * gate;
            }
            return vec4(col, glint) * spot;
        }

        // Port of the CardFoil node (both card shaders)
        vec3 cardFoil(vec2 uv, vec3 viewTS, vec4 foilMask, float border, vec4 baseColor, float glow, vec4 pattern) {
            float area = foilMask.r * foilMask.a * (1.0 - border);
            vec3 v = normalize(viewTS);
            if (patterned()) {
                float pl = dot(baseColor.rgb, vec3(0.299, 0.587, 0.114));
                return (pattern.rgb * (0.3 + 0.7 * pl) * (abs(foilKind - 3.0) < 0.5 ? 1.4 : 1.0) + pattern.a * 0.25) * uFoil * area;
            }
            vec2 tilt = v.xy / max(v.z, 0.25);
            float grain = sin(dot(uv, vec2(173.1, 61.7))) * sin(dot(uv, vec2(-47.3, 211.9)));
            float phase = dot(uv, vec2(0.6, 1.0)) * uFoilScale + dot(tilt, vec2(0.8, 0.5)) * uFoilShift + grain * 0.06;
            vec3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + vec3(0.0, 0.333, 0.667)));
            float sweep = dot(uv - 0.5, vec2(0.8, 0.6)) + dot(tilt, vec2(0.45, 0.3)) * uFoilShift;
            float glint = pow(clamp(1.0 - abs(sweep) * 2.5, 0.0, 1.0), 4.0);
            float luma = dot(baseColor.rgb, vec3(0.299, 0.587, 0.114));
            vec3 foil = rainbow * (0.3 + 0.7 * luma) * (0.35 + 0.65 * glint) + glint * 0.25;
            return foil * uFoil * area;
        }

        // Ports of the CardFoilMetal / CardFoilAlbedo nodes: the foil is a metal film, so the lights' highlights
        // and reflections come back in its rainbow instead of white
        float foilMetal(vec4 foilMask, float border, vec4 pattern, vec2 uv, vec3 viewTS) {
            float m = foilMask.r * foilMask.a * (1.0 - border) * clamp(uFoil * 1.5, 0.0, 1.0);
            vec3 v = normalize(viewTS);
            vec2 tilt = v.xy / max(v.z, 0.25);
            float sweep = dot(uv - 0.5, vec2(0.8, 0.6)) + dot(tilt, vec2(0.45, 0.3)) * uFoilShift;
            float glint = pow(clamp(1.0 - abs(sweep) * 2.5, 0.0, 1.0), 4.0);
            float lum = dot(pattern.rgb, vec3(0.299, 0.587, 0.114)) + pattern.a;
            return m * (patterned() ? clamp(lum * 2.5, 0.0, 1.0) : 0.25 + 0.75 * glint);
        }
        vec3 foilAlbedo(vec3 albedo, float metal, vec2 uv, vec3 viewTS, vec4 pattern) {
            vec3 v = normalize(viewTS);
            if (patterned())
                return mix(albedo, clamp(0.35 + pattern.rgb * 0.6 + albedo * 0.3, 0.0, 1.0), metal);
            vec2 tilt = v.xy / max(v.z, 0.25);
            float grain = sin(dot(uv, vec2(173.1, 61.7))) * sin(dot(uv, vec2(-47.3, 211.9)));
            float phase = dot(uv, vec2(0.6, 1.0)) * uFoilScale + dot(tilt, vec2(0.8, 0.5)) * uFoilShift + grain * 0.06;
            vec3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (phase + vec3(0.0, 0.333, 0.667)));
            return mix(albedo, clamp(rainbow * 0.85 + albedo * 0.35, 0.0, 1.0), metal);
        }

        // Stand-in for the game's lighting: soft key light from the upper right, fill, ambient
        // (times the albedo). metal: metals have no diffuse light, their highlights and reflections are in their colour
        const float PI = 3.14159265;
        const vec3 KEY = normalize(vec3(0.5, 0.65, 0.7)), FILL = normalize(vec3(-0.75, 0.05, 0.5));
        vec3 light(vec3 n, vec3 v, float smoothness, float metal) {
            float diffuse = 0.35 + 0.75 * max(dot(n, KEY), 0.0) + 0.25 * max(dot(n, FILL), 0.0);
            return vec3(diffuse * (1.0 - metal) + 0.35 * metal);
        }
        vec3 light(vec3 n, vec3 v, float smoothness) { return light(n, v, smoothness, 0.0); }

        vec3 env(vec3 r) {
            float y = r.y;
            vec3 top = vec3(0.85, 0.87, 0.9), mid = vec3(0.22, 0.23, 0.26), low = vec3(0.05, 0.05, 0.06);
            vec3 c = y > 0.0 ? mix(mid, top, smoothstep(0.0, 0.9, y)) : mix(mid, low, smoothstep(0.0, 0.7, -y));
            c += vec3(1.2) * pow(max(0.0, 1.0 - abs(y - 0.25) * 5.0), 4.0);
            c += vec3(0.8) * pow(max(0.0, dot(normalize(r), normalize(vec3(-0.7, 0.3, 0.6)))), 24.0);
            return c;
        }
        vec3 ggx(vec3 n, vec3 v, vec3 l, float rough, vec3 f0) {
            vec3 h = normalize(l + v);
            float ndl = max(dot(n, l), 0.0), ndv = max(dot(n, v), 1e-3), ndh = max(dot(n, h), 0.0);
            float a = rough * rough, a2 = a * a;
            float d = ndh * ndh * (a2 - 1.0) + 1.0;
            float D = a2 / (PI * d * d);
            float k = (rough + 1.0) * (rough + 1.0) / 8.0;
            float G = (ndl / (ndl * (1.0 - k) + k)) * (ndv / (ndv * (1.0 - k) + k));
            vec3 F = f0 + (1.0 - f0) * pow(1.0 - max(dot(h, v), 0.0), 5.0);
            return D * G * F / max(4.0 * ndl * ndv, 1e-4) * ndl;
        }
        vec3 gloss(vec3 n, vec3 v, float rough, vec3 f0) {
            vec3 c = ggx(n, v, KEY, rough, f0) * 3.2 + ggx(n, v, FILL, rough, f0) * 1.3;
            float ndv = max(dot(n, v), 0.0);
            vec3 fe = f0 + (max(vec3(1.0 - rough), f0) - f0) * pow(1.0 - ndv, 5.0);
            return c + max(env(reflect(-v, n)) - vec3(0.22, 0.23, 0.26), vec3(0.0)) * fe * mix(0.4, 0.1, rough);
        }
        vec3 lit(vec3 color, vec3 n, vec3 v, float rough, vec3 f0) {
            vec3 c = pow(max(color, vec3(0.0)), vec3(2.2)) + gloss(n, v, rough, f0);
            return pow(c, vec3(1.0 / 2.2));
        }

        vec3 shade(vec4 base, float frame, vec3 nt, float foil, float rough0, float metal0, vec3 n, vec3 T, vec3 B, vec3 v, vec3 viewTS) {
            float glow = mix(uArtGlow, uBorderGlow, frame);
            nt.xy *= uNormalStrength;
            nt = normalize(nt);
            vec3 nLit = normalize(T * nt.x + B * nt.y + n * nt.z);
            vec4 foilMask = vec4(vec3(foil), 1.0);
            vec4 pattern = patterned() && uFoil > 0.0 && foil > 0.0 ? foilPattern(vUV, viewTS, foilKind, nt) : vec4(0.0);
            float shine = foilMetal(foilMask, 0.0, pattern, vUV, viewTS);
            float metal = max(metal0, shine);
            float smoothness = mix(1.0 - rough0, 0.9, shine);
            vec3 albedo = foilAlbedo(base.rgb * (1.0 - glow), shine, vUV, viewTS, pattern);
            vec3 color = albedo * light(nLit, v, smoothness, metal) + base.rgb * glow;
            float rough = clamp(1.0 - smoothness, 0.1, 1.0);
            vec3 f0 = mix(vec3(0.04), pow(max(albedo, vec3(0.0)), vec3(2.2)), metal);
            return lit(color, nLit, v, rough, f0) + cardFoil(vUV, viewTS, foilMask, 0.0, base, glow, pattern);
        }

        void main() {
            fwUV = max(fwidth(vUV.x), 1e-6);
            vec3 n = normalize(vNrm);
            vec3 v = normalize(uEye - vPos);
            if (uPart == 2) { outColor = vec4(lit(EDGE_COLOR * light(n, v, 0.3), n, v, 0.7, vec3(0.04)), 1.0); return; }
            if (uPart == 1) {
                // The back's UVs run mirrored: its tangent points the other way
                vec3 T = normalize(mat3(uModel) * vec3(-1, 0, 0)), B = normalize(mat3(uModel) * vec3(0, 1, 0));
                vec3 viewTS = vec3(dot(v, T), dot(v, B), dot(v, n));
                vec4 foil = texture(uBackFoil, vUV);
                foilKind = foilKindAt(uBackFoil, vUV);
                vec4 surface = texture(uBackSurface, vUV);
                vec3 nt = texture(uBackNormal, vUV).xyz * 2.0 - 1.0;
                outColor = vec4(shade(texture(uBack, vUV), foil.g, nt, foil.r, mix(uRoughness, surface.r, surface.a), surface.g, n, T, B, v, viewTS), 1.0);
                return;
            }
            vec3 T = normalize(mat3(uModel) * vec3(1, 0, 0)), B = normalize(mat3(uModel) * vec3(0, 1, 0));
            vec3 viewTS = vec3(dot(v, T), dot(v, B), dot(v, n));
            vec4 layers = texture(uOverlay, vUV);          // the layer stack, on the glass
            vec4 layerFoil = texture(uLayerFoil, vUV);
            foilKind = foilKindAt(uLayerFoil, vUV);
            vec3 hit = vec3(vUV, 1.0);                     // 2D card: the picture itself (3D cards: set by the parallax)
            vec4 art = uDeep ? parallaxWindow(vUV, viewTS, hit) : texture(uArt, vUV);
            vec4 base = mix(art, layers, layers.a);
            // Ports of the CardNormal / CardLayerFoil nodes: the picture's maps (normal at the hit, flat on the box walls)
            // under the layers' where they cover it
            vec3 np = textureGrad(uNormal, hit.xy, dFdx(vUV), dFdy(vUV)).xyz * 2.0 - 1.0;
            np = mix(vec3(0, 0, 1), np, clamp(hit.z, 0.0, 1.0));
            vec4 surface = texture(uLayerSurface, vUV);
            float cover = max(layers.a, surface.b * surface.a);
            vec3 nt = mix(np, texture(uLayerNormal, vUV).xyz * 2.0 - 1.0, cover);
            vec4 pictureFoil = texture(uFoilMask, vUV);
            float foil = mix(pictureFoil.r * pictureFoil.a, layerFoil.r, cover);
            float pictureRough = uRoughness, pictureMetal = 0.0;
            if (uDeep) {
                float onArt = clamp(hit.z, 0.0, 1.0);
                pictureRough = mix(uPictureRoughnessValue, textureGrad(uPictureRoughness, hit.xy, dFdx(vUV), dFdy(vUV)).r, uHasPictureRoughness * onArt);
                pictureMetal = mix(uPictureMetallicValue, textureGrad(uPictureMetallic, hit.xy, dFdx(vUV), dFdy(vUV)).r, uHasPictureMetallic * onArt);
            }
            float rough = mix(pictureRough, surface.r, surface.a * cover);
            float metal = surface.g * surface.a + pictureMetal * (1.0 - cover);
            outColor = vec4(shade(base, layerFoil.g, nt, foil, rough, metal, n, T, B, v, viewTS), 1.0);
        }`;

    function compile(gl, type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
    }

    function create(canvas) {
        const gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: true });
        if (!gl) throw new Error('WebGL2 is not available');
        const prog = gl.createProgram();
        gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
        gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
        const u = {};
        for (let i = 0; i < gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i++) {
            const name = gl.getActiveUniform(prog, i).name;
            u[name] = gl.getUniformLocation(prog, name);
        }

        const mesh = cardMesh();
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        for (const [name, data, size] of [['aPos', mesh.pos, 3], ['aNrm', mesh.nrm, 3], ['aUV', mesh.uv, 2]]) {
            const loc = gl.getAttribLocation(prog, name);
            gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STATIC_DRAW);

        const units = { art: 0, depth: 1, foilMask: 2, overlay: 3, back: 4, normal: 5, layerFoil: 6, layerNormal: 7, backFoil: 8, backNormal: 9, layerSurface: 10, backSurface: 11, pictureRoughness: 12, pictureMetallic: 13 };
        const white = [255, 255, 255, 255], flat = [128, 128, 255, 255], noFoil = [0, 0, 0, 255];
        const fallback = { art: [0, 0, 0, 0], depth: white, foilMask: noFoil, overlay: [0, 0, 0, 0], back: [40, 42, 48, 255],
            normal: flat, layerFoil: noFoil, layerNormal: flat, backFoil: noFoil, backNormal: flat, layerSurface: [0, 0, 0, 0], backSurface: [0, 0, 0, 0], pictureRoughness: white, pictureMetallic: noFoil };
        const samplers = { art: 'uArt', depth: 'uDepth', foilMask: 'uFoilMask', overlay: 'uOverlay', back: 'uBack',
            normal: 'uNormal', layerFoil: 'uLayerFoil', layerNormal: 'uLayerNormal', backFoil: 'uBackFoil', backNormal: 'uBackNormal',
            layerSurface: 'uLayerSurface', backSurface: 'uBackSurface', pictureRoughness: 'uPictureRoughness', pictureMetallic: 'uPictureMetallic' };
        const textures = {};
        for (const key of Object.keys(units)) {
            const t = gl.createTexture();
            gl.activeTexture(gl.TEXTURE0 + units[key]);
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            textures[key] = t;
        }
        gl.useProgram(prog);
        for (const key of Object.keys(units)) gl.uniform1i(u[samplers[key]], units[key]);

        function upload(key, source) {
            gl.activeTexture(gl.TEXTURE0 + units[key]);
            gl.bindTexture(gl.TEXTURE_2D, textures[key]);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            let ok = false;
            if (source) {
                try {
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
                    gl.generateMipmap(gl.TEXTURE_2D);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                    ok = true;
                } catch {
                }
            }
            if (!ok) {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(fallback[key]));
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            }
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        }
        for (const key of Object.keys(units)) upload(key, null);

        const params = { type: '2d', foil: false, foilType: 0, rarity: [1, 1, 1], material: { ...MATERIAL }, has: {} };
        const view = { yaw: 0, pitch: 0, dist: DIST, sway: true };
        const IDLE_MS = 3000, BLEND_MS = 1000;
        let frame = 0, t0 = performance.now(), idleTimer = 0, blend = null;
        const shown = { yaw: 0, pitch: 0 };

        function resetView() {
            clearTimeout(idleTimer);
            blend = null;
            Object.assign(view, { yaw: 0, pitch: 0, dist: DIST, sway: true });
            t0 = performance.now();
            requestRender();
        }

        function resumeSway() {
            blend = { yaw: view.yaw, pitch: view.pitch, at: performance.now() };
            view.sway = true;
            requestRender();
        }

        const MAX_PX = 2048;
        function fitCanvas() {
            const dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
            let w = Math.max(canvas.clientWidth, r.width) * dpr, h = Math.max(canvas.clientHeight, r.height) * dpr;
            const k = Math.min(1, MAX_PX / Math.max(w, h, 1));
            w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
            if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        }

        const visible = () => canvas.isConnected && !canvas.hidden && canvas.offsetParent !== null;

        function requestRender() {
            if (!frame) frame = requestAnimationFrame(draw);
        }

        function draw(now) {
            frame = 0;
            if (!visible()) return;
            fitCanvas();
            let { yaw, pitch } = view;
            if (view.sway) {
                const t = (now - t0) / 1000;
                yaw = 0.45 * Math.sin(t * 0.7);
                pitch = 0.2 * Math.sin(t * 1.1);
                if (blend) {
                    const k = Math.min(1, Math.max(0, (now - blend.at) / BLEND_MS)), e = k * k * (3 - 2 * k);
                    yaw = blend.yaw + (yaw - blend.yaw) * e;
                    pitch = blend.pitch + (pitch - blend.pitch) * e;
                    if (k >= 1) blend = null;
                }
            }
            shown.yaw = yaw;
            shown.pitch = pitch;
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.DEPTH_TEST);
            gl.useProgram(prog);
            gl.bindVertexArray(vao);
            const model = rotation(yaw, pitch);
            const eye = [0, 0, view.dist];
            const viewMat = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -view.dist, 1]);
            gl.uniformMatrix4fv(u.uModel, false, model);
            gl.uniformMatrix4fv(u.uViewProj, false, mul(perspective(FOV, canvas.width / canvas.height, 0.05, 20), viewMat));
            gl.uniform3fv(u.uEye, eye);
            gl.uniform1i(u.uDeep, params.type === '3d' ? 1 : 0);
            gl.uniform1f(u.uRoughness, roughnessOf(params.type));
            gl.uniform1f(u.uHasPictureRoughness, params.has.pictureRoughness ? 1 : 0);
            gl.uniform1f(u.uHasPictureMetallic, params.has.pictureMetallic ? 1 : 0);
            gl.uniform1f(u.uFoil, params.foil ? params.material.FoilStrength : 0);
            gl.uniform1f(u.uFoilType, params.foilType);
            gl.uniform3fv(u.uRarity, params.rarity);
            const material = params.type === '3d' ? params.material : { ...params.material, ...MATERIAL_2D };
            for (const [key, name] of Object.entries(UNIFORMS)) gl.uniform1f(u[name], material[key]);
            for (const [part, i] of [['front', 0], ['back', 1], ['edge', 2]]) {
                gl.uniform1i(u.uPart, i);
                const [start, count] = mesh.parts[part];
                gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, start * 2);
            }
            if (view.sway) requestRender();
        }

        let drag = null;
        canvas.addEventListener('pointerdown', (e) => {
            clearTimeout(idleTimer);
            if (view.sway) {
                view.yaw = shown.yaw;
                view.pitch = shown.pitch;
                view.sway = false;
                blend = null;
            }
            drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch };
            canvas.setPointerCapture(e.pointerId);
            canvas.classList.add('is-dragging');
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!drag) return;
            view.yaw = drag.yaw + (e.clientX - drag.x) * 0.01;
            view.pitch = Math.max(-1.4, Math.min(1.4, drag.pitch + (e.clientY - drag.y) * 0.01));
            requestRender();
        });
        const end = () => {
            if (!drag) return;
            drag = null;
            canvas.classList.remove('is-dragging');
            clearTimeout(idleTimer);
            idleTimer = setTimeout(resumeSway, IDLE_MS);
        };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            view.dist = Math.max(1.0, Math.min(5, view.dist * Math.exp(e.deltaY * 0.0015)));
            requestRender();
        }, { passive: false });
        canvas.addEventListener('dblclick', resetView);
        new ResizeObserver(requestRender).observe(canvas);

        return {
            set(s) {
                for (const key of Object.keys(units)) upload(key, s[key] || null);
                params.has = { pictureRoughness: !!s.pictureRoughness, pictureMetallic: !!s.pictureMetallic };
                params.type = s.type === '3d' ? '3d' : '2d';
                params.foil = !!s.foil;
                params.foilType = Math.max(0, FOIL_TYPE_IDS.indexOf(s.foilType));
                const m = /^#?([0-9a-f]{6})$/i.exec(s.rarityColor || '');
                const n = m ? parseInt(m[1], 16) : 0xffffff;
                params.rarity = [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
                requestRender();
            },
            update(s) {
                for (const key of Object.keys(s)) if (key in units) upload(key, s[key] || null);
                for (const key of ['pictureRoughness', 'pictureMetallic']) if (key in s) params.has[key] = !!s[key];
                requestRender();
            },
            setMaterial(values) {
                params.material = { ...MATERIAL };
                for (const key of Object.keys(MATERIAL))
                    if (Number.isFinite(values?.[key])) params.material[key] = values[key];
                requestRender();
            },
            resize: requestRender,
            resetView,
        };
    }

    const FOIL_TYPE_IDS = ['foil', 'linear', 'radial', 'sparkle', 'galaxy', 'diamond', 'squares', 'circles', 'surge', 'ripple', 'speckle', 'crackle'];
    const roughnessOf = (type) => (type === '3d' ? 1 : 0.3);

    window.CardView = {
        available: () => !!document.createElement('canvas').getContext('webgl2'),
        create,
        MATERIAL,
        roughnessOf,
    };
})();
