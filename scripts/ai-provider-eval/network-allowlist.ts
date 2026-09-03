/**
 * Isolated Aqenra AI provider benchmark harness — mechanical outbound
 * network guard.
 *
 * The two official SDKs own their own HTTP transport internally, so this
 * guard works by asserting the SDK's own configured `baseURL` before a
 * client is ever constructed — not by trying to intercept every fetch
 * call inside a vendor SDK's own dependency tree. Combined with §18's
 * secret handling (the SDK is never given a key until this assertion
 * passes) and §35's design intent, this makes "the harness silently
 * talks to some other host" a build-time-checkable, not just
 * documented, guarantee.
 */

const ALLOWED_HOSTS = ["api.anthropic.com", "api.openai.com"] as const;

export class DisallowedNetworkHostError extends Error {
  constructor(host: string) {
    super(
      `Refusing to configure a provider client against host "${host}" — only ${ALLOWED_HOSTS.join(" and ")} are permitted by this benchmark harness (see network-allowlist.ts). No environment variable may override this.`,
    );
    this.name = "DisallowedNetworkHostError";
  }
}

/**
 * Throws unless `url` is exactly one of the allowed hosts (scheme
 * `https:`, no credentials, no arbitrary path/port). Deliberately does
 * NOT read any environment variable for an override — see README.md's
 * own "Allowed network hosts" section for why a host override is
 * refused by design, not merely undocumented.
 */
export function assertAllowedProviderHost(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DisallowedNetworkHostError(url);
  }
  if (parsed.protocol !== "https:") {
    throw new DisallowedNetworkHostError(url);
  }
  if (!(ALLOWED_HOSTS as readonly string[]).includes(parsed.hostname)) {
    throw new DisallowedNetworkHostError(parsed.hostname);
  }
}

export function getAllowedHosts(): readonly string[] {
  return ALLOWED_HOSTS;
}
