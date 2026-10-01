import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import yazl from 'yazl';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const option = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};
const modDir = path.resolve(option('--mod') || path.join(repo, 'artifacts', 'dashboard-build'));
const out = path.join(modDir, 'dashboard');

function copyTree(from, to, skip = () => false) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const src = path.join(from, entry.name);
        const dst = path.join(to, entry.name);
        if (skip(src, entry)) continue;
        if (entry.isDirectory()) copyTree(src, dst, skip);
        else if (!fs.existsSync(dst) || fs.statSync(dst).mtimeMs < fs.statSync(src).mtimeMs || fs.statSync(dst).size !== fs.statSync(src).size) fs.copyFileSync(src, dst);
    }
}

function writeIfChanged(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text);
}

async function zipFolder(folder, prefix, target) {
    const zip = new yazl.ZipFile();
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.name === '__pycache__') continue;
            if (entry.isDirectory()) walk(full);
            else zip.addFile(full, `${prefix}/${path.relative(folder, full).split(path.sep).join('/')}`);
        }
    };
    walk(folder);
    zip.end();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await new Promise((resolve, reject) => zip.outputStream.pipe(fs.createWriteStream(target)).on('close', resolve).on('error', reject));
}

for (const entry of ['main', 'cli']) {
    await build({
        entryPoints: [path.join(here, 'server', `${entry}.mjs`)],
        outfile: path.join(out, 'server', `${entry}.mjs`),
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node22',
        banner: { js: "import { createRequire as __dacardRequire } from 'node:module'; const require = __dacardRequire(import.meta.url);" },
        logLevel: 'warning',
    });
}
for (const file of fs.readdirSync(path.join(out, 'server')))
    if (!['main.mjs', 'cli.mjs'].includes(file)) fs.rmSync(path.join(out, 'server', file), { force: true });

copyTree(path.join(here, 'web'), path.join(out, 'web'), (src) => path.basename(src) === 'card-font.css' && path.dirname(src).endsWith('creator'));

const font = path.join(repo, 'unity', 'Assets', 'DaCard', 'Fonts', 'Bw Modelica ExtraBold.ttf');
if (fs.existsSync(font)) {
    const css = `@font-face {\n    font-family: 'Bw Modelica ExtraBold';\n    src: url(data:font/ttf;base64,${fs.readFileSync(font).toString('base64')}) format('truetype');\n}\n`;
    writeIfChanged(path.join(out, 'web', 'creator', 'card-font.css'), css);
} else {
    console.warn(`${font} is missing: the dashboard previews card text in a fallback font.`);
}

const nodes = path.join(repo, 'comfyui', 'DaCardCrop');
if (fs.existsSync(nodes)) await zipFolder(nodes, 'DaCardCrop', path.join(out, 'web', 'creator', 'downloads', 'DaCardCrop.zip'));
const workflow = path.join(repo, 'comfyui', 'workflows', 'CardGen.json');
if (fs.existsSync(workflow)) {
    fs.mkdirSync(path.join(out, 'web', 'creator', 'downloads'), { recursive: true });
    fs.copyFileSync(workflow, path.join(out, 'web', 'creator', 'downloads', 'CardGen.json'));
}

const settings = path.join(out, 'settings.json');
if (!fs.existsSync(settings)) writeIfChanged(settings, JSON.stringify({ port: 6967 }, null, 2) + '\n');
fs.copyFileSync(path.join(here, 'DaCard Dashboard.bat'), path.join(modDir, 'DaCard Dashboard.bat'));

const stray = [];
const scan = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(full);
        else if (/\.(js|ts)$/i.test(entry.name)) stray.push(full);
    }
};
scan(out);
if (stray.length) {
    console.error(`SPT would refuse the mod because of these .js/.ts files:\n${stray.join('\n')}`);
    process.exit(1);
}
console.log(`Dashboard built into ${out}`);
