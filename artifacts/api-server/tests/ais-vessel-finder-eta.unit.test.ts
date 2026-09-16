import assert from "node:assert/strict";
import test from "node:test";
import { normalizeVesselFinderEta, vesselFinderEta } from "../src/services/ais/vesselFinderEta";

test("documented full-date ETA takes precedence; only ETA_AIS uses yearless fallback", () => {
  const anchor = "2030-01-01T12:00:00Z";
  assert.equal(normalizeVesselFinderEta("2030-01-02 14:00:00", "01-01 13:00", anchor), "2030-01-02T14:00:00.000Z");
  assert.equal(normalizeVesselFinderEta(null, "01-01 13:00", anchor), "2030-01-01T13:00:00.000Z");
  assert.equal(normalizeVesselFinderEta("malformed", "01-01 13:00", anchor), "2030-01-01T13:00:00.000Z");
  assert.equal(normalizeVesselFinderEta("01-01 13:00", null, anchor), null);
  assert.equal(normalizeVesselFinderEta("malformed", "malformed", anchor), null);
  assert.equal(normalizeVesselFinderEta("2030-01-02 14:00:00", null, null), "2030-01-02T14:00:00.000Z");
});

test("documented yearless VesselFinder ETA uses observation-year UTC rollover", () => {
  assert.equal(vesselFinderEta("01-01 13:00", "2030-01-01T11:59:30Z"), "2030-01-01T13:00:00.000Z");
  assert.equal(vesselFinderEta("01-01 03:00", "2029-12-31T23:00:00Z"), "2030-01-01T03:00:00.000Z");
  assert.equal(vesselFinderEta("12-31 23:00", "2030-01-01T01:00:00Z"), "2029-12-31T23:00:00.000Z");
  assert.equal(vesselFinderEta("02-29 03:00", "2032-02-28T23:00:00Z"), "2032-02-29T03:00:00.000Z");
});

test("missing, invalid or undocumented ETA formats are not guessed", () => {
  for (const eta of [null, "", "00-00 00:00", "02-30 13:00", "01-01 24:00", "01-01 13:60", "13-01 13:00", "2030-01-01T13:00:00Z"]) {
    assert.equal(vesselFinderEta(eta, "2030-01-01T12:00:00Z"), null);
  }
  assert.equal(vesselFinderEta("01-01 13:00", null), null);
  assert.equal(vesselFinderEta("01-01 13:00", "invalid"), null);
});