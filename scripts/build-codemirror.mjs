// Bundles CodeMirror 6 (scripts/codemirror-entry.js) into the one file src/vendor/codemirror.js, with esbuild. Run it by hand after a change of a CodeMirror, Lezer or esbuild version: `npm run vendor:codemirror`.
// The app's own build stays tsc alone; the bundle is committed like the other files of src/vendor/, and it loads nothing from outside.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = (name) => JSON.parse(readFileSync(`${root}node_modules/${name}/package.json`, "utf8")).version;

await build({
  entryPoints: [`${root}scripts/codemirror-entry.js`],
  outfile: `${root}src/vendor/codemirror.js`,
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "TsunagiaiCodeMirror",
  target: "safari15",
  legalComments: "none",
  banner: {
    js: `/* CodeMirror 6: @codemirror/view ${version("@codemirror/view")}, @codemirror/state ${version("@codemirror/state")}, @codemirror/language ${version("@codemirror/language")}, @codemirror/commands ${version("@codemirror/commands")}, @codemirror/legacy-modes ${version("@codemirror/legacy-modes")} the language packages @codemirror/lang-* and the other @codemirror/* packages they use (MIT, https://github.com/codemirror/dev), with the parsers of Lezer (@lezer/*, MIT) and style-mod, crelt and w3c-keyname (MIT), bundled with esbuild ${version("esbuild")} (MIT) by scripts/build-codemirror.mjs. */`,
  },
});
