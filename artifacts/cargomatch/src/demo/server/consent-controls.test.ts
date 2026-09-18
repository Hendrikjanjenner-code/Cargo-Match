import assert from "node:assert/strict";
import test from "node:test";
import { consentControls } from "./consent-controls";

const commercial = ["SHOW_INTEREST", "ACCEPT_CONNECTION", "DECLINE_CONNECTION"];
const initial = { status: "NEW", ownSide: "CARGO" as const, leftConsent: false, rightConsent: false };
test("only the recipient of pending interest can accept or decline", () => {
  assert.deepEqual(consentControls(initial, commercial), {interest: true, accept: false, decline: false, waiting: false});
  const pending = {...initial, status: "INTEREST_SENT", leftConsent: true};
  assert.deepEqual(consentControls(pending, commercial), {interest: false, accept: false, decline: false, waiting: true});
  assert.deepEqual(consentControls({...pending, ownSide: "CAPACITY"}, commercial), {interest: false, accept: true, decline: true, waiting: false});
});
test("decline is an explicit permission, not implied by profile or acceptance", () => {
  const incoming = {...initial, status: "INTEREST_SENT", rightConsent: true};
  assert.equal(consentControls(incoming, ["ACCEPT_CONNECTION"]).decline, false);
  assert.equal(consentControls(incoming, ["SEND_TO_PLANNER"]).accept, false);
  assert.equal(consentControls(incoming, ["SEND_TO_PLANNER"]).decline, false);
  assert.equal(consentControls(incoming, ["DECLINE_CONNECTION"]).decline, true);
});
test("terminal states and malformed pending states never expose consent buttons", () => {
  for (const status of ["CONNECTED", "DECLINED", "STALE"]) {
    const controls = consentControls({...initial, status, rightConsent: true}, commercial);
    assert.equal(controls.interest || controls.accept || controls.decline, false);
  }
  assert.equal(consentControls({...initial, status: "INTEREST_SENT"}, commercial).decline, false);
});