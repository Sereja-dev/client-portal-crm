import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@paddle/paddle-node-sdk";
import { createPaddleBillingProvider, PaddleAdapterError } from "@/lib/billing/provider/paddle-provider";
import type { PaddleSdkClient } from "@/lib/billing/provider/paddle-client";
import type { PaddleProviderConfig } from "@/lib/billing/provider/paddle-config";

// src/lib/billing/provider/paddle-provider.ts (transitively, via
// paddle-client.ts) imports the real "server-only" marker package — see
// test/unit/billing-provider-availability.test.ts's own header comment
// for why this needs neutralizing here rather than disabling the guard
// globally.
vi.mock("server-only", () => ({}));

const ORG_ID = "11111111-1111-1111-1111-111111111111";

const CONFIG: PaddleProviderConfig = {
  environment: "sandbox",
  apiKey: "test-api-key",
  webhookSecret: "test-webhook-secret",
  priceIdByPlanKey: {
    STARTER: "pri_test_starter",
    PRO: "pri_test_pro",
  },
};

/** No network, no real SDK instance — every test injects this in place of a real Paddle client via createPaddleBillingProvider's own DI parameter. */
function fakeSdkClient(overrides: Partial<PaddleSdkClient> = {}): PaddleSdkClient {
  return {
    transactions: { create: vi.fn() },
    customerPortalSessions: { create: vi.fn() },
    ...overrides,
  } as PaddleSdkClient;
}

