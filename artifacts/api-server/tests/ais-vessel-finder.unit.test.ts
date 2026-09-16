import assert from "node:assert/strict";
import test from "node:test";

import {
  VesselFinderConnector,
  type AisProviderRequest,
} from "../src/services/ais";

const now = new Date("2030-01-01T12:00:00.000Z");
const request: AisProviderRequest = {
  vessel: {
    vesselId: "6b6f4f4a-86e6-4ea6-9e3c-6d8b4a4c3d10",
    externalIdentifiers: [
      {
        identifierType: "MMSI",
        identifierValue: "244000001",
        provider: "vesselfinder",
        verified: true,
      },
    ],
  },
  requiredCapabilities: ["LIVE_POSITION", "VESSEL_LOOKUP"],
  now,
};

function fakeFetch(
  body: unknown,
  status = 200,
  onUrl?: (url: URL) => void,
  onInit?: (init: RequestInit | undefined) => void,
) {
  return async (
    input: string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    onUrl?.(new URL(String(input)));
    onInit?.(init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

const fixture = [
  {
    AIS: {
      MMSI: 244000001,
      TIMESTAMP: "2030-01-01 11:59:30 UTC",
      LATITUDE: 51.9244,
      LONGITUDE: 4.4777,
      COURSE: 92,
      SPEED: 6.2,
      HEADING: 90,
      NAVSTAT: 0,
      IMO: 0,
      NAME: "FIXTURE ALPHA",
      DRAUGHT: 2.1,
      DESTINATION: "ROTTERDAM",
      ETA: "2030-01-01 13:00:00",
      ETA_AIS: "01-01 13:00",
      SRC: "TER",
    },
    MASTERDATA: {
      IMO: 0,
      NAME: "FIXTURE ALPHA",
    },
  },
];

test("VesselFinder VESSELS fixture normalizes documented AIS fields", async () => {
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;
  const signal = new AbortController().signal;
  const connector = new VesselFinderConnector({
    apiKey: "fixture-key",
    fetch: fakeFetch(fixture, 200, (url) => {
      requestedUrl = url;
    }, (init) => {
      requestedInit = init;
    }),
  });

  const result = await connector.lookup({ ...request, signal });
  assert.equal(result.kind, "success");
  assert.equal(requestedUrl?.pathname, "/vessels");
  assert.equal(requestedUrl?.searchParams.get("mmsi"), "244000001");
  assert.equal(requestedUrl?.searchParams.get("format"), "json");
  assert.equal(requestedInit?.redirect, "error");
  assert.equal(requestedInit?.signal, signal);
  if (result.kind !== "success") return;

  const normalized = connector.normalize(result.observation, now, request);
  assert.equal(normalized?.providerVesselId, null);
  assert.equal(normalized?.mmsi, "244000001");
  assert.equal(normalized?.imo, null);
  assert.equal(normalized?.latitude, 51.9244);
  assert.equal(normalized?.speedKnots, 6.2);
  assert.equal(normalized?.reportedEta, "2030-01-01T13:00:00.000Z");
  assert.equal(normalized?.sourceType, "TER");
  assert.equal(normalized?.rawDataReference, "vesselfinder:vessels:mmsi:244000001");
});

test("VesselFinder never falls back to an unverified/name-only identity", async () => {
  const connector = new VesselFinderConnector({
    apiKey: "fixture-key",
    fetch: fakeFetch(fixture),
  });
  const result = await connector.lookup({
    ...request,
    vessel: {
      vesselId: request.vessel.vesselId,
      externalIdentifiers: [
        {
          identifierType: "MMSI",
          identifierValue: "244000001",
          provider: "vesselfinder",
          verified: false,
        },
      ],
    },
  });
  assert.equal(result.kind, "identifier_unavailable");
});

test("VesselFinder rejects a response for a different exact identifier", async () => {
  const connector = new VesselFinderConnector({
    apiKey: "fixture-key",
    fetch: fakeFetch([
      {
        ...fixture[0],
        AIS: { ...fixture[0].AIS, MMSI: 244000999 },
      },
    ]),
  });
  const result = await connector.lookup(request);
  assert.equal(result.kind, "identifier_mismatch");
});

test("VesselFinder preserves malformed JSON shape for manager normalization", async () => {
  const connector = new VesselFinderConnector({
    apiKey: "fixture-key",
    fetch: fakeFetch({ unexpected: true }),
  });
  const result = await connector.lookup(request);
  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.equal(connector.normalize(result.observation, now, request), null);
});

test("VesselFinder rejects canonical mappings that conflict outside the lookup key", async () => {
  const connector = new VesselFinderConnector({
    apiKey: "fixture-key",
    fetch: fakeFetch([
      {
        AIS: {
          ...fixture[0].AIS,
          IMO: 9876543,
        },
      },
    ]),
  });
  const result = await connector.lookup({
    ...request,
    vessel: {
      ...request.vessel,
      externalIdentifiers: [
        ...(request.vessel.externalIdentifiers ?? []),
        {
          identifierType: "IMO",
          identifierValue: "1234567",
          provider: "marinetraffic",
          verified: true,
        },
      ],
    },
  });
  assert.deepEqual(result, { kind: "identifier_mismatch" });
});

test("VesselFinder rejects ambiguous canonical mappings even with provider evidence", async () => {
  const connector = new VesselFinderConnector({
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
          identifierValue: "244000002",
          provider: "marinetraffic",
          verified: true,
        },
      ],
    },
  });
  assert.deepEqual(result, { kind: "identifier_unavailable" });
});

test("VesselFinder maps authentication and rate-limit errors without leaking credentials", async () => {
  const auth = new VesselFinderConnector({
    apiKey: "secret-fixture-key",
    fetch: fakeFetch({ error: "unauthorized" }, 401),
  });
  assert.deepEqual(await auth.lookup(request), {
    kind: "authentication_failed",
  });

  const rateLimited = new VesselFinderConnector({
    apiKey: "secret-fixture-key",
    fetch: fakeFetch({ error: "limit" }, 429),
  });
  assert.deepEqual(await rateLimited.lookup(request), { kind: "rate_limited" });
});