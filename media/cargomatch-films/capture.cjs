#!/usr/bin/env node
'use strict';
// Read-only reuse of CDP infrastructure. Explicit isolated server only.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
if (process.env.CARGOMATCH_CAPTURE_URL !== 'http://127.0.0.1:24302/') throw Error('Explicit isolated capture URL required.');
const isolated = fs.readdirSync('/proc').filter(x => /^\d+$/.test(x)).some(id => {
  try {
    const env = fs.readFileSync(`/proc/${id}/environ`, 'utf8').split('\0');
    return env.includes('PORT=24301') && env.includes('NODE_ENV=test') &&
      env.includes('DEMO_TEST_ECOSYSTEM=test-brokerage-groupage-films');
  } catch { return false; }
});
if (!isolated) throw Error('Disposable API namespace could not be verified.');
const reference = fs.readFileSync(path.join(__dirname, '../cargomatch/capture.cjs'), 'utf8');
const bootstrap = reference.slice(0, reference.indexOf('    // Priority proof screens first.'))
  .replace(/^#!.*\n/, '')
  .replace('attached_assets/cargomatch/screens', 'attached_assets/cargomatch-films')
  .replace('attached_assets/cargomatch/capture-manifest.json', 'attached_assets/cargomatch-films/capture-manifest.json');
const scenario = async function () {
  const setValue = async (selector, value) => {
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw Error('Missing input');
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true}));
    })()`);
    await sleep(250);
  };
  const capture = async (film, name, facts) => {
    await evaluate('window.scrollTo(0,0)');
    await sleep(400);
    await shot(`${film}/screens/${name}.png`, 1600, 1000, {
      capturedAt: new Date().toISOString(), facts,
      route: await evaluate('location.search'),
      persona: await evaluate("document.querySelector('#demo-persona')?.value"),
      visibleText: await evaluate('document.body.innerText'),
    });
    fs.writeFileSync(MANIFEST, JSON.stringify({
      namespace: 'test-brokerage-groupage-films',
      verifiedProcessConfiguration: true,
      source: 'Current authentic UI served through explicitly isolated localhost capture proxy. Real consent/actions, no UI patching or reset.',
      screenshots: captures,
    }, null, 2));
  };
  const b = (n,f) => capture('brokerage',n,f);
  const g = (n,f) => capture('groupage',n,f);
  if (process.env.CAPTURE_DELIVERY_ONLY === '1') {
    const previous = JSON.parse(fs.readFileSync(MANIFEST,'utf8'));
    captures.push(...previous.screenshots.filter(s=>!s.filename.endsWith('groupage-delivery.png')));
    await switchPersona('consignee');
    await route('import_delivery','IMPORT','india-house-2');
    await setValue('#import-evidence','Synthetic film demonstration: receiver requests delivery; no transport booking.');
    await clickText('Laten bezorgen (Deliver)');
    await waitFor(`document.body.innerText.includes('DELIVER')`, 'stored delivery preference');
    await g('groupage-delivery','DELIVER preference stored through real authorized UI action with evidence, not transport booking.');
    return;
  }
  await route('cargos','DEEPSEA');
  await b('brokerage-cargo','Andy cargo requirement; own authorized projection.');
  await switchPersona('sophie');
  await route('capacity','DEEPSEA');
  await b('brokerage-capacity','Sophie expected-open capacity, not guaranteed availability.');
  await route('assets','DEEPSEA');
  await b('brokerage-assets','Sophie vessel information and estimated position.');
  await switchPersona('andy');
  await route('match_detail','DEEPSEA','match-deepsea');
  await b('brokerage-opportunity','Before consent: compatibility and protected counterparty.');
  await clickText('Toon interesse');
  await waitFor(`document.body.innerText.includes('INTEREST_SENT')`, 'interest');
  await switchPersona('sophie');
  await route('match_detail','DEEPSEA','match-deepsea');
  await b('brokerage-interest','Andy expressed interest; Sophie has not accepted.');
  await clickText('Accepteer verbinding');
  await waitFor(`document.body.innerText.includes('CONNECTED')`, 'connection');
  await b('brokerage-connected','Real mutual demo consent. Introduction, not booking.');
  await switchPersona('andy');
  await route('match_detail','DEEPSEA','match-deepsea');
  await setValue('input[aria-label="Bericht"]','Kunnen we het laadvenster en de operationele voorwaarden samen afstemmen?');
  await evaluate(`document.querySelector('button[aria-label="Bericht versturen"]').click()`);
  await waitFor(`document.body.innerText.includes('Kunnen we het laadvenster')`, 'conversation');
  await b('brokerage-conversation','Authorized shared conversation after mutual consent.');
  await switchPersona('david');
  await route('import_shipments','IMPORT','india-master');
  await g('groupage-master','David views master Mumbai consolidation.');
  await route('import_shipments','IMPORT','india-house-2');
  await g('groupage-house','David views own selected house H2 within master context.');
  await switchPersona('consignee');
  await route('import','IMPORT','india-house-2');
  await g('groupage-private','Receiver own H2 shipment only.');
  await route('import_documents','IMPORT','india-house-2');
  await g('groupage-documents','Receiver permitted own-house documents; no other receivers.');
  await route('import_charges','IMPORT','india-house-2');
  await g('groupage-charges','Receiver relevant own-house costs only.');
  await route('import_release','IMPORT','india-house-2');
  await g('groupage-release','Own-house release conditions remain outstanding. No invented release success.');
  await route('import_delivery','IMPORT','india-house-2');
  await setValue('#import-evidence','Synthetic film demonstration: receiver requests delivery; no transport booking.');
  await clickText('Laten bezorgen (Deliver)');
  await waitFor(`document.body.innerText.includes('DELIVER')`, 'stored delivery preference');
  await g('groupage-delivery','Real DELIVER preference, not transport booking or simulated delivery success.');
  console.log(`Captured ${captures.length} authentic film screens.`);
};
const tail = `
    await (${scenario.toString()})();
  } finally {
    cdp?.close();
    chrome.kill('SIGTERM');
    await sleep(200);
    fs.rmSync(profile, {recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
`;
vm.runInThisContext('(function(require,__dirname){' + bootstrap + tail + '\n})', {filename:__filename})(require,__dirname);