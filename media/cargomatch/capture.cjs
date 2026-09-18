#!/usr/bin/env node
'use strict';

/*
 * Captures the already-running CargoMatch secure server demo through Chromium
 * CDP. No browser driver, fixture server, credentials, cookies, or CSRF values
 * are written to disk.
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'attached_assets/cargomatch/screens');
const MANIFEST = path.join(ROOT, 'attached_assets/cargomatch/capture-manifest.json');
const BASE = process.env.CARGOMATCH_CAPTURE_URL ||
  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/` : 'http://localhost/');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function timeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`Timed out: ${label}`)), ms); }),
  ]);
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
async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`Chromium debugger returned ${response.status}`);
  return response.json();
}

class CDP {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
  }
  async open() {
    await timeout(new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = reject;
    }), 15000, 'opening Chromium CDP');
    this.socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const callback = this.pending.get(message.id);
      if (callback) callback(message);
    };
  }
  call(method, params = {}) {
    return timeout(new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, message => {
        this.pending.delete(id);
        if (message.error) reject(Error(`${method}: ${message.error.message}`));
        else resolve(message.result);
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    }), 20000, method);
  }
  close() { this.socket.close(); }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const debugPort = await freePort();
  const profile = fs.mkdtempSync('/tmp/cargomatch-capture-');
  const chrome = spawn(process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium', [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let cdp;
  const captures = [];
  try {
    let targets;
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        targets = await getJson(`http://127.0.0.1:${debugPort}/json/list`);
        if (targets.some(target => target.type === 'page')) break;
      } catch { /* Chromium is still starting. */ }
      await sleep(100);
    }
    const target = targets?.find(item => item.type === 'page');
    if (!target) throw Error('Chromium did not expose a page target');
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');

    const evaluate = async (expression, awaitPromise = false) => {
      const result = await cdp.call('Runtime.evaluate', {
        expression, awaitPromise, returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result.value;
    };
    const viewport = async (width, height) => {
      await cdp.call('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: width < 700,
      });
      await sleep(350);
    };
    const waitFor = async (expression, label, ms = 25000) => {
      const started = Date.now();
      while (Date.now() - started < ms) {
        try {
          if (await evaluate(`Boolean(${expression})`)) return;
        } catch { /* The document may be between navigation commits. */ }
        await sleep(150);
      }
      const visible = await evaluate('document.body.innerText.slice(0, 1200)');
      throw Error(`Timed out waiting for ${label}. Visible page: ${visible}`);
    };
    const route = async (view, mode, entityId = null) => {
      await evaluate(`(() => {
        const u = new URL(location.href);
        u.searchParams.set('entry', 'demo');
        u.searchParams.set('demoView', ${JSON.stringify(view)});
        u.searchParams.set('demoMode', ${JSON.stringify(mode)});
        ${entityId ? `u.searchParams.set('entityId', ${JSON.stringify(entityId)});` : "u.searchParams.delete('entityId');"}
        history.pushState({}, '', u);
        dispatchEvent(new PopStateEvent('popstate'));
      })()`);
      await sleep(500);
    };
    const switchPersona = async id => {
      await evaluate(`(() => {
        const s = document.querySelector('#demo-persona');
        if (!s) throw Error('Persona selector not found');
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(s, ${JSON.stringify(id)});
        s.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await waitFor(`document.querySelector('#demo-persona')?.value === ${JSON.stringify(id)} && !document.querySelector('#demo-persona')?.disabled`, `persona ${id}`);
      await sleep(400);
    };
    const clickText = async (text, selector = 'button') => {
      const clicked = await evaluate(`(() => {
        const wanted = ${JSON.stringify(text)};
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
          .find(node => node.textContent.trim().includes(wanted) && !node.disabled);
        if (!el) return false;
        el.click();
        return true;
      })()`);
      if (!clicked) throw Error(`Clickable control not found: ${text}`);
      await sleep(700);
    };
    const shot = async (filename, width, height, metadata) => {
      await viewport(width, height);
      await waitFor(`document.querySelector('main') && !document.body.innerText.includes('Beveiligde demo laden')`, filename);
      const image = await cdp.call('Page.captureScreenshot', {
        format: 'png', fromSurface: true, captureBeyondViewport: false,
      });
      fs.writeFileSync(path.join(OUT, filename), Buffer.from(image.data, 'base64'));
      captures.push({ filename, viewport: { width, height }, ...metadata });
    };

    await viewport(1280, 800);
    await cdp.call('Page.navigate', { url: new URL('?entry=demo', BASE).href });
    await waitFor(`document.querySelector('#demo-persona') && document.querySelector('#demo-persona').value === 'andy'`, 'fresh Andy server demo', 35000);
    // The hosted preview injects a Replit-only notice above the application.
    // Remove that external platform chrome only; app DEMO/PILOT badges remain.
    await evaluate(`(() => {
      const candidates = [...document.querySelectorAll('body *')].filter(el => {
        const r = el.getBoundingClientRect();
        return el.textContent.includes('This is a temporary development preview') &&
          r.width > innerWidth * .8 && r.height > 0 && r.height < 100;
      }).sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height);
      candidates.forEach(el => el.style.setProperty('display', 'none', 'important'));
    })()`);
    await sleep(300);

    // Priority proof screens first.
    await switchPersona('sophie');
    await route('capacity', 'DEEPSEA');
    await shot('deepsea-capacity.png', 1280, 800, {
      route: '?entry=demo&demoView=capacity&demoMode=DEEPSEA', persona: 'Sophie van Dijk',
      consentStatus: 'NEW / no mutual consent',
      intendedNarration: 'Sophie manages the expected-open Kamsarmax capacity from Malaysia.',
    });
    await shot('capacity-tablet.png', 1024, 768, {
      route: '?entry=demo&demoView=capacity&demoMode=DEEPSEA', persona: 'Sophie van Dijk',
      consentStatus: 'NEW / no mutual consent',
      intendedNarration: 'CargoMatch capacity remains usable at tablet width.',
    });
    await route('assets', 'DEEPSEA');
    await shot('deepsea-capacity-detail.png', 1280, 800, {
      route: '?entry=demo&demoView=assets&demoMode=DEEPSEA', persona: 'Sophie van Dijk',
      consentStatus: 'NEW / owner-side asset display / no mutation',
      intendedNarration: 'The read-only fleet view shows MV OceanBridge Atlas as an 82,000-ton Kamsarmax expected open in Malaysia.',
    });
    await switchPersona('andy');
    await route('cargos', 'DEEPSEA');
    await shot('deepsea-cargo.png', 1280, 800, {
      route: '?entry=demo&demoView=cargos&demoMode=DEEPSEA', persona: 'Andy Kers',
      consentStatus: 'NEW / no mutual consent',
      intendedNarration: 'Andy owns the 75,000 mt Indonesia–China cargo order.',
    });

    await route('match_detail', 'DEEPSEA', 'match-deepsea');
    await shot('deepsea-opportunity.png', 1280, 800, {
      route: '?entry=demo&demoView=match_detail&demoMode=DEEPSEA&entityId=match-deepsea', persona: 'Andy Kers',
      consentStatus: 'NEW / counterparty identity redacted',
      intendedNarration: 'A suitable opportunity is visible while the counterparty remains protected.',
    });
    await clickText('Toon interesse');
    await waitFor(`document.body.innerText.includes('INTEREST_SENT')`, 'interest sent status');
    await switchPersona('sophie');
    await route('match_detail', 'DEEPSEA', 'match-deepsea');
    await shot('deepsea-interest.png', 1280, 800, {
      route: '?entry=demo&demoView=match_detail&demoMode=DEEPSEA&entityId=match-deepsea', persona: 'Sophie van Dijk',
      consentStatus: 'INTEREST_SENT / incoming interest / identity redacted',
      intendedNarration: 'Sophie receives Andy’s interest and controls her own consent.',
    });
    await clickText('Accepteer verbinding');
    await waitFor(`document.body.innerText.includes('CONNECTED') && document.body.innerText.includes('NorthSea Chartering Demo')`, 'mutual consent connection');
    await shot('deepsea-connected.png', 1280, 800, {
      route: '?entry=demo&demoView=match_detail&demoMode=DEEPSEA&entityId=match-deepsea', persona: 'Sophie van Dijk',
      consentStatus: 'CONNECTED / real mutual demo consent completed',
      intendedNarration: 'Only mutual consent reveals the authorized company and contact projection.',
    });
    await switchPersona('andy');
    await route('match_detail', 'DEEPSEA', 'match-deepsea');
    await evaluate(`(() => {
      const input = document.querySelector('input[aria-label="Bericht"]');
      if (!input) throw Error('Message input not found');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'Kunnen we morgen het laadvenster afstemmen?');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(250);
    await evaluate(`document.querySelector('button[aria-label="Bericht versturen"]').click()`);
    await waitFor(`document.body.innerText.includes('Kunnen we morgen het laadvenster afstemmen?')`, 'sent conversation message');
    await shot('deepsea-messages.png', 1280, 800, {
      route: '?entry=demo&demoView=match_detail&demoMode=DEEPSEA&entityId=match-deepsea', persona: 'Andy Kers',
      consentStatus: 'CONNECTED / messaging authorized',
      intendedNarration: 'Connected participants exchange a short fictional planning message.',
    });

    await switchPersona('jan');
    await route('assets', 'ROAD');
    await shot('road-availability.png', 1280, 800, {
      route: '?entry=demo&demoView=assets&demoMode=ROAD', persona: 'Jan Müller',
      consentStatus: 'Operational assignment only / no commercial consent',
      intendedNarration: 'Jan sees only assigned Truck 42 and its expected Eindhoven availability.',
    });
    await shot('road-availability-mobile.png', 430, 860, {
      route: '?entry=demo&demoView=assets&demoMode=ROAD', persona: 'Jan Müller',
      consentStatus: 'Operational assignment only / no commercial consent',
      intendedNarration: 'Assigned-truck availability remains clear on mobile.',
    });
    await route('match_detail', 'ROAD', 'match-road');
    await shot('road-next-load.png', 1280, 800, {
      route: '?entry=demo&demoView=match_detail&demoMode=ROAD&entityId=match-road', persona: 'Jan Müller',
      consentStatus: 'NEW / operational referral permitted / commercial consent denied',
      intendedNarration: 'Jan reviews a suitable next load without commercial authority.',
    });
    await shot('road-next-load-mobile.png', 430, 860, {
      route: '?entry=demo&demoView=match_detail&demoMode=ROAD&entityId=match-road', persona: 'Jan Müller',
      consentStatus: 'NEW / operational referral permitted / commercial consent denied',
      intendedNarration: 'The next-load opportunity and planner action are available on mobile.',
    });
    await clickText('Naar Planner Sturen');
    await waitFor(`document.body.innerText.includes('Verzoek naar de planner verstuurd')`, 'road planner referral');
    await switchPersona('thomas');
    await route('dashboard', 'ROAD');
    await evaluate(`(() => {
      const heading = [...document.querySelectorAll('*')]
        .find(el => el.childElementCount === 0 && el.textContent.trim() === 'Van jouw schipper / chauffeur');
      heading?.scrollIntoView({ block: 'center' });
    })()`);
    await sleep(350);
    await shot('road-referral.png', 1280, 800, {
      route: '?entry=demo&demoView=dashboard&demoMode=ROAD', persona: 'Thomas Becker',
      consentStatus: 'Referral SENT / planner has not yet given commercial consent',
      intendedNarration: 'Thomas receives Jan’s actual server-stored planner referral.',
    });

    await switchPersona('anna');
    await route('capacity', 'RAIL');
    await shot('rail-capacity.png', 1280, 800, {
      route: '?entry=demo&demoView=capacity&demoMode=RAIL', persona: 'Anna Schmidt',
      consentStatus: 'NEW / Rail demo pilot',
      intendedNarration: 'Anna manages twelve compatible wagons available at Duisburg.',
    });
    await shot('rail-capacity-tablet.png', 1024, 768, {
      route: '?entry=demo&demoView=capacity&demoMode=RAIL', persona: 'Anna Schmidt',
      consentStatus: 'NEW / Rail demo pilot',
      intendedNarration: 'Anna’s twelve-wagon Duisburg capacity remains clear on a 4:3 tablet.',
    });
    await switchPersona('sarah');
    await route('capacity', 'AIR');
    await shot('air-capacity.png', 1280, 800, {
      route: '?entry=demo&demoView=capacity&demoMode=AIR', persona: 'Sarah Williams',
      consentStatus: 'NEW / Air Cargo demo pilot',
      intendedNarration: 'Sarah manages B777F AMS–DXB capacity with 4,800 kg and 28 m³ remaining.',
    });
    await route('assets', 'AIR');
    await shot('air-flight-detail.png', 1280, 800, {
      route: '?entry=demo&demoView=assets&demoMode=AIR', persona: 'Sarah Williams',
      consentStatus: 'NEW / owner-side asset display / no mutation / Air Cargo demo pilot',
      intendedNarration: 'The actual flight asset shows B777F AMS–DXB with 4,800 kg and 28 m³ together.',
    });
    await switchPersona('sophie');
    await route('map', 'DEEPSEA');
    await shot('regional-map.png', 1280, 800, {
      route: '?entry=demo&demoView=map&demoMode=DEEPSEA', persona: 'Sophie van Dijk',
      consentStatus: 'CONNECTED chain retained / projected map data',
      intendedNarration: 'The actual demo regional map places projected deepsea capacity and opportunities in context.',
    });
    await shot('regional-map-tablet.png', 1024, 768, {
      route: '?entry=demo&demoView=map&demoMode=DEEPSEA', persona: 'Sophie van Dijk',
      consentStatus: 'CONNECTED chain retained / projected map data',
      intendedNarration: 'The actual demo regional map remains useful on a 4:3 tablet.',
    });

    // Crop the exact rendered app brand at high device density from the public
    // app header. The isolated server sandbox is left untouched.
    await cdp.call('Page.navigate', { url: new URL('?entry=landing', BASE).href });
    await waitFor(`document.body.innerText.includes('Ontdek CargoMatch vanuit elk perspectief')`, 'CargoMatch landing brand');
    await evaluate(`(() => {
      [...document.querySelectorAll('body *')].filter(el => {
        const r = el.getBoundingClientRect();
        return el.textContent.includes('This is a temporary development preview') &&
          r.width > innerWidth * .8 && r.height > 0 && r.height < 100;
      }).forEach(el => el.style.setProperty('display', 'none', 'important'));
    })()`);
    await viewport(1440, 900);
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 3, mobile: false,
    });
    await sleep(350);
    const rect = await evaluate(`(() => {
      const label = [...document.querySelectorAll('*')].find(el =>
        el.textContent.trim() === 'CargoMatch' &&
        el.querySelector('svg'));
      if (!label) return null;
      const r = label.getBoundingClientRect();
      return { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 8), width: r.width + 20, height: r.height + 16 };
    })()`);
    if (!rect) throw Error('Rendered CargoMatch brand was not found for logo crop');
    const fullLogoFrame = await cdp.call('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false,
    });
    const temporaryFrame = path.join(profile, 'logo-frame.png');
    fs.writeFileSync(temporaryFrame, Buffer.from(fullLogoFrame.data, 'base64'));
    const crop = [
      `${Math.round(rect.width * 3)}x${Math.round(rect.height * 3)}`,
      `+${Math.round(rect.x * 3)}+${Math.round(rect.y * 3)}`,
    ].join('');
    execFileSync('magick', [
      temporaryFrame, '-crop', crop, '+repage',
      path.join(ROOT, 'attached_assets/cargomatch/logo.png'),
    ]);

    const manifest = {
      createdAt: new Date().toISOString(),
      source: 'Current already-running CargoMatch secure isolated server demo, captured through Chromium CDP.',
      safeProvenance: 'Fresh ephemeral browser profile and isolated visitor sandbox; authentic projected UI and real demo actions. No cookies, CSRF tokens, credentials, or production records retained.',
      mainProofViewport: { width: 1280, height: 800 },
      screenshots: captures,
      logo: {
        filename: 'logo.png',
        viewport: { width: 1440, height: 900 },
        route: '?entry=landing',
        persona: 'Public app header',
        intendedNarration: 'High-resolution crop of the exact CargoMatch branding rendered by the app landing header.',
      },
    };
    fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Captured ${captures.length} CargoMatch screens and rendered logo.`);
  } finally {
    cdp?.close();
    chrome.kill('SIGTERM');
    await sleep(200);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`CargoMatch capture failed: ${error.message}`);
  process.exitCode = 1;
});