type MatchConsent = {
  status: string;
  ownSide: "CARGO" | "CAPACITY";
  leftConsent?: boolean;
  rightConsent?: boolean;
};
export function consentControls(match: MatchConsent, permissions: readonly string[]) {
  const own = match.ownSide === "CARGO" ? !!match.leftConsent : !!match.rightConsent;
  const other = match.ownSide === "CARGO" ? !!match.rightConsent : !!match.leftConsent;
  const incoming = match.status === "INTEREST_SENT" && other && !own;
  return {
    interest: match.status === "NEW" && !own && !other && permissions.includes("SHOW_INTEREST"),
    accept: incoming && permissions.includes("ACCEPT_CONNECTION"),
    decline: incoming && permissions.includes("DECLINE_CONNECTION"),
    waiting: match.status === "INTEREST_SENT" && own && !other,
  };
}