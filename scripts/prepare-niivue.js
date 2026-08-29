// Vendor the NiiVue renderer into the backend's static tree.
//
// The nifti_viewer tool renders its UI into a sandboxed srcdoc iframe that vite
// never processes, so the SPA's bundle is out of reach: the viewer can only pull
// JS over HTTP. It is served from STATIC_DIR, which app.mount('/static', ...)
// exposes without authentication -- fine for a BSD-licensed library.
//
// The UMD build is required, not the package default. NiiVue's "exports" map has
// only "import" conditions, and a <script type="module"> is fetched in CORS mode;
// /static sends no Access-Control-Allow-Origin and the iframe has an opaque
// origin, so a module script is blocked. A classic <script src> is not
// CORS-checked, and dist/niivue.umd.js registers globalThis.niivue.
//
// Destination is a SUBDIRECTORY on purpose: config.py unlinks every top-level
// file and symlink in STATIC_DIR at import time and does not recurse, so
// static/nifti/ survives restarts while a top-level file would not.
//
//   npm run niivue:vendor

import { createHash } from 'crypto';
import { mkdir, copyFile, readFile, writeFile } from 'fs/promises';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);

// Resolved by filesystem path, not require.resolve(): NiiVue's "exports" map
// declares only ".", "./drawing", "./utils" and "./min", so the UMD file it
// publishes is not reachable through the package API even though it ships in
// the tarball. If a future release stops shipping it, this throws loudly.
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PKG_DIR = path.join(ROOT, 'node_modules', '@niivue', 'niivue');
const SRC = path.join(PKG_DIR, 'dist', 'niivue.umd.js');
const DEST_DIR = path.join(ROOT, 'backend', 'open_webui', 'static', 'nifti');
const DEST = path.join(DEST_DIR, 'niivue.umd.js');

const { version } = require(path.join(PKG_DIR, 'package.json'));

let bytes;
try {
	bytes = await readFile(SRC);
} catch {
	throw new Error(
		`${SRC} is missing. Run \`npm install\` first; if @niivue/niivue ${version} no ` +
			`longer publishes dist/niivue.umd.js, a UMD bundle must be built from the ESM ` +
			`entry instead (esbuild --format=iife --global-name=niivue).`
	);
}
const sha256 = createHash('sha256').update(bytes).digest('hex');

const head = bytes.subarray(0, 200).toString('utf8');
if (!/typeof exports|typeof define/.test(head)) {
	throw new Error(
		`${SRC} does not look like a UMD bundle. A classic <script src> needs the UMD ` +
			`build; the ESM entry points cannot be loaded from the viewer iframe.`
	);
}

await mkdir(DEST_DIR, { recursive: true });
await copyFile(SRC, DEST);
await writeFile(
	path.join(DEST_DIR, 'VERSION'),
	[
		`@niivue/niivue ${version}`,
		`file:   dist/niivue.umd.js (published UMD build, copied verbatim)`,
		`note:   the UMD file is shipped but NOT declared in the package's "exports"`,
		`        map, so it is reachable only by filesystem path.`,
		`sha256: ${sha256}`,
		`bytes:  ${bytes.length}`,
		``,
		`Vendored by scripts/prepare-niivue.js -- run \`npm run niivue:vendor\` after`,
		`bumping @niivue/niivue in package.json. Do not edit this directory by hand.`,
		``
	].join('\n')
);

console.log(`niivue ${version} -> ${path.relative(process.cwd(), DEST)} (${bytes.length} bytes)`);
