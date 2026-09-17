/**
 * Provider-independent road telemetry seam.
 *
 * The pilot intentionally has no configured provider and no subscription
 * behavior. Implementations may be added only when an explicitly authorized
 * integration is available. A telemetry signal is operational evidence, never
 * a commercial availability decision.
 */
export type RoadTelemetrySnapshot = {
  source: "TELEMATICS";
  observedAt: Date;
  latitude?: number;
  longitude?: number;
  operationalState?: "MOVING" | "STOPPED" | "DELIVERING" | "UNKNOWN";
};

export interface RoadTelematicsProvider {
  readonly providerKey: string;
  isAvailable(): boolean;
  getSnapshot(assetExternalReference: string): Promise<RoadTelemetrySnapshot | null>;
}

export class UnavailableRoadTelematicsProvider implements RoadTelematicsProvider {
  readonly providerKey = "unconfigured";
  isAvailable() {
    return false;
  }
  async getSnapshot(_assetExternalReference: string): Promise<RoadTelemetrySnapshot | null> {
    return null;
  }
}

export const roadTelematicsProvider: RoadTelematicsProvider =
  new UnavailableRoadTelematicsProvider();