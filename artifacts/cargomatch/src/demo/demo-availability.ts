declare const __CARGOMATCH_DEMO_ENABLED__: boolean;
// Replaced by Vite from its server-side environment, not a browser preference.
export const DEMO_UI_ENABLED = typeof __CARGOMATCH_DEMO_ENABLED__ !== "undefined" && __CARGOMATCH_DEMO_ENABLED__;