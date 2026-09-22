#!/usr/bin/env node
'use strict';
// Reuse the approved CDP capture infrastructure without changing the first film.
// Only UI controls are used. No app code, state, response, or UI text is patched.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const reference = fs.readFileSync(path.join(__dirname, '../cargomatch/capture.cjs'), 'utf8');
const bootstrap = reference.slice(0, reference.indexOf('    // Priority proof screens first.'))
  .replace(/^#!.*\n/, '')
  .replace("attached_assets/cargomatch/screens", "attached_assets/cargomatch-import/screens")
  .replace("attached_assets/cargomatch/capture-manifest.json", "attached_assets/cargomatch-import/capture-manifest.json");
const scenario = async function () {
  const setValue = async (selector, value) => {
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw Error('Input missing: ' + ${JSON.stringify(selector)});
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true}));
    })()`);
    await sleep(200);
  };
  const evidence = () => setValue('#import-evidence', 'DEMO film review — synthetic fixture checked; no real commercial action.');
  const text = () => evaluate('document.body.innerText');
  const top = () => evaluate('window.scrollTo(0,0)');
  const capture = async (filename, facts, height = 1000) => {
    await sleep(500);
    await shot(filename, 1600, height, {
      capturedAt: new Date().toISOString(),
      route: await evaluate('location.search'),
      persona: await evaluate("document.querySelector('#demo-persona')?.selectedOptions[0]?.textContent"),
      scenario: (await text()).includes('CM-2026-008421') ? 'China FCL and authorized demo projection' : 'Authorized demo projection',
      facts,
      visibleText: await text(),
    });
    fs.writeFileSync(MANIFEST, JSON.stringify({
      createdAt: new Date().toISOString(),
      source: 'Current isolated CargoMatch server demo; fresh ephemeral Chromium profile.',
      safety: 'Real UI actions only. Synthetic customs/payments/tracking. Connection is not booking. No cookies, tokens or credentials saved.',
      screenshots: captures,
    }, null, 2));
  };
  const go = async (view, id = 'china-fcl') => {
    await route(view, 'IMPORT', id);
    await top();
    await evidence();
  };
  const clickAll = async label => {
    for (let i = 0; i < 35; i++) {
      if (!await evaluate(`[...document.querySelectorAll('button')].some(e => e.textContent.trim() === ${JSON.stringify(label)} && !e.disabled)`)) return;
      await clickText(label);
    }
    throw Error('Repeated control did not complete: ' + label);
  };
  await switchPersona('michael');
  await go('import');
  await capture('01-import-overview.png', 'Fresh import overview and ten-module navigation.');
  await go('import_shipments');
  await capture('02-shipments.png', 'China FCL shipment detail in authorized manager projection.');
  await go('import_exceptions');
  await evaluate(`([...document.querySelectorAll('*')].find(e => e.childElementCount === 0 && e.textContent.includes('verschil 180')))?.scrollIntoView({block:'center'})`);
  await capture('03-exceptions-180kg.png', 'Initial genuine weight discrepancy: packing list 18420 kg versus B/L 18240 kg, difference 180 kg.');
  await go('import_documents');
  await capture('04-documents-before.png', 'Original synthetic documents before review.', 1200);
  await clickAll('Extract data');
  await capture('05-documents-extracted.png', 'Synthetic extraction proposals await explicit human confirmation.', 1400);
  // The origin proposal uses a field the server does not accept; do not fabricate
  // success. Confirm the real 18420 kg packing-list correction once.
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(e =>
      e.textContent.trim() === 'Bevestig wijziging' &&
      e.parentElement.textContent.includes('weightKg:') &&
      e.parentElement.textContent.includes('18420'));
    if (!b) throw Error('Packing-list weight proposal missing'); b.click();
  })()`);
  await sleep(800);
  await clickAll('Goedkeuren');
  await top();
  await capture('06-documents-reviewed.png', 'Real proposal confirmation and document acceptance completed in isolated demo.', 1200);
  await evaluate(`([...document.querySelectorAll('*')].find(e => e.childElementCount === 0 && e.textContent.includes('weightKg:')))?.scrollIntoView({block:'center'})`);
  await capture('06b-weight-confirmed.png', 'Actual 18420 kg proposal confirmed. Source documents retain their original different weights.', 1000);
  await go('import');
  await capture('07-import-readiness.png', 'Current readiness after human document review.', 1200);
  await go('import_partners');
  await capture('08-partners.png', 'Actual assigned collaborators and module access.', 1200);
  await go('import_customs');
  await capture('09-customs-draft.png', 'Customs draft before specialist review.');
  await switchPersona('customs-specialist');
  await go('import_customs');
  await clickText('Bewerken');
  for (const [field, value] of Object.entries({hsCode:'8501 (DEMO)',origin:'CN',goodsDescription:'Elektrische motoren — synthetic demo',classificationConfirmed:'yes',valuationConfirmed:'yes'})) {
    await setValue(`[aria-label="${field}"]`, value);
    await evaluate(`document.querySelector('[aria-label="${field}"]').parentElement.querySelector('button').click()`);
    await sleep(800);
  }
  await clickText('Klaar met bewerken');
  await capture('10-customs-human-review.png', 'Noor explicitly entered synthetic classification/origin and confirmed classification and valuation.');
  await clickText('Review & Goedkeuren');
  await capture('11-customs-approval-result.png', 'Actual outcome of specialist approval; inspect status rather than assume success.');
  if ((await text()).includes('Indienen bij Mock Provider')) {
    await clickText('Indienen bij Mock Provider');
    await capture('12-customs-submitted.png', 'Submitted to mock provider only.');
    await clickText('Simuleer Vrijgave');
    await capture('13-customs-released.png', 'Explicit simulated customs release.');
  }
  await switchPersona('michael');
  await go('import_charges');
  await capture('14-charges-95707.png', 'Eight China cost lines: 84300 + 4800 + 950 + 1240 + 3372 + 145 + 720 + 180 = EUR 95707.', 1200);
  await clickAll('Betaal (Sim)');
  await capture('15-charges-simulated-payment.png', 'Actual synthetic payment actions, no real charge or collection.', 1200);
  await go('import_release');
  await capture('16-release-gates.png', 'Actual release conditions and remaining blockers; no gates disabled.', 1200);
  // Satisfy only ordinary synthetic gates. Customs/payment remain source-driven.
  await evaluate(`(() => {
    const rows = [...document.querySelectorAll('button')].filter(e => e.textContent.trim() === 'Toggle');
    const b = rows.find(e => !/customs|payment/.test(e.parentElement.parentElement.textContent) && e.parentElement.parentElement.textContent.includes('Open'));
    if(b) b.click();
  })()`);
  await sleep(800);
  for (let i=0;i<10;i++) {
    const clicked = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Toggle' && !/customs|payment/.test(e.parentElement.parentElement.textContent) && e.parentElement.parentElement.textContent.includes('Open'));
      if(!b) return false; b.click(); return true;
    })()`);
    if(!clicked) break;
    await sleep(800);
  }
  await capture('16b-release-gates-satisfied.png', 'Ordinary gates explicitly satisfied with synthetic evidence; customs/payment untouched by manual toggles.', 1200);
  await go('import_delivery');
  await clickText('Zoek Capaciteit');
  await capture('17-delivery-options.png', 'Real capacity matching result; connection is not booking.', 1200);
  await clickText('Details / Consent');
  const roadMatch = await evaluate("new URL(location.href).searchParams.get('entityId')");
  await capture('17b-delivery-consent-new.png', 'Road opportunity before either party gives consent.');
  await clickText('Toon interesse');
  await capture('17c-delivery-interest.png', 'Manager sends interest; not yet connected and not booked.');
  await switchPersona('thomas');
  await route('match_detail', 'ROAD', roadMatch);
  await clickText('Accepteer verbinding');
  await capture('17d-delivery-connected.png', 'Thomas accepts mutual demo connection; no automatic booking.');
  await switchPersona('michael');
  await go('import_delivery');
  await clickText('Afzonderlijk inplannen');
  await capture('17e-delivery-planned.png', 'Manager separately plans connected eligible road transport after release gates.');
  await clickText('Simuleer Aflevering');
  await capture('17f-delivery-delivered.png', 'Explicit simulated delivery with demo evidence.');
  await go('import_control');
  await capture('18-control-geographic.png', 'Geographic synthetic vessel map, different statuses and source/time.', 1200);
  for (const name of ['Jade Horizon','Mumbai Star','North Anchorage','Rotterdam Pearl','Silent Ocean','Unknown Passage']) {
    const found = await evaluate(`(() => {
      const el = [...document.querySelectorAll('span')].find(e => e.textContent.trim() === 'DEMO ' + ${JSON.stringify(name)});
      if (!el) return false;
      el.parentElement.parentElement.parentElement.scrollIntoView({block:'center'});
      el.click(); return true;
    })()`);
    if (found) {
      await capture('19-vessel-' + name.toLowerCase().replaceAll(' ','-') + '.png', 'Actual selected synthetic vessel: ' + name, 1200);
      await go('import_shipments');
      await go('import_control');
    }
  }
  await setValue('input[type="range"]', '35');
  await capture('19b-control-simulated-position.png', 'Real demo playback slider at 35%; explicitly simulated movement, not live AIS.', 1200);
  await switchPersona('consignee');
  await go('import', 'india-house-2');
  await capture('20-india-receiver-private.png', 'Priya receiver portal: own India house H2 only, not H1 or China.');
  await go('import_documents', 'india-house-2');
  await capture('21-india-own-documents.png', 'Receiver projected own-house documents, commercial invoice excluded.', 1200);
  await go('import_charges', 'india-house-2');
  await capture('22-india-relevant-costs.png', 'Receiver own-house relevant costs only.');
  await go('import_delivery', 'india-house-2');
  await clickText('Laten bezorgen (Deliver)');
  await capture('23-india-delivery-choice.png', 'Receiver actually registered DELIVER preference; not a transport booking.');
  console.log('Captured ' + captures.length + ' fresh import screenshots.');
};
const tail = `
    await (${scenario.toString()})();
  } finally {
    cdp?.close();
    chrome.kill('SIGTERM');
    await sleep(200);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error('Import capture failed: ' + error.message); process.exitCode = 1; });
`;
vm.runInThisContext('(function(require,__dirname){' + bootstrap + tail + '\n})', {filename: __filename})(require,__dirname);