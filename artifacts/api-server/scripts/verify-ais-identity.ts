import {
  revokeAisIdentityTrust,
  verifyAisIdentity,
} from "../src/services/aisIdentityVerification.js";

function requiredFlag(args: Map<string, string>, name: string): string {
  const value = args.get(name)?.trim();
  if (!value) throw new Error(`Missing required flag ${name}`);
  return value;
}

function parseFlags(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) {
      throw new Error(`Unexpected argument ${token ?? ""}`);
    }
    const name = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }
    args.set(name, value);
    index += 1;
  }
  return args;
}

async function main() {
  const args = parseFlags(process.argv.slice(2));
  const action = args.get("action") ?? "verify";
  const mapping = {
    companyId: requiredFlag(args, "company-id"),
    vesselId: requiredFlag(args, "vessel-id"),
    mappingId: requiredFlag(args, "mapping-id"),
  };
  if (action === "revoke") {
    console.log(JSON.stringify(await revokeAisIdentityTrust(mapping), null, 2));
    return;
  }
  if (action !== "verify") {
    throw new Error(`Unsupported action ${action}; use verify or revoke`);
  }
  const verified = await verifyAisIdentity({
    ...mapping,
    evidence: {
      source: requiredFlag(args, "source"),
      reference: args.get("reference"),
      notes: args.get("notes"),
      capturedAt: args.get("captured-at"),
    },
  });
  console.log(JSON.stringify(verified, null, 2));
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "AIS identity verification failed";
  console.error(message);
  process.exitCode = 1;
});
