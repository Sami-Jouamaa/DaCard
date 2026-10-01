(() => {
    'use strict';

    const FOV = 30 * Math.PI / 180;

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

    function stickerUV(u, v, p, cover) {
        let x = (u - p.x) * cover.width, y = (v - (1 - p.y)) * cover.height;
        const a = p.rotation * Math.PI / 180, s = Math.sin(a), c = Math.cos(a);
        [x, y] = [c * x - s * y, s * x + c * y];
        return [x / Math.max(p.width * cover.width, 1e-5) + 0.5, y / Math.max(p.height * cover.height, 1e-5) + 0.5];
    }

    const LIGHTING = `
        uniform vec3 uEye, uKey, uFill;
        vec3 shade(vec3 albedo, vec3 n, vec3 p, float gloss, float power) {
            vec3 v = normalize(uEye - p);
            if (dot(n, v) < 0.0) n = -n;
            float d = max(dot(n, uKey), 0.0) * 0.85 + max(dot(n, uFill), 0.0) * 0.35 + 0.3;
            float s = pow(max(dot(n, normalize(uKey + v)), 0.0), power) * gloss;
            return albedo * d + s;
        }
        vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
        vec3 toScreen(vec3 c) { return pow(c, vec3(1.0 / 2.2)); }`;

    const BINDER_VS = `#version 300 es
        in vec3 aPos; in vec3 aNormal; in vec2 aUv;
        uniform mat4 uViewProj;
        out vec3 vPos; out vec3 vNormal; out vec2 vUv;
        void main() { vPos = aPos; vNormal = aNormal; vUv = aUv; gl_Position = uViewProj * vec4(aPos, 1.0); }`;
    const BINDER_FS = `#version 300 es
        precision highp float;
        in vec3 vPos; in vec3 vNormal; in vec2 vUv;
        uniform sampler2D uTex;
        out vec4 outColor;
        const float ROUGHNESS = 0.7;
        ${LIGHTING}
        void main() {
            vec3 albedo = toLinear(texture(uTex, vUv).rgb);
            float a = ROUGHNESS * ROUGHNESS;
            float power = 2.0 / (a * a) - 2.0;
            float gloss = 0.04 * (power + 2.0) / 8.0;
            outColor = vec4(toScreen(shade(albedo, normalize(vNormal), vPos, gloss, power)), 1.0);
        }`;
    const STICKER_VS = `#version 300 es
        in vec3 aPos; in vec3 aNormal; in vec2 aCover;
        uniform mat4 uViewProj;
        out vec3 vPos; out vec3 vNormal; out vec2 vCover;
        void main() { vPos = aPos; vNormal = aNormal; vCover = aCover; gl_Position = uViewProj * vec4(aPos, 1.0); }`;
    const STICKER_FS = `#version 300 es
        precision highp float;
        in vec3 vPos; in vec3 vNormal; in vec2 vCover;
        uniform sampler2D uTex;
        uniform vec2 uCenter, uSize, uCoverSize;
        uniform float uAngle, uLine, uOutline;
        out vec4 outColor;
        ${LIGHTING}
        void main() {
            vec2 p = (vCover - uCenter) * uCoverSize;
            float a = radians(uAngle), s = sin(a), c = cos(a);
            p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
            vec2 size = max(uSize * uCoverSize, vec2(1e-5));
            vec2 st = p / size + 0.5;
            bool inside = all(greaterThanEqual(st, vec2(0.0))) && all(lessThanEqual(st, vec2(1.0)));
            if (!inside) discard;
            if (uOutline > 0.5) {
                // The selected sticker's frame
                float edge = min(min(st.x, 1.0 - st.x) * size.x, min(st.y, 1.0 - st.y) * size.y);
                if (edge > uLine) discard;
                outColor = vec4(0.3, 0.6, 1.0, 1.0);
                return;
            }
            vec4 col = texture(uTex, st);
            if (col.a < 0.5) discard;
            outColor = vec4(toScreen(shade(toLinear(col.rgb), normalize(vNormal), vPos, 0.25, 48.0)), 1.0);
        }`;

    function program(gl, vs, fs) {
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

    function buffer(gl, prog, name, data, size) {
        const loc = gl.getAttribLocation(prog.p, name);
        if (loc < 0) return;
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }

    function texture(gl, image) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
        if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
        return t;
    }

    function create(canvas, host) {
        const model = window.CC_BINDER_MODEL;
        const gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
        if (!model || !gl) return null;

        const cover = model.cover;
        const n = norm(cover.normal), right = norm(cover.right), up = norm(cover.up);
        const coverPoint = (u, v, lift) => add(add(add(cover.center, scale(n, lift)), scale(right, (u - 0.5) * cover.width)), scale(up, (v - 0.5) * cover.height));

        const binder = program(gl, BINDER_VS, BINDER_FS);
        const binderVao = gl.createVertexArray();
        gl.bindVertexArray(binderVao);
        buffer(gl, binder, 'aPos', base64(model.positions, Float32Array), 3);
        buffer(gl, binder, 'aNormal', base64(model.normals, Float32Array), 3);
        buffer(gl, binder, 'aUv', base64(model.uvs, Float32Array), 2);
        const indices = base64(model.indices, Uint32Array);
        const ib = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
        let binderTex = null;
        const texImage = new Image();
        texImage.onload = () => { binderTex = texture(gl, texImage); requestRender(); };
        texImage.src = model.texture;

        const sticker = program(gl, STICKER_VS, STICKER_FS);
        let shell = model.shell && {
            positions: base64(model.shell.positions, Float32Array),
            normals: base64(model.shell.normals, Float32Array),
            uvs: base64(model.shell.uvs, Float32Array),
            indices: base64(model.shell.indices, Uint32Array),
        };
        if (!shell) {
            const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
            shell = {
                positions: new Float32Array(corners.flatMap(([u, v]) => coverPoint(u, v, cover.lift))),
                normals: new Float32Array(corners.flatMap(() => n)),
                uvs: new Float32Array(corners.flat()),
                indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
            };
        }
        const band = model.band || { xMin: 0, xMax: 1 };
        const shellVao = gl.createVertexArray();
        gl.bindVertexArray(shellVao);
        buffer(gl, sticker, 'aPos', shell.positions, 3);
        buffer(gl, sticker, 'aNormal', shell.normals, 3);
        buffer(gl, sticker, 'aCover', shell.uvs, 2);
        const shellIb = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, shellIb);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, shell.indices, gl.STATIC_DRAW);
        const stickerTextures = new WeakMap();
        const alphaMaps = new WeakMap();

        const size = model.bounds.size, target = model.bounds.center;
        const fitDistance = Math.max(size[0], size[1], size[2]) / (2 * Math.tan(FOV / 2)) * 1.3;
        const frontYaw = Math.atan2(n[0], n[2]);
        const cam = {};
        function resetView() {
            Object.assign(cam, { yaw: frontYaw - 0.38, pitch: 0.16, dist: fitDistance });
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
            fitCanvas();
            const b = eyeBasis();
            const aspect = canvas.width / canvas.height;
            const viewProj = mul(perspective(FOV, aspect, cam.dist * 0.02, cam.dist * 10), lookAt(b.eye, target, [0, 1, 0]));
            const key = norm(add(add(scale(b.right, 0.45), scale(b.up, 0.6)), scale(b.back, 0.75)));
            const fill = norm(add(add(scale(b.right, -0.7), scale(b.up, 0.1)), scale(b.back, 0.5)));

            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL);

            if (binderTex) {
                gl.useProgram(binder.p);
                gl.uniformMatrix4fv(binder.u.uViewProj, false, viewProj);
                gl.uniform3fv(binder.u.uEye, b.eye); gl.uniform3fv(binder.u.uKey, key); gl.uniform3fv(binder.u.uFill, fill);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, binderTex);
                gl.uniform1i(binder.u.uTex, 0);
                gl.bindVertexArray(binderVao);
                gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);
            }

            const { list, selected } = host.stickers();
            gl.useProgram(sticker.p);
            gl.uniformMatrix4fv(sticker.u.uViewProj, false, viewProj);
            gl.uniform3fv(sticker.u.uEye, b.eye); gl.uniform3fv(sticker.u.uKey, key); gl.uniform3fv(sticker.u.uFill, fill);
            gl.uniform2f(sticker.u.uCoverSize, cover.width, cover.height);
            gl.uniform1f(sticker.u.uLine, cover.height * 0.005);
            gl.uniform1i(sticker.u.uTex, 0);
            gl.enable(gl.POLYGON_OFFSET_FILL);
            const drawSticker = (s, i, outline, offsetUnits) => {
                const p = s.placement;
                gl.polygonOffset(-1, offsetUnits ?? -1 - 4 * i);
                gl.uniform2f(sticker.u.uCenter, p.x, 1 - p.y);
                gl.uniform2f(sticker.u.uSize, p.width, p.height);
                gl.uniform1f(sticker.u.uAngle, p.rotation);
                gl.uniform1f(sticker.u.uOutline, outline ? 1 : 0);
                gl.bindVertexArray(shellVao);
                gl.drawElements(gl.TRIANGLES, shell.indices.length, gl.UNSIGNED_INT, 0);
            };
            list.forEach((s, i) => {
                if (!s.img || !s.img.complete || !s.img.naturalWidth) return;
                let t = stickerTextures.get(s.img);
                if (!t) { t = texture(gl, s.img); stickerTextures.set(s.img, t); }
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, t);
                drawSticker(s, i, false);
            });
            if (list[selected]) drawSticker(list[selected], selected, true, -1 - 4 * list.length - 8);
            gl.disable(gl.POLYGON_OFFSET_FILL);
        }

        function shellHit(e) {
            const r = canvas.getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * 2 - 1, y = 1 - ((e.clientY - r.top) / r.height) * 2;
            const b = eyeBasis(), t = Math.tan(FOV / 2), aspect = r.width / r.height;
            const dir = norm(add(add(scale(b.back, -1), scale(b.right, x * t * aspect)), scale(b.up, y * t)));
            const P = shell.positions, UV = shell.uvs, I = shell.indices;
            let best = Infinity, hit = null;
            for (let k = 0; k < I.length; k += 3) {
                const a = I[k] * 3, bb = I[k + 1] * 3, c = I[k + 2] * 3;
                const e1 = [P[bb] - P[a], P[bb + 1] - P[a + 1], P[bb + 2] - P[a + 2]];
                const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
                const pv = cross(dir, e2), det = dot(e1, pv);
                if (Math.abs(det) < 1e-12) continue;
                const tv = [b.eye[0] - P[a], b.eye[1] - P[a + 1], b.eye[2] - P[a + 2]];
                const u = dot(tv, pv) / det;
                if (u < 0 || u > 1) continue;
                const qv = cross(tv, e1), v = dot(dir, qv) / det;
                if (v < 0 || u + v > 1) continue;
                const dist = dot(e2, qv) / det;
                if (dist <= 0 || dist >= best) continue;
                best = dist;
                const w = 1 - u - v, ia = I[k] * 2, ib = I[k + 1] * 2, ic = I[k + 2] * 2;
                hit = { u: w * UV[ia] + u * UV[ib] + v * UV[ic], v: w * UV[ia + 1] + u * UV[ib + 1] + v * UV[ic + 1] };
            }
            return hit;
        }

        function alphaAt(img, st) {
            let map = alphaMaps.get(img);
            if (!map) {
                const k = Math.min(1, 160 / Math.max(img.naturalWidth, img.naturalHeight));
                const c = document.createElement('canvas');
                c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
                const g = c.getContext('2d', { willReadFrequently: true });
                g.drawImage(img, 0, 0, c.width, c.height);
                try { map = { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data }; } catch { map = { w: 1, h: 1, data: [0, 0, 0, 255] }; }
                alphaMaps.set(img, map);
            }
            const x = Math.min(map.w - 1, Math.floor(st[0] * map.w)), y = Math.min(map.h - 1, Math.floor((1 - st[1]) * map.h));
            return map.data[(y * map.w + x) * 4 + 3] / 255;
        }

        function pick(hit) {
            if (!hit) return -1;
            const { list, selected } = host.stickers();
            for (let i = list.length - 1; i >= 0; i--) {
                const s = list[i];
                if (!s.img) continue;
                const st = stickerUV(hit.u, hit.v, s.placement, cover);
                if (st[0] < 0 || st[0] > 1 || st[1] < 0 || st[1] > 1) continue;
                if (i === selected || alphaAt(s.img, st) >= 0.5) return i;
            }
            return -1;
        }

        let action = null;
        canvas.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            const hit = shellHit(e);
            const index = pick(hit);
            if (index >= 0) {
                host.select(index);
                const p = host.stickers().list[index].placement;
                action = { kind: 'move', index, u0: hit.u, v0: hit.v, x0: p.x, y0: p.y };
                canvas.style.cursor = 'grabbing';
            } else {
                action = { kind: 'orbit', x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch };
            }
            canvas.setPointerCapture(e.pointerId);
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!action) {
                canvas.style.cursor = pick(shellHit(e)) >= 0 ? 'grab' : 'default';
                return;
            }
            if (action.kind === 'orbit') {
                cam.yaw = action.yaw - (e.clientX - action.x) * 0.008;
                cam.pitch = Math.max(-1.45, Math.min(1.45, action.pitch + (e.clientY - action.y) * 0.008));
                requestRender();
                return;
            }
            const hit = shellHit(e);
            if (!hit) return;
            let du = hit.u - action.u0, dv = hit.v - action.v0;
            if (e.shiftKey) { if (Math.abs(du * cover.width) >= Math.abs(dv * cover.height)) dv = 0; else du = 0; }
            const p = host.stickers().list[action.index].placement;
            p.x = Math.min(band.xMax + 0.2, Math.max(band.xMin - 0.2, action.x0 + du));
            p.y = Math.min(1.2, Math.max(-0.2, action.y0 - dv));
            host.changed();
            requestRender();
        });
        const end = () => { action = null; canvas.style.cursor = 'default'; };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        // Scrolling zooms the view (never resizes a sticker: that's the Size slider)
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            cam.dist = Math.max(fitDistance * 0.25, Math.min(fitDistance * 3, cam.dist / Math.exp(-e.deltaY * 0.0012)));
            requestRender();
        }, { passive: false });
        canvas.addEventListener('dblclick', resetView);
        new ResizeObserver(requestRender).observe(canvas);

        resetView();
        return { update: requestRender, resetView };
    }

    window.BinderView = {
        available: () => !!window.CC_BINDER_MODEL && !!document.createElement('canvas').getContext('webgl2'),
        create,
    };
})();
