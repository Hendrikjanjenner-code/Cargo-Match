import assert from "node:assert/strict";
import test from "node:test";

import {
  MarineTrafficConnector,
  type AisProviderRequest,
} from "../src/services/ais";

const now = new Date("2030-01-01T12:00:00.000Z");
const request: AisProviderRequest = {
  vessel: {
    vesselId: "3f86b76f-cd02-4e6e-9a5d-3ac2d6ef5c2a",
    externalIdentifiers: [
      {
        identifierType: "MARINETRAFFIC_ID",
        identifierValue: "713139",
        provider: "marinetraffic",
        verified: true,
      },
    ],
  },
  requiredCapabilities: ["LIVE_POSITION", "VESSEL_LOOKUP"],
  now,
};

function fakeFetch(body: unknown, status = 200, onUrl?: (url: URL) => void) {
  return async (input: string | URL): Promise<Response> => {
    onUrl?.(new URL(String(input)));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

const fixture = [
  {
    MMSI: "538003913",
    IMO: "9470959",
    SHIP_ID: "713139",
    LAT: "37.388430",
    LON: "23.871230",
    SPEED: "6",
    HEADING: "104",
    COURSE: "41",
    STATUS: "0",
    TIMESTAMP: "2030-01-01T11:59:44.000Z",
    DSRC: "TER",
    SHIPNAME: "FIXTURE SUNNY STAR",
    DRAUGHT: "95",
    DESTINATION: "FOR ORDERS",
    ETA: "2030-01-01T13:00:00.000Z",
  },
];

test("MarineTraffic exportvessel fixture uses the documented v6 request", async () => {
  let requestedUrl: URL | undefined;
  const connector = new MarineTrafficConnector({
    apiKey: "fixture-key",
    fetch: fakeFetch(fixture, 200, (url) => {
      requestedUrl = url;
    }),
  });
  const result = await connector.lookup(request);
  assert.equal(result.kind, "success");
  assert.equal(requestedUrl?.pathname, "/api/exportvessel/fixture-key");
  assert.equal(requestedUrl?.searchParams.get("v"), "6");
  assert.equal(requestedUrl?.searchParams.get("shipid"), "713139");
  assert.equal(requestedUrl?.searchParams.get("protocol"), "jsono");
  assert.equal(requestedUrl?.searchParams.get("timespan"), "5");
  if (result.kind !== "success") return;

  const normalized = connector.normalize(result.observation, now, request);
  assert.equal(normalized?.providerVesselId, "713139");
  assert.equal(normalized?.mmsi, "538003913");
  assert.equal(normalized?.imo, "9470959");
  assert.equal(normalized?.speedKnots, 0.6);
  assert.equal(normalized?.reportedDraughtMeters, null);
  assert.equal(normalized?.headingDegrees, 104);
  assert.equal(normalized?.sourceType, "TER");
});

test("MarineTraffic exact ship ID mismatch is rejected", async () => {
  const connector = new MarineTrafficConnector({
    apiKey: "fixture-key",
    fetch: fakeFetch([{ ...fixture[0], SHIP_ID: "713140" }]),
  });
  assert.deepEqual(await connector.lookup(request), {
    kind: "identifier_mismatch",
  });
});

test("MarineTraffic rejects a mapped MMSI conflict even when ship ID matches", async () => {
  const connector = new MarineTrafficConnector({
    apiKey: "fixture-key",
    fetch: fakeFetch(fixture),
  });
  const result = await connector.lookup({
    ...request,
    vessel: {
      ...request.vessel,
      externalIdentifiers: [
        ...(request.vessel.externalIdentifiers ?? []),
        {
          identifierType: "MMSI",
          identifierValue: "538003999",
          provider: "vesselfinder",
          verified: true,
        },
      ],
    },
  });
  assert.deepEqual(result, { kind: "identifier_mismatch" });
});

test("MarineTraffic preserves malformed JSON shape for manager normalization", async () => {
  const connector = new MarineTrafficConnector({
    apiKey: "fixture-key",
    fetch: fakeFetch({ unexpected: true }),
  });
  const result = await connector.lookup(request);
  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.equal(connector.normalize(result.observation, now, request), null);
});

test("MarineTraffic documented status errors are bounded and missing key is fail-closed", async () => {
  const rateLimited = new MarineTrafficConnector({
    apiKey: "fixture-key",
    fetch: fakeFetch({ error: "limit" }, 429),
  });
  assert.deepEqual(await rateLimited.lookup(request), { kind: "rate_limited" });

  const noKey = new MarineTrafficConnector({
    fetch: fakeFetch(fixture),
  });
  assert.deepEqual(await noKey.lookup(request), {
    kind: "authentication_failed",
  });
});