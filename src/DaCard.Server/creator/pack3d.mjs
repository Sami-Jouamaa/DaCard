(() => {
    'use strict';

    const FOV = 30 * Math.PI / 180;
    const FACE_MIN_FACING = 0.25;

    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

    function perspective(fovy, aspect, near, far) {
        const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
        return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    }
    function lookAt(eye, target, up) {
        const z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
        return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
    }
    function mul(a, b) {
        const o = new Float32Array(16);
        for (let c = 0; c < 4; c++)
            for (let r = 0; r < 4; r++)
                o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        return o;
    }
    function base64(text, Type) {
        const bin = atob(text), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Type(bytes.buffer);
    }

    function tangentMap(f, t) {
        const g = f.map(([x, y]) => [x, -y]), uv = t.map(([u, y]) => [u, 1 - y]);
        const a = g[1][0] - g[0][0], b = g[2][0] - g[0][0], c = g[1][1] - g[0][1], d = g[2][1] - g[0][1];
        const det = a * d - b * c;
        if (Math.abs(det) < 1e-14) return [1, 0, 0, 1];
        const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
        const p = uv[1][0] - uv[0][0], q = uv[2][0] - uv[0][0], r = uv[1][1] - uv[0][1], s = uv[2][1] - uv[0][1];
        const j00 = p * ia + q * ic, j01 = p * ib + q * id, j10 = r * ia + s * ic, j11 = r * ib + s * id;
        const k = Math.sqrt(Math.abs(j00 * j11 - j01 * j10)) || 1;
        return [j00 / k, j10 / k, j01 / k, j11 / k];
    }

    let geometry = null;
    function geo() {
        if (geometry) return geometry;
        const m = window.CC_PACK_MODEL;
        if (!m) return null;
        const P = base64(m.positions, Float32Array), N = base64(m.normals, Float32Array);
        const UV = base64(m.uvs, Float32Array), I = base64(m.indices, Uint32Array);
        const [cx, cy, cz] = m.bounds.center, [sx, sy, sz] = m.bounds.size;
        const fz = (m.front && m.front[2] < 0) ? -1 : 1;

        const tangents = new Float32Array(P.length / 3 * 4);
        const tan = new Float32Array(P.length), bit = new Float32Array(P.length);
        for (let k = 0; k < I.length; k += 3) {
            const [a, b, c] = [I[k], I[k + 1], I[k + 2]];
            const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
            const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
            const du1 = UV[b * 2] - UV[a * 2], dv1 = UV[b * 2 + 1] - UV[a * 2 + 1];
            const du2 = UV[c * 2] - UV[a * 2], dv2 = UV[c * 2 + 1] - UV[a * 2 + 1];
            const det = du1 * dv2 - du2 * dv1;
            if (Math.abs(det) < 1e-12) continue;
            const r = 1 / det;
            const t = [(e1[0] * dv2 - e2[0] * dv1) * r, (e1[1] * dv2 - e2[1] * dv1) * r, (e1[2] * dv2 - e2[2] * dv1) * r];
            const s = [(e2[0] * du1 - e1[0] * du2) * r, (e2[1] * du1 - e1[1] * du2) * r, (e2[2] * du1 - e1[2] * du2) * r];
            for (const v of [a, b, c]) for (let j = 0; j < 3; j++) { tan[v * 3 + j] += t[j]; bit[v * 3 + j] += s[j]; }
        }
        for (let v = 0; v < P.length / 3; v++) {
            const n = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
            let t = [tan[v * 3], tan[v * 3 + 1], tan[v * 3 + 2]];
            t = norm(sub(t, scale(n, dot(n, t))));
            const w = dot(cross(n, t), [bit[v * 3], bit[v * 3 + 1], bit[v * 3 + 2]]) < 0 ? -1 : 1;
            tangents.set([t[0], t[1], t[2], w], v * 4);
        }

        const faces = {};
        for (const [name, dir] of [['front', fz], ['back', -fz]]) {
            const face = (i) => [(dir * (P[i * 3] - cx) + sx / 2) / sx, (cy + sy / 2 - P[i * 3 + 1]) / sy];
            const depth = (i) => 0.5 - dir * (P[i * 3 + 2] - cz) / (sz * 2);
            const tris = [];
            for (let k = 0; k < I.length; k += 3) {
                const idx = [I[k], I[k + 1], I[k + 2]];
                const facing = idx.reduce((s, i) => s + N[i * 3 + 2] * dir, 0) / 3;
                if (facing < FACE_MIN_FACING) continue;
                const f = idx.map(face), t = idx.map((i) => [UV[i * 2], 1 - UV[i * 2 + 1]]);
                tris.push({ f, t, d: idx.map(depth), j: tangentMap(f, t) });
            }
            faces[name] = { tris };
        }
        geometry = { P, N, UV, I, tangents, faces, aspect: sx / sy, bounds: m.bounds, front: [0, 0, fz] };
        return geometry;
    }

    function compile(gl, vs, fs) {
        const make = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
            return s;
        };
        const p = gl.createProgram();
        gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
        gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        const u = {};
        for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
            const name = gl.getActiveUniform(p, i).name;
            u[name] = gl.getUniformLocation(p, name);
        }
        return { p, u };
    }

    function attribute(gl, prog, name, data, size) {
        const loc = gl.getAttribLocation(prog.p, name);
        if (loc < 0) return null;
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        return b;
    }

    function uploadTexture(gl, texture, source, { flipY = false, premultiply = false, mips = true } = {}) {
        if (flipY && typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
            const c = document.createElement('canvas');
            c.width = source.width; c.height = source.height;
            c.getContext('2d').drawImage(source, 0, 0);
            source = c;
        }
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        if (mips) gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
        if (aniso && mips) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    }

    const TO_ATLAS_VS = `#version 300 es
        in vec2 aUv; in vec2 aFace; in vec4 aJ;
        out vec2 vFace; out vec4 vJ;
        void main() { vFace = aFace; vJ = aJ; gl_Position = vec4(aUv.x * 2.0 - 1.0, 1.0 - aUv.y * 2.0, 0.0, 1.0); }`;
    const TO_ATLAS_FS = `#version 300 es
        precision highp float;
        in vec2 vFace; in vec4 vJ;
        uniform sampler2D uFace;
        uniform float uNormal;
        uniform vec2 uRot;
        out vec4 outColor;
        void main() {
            vec4 c = texture(uFace, vFace);
            if (uNormal < 0.5) { outColor = c; return; }
            if (c.a <= 0.001) { outColor = vec4(0.0); return; }
            vec3 n = c.rgb / c.a * 2.0 - 1.0;
            vec2 f = vec2(n.x * uRot.x + n.y * uRot.y, -n.x * uRot.y + n.y * uRot.x);
            vec2 a = mat2(vJ.xy, vJ.zw) * f;
            n = normalize(vec3(a, max(n.z, 0.0)));
            outColor = vec4((n * 0.5 + 0.5) * c.a, c.a);
        }`;
    const TO_FACE_VS = `#version 300 es
        in vec2 aFace; in float aDepth; in vec2 aUv;
        out vec2 vUv;
        void main() { vUv = aUv; gl_Position = vec4(aFace.x * 2.0 - 1.0, 1.0 - aFace.y * 2.0, aDepth * 2.0 - 1.0, 1.0); }`;
    const TO_FACE_FS = `#version 300 es
        precision highp float;
        in vec2 vUv;
        uniform sampler2D uAtlas;
        out vec4 outColor;
        void main() { outColor = texture(uAtlas, vUv); }`;

    function expandTriangle(uv, face, by) {
        const cu = (uv[0][0] + uv[1][0] + uv[2][0]) / 3, cv = (uv[0][1] + uv[1][1] + uv[2][1]) / 3;
        const [a, b, c] = uv;
        const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
        const grown = uv.map(([u, v]) => {
            const l = Math.hypot(u - cu, v - cv) || 1;
            return [u + (u - cu) / l * by, v + (v - cv) / l * by];
        });
        if (Math.abs(det) < 1e-14) return { uv: grown, face };
        const f = (p) => {
            const l1 = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / det;
            const l2 = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / det;
            const l3 = 1 - l1 - l2;
            return [l1 * face[0][0] + l2 * face[1][0] + l3 * face[2][0], l1 * face[0][1] + l2 * face[1][1] + l3 * face[2][1]];
        };
        return { uv: grown, face: grown.map(f) };
    }

    let projectorInstance = null;
    function projector() {
        if (projectorInstance) return projectorInstance;
        const g = geo();
        if (!g) return null;
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true, antialias: false });
        if (!gl) return null;
        const toAtlas = compile(gl, TO_ATLAS_VS, TO_ATLAS_FS);
        const toFace = compile(gl, TO_FACE_VS, TO_FACE_FS);
        const texture = gl.createTexture();
        const atlasVaos = new Map();
        const faceVaos = {};

        function atlasVao(face, size) {
            const key = face + ':' + size;
            if (atlasVaos.has(key)) return atlasVaos.get(key);
            const tris = g.faces[face].tris;
            const build = (by) => {
                const uv = [], fc = [], jj = [];
                for (const t of tris) {
                    const e = by ? expandTriangle(t.t, t.f, by) : { uv: t.t, face: t.f };
                    e.uv.forEach((p) => uv.push(p[0], p[1]));
                    e.face.forEach((p) => fc.push(p[0], p[1]));
                    for (let k = 0; k < 3; k++) jj.push(...t.j);
                }
                const vao = gl.createVertexArray();
                gl.bindVertexArray(vao);
                attribute(gl, toAtlas, 'aUv', new Float32Array(uv), 2);
                attribute(gl, toAtlas, 'aFace', new Float32Array(fc), 2);
                attribute(gl, toAtlas, 'aJ', new Float32Array(jj), 4);
                return { vao, count: uv.length / 2 };
            };
            const entry = { grown: build(2.5 / size), exact: build(0) };
            atlasVaos.set(key, entry);
            return entry;
        }

        function faceVao(face) {
            if (faceVaos[face]) return faceVaos[face];
            const fc = [], d = [], uv = [];
            for (const t of g.faces[face].tris) {
                t.f.forEach((p) => fc.push(p[0], p[1]));
                t.d.forEach((v) => d.push(v));
                t.t.forEach((p) => uv.push(p[0], p[1]));
            }
            const vao = gl.createVertexArray();
            gl.bindVertexArray(vao);
            attribute(gl, toFace, 'aFace', new Float32Array(fc), 2);
            attribute(gl, toFace, 'aDepth', new Float32Array(d), 1);
            attribute(gl, toFace, 'aUv', new Float32Array(uv), 2);
            faceVaos[face] = { vao, count: fc.length / 2 };
            return faceVaos[face];
        }

        function resize(w, h) {
            if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
            gl.viewport(0, 0, w, h);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        }

        function copy() {
            const out = document.createElement('canvas');
            out.width = canvas.width; out.height = canvas.height;
            out.getContext('2d').drawImage(canvas, 0, 0);
            return out;
        }

        return projectorInstance = {
            faceToAtlas(face, faceCanvas, size, normal = null) {
                resize(size, size);
                gl.disable(gl.DEPTH_TEST);
                gl.disable(gl.BLEND);
                gl.useProgram(toAtlas.p);
                gl.activeTexture(gl.TEXTURE0);
                uploadTexture(gl, texture, faceCanvas, { premultiply: true });
                gl.uniform1i(toAtlas.u.uFace, 0);
                const turn = (normal ? normal.rotation : 0) * Math.PI / 180;
                gl.uniform1f(toAtlas.u.uNormal, normal ? 1 : 0);
                gl.uniform2f(toAtlas.u.uRot, Math.cos(turn), Math.sin(turn));
                const v = atlasVao(face, size);
                gl.bindVertexArray(v.grown.vao);
                gl.drawArrays(gl.TRIANGLES, 0, v.grown.count);
                gl.bindVertexArray(v.exact.vao);
                gl.drawArrays(gl.TRIANGLES, 0, v.exact.count);
                return copy();
            },
            atlasToFace(face, atlas, width, height) {
                resize(width, height);
                gl.enable(gl.DEPTH_TEST);
                gl.depthFunc(gl.LESS);
                gl.disable(gl.BLEND);
                gl.useProgram(toFace.p);
                gl.activeTexture(gl.TEXTURE0);
                uploadTexture(gl, texture, atlas, { premultiply: true });
                gl.uniform1i(toFace.u.uAtlas, 0);
                const v = faceVao(face);
                gl.bindVertexArray(v.vao);
                gl.drawArrays(gl.TRIANGLES, 0, v.count);
                return copy();
            },
        };
    }

    const VIEW_VS = `#version 300 es
        in vec3 aPos; in vec3 aNormal; in vec2 aUv; in vec4 aTangent;
        uniform mat4 uViewProj;
        out vec3 vPos; out vec3 vNormal; out vec2 vUv; out vec4 vTangent;
        void main() { vPos = aPos; vNormal = aNormal; vUv = aUv; vTangent = aTangent; gl_Position = uViewProj * vec4(aPos, 1.0); }`;
    const VIEW_FS = `#version 300 es
        precision highp float;
        in vec3 vPos; in vec3 vNormal; in vec2 vUv; in vec4 vTangent;
        uniform sampler2D uAlbedo, uNormal, uMetallic, uRoughness, uAo;
        uniform vec3 uEye, uKey, uFill;
        uniform float uMetalScale, uFillLight;
        out vec4 outColor;
        const float PI = 3.14159265;
        vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
        vec3 env(vec3 r) {
            float y = r.y;
            vec3 top = vec3(0.85, 0.87, 0.9), mid = vec3(0.22, 0.23, 0.26), low = vec3(0.05, 0.05, 0.06);
            vec3 c = y > 0.0 ? mix(mid, top, smoothstep(0.0, 0.9, y)) : mix(mid, low, smoothstep(0.0, 0.7, -y));
            c += vec3(1.2) * pow(max(0.0, 1.0 - abs(y - 0.25) * 5.0), 4.0);
            c += vec3(0.8) * pow(max(0.0, dot(normalize(r), normalize(vec3(-0.7, 0.3, 0.6)))), 24.0);
            return c;
        }
        vec3 light(vec3 n, vec3 v, vec3 l, vec3 albedo, float metal, float rough, vec3 f0) {
            vec3 h = normalize(l + v);
            float ndl = max(dot(n, l), 0.0), ndv = max(dot(n, v), 1e-3), ndh = max(dot(n, h), 0.0);
            float a = rough * rough, a2 = a * a;
            float d = ndh * ndh * (a2 - 1.0) + 1.0;
            float D = a2 / (PI * d * d);
            float k = (rough + 1.0) * (rough + 1.0) / 8.0;
            float G = (ndl / (ndl * (1.0 - k) + k)) * (ndv / (ndv * (1.0 - k) + k));
            vec3 F = f0 + (1.0 - f0) * pow(1.0 - max(dot(h, v), 0.0), 5.0);
            vec3 spec = D * G * F / max(4.0 * ndl * ndv, 1e-4);
            vec3 kd = (1.0 - F) * (1.0 - metal);
            return (kd * albedo / PI + spec) * ndl;
        }
        void main() {
            vec3 albedo = toLinear(texture(uAlbedo, vUv).rgb);
            vec3 nt = texture(uNormal, vUv).xyz * 2.0 - 1.0;
            vec3 N = normalize(vNormal);
            vec3 T = normalize(vTangent.xyz - N * dot(N, vTangent.xyz));
            vec3 B = cross(N, T) * vTangent.w;
            vec3 n = normalize(T * nt.x + B * nt.y + N * max(nt.z, 0.05));
            vec3 v = normalize(uEye - vPos);
            if (dot(N, v) < 0.0) { n = reflect(n, N); }
            float metal = clamp(texture(uMetallic, vUv).r * uMetalScale, 0.0, 1.0);
            float rough = clamp(texture(uRoughness, vUv).r, 0.05, 1.0);
            float ao = texture(uAo, vUv).r;
            vec3 f0 = mix(vec3(0.04), albedo, metal);
            vec3 c = light(n, v, uKey, albedo, metal, rough, f0) * 3.2 + light(n, v, uFill, albedo, metal, rough, f0) * 1.3;
            vec3 r = reflect(-v, n);
            float ndv = max(dot(n, v), 0.0);
            vec3 fe = f0 + (max(vec3(1.0 - rough), f0) - f0) * pow(1.0 - ndv, 5.0);
            c += (albedo * (1.0 - metal) * 0.28 + env(r) * fe * mix(1.0, 0.25, rough)) * ao;
            c += albedo * ao * uFillLight;
            c = c / (1.0 + c * 0.35);
            outColor = vec4(pow(c * 1.25, vec3(1.0 / 2.2)), 1.0);
        }`;

    function view(canvas) {
        const g = geo();
        const gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
        const m = window.CC_PACK_MODEL;
        if (!g || !gl) return null;

        const prog = compile(gl, VIEW_VS, VIEW_FS);
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        attribute(gl, prog, 'aPos', g.P, 3);
        attribute(gl, prog, 'aNormal', g.N, 3);
        attribute(gl, prog, 'aUv', g.UV, 2);
        attribute(gl, prog, 'aTangent', g.tangents, 4);
        const ib = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.I, gl.STATIC_DRAW);

        const NAMES = ['albedo', 'normal', 'metallic', 'roughness', 'ao'];
        const UNIFORM = { albedo: 'uAlbedo', normal: 'uNormal', metallic: 'uMetallic', roughness: 'uRoughness', ao: 'uAo' };
        const textures = {}, template = {}, own = {};
        let ready = 0;
        for (const name of NAMES) {
            textures[name] = gl.createTexture();
            const img = new Image();
            img.onload = () => {
                template[name] = img;
                if (!own[name]) uploadTexture(gl, textures[name], img, { flipY: true });
                ready++;
                requestRender();
            };
            img.src = (m.previews || {})[name] || '';
        }

        const size = g.bounds.size, target = g.bounds.center;
        const fitDistance = Math.max(size[0], size[1], size[2]) / (2 * Math.tan(FOV / 2)) * 1.25;
        const frontYaw = Math.atan2(g.front[0], g.front[2]);
        const cam = {};
        let metalScale = 0.85, fillLight = 0.18;

        function resetView() {
            Object.assign(cam, { yaw: frontYaw - 0.42, pitch: 0.12, dist: fitDistance });
            requestRender();
        }
        function eyeBasis() {
            const cp = Math.cos(cam.pitch);
            const dir = [cp * Math.sin(cam.yaw), Math.sin(cam.pitch), cp * Math.cos(cam.yaw)];
            const eye = add(target, scale(dir, cam.dist));
            const back = norm(dir), r = norm(cross([0, 1, 0], back)), u = cross(back, r);
            return { eye, back, right: r, up: u };
        }

        let pending = false;
        function requestRender() {
            if (pending) return;
            pending = true;
            requestAnimationFrame(() => { pending = false; draw(); });
        }
        function fitCanvas() {
            const dpr = window.devicePixelRatio || 1;
            const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
            if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        }
        function draw() {
            if (canvas.hidden || ready < NAMES.length) return;
            fitCanvas();
            const b = eyeBasis();
            const viewProj = mul(perspective(FOV, canvas.width / canvas.height, cam.dist * 0.02, cam.dist * 10), lookAt(b.eye, target, [0, 1, 0]));
            const key = norm(add(add(scale(b.right, 0.5), scale(b.up, 0.65)), scale(b.back, 0.7)));
            const fill = norm(add(add(scale(b.right, -0.75), scale(b.up, 0.05)), scale(b.back, 0.5)));
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.DEPTH_TEST);
            gl.useProgram(prog.p);
            gl.uniformMatrix4fv(prog.u.uViewProj, false, viewProj);
            gl.uniform3fv(prog.u.uEye, b.eye);
            gl.uniform3fv(prog.u.uKey, key);
            gl.uniform3fv(prog.u.uFill, fill);
            gl.uniform1f(prog.u.uMetalScale, metalScale);
            gl.uniform1f(prog.u.uFillLight, fillLight);
            NAMES.forEach((name, i) => {
                gl.activeTexture(gl.TEXTURE0 + i);
                gl.bindTexture(gl.TEXTURE_2D, textures[name]);
                gl.uniform1i(prog.u[UNIFORM[name]], i);
            });
            gl.bindVertexArray(vao);
            gl.drawElements(gl.TRIANGLES, g.I.length, gl.UNSIGNED_INT, 0);
        }

        let action = null;
        canvas.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            action = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch };
            canvas.setPointerCapture(e.pointerId);
            canvas.classList.add('is-dragging');
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!action) return;
            cam.yaw = action.yaw - (e.clientX - action.x) * 0.008;
            cam.pitch = Math.max(-1.45, Math.min(1.45, action.pitch + (e.clientY - action.y) * 0.008));
            requestRender();
        });
        const end = () => { action = null; canvas.classList.remove('is-dragging'); };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            cam.dist = Math.max(fitDistance * 0.3, Math.min(fitDistance * 3, cam.dist / Math.exp(-e.deltaY * 0.0012)));
            requestRender();
        }, { passive: false });
        canvas.addEventListener('dblclick', resetView);
        new ResizeObserver(requestRender).observe(canvas);
        resetView();

        return {
            setTexture(name, source) {
                if (!textures[name]) return;
                own[name] = source || null;
                const use = source || template[name];
                if (use) uploadTexture(gl, textures[name], use, { flipY: true });
                requestRender();
            },
            setMaterial({ metallic, fill } = {}) {
                if (metallic != null) metalScale = metallic;
                if (fill != null) fillLight = fill;
                requestRender();
            },
            update: requestRender,
            resetView,
        };
    }

    window.PackGL = {
        available: () => !!window.CC_PACK_MODEL && !!document.createElement('canvas').getContext('webgl2'),
        geo,
        projector,
        view,
    };
})();
