import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Landing from "./Landing";
import { DemoEntryContext } from "@/demo/entry";

test("fail-closed landing renders standard login without demo shortcuts or persona cards", () => {
  const html = renderToStaticMarkup(createElement(DemoEntryContext.Provider, { value: {startDemo: () => {}, loginReal: () => {}} }, createElement(Landing)));
  assert.match(html, /Standaard inloggen/);
  assert.doesNotMatch(html, /Explore Demo|demo-personas|Andy Kers|Sophie van Dijk/);
});