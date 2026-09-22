import { DemoError } from "../demo/types";
import type { CustomsProvider, PaymentProvider, DocumentIntelligenceProvider, Document } from "./types";

/** No network or credentials. A real adapter must never instantiate these with demo=false. */
export class SyntheticCustomsProvider implements CustomsProvider {
  constructor(private readonly demo: boolean) {}
  submit(_reference: string, _version: number) {
    if (!this.demo) throw new DemoError(409, "PROVIDER_UNAVAILABLE", "Synthetische douaneprovider is uitsluitend voor demo.");
    return {status: "SUBMITTED", source: "SYNTHETIC_DEMO"};
  }
}
export class SyntheticPaymentProvider implements PaymentProvider {
  constructor(private readonly demo: boolean) {}
  record(_reference: string) {
    if (!this.demo) throw new DemoError(409, "PROVIDER_UNAVAILABLE", "Synthetische betaling is uitsluitend voor demo.");
    return {status: "SIMULATED_PAID", source: "SYNTHETIC_DEMO"};
  }
}
/** Only known structured demo fixture values are supported; arbitrary PDFs require review. */
export class SyntheticDocumentIntelligence implements DocumentIntelligenceProvider {
  constructor(private readonly demo: boolean) {}
  extract(document: Document): Document["proposals"] {
    if (!this.demo || !document.fixtureId) return [];
    return Object.entries(document.fields).map(([field, value]) => ({field, value, sourceDocumentId: document.id, status: "PROPOSED"}));
  }
}