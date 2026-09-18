#!/usr/bin/env node
'use strict';

/*
 * Loopback-only Chromium/CDP verification for the final CargoMatch film.
 * No npm browser driver is used. Burned-in subtitles intentionally require no
 * browser text track.
 */
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../../attached_assets/cargomatch/delivery');
const VIDEO = 'cargomatch-en-nl-1080p.mp4';
const VIDEO_PATH = path.join(ROOT, VIDEO);
const BUILD = path.resolve(__dirname, 'build/browser');
const REPORT = path.join(ROOT, 'browser-verification.json');
const SEEK_TIMES = [50, 90, 122, 155, 165];
const HTML = `<!doctype html><meta charset="utf-8"><title>CargoMatch final film verification</title>
<style>
html,body{margin:0;background:#020617;color:#f8fafc;font:16px system-ui,sans-serif}
main{width:min(100vw,1280px);margin:auto;padding:18px;box-sizing:border-box}
h1{font-size:20px;font-weight:600}video{display:block;width:100%;background:#000}
#state{margin-top:10px;color:#cbd5e1}
</style><main><h1>CargoMatch — final 168-second film browser check</h1>
<video id="player" controls muted playsinline preload="auto">
<source src="/${VIDEO}" type="video/mp4">
</video><div id="state">Loading final delivery…</div></main>`;

function timeout(promise, milliseconds, description) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(`Timed out waiting for ${description}`)), milliseconds);
    }),
  ]);
}

function serveVideo(req, res) {
  fs.stat(VIDEO_PATH, (error, info) => {
    if (error || !info.isFile()) return res.writeHead(404).end('Not found');
    const total = info.size;
    const range = req.headers.range;
    let start = 0;
    let end = total - 1;
    let status = 200;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return res.writeHead(416, { 'Content-Range': `bytes */${total}` }).end();
      if (!match[1]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) {
          return res.writeHead(416, { 'Content-Range': `bytes */${total}` }).end();
        }
        start = Math.max(0, total - suffix);
      } else {
        start = Number(match[1]);
        if (match[2]) end = Number(match[2]);
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
          start < 0 || start >= total || end < start) {
        return res.writeHead(416, { 'Content-Range': `bytes */${total}` }).end();
      }
      end = Math.min(end, total - 1);
      status = 206;
    }
    const headers = {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Cache-Control': 'no-store',
    };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(VIDEO_PATH, { start, end }).pipe(res);
  });
}

function startServer() {
  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      return res.writeHead(400).end('Bad request');
    }
    if ((url.pathname === '/' || url.pathname === '/index.html') &&
        (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return req.method === 'HEAD' ? res.end() : res.end(HTML);
    }
    if (url.pathname === `/${VIDEO}` && (req.method === 'GET' || req.method === 'HEAD')) {
      return serveVideo(req, res);
    }
    return res.writeHead(404).end('Not found');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`${url}: ${response.status}`);
  return response.json();
}

class CDP {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.sequence = 0;
    this.pending = new Map();
    this.events = new Map();
  }
  async open() {
    await timeout(new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = reject;
    }), 15000, 'CDP connection');
    this.socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id) this.pending.get(message.id)?.(message);
      for (const listener of this.events.get(message.method) || []) listener(message.params);
    };
  }
  call(method, params = {}) {
    return timeout(new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, message => {
        this.pending.delete(id);
        if (message.error) reject(Error(`${method}: ${JSON.stringify(message.error)}`));
        else resolve(message.result);
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    }), 20000, `CDP ${method}`);
  }
  on(method, listener) {
    if (!this.events.has(method)) this.events.set(method, []);
    this.events.get(method).push(listener);
  }
  close() {
    this.socket.close();
  }
}