describe("createPaddleBillingProvider", () => {
  it("reports kind: 'paddle' and name: 'PADDLE'", () => {
    const provider = createPaddleBillingProvider(CONFIG, fakeSdkClient());
    expect(provider.kind).toBe("paddle");
    expect(provider.name).toBe("PADDLE");
  });

  describe("createCheckoutSession", () => {
    it("resolves STARTER to its own configured price id", async () => {
      const create = vi.fn().mockResolvedValue({ checkout: { url: "https://checkout.paddle.com/txn_1" } });
      const provider = createPaddleBillingProvider(CONFIG, fakeSdkClient({ transactions: { create } }));

      await provider.createCheckoutSession({
        organizationId: ORG_ID,
        planKey: "STARTER",
        returnUrl: "/settings/billing?checkout=success",
        cancelUrl: "/settings/billing?checkout=canceled",
        existingProviderCustomerId: null,
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ items: [{ priceId: "pri_test_starter", quantity: 1 }] }),
      );
    });

    it("resolves PRO to its own, distinct configured price id", async () => {
      const create = vi.fn().mockResolvedValue({ checkout: { url: "https://checkout.paddle.com/txn_2" } });
      const provider = createPaddleBillingProvider(CONFIG, fakeSdkClient({ transactions: { create } }));

      await provider.createCheckoutSession({
        organizationId: ORG_ID,
        planKey: "PRO",
        returnUrl: "/settings/billing?checkout=success",
        cancelUrl: "/settings/billing?checkout=canceled",
        existingProviderCustomerId: null,
      });

      expect(create).toHaveBeenCalledWith(expect.objectContaining({ items: [{ priceId: "pri_test_pro", quantity: 1 }] }));
    });

    it("always requests quantity: 1", async () => {
      const create = vi.fn().mockResolvedValue({ checkout: { url: "https://checkout.paddle.com/txn_3" } });
      const provider = createPaddleBillingProvider(CONFIG, fakeSdkClient({ transactions: { create } }));

      await provider.createCheckoutSession({
        organizationId: ORG_ID,
        planKey: "STARTER",
        returnUrl: "/x",
        cancelUrl: "/y",
        existingProviderCustomerId: null,
      });

      const [request] = create.mock.calls[0];
      expect(request.items[0].quantity).toBe(1);
    });

    it("passes existingProviderCustomerId as customerId when present — reuses the existing provider customer, never creates a second one", async () => {
      const create = vi.fn().mockResolvedValue({ checkout: { url: "https://checkout.paddle.com/txn_4" } });
      const provider = createPaddleBillingProvider(CONFIG, fakeSdkClient({ transactions: { create } }));

      await provider.createCheckoutSession({
        organizationId: ORG_ID,
        planKey: "STARTER",
        returnUrl: "/x",
        cancelUrl: "/y",
        existingProviderCustomerId: "ctm_existing_123",
      });

      expect(create).toHaveBeenCalledWith(expect.objectContaining({ customerId: "ctm_existing_123" }));
    });

    it("omits customerId entirely when existingProviderCustomerId is null — never sends null/undefined, lets Paddle resolve/create the customer itself", async () => {
      const create = vi.fn().mockResolvedValue({ checkout: { url: "https://checkout.paddle.com/txn_5" } });
      const provider = createPaddleBillingProvider(CONFIG, fakeSdkClient({ transactions: { create } }));

      await provider.createCheckoutSession({
        organizationId: ORG_ID,
        planKey: "STARTER",
        returnUrl: "/x",
        cancelUrl: "/y",
        existingProviderCustomerId: null,
      });

      const [request] = create.mock.calls[0];
      expect(Object.prototype.hasOwnProperty.call(request, "customerId")).toBe(false);
    });

    it("embeds organizationId as customData, so a future webhook can recover which organization a delivered event is about", async () => {
      const create = vi.fn().mockResolvedValue({ checkout: { url: "https://checkout.paddle.com/txn_6" } });
      const provider = createPaddleBillingProvider(CONFIG, fakeSdkClient({ transactions: { create } }));

      await provider.createCheckoutSession({
        organizationId: ORG_ID,
        planKey: "STARTER",
        returnUrl: "/x",
        cancelUrl: "/y",
        existingProviderCustomerId: null,
      });

      expect(create).toHaveBeenCalledWith(expect.objectContaining({ customData: { organizationId: ORG_ID } }));
    });

    it("returns the hosted checkout URL from a successful transaction", async () => {
      const create = vi.fn().mockResolvedValue({ checkout: { url: "https://checkout.paddle.com/txn_7" } });
      const provider = createPaddleBillingProvider(CONFIG, fakeSdkClient({ transactions: { create } }));

      const session = await provider.createCheckoutSession({
        organizationId: ORG_ID,
        planKey: "STARTER",
        returnUrl: "/x",
        cancelUrl: "/y",
        existingProviderCustomerId: null,
      });

      expect(session).toEqual({ url: "https://checkout.paddle.com/txn_7" });
    });

    it("fails closed with a controlled error when the plan key has no configured price id", async () => {
      const create = vi.fn();
      const provider = createPaddleBillingProvider(CONFIG, fakeSdkClient({ transactions: { create } }));

      await expect(
        provider.createCheckoutSession({
          organizationId: ORG_ID,
          planKey: "LEGACY",
          returnUrl: "/x",
          cancelUrl: "/y",
          existingProviderCustomerId: null,
        }),
      ).rejects.toThrow(PaddleAdapterError);
      expect(create).not.toHaveBeenCalled();
    });

    it("fails closed with a controlled error when Paddle returns a transaction with no checkout URL", async () => {
      const create = vi.fn().mockResolvedValue({ checkout: null });
      const provider = createPaddleBillingProvider(CONFIG, fakeSdkClient({ transactions: { create } }));

      await expect(
        provider.createCheckoutSession({
          organizationId: ORG_ID,
          planKey: "STARTER",
          returnUrl: "/x",
          cancelUrl: "/y",
          existingProviderCustomerId: null,
        }),
      ).rejects.toThrow(PaddleAdapterError);
    });

    it("fails closed with a controlled error, never the raw SDK error, when the SDK call throws", async () => {
      const sdkError = new ApiError({ type: "request_error", code: "not_found", detail: "not found", documentation_url: "" }, null);
      const create = vi.fn().mockRejectedValue(sdkError);
      const provider = createPaddleBillingProvider(CONFIG, fakeSdkClient({ transactions: { create } }));

      let caught: unknown;
      try {
        await provider.createCheckoutSession({
          organizationId: ORG_ID,
          planKey: "STARTER",
          returnUrl: "/x",
          cancelUrl: "/y",
          existingProviderCustomerId: null,
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(PaddleAdapterError);
      expect((caught as PaddleAdapterError).code).toBe("not_found");
      expect((caught as PaddleAdapterError).message).not.toContain("test-api-key");
      expect(JSON.stringify(caught)).not.toContain("test-api-key");
    });
  });

  describe("createCustomerPortalSession", () => {
    it("passes providerCustomerId through to the SDK call", async () => {
      const create = vi.fn().mockResolvedValue({ urls: { general: { overview: "https://portal.paddle.com/abc" } } });
      const provider = createPaddleBillingProvider(CONFIG, fakeSdkClient({ customerPortalSessions: { create } }));

      await provider.createCustomerPortalSession({
        organizationId: ORG_ID,
        providerCustomerId: "ctm_abc123",
        returnUrl: "/settings/billing",
      });

      expect(create).toHaveBeenCalledWith("ctm_abc123", []);
    });

    it("returns the hosted customer portal URL", async () => {
      const create = vi.fn().mockResolvedValue({ urls: { general: { overview: "https://portal.paddle.com/xyz" } } });
      const provider = createPaddleBillingProvider(CONFIG, fakeSdkClient({ customerPortalSessions: { create } }));

      const session = await provider.createCustomerPortalSession({
        organizationId: ORG_ID,
        providerCustomerId: "ctm_abc123",
        returnUrl: "/settings/billing",
      });

      expect(session).toEqual({ url: "https://portal.paddle.com/xyz" });
    });

    it("fails closed with a controlled error when Paddle returns no overview URL", async () => {
      const create = vi.fn().mockResolvedValue({ urls: { general: { overview: "" } } });
      const provider = createPaddleBillingProvider(CONFIG, fakeSdkClient({ customerPortalSessions: { create } }));

      await expect(
        provider.createCustomerPortalSession({
          organizationId: ORG_ID,
          providerCustomerId: "ctm_abc123",
          returnUrl: "/settings/billing",
        }),
      ).rejects.toThrow(PaddleAdapterError);
    });

    it("fails closed with a controlled error, never the raw SDK error, when the SDK call throws", async () => {
      const sdkError = new ApiError({ type: "request_error", code: "not_found", detail: "not found", documentation_url: "" }, null);
      const create = vi.fn().mockRejectedValue(sdkError);
      const provider = createPaddleBillingProvider(CONFIG, fakeSdkClient({ customerPortalSessions: { create } }));

      let caught: unknown;
      try {
        await provider.createCustomerPortalSession({
          organizationId: ORG_ID,
          providerCustomerId: "ctm_abc123",
          returnUrl: "/settings/billing",
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(PaddleAdapterError);
      expect((caught as PaddleAdapterError).code).toBe("not_found");
      expect((caught as PaddleAdapterError).message).not.toContain("test-webhook-secret");
    });
  });

  describe("webhook placeholders (E2.3 scope — real verification/parsing is a later PR)", () => {
    it("verifyWebhook always fails closed with a safe, generic reason", () => {
      const provider = createPaddleBillingProvider(CONFIG, fakeSdkClient());

      const result = provider.verifyWebhook({ rawBody: "{}", headers: new Headers() });

      expect(result).toEqual({ verified: false, reason: "not_implemented" });
    });

    it("parseWebhookEvent always returns null", () => {
      const provider = createPaddleBillingProvider(CONFIG, fakeSdkClient());

      expect(provider.parseWebhookEvent('{"event_type":"subscription.created"}')).toBeNull();
    });
  });

  describe("security", () => {
    it("never logs the api key or webhook secret across the full checkout + portal + webhook-placeholder surface", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const create = vi.fn().mockResolvedValue({ checkout: { url: "https://checkout.paddle.com/txn_8" } });
      const portalCreate = vi.fn().mockResolvedValue({ urls: { general: { overview: "https://portal.paddle.com/abc" } } });
      const provider = createPaddleBillingProvider(
        CONFIG,
        fakeSdkClient({ transactions: { create }, customerPortalSessions: { create: portalCreate } }),
      );

      await provider.createCheckoutSession({
        organizationId: ORG_ID,
        planKey: "STARTER",
        returnUrl: "/x",
        cancelUrl: "/y",
        existingProviderCustomerId: null,
      });
      await provider.createCustomerPortalSession({
        organizationId: ORG_ID,
        providerCustomerId: "ctm_abc123",
        returnUrl: "/settings/billing",
      });
      provider.verifyWebhook({ rawBody: "{}", headers: new Headers() });
      provider.parseWebhookEvent("{}");

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("makes no real network call — every SDK method used in these tests is this file's own fake, never the real @paddle/paddle-node-sdk client", async () => {
      const create = vi.fn().mockResolvedValue({ checkout: { url: "https://checkout.paddle.com/txn_9" } });
      const client = fakeSdkClient({ transactions: { create } });
      const provider = createPaddleBillingProvider(CONFIG, client);

      await provider.createCheckoutSession({
        organizationId: ORG_ID,
        planKey: "STARTER",
        returnUrl: "/x",
        cancelUrl: "/y",
        existingProviderCustomerId: null,
      });

      expect(create).toHaveBeenCalledTimes(1);
    });
  });
});
