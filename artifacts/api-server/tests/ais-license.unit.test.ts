import assert from "node:assert/strict";
import test from "node:test";
import { EnvironmentAisLicenseGate } from "../src/services/ais/license";
import { AIS_LICENSE_SCOPES, type AisLicenseRequest } from "../src/services/ais/model";

const now = new Date("2026-09-16T12:00:00Z");
const request: AisLicenseRequest = { tenantId: "tenant-one", provider: "vesselfinder", scopes: AIS_LICENSE_SCOPES, capabilities: ["LIVE_POSITION", "VESSEL_LOOKUP"], now };
const grant = {
  tenantId: request.tenantId, provider: request.provider, enabled: true,
  agreementReference: "fixture-contract", reviewedBy: "fixture-reviewer",
  documentedProduct: "VESSELS AIS dataset", approvedAt: "2026-09-01T00:00:00Z",
  expiresAt: "2026-10-01T00:00:00Z", scopes: AIS_LICENSE_SCOPES,
  capabilities: ["LIVE_POSITION", "VESSEL_LOOKUP"],
  retentionMode: "TRANSIENT_ONLY", redistribution: "DENIED",
  areaMonitoring: false, historicalStorage: false,
};

test("license requires explicit tenant-reviewed, unexpired contract with all rights", () => {
  const gate = new EnvironmentAisLicenseGate(() => JSON.stringify([grant]));
  assert.equal(gate.authorize(request).allowed, true);
  assert.equal(gate.authorize({ ...request, tenantId: "other-tenant" }).allowed, false);
  assert.equal(gate.authorize({ ...request, provider: "marinetraffic" }).allowed, false);
  assert.equal(gate.authorize({ ...request, capabilities: ["DESTINATION"] }).allowed, false);
  assert.equal(gate.authorize({ ...request, now: new Date(grant.expiresAt) }).allowed, false);
  for (const change of [
    { enabled: false }, { scopes: ["COMMERCIAL"] }, { reviewedBy: "" },
    { agreementReference: "" }, { documentedProduct: "" }, { capabilities: [] },
    { approvedAt: "invalid" }, { expiresAt: "invalid" },
    { approvedAt: "2030-01-01T00:00:00Z" }, { retentionMode: "PERSISTENT" },
    { redistribution: "ALLOWED" }, { historicalStorage: true }, { areaMonitoring: true },
  ]) {
    assert.equal(new EnvironmentAisLicenseGate(() => JSON.stringify([{ ...grant, ...change }])).authorize(request).allowed, false, JSON.stringify(change));
  }
});

test("malformed, absent, duplicated, and revoked policy denies without throwing", () => {
  for (const input of [undefined, "", "{", "null", "{}", JSON.stringify([grant, grant])]) {
    assert.equal(new EnvironmentAisLicenseGate(() => input).authorize(request).allowed, false);
  }
  let policy = JSON.stringify([grant]);
  const gate = new EnvironmentAisLicenseGate(() => policy);
  assert.equal(gate.authorize(request).allowed, true);
  policy = "[]";
  assert.equal(gate.authorize(request).allowed, false);
});