async function main() {
  if (!fs.existsSync(VIDEO_PATH)) {
    throw Error(`Final delivery is not ready; missing ${VIDEO_PATH}`);
  }
  fs.mkdirSync(BUILD, { recursive: true });
  const server = await startServer();
  const port = server.address().port;
  const debugPort = await freePort();
  const profile = fs.mkdtempSync('/tmp/cargomatch-browser-');
  const chromium = spawn(process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium', [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-sandbox',
    '--disable-gpu',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,800',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let browser;
  const report = {
    check: 'CargoMatch final MP4 browser decode, playback, seeks, and burned-subtitle delivery',
    started: new Date().toISOString(),
    baseURL: `http://127.0.0.1:${port}`,
    file: VIDEO,
    expected: { width: 1920, height: 1080, durationSeconds: 168, videoCodec: 'H.264', browserTextTracks: 0 },
    assertions: {},
    screenshots: [],
  };
  try {
    let targets;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        targets = await json(`http://127.0.0.1:${debugPort}/json/list`);
        if (targets.some(target => target.type === 'page')) break;
      } catch { /* Chromium is still starting. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const target = targets?.find(item => item.type === 'page');
    if (!target) throw Error('Chromium did not open a page debugging target');
    browser = new CDP(target.webSocketDebuggerUrl);
    await browser.open();

    const mediaProperties = [];
    browser.on('Media.playerPropertiesChanged', event => {
      for (const property of event.properties || []) {
        mediaProperties.push({ name: property.name, value: property.value });
      }
    });
    await browser.call('Page.enable');
    await browser.call('Runtime.enable');
    await browser.call('Media.enable');
    await browser.call('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
    });
    await browser.call('Page.navigate', { url: `http://127.0.0.1:${port}/` });

    const evaluate = async (expression, awaitPromise = false) => {
      const result = await browser.call('Runtime.evaluate', {
        expression, awaitPromise, returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result.value;
    };

    await evaluate(`new Promise((resolve, reject) => {
      const video = document.querySelector('#player');
      const timer = setTimeout(() => reject(Error('metadata timeout')), 20000);
      const done = () => { clearTimeout(timer); resolve(true); };
      const failed = () => { clearTimeout(timer); reject(Error(video.error?.message || 'video load error')); };
      if (video.readyState >= 1) done();
      else {
        video.addEventListener('loadedmetadata', done, { once: true });
        video.addEventListener('error', failed, { once: true });
      }
    })`, true);

    const metadata = await evaluate(`(() => {
      const video = document.querySelector('#player');
      return {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        readyState: video.readyState,
        networkState: video.networkState,
        error: video.error && { code: video.error.code, message: video.error.message },
        textTracks: video.textTracks.length,
        videoTracks: video.videoTracks ? video.videoTracks.length : null,
        audioTracks: video.audioTracks ? video.audioTracks.length : null
      };
    })()`);
    if (metadata.error) throw Error(`Media element error: ${JSON.stringify(metadata.error)}`);
    if (metadata.width !== 1920 || metadata.height !== 1080) {
      throw Error(`Expected 1920x1080, got ${metadata.width}x${metadata.height}`);
    }
    if (!Number.isFinite(metadata.duration) || Math.abs(metadata.duration - 168) > 0.75) {
      throw Error(`Expected approximately 168 seconds, got ${metadata.duration}`);
    }
    if (metadata.textTracks !== 0) {
      throw Error(`Burned-subtitle delivery must have no browser text tracks; found ${metadata.textTracks}`);
    }
    if (metadata.videoTracks != null && metadata.videoTracks !== 1) {
      throw Error(`Expected exactly one video track; found ${metadata.videoTracks}`);
    }
    if (metadata.audioTracks != null && metadata.audioTracks !== 1) {
      throw Error(`Expected exactly one mixed audio track; found ${metadata.audioTracks}`);
    }
    report.assertions.metadata = metadata;
    report.assertions.noExtraBrowserTracks = true;
    report.assertions.noMediaElementError = true;

    const progression = await evaluate(`new Promise(async (resolve, reject) => {
      const video = document.querySelector('#player');
      try {
        video.currentTime = 0;
        await new Promise((ok, bad) => {
          const timer = setTimeout(() => bad(Error('initial seek timeout')), 8000);
          const done = () => { clearTimeout(timer); ok(); };
          if (!video.seeking && video.currentTime < .1) done();
          else video.addEventListener('seeked', done, { once: true });
        });
        let frames = 0;
        let callback;
        if ('requestVideoFrameCallback' in video) {
          callback = () => {
            frames += 1;
            if (video.currentTime < 3) video.requestVideoFrameCallback(callback);
          };
          video.requestVideoFrameCallback(callback);
        }
        const startedAt = video.currentTime;
        await video.play();
        const timeoutAt = performance.now() + 15000;
        while (video.currentTime < startedAt + 3) {
          if (performance.now() > timeoutAt) throw Error('three-second playback timeout');
          await new Promise(ok => setTimeout(ok, 50));
        }
        video.pause();
        resolve({
          startedAt,
          endedAt: video.currentTime,
          progressedSeconds: video.currentTime - startedAt,
          decodedFramesObserved: frames,
          totalVideoFrames: video.getVideoPlaybackQuality?.().totalVideoFrames ?? null,
          droppedVideoFrames: video.getVideoPlaybackQuality?.().droppedVideoFrames ?? null,
          error: video.error && { code: video.error.code, message: video.error.message }
        });
      } catch (error) { reject(error); }
    })`, true);
    if (progression.error || progression.progressedSeconds < 3) {
      throw Error(`Decoded playback did not progress three seconds: ${JSON.stringify(progression)}`);
    }
    if (progression.decodedFramesObserved < 1 &&
        !(progression.totalVideoFrames != null && progression.totalVideoFrames > 0)) {
      throw Error(`No decoded video frames were observed: ${JSON.stringify(progression)}`);
    }
    report.assertions.decodedPlaybackProgression = progression;

    for (const seconds of SEEK_TIMES) {
      const seek = await evaluate(`new Promise((resolve, reject) => {
        const video = document.querySelector('#player');
        const target = ${seconds};
        const timer = setTimeout(() => reject(Error('seek timeout at ' + target)), 12000);
        const finish = () => {
          const settle = () => {
            clearTimeout(timer);
            document.querySelector('#state').textContent = 'Verified frame at ' + target + ' seconds';
            resolve({
              requested: target,
              currentTime: video.currentTime,
              readyState: video.readyState,
              usedVideoFrameCallback: false,
              settlingMethod: 'seeked plus two animation frames',
              error: video.error && { code: video.error.code, message: video.error.message }
            });
          };
          // A paused seek can present its frame before "seeked" fires.
          // Registering a video-frame callback here would wait forever for
          // another frame; let the already decoded seek frame reach the page.
          requestAnimationFrame(() => requestAnimationFrame(settle));
        };
        video.pause();
        video.addEventListener('seeked', finish, { once: true });
        video.currentTime = target;
      })`, true);
      if (seek.error || Math.abs(seek.currentTime - seconds) > 0.5 || seek.readyState < 2) {
        throw Error(`Seek verification failed at ${seconds}s: ${JSON.stringify(seek)}`);
      }
      const filename = `seek-${String(seconds).padStart(3, '0')}s.png`;
      const screenshot = await browser.call('Page.captureScreenshot', {
        format: 'png', fromSurface: true, captureBeyondViewport: false,
      });
      fs.writeFileSync(path.join(BUILD, filename), Buffer.from(screenshot.data, 'base64'));
      report.screenshots.push({ filename, timeSeconds: seconds, currentTime: seek.currentTime, frameCallback: seek.usedVideoFrameCallback });
    }

    for (let attempt = 0; attempt < 30; attempt++) {
      if (mediaProperties.some(property => /h\.?264|avc1|avc/i.test(`${property.name}:${property.value}`))) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const codecEvidence = mediaProperties.filter(property =>
      /codec|decoder/i.test(property.name) || /h\.?264|avc1|avc/i.test(property.value)
    );
    if (!codecEvidence.some(property => /h\.?264|avc1|avc/i.test(`${property.name}:${property.value}`))) {
      throw Error('Chromium decoded the video, but CDP Media did not identify the stream as H.264/AVC');
    }
    report.assertions.h264DecodeEvidence = codecEvidence;
    const finalState = await evaluate(`(() => {
      const video = document.querySelector('#player');
      return { error: video.error && { code: video.error.code, message: video.error.message }, textTracks: video.textTracks.length };
    })()`);
    if (finalState.error || finalState.textTracks !== 0) {
      throw Error(`Final media state failed: ${JSON.stringify(finalState)}`);
    }
    report.assertions.finalState = finalState;
    report.completed = new Date().toISOString();
    fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`CargoMatch browser verification passed; report: ${REPORT}`);
  } finally {
    browser?.close();
    chromium.kill('SIGTERM');
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`CargoMatch browser verification failed: ${error.message}`);
  process.exitCode = 1;
});