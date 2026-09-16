export * from "./model";
export * from "./config";
export * from "./normalize";
export * from "./mock";
export * from "./manager";

import { AISProviderManager } from "./manager";

/**
 * A single request-scoped-independent manager is safe because it only keeps a
 * bounded short-lived cache and in-flight requests. It performs no polling.
 */
export const aisProviderManager = new AISProviderManager();