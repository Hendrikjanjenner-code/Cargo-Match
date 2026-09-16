/** Origins supplied by deployment configuration, never by request headers. */
export function configuredOrigins(): Set<string> {
  const domains = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map(domain => domain.trim())
    .filter(domain => /^[a-z0-9.-]+(?::\d+)?$/i.test(domain))
    .map(domain => `https://${domain}`);
  return new Set([
    process.env.APP_ORIGIN,
    ...domains,
    process.env.REPLIT_DEV_DOMAIN && `https://${process.env.REPLIT_DEV_DOMAIN}`,
  ].filter((origin): origin is string => Boolean(origin)));
}