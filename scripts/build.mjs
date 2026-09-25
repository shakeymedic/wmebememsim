// =================================================================================================
// PRODUCTION BUILD  (npm run build  ->  dist/)
//
// The source still runs as-is in a browser (CDN React, in-browser Babel, the Tailwind play CDN), so
// editing a file and opening index.html keeps working with no tooling. Netlify runs this script on
// every deploy and serves dist/, which differs from the source in exactly these ways:
//
//   1. Every <script type="text/babel"> (the data/ files and the inline App script) is compiled
//      AHEAD OF TIME with the same library and the same options the browser used
//      (@babel/standalone, presets react + env, the same three plugins), so behaviour is
//      unchanged. Visitors no longer download ~3 MB of Babel and compile ~1 MB of JSX on load.
//   2. React, ReactDOM and the Firebase SDK are served from dist/vendor/ instead of unpkg/gstatic.
//   3. Tailwind is a generated stylesheet (dist/assets/app.css) instead of the runtime play CDN.
//   4. The defib service worker caches those local files instead of the CDN URLs.
//
// The build FAILS (and Netlify keeps the previous deploy) if any CDN reference or text/babel
// script survives, so a half-converted page can never ship.
// =================================================================================================
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
const Babel = require(path.join(ROOT, 'node_modules', '@babel', 'standalone'));

const EXCLUDE = new Set(['node_modules', 'dist', '.git', 'scripts', 'package.json', 'package-lock.json',
    'netlify.toml', 'tailwind.config.js', '.gitignore', 'README.md']);

const log = (...a) => console.log('[build]', ...a);
const fail = (msg) => { console.error('[build] FAILED: ' + msg); process.exit(1); };

// ---- 1. copy the site ------------------------------------------------------------------------
fs.rmSync(OUT, { recursive: true, force: true });
const copyTree = (src, dst) => {
    for (const name of fs.readdirSync(src)) {
        if (src === ROOT && EXCLUDE.has(name)) continue;
        const s = path.join(src, name), d = path.join(dst, name);
        if (fs.statSync(s).isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyTree(s, d); }
        else { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); }
    }
};
copyTree(ROOT, OUT);

// ---- 2. compile exactly as the browser did ---------------------------------------------------
// Mirrors @babel/standalone's buildBabelOptions() for a classic <script type="text/babel">.
const compile = (code, filename) => Babel.transform(code, {
    filename,
    presets: ['react', 'env'],
    plugins: ['transform-class-properties', 'transform-object-rest-spread', 'transform-flow-strip-types'],
    sourceMaps: false,
    targets: { browsers: undefined }
}).code;

const indexPath = path.join(OUT, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

const babelSrcRe = /<script type="text\/babel" src="([^"]+)"><\/script>/g;
let m, compiled = 0;
while ((m = babelSrcRe.exec(html)) !== null) {
    const rel = m[1];
    const file = path.join(OUT, rel);
    if (!fs.existsSync(file)) fail(`index.html references ${rel}, which does not exist`);
    fs.writeFileSync(file, compile(fs.readFileSync(file, 'utf8'), rel));
    compiled++;
}
html = html.replace(babelSrcRe, '<script src="$1"></script>');
html = html.replace(/<script type="text\/babel">([\s\S]*?)<\/script>/g, (all, code) => {
    compiled++;
    return '<script>\n' + compile(code, 'index.html (inline)') + '\n</script>';
});
log(`compiled ${compiled} script(s)`);

