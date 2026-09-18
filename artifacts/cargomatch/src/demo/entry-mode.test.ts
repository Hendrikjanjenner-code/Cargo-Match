import assert from "node:assert/strict";
import test from "node:test";
import { entryUrl, resolveEntryMode } from "./entry-mode";
import { demoUiEnabled } from "./demo-policy";

test("explicit demo entry overrides a remembered real session without reading it", () => {
  assert.equal(resolveEntryMode(new URL("https://example.com/?entry=demo"), "/", () => {
    throw new Error("This store must not be consulted");
  }), "demo");
});

test("demo refresh and exit remain local with blocked session storage", () => {
  const blocked = () => { throw new Error("SecurityError"); };
  for (const mode of ["demo", "landing"] as const) {
    assert.equal(resolveEntryMode(new URL(entryUrl("/cargo/", mode), "https://example.com"), "/cargo/", blocked), mode);
  }
  assert.equal(resolveEntryMode(new URL("https://example.com/"), "/", blocked), "landing");
});

test("real deep links and legacy saved demo entry retain their behavior", () => {
  assert.equal(resolveEntryMode(new URL("https://example.com/road/assets"), "/", () => null), "real");
  assert.equal(resolveEntryMode(new URL("https://example.com/"), "/", () => "demo"), "demo");
  assert.equal(entryUrl("/cargo/", "real"), "/cargo/");
});

test("production and disabled demo shortcuts fail closed, including saved preferences and direct URLs", () => {
  for (const command of ["build", "preview"]) {
    for (const env of ["production", "development", "test", undefined]) {
      assert.equal(demoUiEnabled(command, env, "true"), false);
    }
  }
  assert.equal(demoUiEnabled("serve", "production", "true"), false);
  assert.equal(demoUiEnabled("serve", undefined, "true"), false);
  assert.equal(demoUiEnabled("serve", "development", "false"), false);
  assert.equal(demoUiEnabled("serve", "development", undefined), true);
  assert.equal(demoUiEnabled("serve", "test", undefined), true);
  assert.equal(resolveEntryMode(new URL("https://example.com/?entry=demo"), "/", () => "demo", false), "landing");
  assert.equal(resolveEntryMode(new URL("https://example.com/"), "/", () => "demo", false), "landing");
  assert.equal(resolveEntryMode(new URL("https://example.com/road/assets"), "/", () => "real", false), "real");
});