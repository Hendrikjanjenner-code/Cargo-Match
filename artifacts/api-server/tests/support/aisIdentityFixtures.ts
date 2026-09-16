export function aisIdentityEvidence(source = "test-registry") {
  return {
    source,
    reference: `fixture://${source}/identity-check`,
    notes: "Fixture evidence for a tenant-scoped integration test.",
    capturedAt: "2030-01-01T00:00:00.000Z",
  };
}

export function aisIdentityPayload(
  identifierValue: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    identifierType: "MMSI",
    identifierValue,
    verified: false,
    ...overrides,
  };
}