// ---- 3. self-host the libraries --------------------------------------------------------------
const NM = path.join(ROOT, 'node_modules');
const vendor = (from, toRel) => {
    // Direct paths: these packages' `exports` maps do not expose their UMD/compat files.
    const src = path.join(NM, from);
    if (!fs.existsSync(src)) fail(`missing ${from} (did npm install run?)`);
    const dst = path.join(OUT, toRel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return toRel;
};
const V = {
    react: vendor('react/umd/react.production.min.js', 'vendor/react.production.min.js'),
    reactDom: vendor('react-dom/umd/react-dom.production.min.js', 'vendor/react-dom.production.min.js'),
    fbApp: vendor('firebase/firebase-app.js', 'vendor/firebase/firebase-app.js'),
    fbDb: vendor('firebase/firebase-database.js', 'vendor/firebase/firebase-database.js'),
    fbAuth: vendor('firebase/firebase-auth.js', 'vendor/firebase/firebase-auth.js')
};
const FB = 'https://www.gstatic.com/firebasejs/8.10.1/';
const localise = (text, prefix) => text
    .split('https://unpkg.com/react@18/umd/react.production.min.js').join(prefix + V.react)
    .split('https://unpkg.com/react-dom@18/umd/react-dom.production.min.js').join(prefix + V.reactDom)
    .split(FB + 'firebase-app.js').join(prefix + V.fbApp)
    .split(FB + 'firebase-database.js').join(prefix + V.fbDb)
    .split(FB + 'firebase-auth.js').join(prefix + V.fbAuth);

// In-browser Babel is no longer needed at all.
html = html.replace(/[ \t]*<script src="https:\/\/unpkg\.com\/@babel\/standalone\/babel\.min\.js"><\/script>\n?/, '');
// The Tailwind play CDN and its inline config become one generated stylesheet.
html = html.replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>\s*<script>\s*tailwind\.config[\s\S]*?<\/script>/,
    '<link rel="stylesheet" href="assets/app.css">');
html = localise(html, '');
// crossorigin was for the CDN; it is meaningless (and can block caching quirks) for same-origin.
html = html.replace(/<script crossorigin src="vendor\//g, '<script src="vendor/');
fs.writeFileSync(indexPath, html);

const defibPath = path.join(OUT, 'defib', 'index.html');
fs.writeFileSync(defibPath, localise(fs.readFileSync(defibPath, 'utf8'), '../'));

// ---- 4. Tailwind -----------------------------------------------------------------------------
const twBin = path.join(NM, 'tailwindcss', 'lib', 'cli.js');
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
execFileSync(process.execPath, [twBin, '-c', path.join(ROOT, 'tailwind.config.js'), '-i', path.join(ROOT, 'scripts', 'tailwind.css'),
    '-o', path.join(OUT, 'assets', 'app.css'), '--minify'], { cwd: ROOT, stdio: 'inherit' });

// ---- 5. the defib service worker caches the local files --------------------------------------
const swPath = path.join(OUT, 'defib', 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
sw = sw.replace(/\s*'https:\/\/cdn\.tailwindcss\.com',[\s\S]*?'https:\/\/unpkg\.com\/lucide@latest'/,
    `\n  '../assets/app.css',\n  '../${V.react}',\n  '../${V.reactDom}',\n  '../${V.fbApp}',\n  '../${V.fbDb}',\n  '../${V.fbAuth}'`);
fs.writeFileSync(swPath, sw);

// ---- 6. refuse to ship a half-converted site -------------------------------------------------
const problems = [];
for (const rel of ['index.html', 'defib/index.html', 'defib/sw.js']) {
    const t = fs.readFileSync(path.join(OUT, rel), 'utf8');
    if (/type="text\/babel"/.test(t)) problems.push(`${rel} still contains text/babel`);
    for (const host of ['unpkg.com', 'cdn.tailwindcss.com', 'gstatic.com/firebasejs']) if (t.includes(host)) problems.push(`${rel} still references ${host}`);
}
if (!fs.existsSync(path.join(OUT, 'assets', 'app.css')) || fs.statSync(path.join(OUT, 'assets', 'app.css')).size < 5000) problems.push('assets/app.css missing or implausibly small');
if (problems.length) fail(problems.join('; '));
log('done ->', path.relative(ROOT, OUT));
