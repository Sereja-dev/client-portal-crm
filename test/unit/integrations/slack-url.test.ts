import { describe, it, expect } from "vitest";
import { validateSlackWebhookUrl } from "@/lib/integrations/slack-url";

const VALID = "https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXXXXXXXXXX";

describe("integrations/slack-url", () => {
  it("accepts a well-formed commercial Slack Incoming Webhook URL", () => {
    const result = validateSlackWebhookUrl(VALID);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.canonicalUrl).toBe(VALID);
  });

  it("accepts an explicit :443 port", () => {
    const result = validateSlackWebhookUrl("https://hooks.slack.com:443/services/T000/B000/XXXX");
    expect(result.valid).toBe(true);
  });

  it("rejects http://", () => {
    const result = validateSlackWebhookUrl("http://hooks.slack.com/services/T000/B000/XXXX");
    expect(result).toEqual({ valid: false, reason: "not_https" });
  });

  it("rejects a userinfo component", () => {
    const result = validateSlackWebhookUrl("https://user:pass@hooks.slack.com/services/T000/B000/XXXX");
    expect(result).toEqual({ valid: false, reason: "has_userinfo" });
  });

  it("rejects a # fragment", () => {
    const result = validateSlackWebhookUrl("https://hooks.slack.com/services/T000/B000/XXXX#frag");
    expect(result).toEqual({ valid: false, reason: "has_fragment" });
  });

  it("rejects a non-allowlisted host", () => {
    const result = validateSlackWebhookUrl("https://example.com/services/T000/B000/XXXX");
    expect(result).toEqual({ valid: false, reason: "disallowed_host" });
  });

  it("rejects a suffix-attack host (hooks.slack.com.evil.example)", () => {
    const result = validateSlackWebhookUrl("https://hooks.slack.com.evil.example/services/T000/B000/XXXX");
    expect(result).toEqual({ valid: false, reason: "disallowed_host" });
  });

  it("rejects a subdomain-prefix attack host (evil-hooks.slack.com)", () => {
    const result = validateSlackWebhookUrl("https://evil-hooks.slack.com/services/T000/B000/XXXX");
    expect(result).toEqual({ valid: false, reason: "disallowed_host" });
  });

  it("rejects GovSlack (slack-gov.com) — explicitly out of scope for V1", () => {
    const result = validateSlackWebhookUrl("https://hooks.slack-gov.com/services/T000/B000/XXXX");
    expect(result).toEqual({ valid: false, reason: "disallowed_host" });
  });

  it("rejects a literal IP host", () => {
    const result = validateSlackWebhookUrl("https://93.184.216.34/services/T000/B000/XXXX");
    expect(result).toEqual({ valid: false, reason: "disallowed_host" });
  });

  it("rejects localhost", () => {
    const result = validateSlackWebhookUrl("https://localhost/services/T000/B000/XXXX");
    expect(result).toEqual({ valid: false, reason: "disallowed_host" });
  });

  it("rejects a non-standard port", () => {
    const result = validateSlackWebhookUrl("https://hooks.slack.com:8443/services/T000/B000/XXXX");
    expect(result).toEqual({ valid: false, reason: "disallowed_port" });
  });

  it("rejects a path that doesn't start with /services/", () => {
    const result = validateSlackWebhookUrl("https://hooks.slack.com/oauth/authorize");
    expect(result).toEqual({ valid: false, reason: "invalid_path" });
  });

  it("rejects a bare /services/ with nothing after it", () => {
    const result = validateSlackWebhookUrl("https://hooks.slack.com/services/");
    expect(result).toEqual({ valid: false, reason: "invalid_path" });
  });

  it("rejects a malformed URL string", () => {
    const result = validateSlackWebhookUrl("not a url");
    expect(result).toEqual({ valid: false, reason: "malformed_url" });
  });

  it("normalizes hostname case", () => {
    const result = validateSlackWebhookUrl("https://HOOKS.SLACK.COM/services/T000/B000/XXXX");
    expect(result.valid).toBe(true);
  });
});
