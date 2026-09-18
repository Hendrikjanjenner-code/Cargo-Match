import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DemoConsentButtons } from "./DemoConsentButtons";
import { consentControls } from "../consent-controls";

test("actual consent UI renders decline only for authorized incoming interest", () => {
  const render = (status: string, permissions: string[]) => renderToStaticMarkup(createElement(DemoConsentButtons, {
    controls: consentControls({status, ownSide: "CAPACITY", leftConsent: true, rightConsent: false}, permissions),
    busy: false, onAction: () => {},
  }));
  assert.match(render("INTEREST_SENT", ["DECLINE_CONNECTION"]), /Wijs af/);
  assert.doesNotMatch(render("INTEREST_SENT", ["ACCEPT_CONNECTION"]), /Wijs af/);
  assert.doesNotMatch(render("INTEREST_SENT", ["SEND_TO_PLANNER"]), /Wijs af|Accepteer verbinding/);
  assert.doesNotMatch(render("CONNECTED", ["DECLINE_CONNECTION"]), /Wijs af/);
  assert.doesNotMatch(render("NEW", ["DECLINE_CONNECTION"]), /Wijs af/);
});