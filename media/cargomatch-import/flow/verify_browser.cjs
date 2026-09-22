'use strict';
// Reuse approved loopback video-only checker, with full real-time playback.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const root = path.resolve(__dirname, '../../..');
const proof = process.argv.includes('--proof');
const delivery = proof ? path.join(__dirname,'build') : path.join(root, 'attached_assets/cargomatch-import/flow');
const edit = JSON.parse(fs.readFileSync(path.join(root,'attached_assets/cargomatch-import/flow/edit-timeline.json'), 'utf8'));
const times = edit.scenes.slice(1).map(s => Math.max(0,s.renderStartFrame/24-.5));
for (const scene of edit.scenes) for (const change of scene.screens.slice(1)) {
  times.push(Math.max(0,(scene.renderStartFrame+change.frame)/24-.5));
}
const sourcePath = path.join(root, 'media/cargomatch/verify-browser.cjs');
let source = fs.readFileSync(sourcePath, 'utf8');
if (proof) {
  const s=edit.scenes[2];
  source=source.replace("const VIDEO = 'cargomatch-en-nl-1080p.mp4';","const VIDEO = 'representative-proof.mp4';");
  source=source.replace('const expectedDuration = timeline ? Number(timeline.durationSeconds) : 168;',
    `const expectedDuration = ${(s.renderEndFrame-s.renderStartFrame)/24};`);
  times.splice(0,times.length,1,...s.screens.slice(1).map(c=>Math.max(0,c.frame/24-.5)));
}
source = source.replace(/const seekTimes =[\s\S]*?: \[50, 90, 122, 155, 165\];/,
  `const seekTimes = ${JSON.stringify(times.sort((a,b)=>a-b))};`);
source = source.replace("const BUILD = path.resolve(__dirname, timeline ? 'build/revised-browser' : 'build/browser');",
  `const BUILD = ${JSON.stringify(path.join(__dirname, 'build/browser'))};`);
source = source.replace('if (video.currentTime < 3)', 'if (video.currentTime < video.duration - 0.1)');
source = source.replace('performance.now() + 15000', 'performance.now() + (video.duration + 25) * 1000');
source = source.replace('while (video.currentTime < startedAt + 3)', 'while (video.currentTime < video.duration - 0.1)');
// The CDP timeout must cover full real-time playback, not just the old 3s probe.
source = source.replace('}), 20000, `CDP ${method}`);', '}), 240000, `CDP ${method}`);');
source = source.replace('const filename = `seek-', `const moving = await evaluate(\`new Promise(async (resolve, reject) => {
  const v = document.querySelector('#player'); const before=v.currentTime;
  try { await v.play(); await new Promise(r=>setTimeout(r,1600)); v.pause();
    resolve({before,after:v.currentTime,error:v.error && v.error.message}); }
  catch(e) { reject(e); }
})\`, true);
      if (moving.error || moving.after-moving.before < 1) throw Error('Transition playback did not advance');
      if (!report.transitionPlayback) report.transitionPlayback=[];
      report.transitionPlayback.push(moving);
      const filename = \`seek-`);
process.argv=[process.argv[0],sourcePath,'--delivery-dir',delivery];
const checker=new Module(sourcePath,module);
checker.filename=sourcePath;
checker.paths=module.paths;
checker._compile(source,sourcePath);