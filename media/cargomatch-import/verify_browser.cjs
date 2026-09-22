'use strict';
// Reuse the approved CDP playback checker, keeping disposable evidence separate.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const root = path.resolve(__dirname, '../..');
const sourcePath = path.join(root, 'media/cargomatch/verify-browser.cjs');
const source = fs.readFileSync(sourcePath, 'utf8').replace(
  "const BUILD = path.resolve(__dirname, timeline ? 'build/revised-browser' : 'build/browser');",
  `const BUILD = ${JSON.stringify(path.join(__dirname, 'build/browser'))};`
);
process.argv = [process.argv[0], sourcePath, '--delivery-dir', path.join(root, 'attached_assets/cargomatch-import/delivery')];
const checker = new Module(sourcePath, module);
checker.filename = sourcePath;
checker.paths = module.paths;
checker._compile(source, sourcePath);