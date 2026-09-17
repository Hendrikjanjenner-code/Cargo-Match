#!/usr/bin/env node
'use strict';
/*
 * Loopback-only Chromium/CDP check.  It deliberately uses no npm browser
 * driver: Node 24's built-in WebSocket speaks directly to Chromium.
 * WebVTT rendering here does not prove native MP4 mov_text support.
 */
const fs = require('fs'), http = require('http'), net = require('net');
const path = require('path'), { URL } = require('url');
const { spawn } = require('child_process');
function deliveryArg(argv) {
  let supplied = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--delivery') {
      if (!argv[i + 1] || argv[i + 1].startsWith('-')) throw Error('--delivery requires a directory');
      supplied = argv[++i];
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: node media/closa/verify-browser.cjs [--delivery DIR | DIR]');
      process.exit(0);
    } else if (argv[i].startsWith('-') || supplied) {
      throw Error(`Unexpected argument: ${argv[i]}`);
    } else {
      supplied = argv[i];
    }
  }
  return path.resolve(supplied || path.join(__dirname, '../../attached_assets/closa/delivery'));
}
const ROOT = deliveryArg(process.argv.slice(2));
const screensDelivery = path.basename(ROOT) === 'screens';
const BUILD = path.resolve(__dirname, screensDelivery ? 'build-screens' : 'build');
const MP4 = 'closa-en-1080p.mp4', VTT = 'closa-en-nl.vtt';
const REPORT = path.join(BUILD, 'browser-verification.json');
const HTML = `<!doctype html><meta charset=utf-8><title>Closa local delivery verification</title>
<style>body{margin:0;padding:22px;background:#111827;color:#f8fafc;font:16px system-ui,sans-serif}
main{max-width:1100px;margin:auto}h1{font-size:21px;font-weight:600}video{display:block;width:100%;background:#000}
#state{margin-top:12px;color:#cbd5e1}</style><main><h1>Closa — local MP4 delivery check</h1>
<video id=player controls muted playsinline preload=auto><source src="/closa-en-1080p.mp4" type="video/mp4">
<track id=nl kind=subtitles srclang=nl label=Nederlands src="/closa-en-nl.vtt"></video>
<div id=state>Captions: off</div></main>`;
function safeFile(name) {
  const full = path.resolve(ROOT, '.' + decodeURIComponent(name));
  return full.startsWith(ROOT + path.sep) ? full : null;
}
function serveFile(req, res, file) {
  fs.stat(file, (err, info) => {
    if (err || !info.isFile()) return res.writeHead(404).end('Not found');
    const total = info.size, range = req.headers.range; let start = 0, end = total - 1, status = 200;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m) return res.writeHead(416, {'Content-Range': `bytes */${total}`}).end();
      if (!m[1]) start = Math.max(0, total - Number(m[2])); else { start = Number(m[1]); if (m[2]) end = Number(m[2]); }
      if (!Number.isSafeInteger(start) || start < 0 || start >= total) return res.writeHead(416, {'Content-Range': `bytes */${total}`}).end();
      end = Math.min(end, total - 1); if (end < start) return res.writeHead(416).end(); status = 206;
    }
    const headers = {'Content-Type': file.endsWith('.mp4') ? 'video/mp4' : 'text/vtt; charset=utf-8',
      'Accept-Ranges':'bytes','Content-Length':end-start+1,'Cache-Control':'no-store'};
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, {start, end}).pipe(res);
  });
}
function serverStart() {
  const s = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/' || u.pathname === '/index.html') {
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}); return res.end(HTML);
    }
    const file = safeFile(u.pathname);
    if (!file || ![MP4, VTT].includes(path.basename(file))) return res.writeHead(404).end('Not found');
    serveFile(req, res, file);
  });
  return new Promise((resolve, reject) => { s.once('error', reject); s.listen(0, '127.0.0.1', () => resolve(s)); });
}
function freePort() {
  return new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p=s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });
}
async function json(url) { const r = await fetch(url); if (!r.ok) throw Error(`${url}: ${r.status}`); return r.json(); }
function timeout(promise, milliseconds, description) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`Timed out waiting for ${description}`)), milliseconds); })
  ]);
}
class CDP {
  constructor(ws) { this.ws = new WebSocket(ws); this.id = 0; this.waiting = new Map(); this.events = new Map(); }
  async open() { await new Promise((ok, bad) => { this.ws.onopen=ok; this.ws.onerror=bad; }); this.ws.onmessage = e => { const m=JSON.parse(e.data); if (m.id) this.waiting.get(m.id)?.(m); (this.events.get(m.method)||[]).forEach(f=>f(m.params)); }; }
  call(method, params={}) { return timeout(new Promise((resolve, reject) => { const id=++this.id; this.waiting.set(id, m=>{this.waiting.delete(id); m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result);}); this.ws.send(JSON.stringify({id,method,params})); }), 15000, `CDP ${method}`); }
  on(name, fn) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(fn); }
  close() { this.ws.close(); }
}
async function main() {
  for (const f of [MP4,VTT]) if (!fs.existsSync(path.join(ROOT,f))) throw Error(`Delivery is not rendered yet; missing ${path.join(ROOT,f)}`);
  fs.mkdirSync(BUILD, {recursive:true});
  const web = await serverStart(), port = web.address().port, debugPort = await freePort();
  const profile = fs.mkdtempSync(path.join('/tmp', 'closa-chromium-'));
  const chrome = spawn(process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
    [`--headless=new`,`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,
      '--no-sandbox','--disable-gpu','about:blank'], {stdio:['ignore','ignore','pipe']});
  let browser, report = {check:'Closa local MP4 delivery and browser WebVTT captions',
    started:new Date().toISOString(), baseURL:`http://127.0.0.1:${port}`, files:{video:MP4,subtitles:VTT},
    assertions:{},screenshots:[], distinction:'This verifies browser-rendered WebVTT only; it does not prove native MP4 mov_text playback support.',
    pronunciation:'No spoken-pronunciation claim is made.'};
  try {
    let targets; for (let i=0;i<100;i++) { try { targets=await json(`http://127.0.0.1:${debugPort}/json/list`); break; } catch { await new Promise(r=>setTimeout(r,100)); } }
    const target = targets?.find(t=>t.type==='page');
    if (!target) throw Error('Chromium did not open a page debugging target');
    browser = new CDP(target.webSocketDebuggerUrl); await browser.open();
    await browser.call('Page.enable'); await browser.call('Runtime.enable');
    await browser.call('Page.navigate',{url:`http://127.0.0.1:${port}/`});
    await browser.call('Runtime.evaluate',{expression:`new Promise((resolve,reject)=>{let v=document.querySelector('#player');let timer=setTimeout(()=>reject(Error('metadata timeout')),12000);let ok=()=>{clearTimeout(timer);resolve()};let bad=()=>{clearTimeout(timer);reject(Error('video load error'))};if(v.readyState>=1)ok();else{v.addEventListener('loadedmetadata',ok,{once:true});v.addEventListener('error',bad,{once:true});}})`,awaitPromise:true});
    const ev = async (expression, awaitPromise=false) => (await browser.call('Runtime.evaluate',{expression,awaitPromise,returnByValue:true})).result.value;
    const metadata = await ev(`(()=>{let v=player;return {duration:v.duration,width:v.videoWidth,height:v.videoHeight,error:v.error&&v.error.message,trackMode:v.textTracks[0].mode}})()`);
    if (metadata.error) throw Error(`video error: ${metadata.error}`);
    if (metadata.width!==1920||metadata.height!==1080) throw Error(`Expected 1920x1080, got ${metadata.width}x${metadata.height}`);
    if (!Number.isFinite(metadata.duration)||Math.abs(metadata.duration-75)>.5) throw Error(`Expected ~75s duration, got ${metadata.duration}`);
    report.assertions.metadata=metadata;
    const initial=await ev(`({mode:player.textTracks[0].mode,error:player.error&&player.error.message})`);
    if(initial.mode!=='disabled'||initial.error) throw Error(`Captions did not start disabled or video has error: ${JSON.stringify(initial)}`);
    report.assertions.captionsDefaultOff=true;
    await ev(`(async()=>{await player.play();player.currentTime=1.5;return true})()`,true);
    await ev(`new Promise(r=>{let f=()=>player.currentTime>=1.4?r():setTimeout(f,20);f()})`,true);
    const on=await ev(`new Promise(resolve=>{let t=player.textTracks[0];t.mode='showing';let until=Date.now()+3000;let poll=()=>{let cues=[...(t.activeCues||[])].map(c=>c.text);if(cues.length||Date.now()>until){state.textContent='Captions: on — '+cues.join(' ');resolve({mode:t.mode,cues})}else setTimeout(poll,25)};poll()})`,true);
    if(on.mode!=='showing'||!on.cues.length||!/\bvastgoed\b/i.test(on.cues.join(' '))) throw Error(`No active Dutch WebVTT cue: ${JSON.stringify(on)}`);
    report.assertions.captionsOn=on;
    if (screensDelivery) {
      const placement=await ev(`({line:player.textTracks[0].cues[0].line,snapToLines:player.textTracks[0].cues[0].snapToLines})`);
      if(placement.line!==2||placement.snapToLines!==false) throw Error('Expected top-positioned WebVTT captions');
      report.assertions.captionPlacement=placement;
    }
    const shot=async name=>{const x=await browser.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(BUILD,name),Buffer.from(x.data,'base64'));report.screenshots.push(name);};
    await shot('captions-on.png');
    const off=await ev(`(()=>{let t=player.textTracks[0];t.mode='disabled';state.textContent='Captions: off';return {mode:t.mode,activeCues:t.activeCues?t.activeCues.length:0}})()`);
    if(off.mode!=='disabled') throw Error(`Captions did not disable: ${JSON.stringify(off)}`);
    report.assertions.captionsOff=off; await shot('captions-off.png');
    const finalToggle=await ev(`new Promise((resolve,reject)=>{let v=player,t=v.textTracks[0],timer=setTimeout(()=>reject(Error('final cue timeout')),8000);v.pause();t.mode='showing';v.currentTime=70;let poll=()=>{let active=[...(t.activeCues||[])];let cues=active.filter(c=>c.startTime<=v.currentTime&&c.endTime>v.currentTime).map(c=>c.text);if(!v.seeking&&v.currentTime>=69.5&&cues.length){clearTimeout(timer);resolve({time:v.currentTime,mode:t.mode,cues})}else setTimeout(poll,30)};poll()})`,true);
    if(finalToggle.mode!=='showing'||!finalToggle.cues.length||!/(?:Closa|demo)/i.test(finalToggle.cues.join(' '))) throw Error(`Final Dutch subtitle toggle failed: ${JSON.stringify(finalToggle)}`);
    report.assertions.finalSubtitleToggle=finalToggle;
    report.completed=new Date().toISOString();
    fs.writeFileSync(REPORT,JSON.stringify(report,null,2)+'\n'); console.log(`Browser verification passed; report: ${REPORT}`);
  } finally { browser?.close(); chrome.kill('SIGTERM'); await new Promise(r=>web.close(r)); fs.rmSync(profile,{recursive:true,force:true}); }
}
main().catch(e=>{console.error(`Browser verification failed: ${e.message}`);process.exitCode=1;});