import { describe, expect, it, vi } from "vitest";
import {
  parseArgs,
  validateOperatorEnv,
  isAllowlistedPlatformAdminEmail,
  validatePasswordInput,
  rotatePlatformAdminPassword,
  findUserIdByEmail,
  updateUserPassword,
  REQUIRED_ENV_VARS,
  MIN_PASSWORD_LENGTH,
} from "../../scripts/platform-admin-set-password.mjs";

/**
 * Platform Admin Credential / Recovery Hardening. Covers
 * scripts/platform-admin-set-password.mjs entirely through dependency
 * injection, mirroring test/unit/prisma-production-helper.test.ts's own
 * conventions exactly — no real Postgres, no real Supabase, no real
 * password, and no real terminal/TTY is ever touched here. Every
 * fixture below is a synthetic sentinel value.
 */

const VALID_ENV = {
  PLATFORM_ADMIN_EMAILS: "owner@example.com, Second.Admin@Example.com ",
  NEXT_PUBLIC_SUPABASE_URL: "https://sentinel.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "sentinel-service-role-key",
  DATABASE_URL: "postgres://sentinel-db-value",
};

describe("REQUIRED_ENV_VARS", () => {
  it("is exactly the four already-existing application env var names -- no new runtime configuration is introduced", () => {
    expect(REQUIRED_ENV_VARS).toEqual([
      "PLATFORM_ADMIN_EMAILS",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "DATABASE_URL",
    ]);
  });
});

describe("parseArgs", () => {
  it("1. missing --email fails", () => {
    const result = parseArgs([]);
    expect(result.ok).toBe(false);
  });

  it("fails on a blank --email value", () => {
    const result = parseArgs(["--email", "   "]);
    expect(result.ok).toBe(false);
  });

  it("fails on more than one --email value -- never guesses which target was meant", () => {
    const result = parseArgs(["--email", "a@example.com", "--email", "b@example.com"]);
    expect(result.ok).toBe(false);
  });

  it("accepts the '--email value' form, normalized (trimmed, lowercased)", () => {
    const result = parseArgs(["--email", "  Owner@Example.com  "]);
    expect(result).toEqual({ ok: true, email: "owner@example.com" });
  });

  it("accepts the '--email=value' form, normalized", () => {
    const result = parseArgs(["--email=Owner@Example.com"]);
    expect(result).toEqual({ ok: true, email: "owner@example.com" });
  });
});

describe("validateOperatorEnv", () => {
  it("4. fails closed when a required operator environment variable is missing, naming it but never a value", () => {
    const incomplete = {
      PLATFORM_ADMIN_EMAILS: VALID_ENV.PLATFORM_ADMIN_EMAILS,
      NEXT_PUBLIC_SUPABASE_URL: VALID_ENV.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: VALID_ENV.SUPABASE_SERVICE_ROLE_KEY,
    };
    const result = validateOperatorEnv(incomplete);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error).toContain("DATABASE_URL");
    expect(result.error).not.toContain(VALID_ENV.SUPABASE_SERVICE_ROLE_KEY);
  });

  it("passes when every required variable is present", () => {
    expect(validateOperatorEnv(VALID_ENV)).toEqual({ ok: true });
  });
});

describe("isAllowlistedPlatformAdminEmail", () => {
  it("3. matches case-insensitively and trims whitespace, mirroring the real allowlist's own parsing exactly", () => {
    expect(isAllowlistedPlatformAdminEmail("second.admin@example.com", VALID_ENV.PLATFORM_ADMIN_EMAILS)).toBe(true);
    expect(isAllowlistedPlatformAdminEmail("owner@example.com", VALID_ENV.PLATFORM_ADMIN_EMAILS)).toBe(true);
  });

  it("returns false for an email not in the allowlist", () => {
    expect(isAllowlistedPlatformAdminEmail("ordinary-staff@example.com", VALID_ENV.PLATFORM_ADMIN_EMAILS)).toBe(false);
  });

  it("returns false for an empty/undefined allowlist value", () => {
    expect(isAllowlistedPlatformAdminEmail("owner@example.com", "")).toBe(false);
    expect(isAllowlistedPlatformAdminEmail("owner@example.com", undefined)).toBe(false);
  });
});

describe("validatePasswordInput", () => {
  it("6. fails on a confirmation mismatch", () => {
    const result = validatePasswordInput("a-long-enough-password", "a-different-password");
    expect(result.ok).toBe(false);
  });

  it(`fails below the ${MIN_PASSWORD_LENGTH}-character floor -- the same floor the app's own self-service reset enforces`, () => {
    const result = validatePasswordInput("short1", "short1");
    expect(result.ok).toBe(false);
  });

  it("fails when either prompt is empty", () => {
    expect(validatePasswordInput("", "").ok).toBe(false);
  });

  it("succeeds when both entries are equal and long enough", () => {
    const result = validatePasswordInput("a-long-enough-password", "a-long-enough-password");
    expect(result).toEqual({ ok: true, password: "a-long-enough-password" });
  });
});

/** Builds a fully-mocked deps object; every call recorded so each test can assert exactly which ones ran. */
function makeDeps(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    findUserIdByEmail: vi.fn(async () => "11111111-1111-1111-1111-111111111111"),
    confirmAction: vi.fn(async () => true),
    promptPassword: vi.fn(async () => ({ password: "a-long-enough-password", confirmPassword: "a-long-enough-password" })),
    updateUserPassword: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

describe("rotatePlatformAdminPassword — orchestration", () => {
  it("2 & 9. target not in PLATFORM_ADMIN_EMAILS fails before ANY lookup/mutation dependency runs -- an ordinary Staff email can never reach updateUserById through this tool", async () => {
    const deps = makeDeps();
    const result = await rotatePlatformAdminPassword({
      targetEmail: "ordinary-staff@example.com",
      env: VALID_ENV,
      deps,
    });

    expect(result.ok).toBe(false);
    expect(deps.findUserIdByEmail).not.toHaveBeenCalled();
    expect(deps.confirmAction).not.toHaveBeenCalled();
    expect(deps.promptPassword).not.toHaveBeenCalled();
    expect(deps.updateUserPassword).not.toHaveBeenCalled();
  });

  it("4. missing required operator environment fails closed before the allowlist check or any dependency runs", async () => {
    const incompleteEnv = {
      PLATFORM_ADMIN_EMAILS: VALID_ENV.PLATFORM_ADMIN_EMAILS,
      NEXT_PUBLIC_SUPABASE_URL: VALID_ENV.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: VALID_ENV.SUPABASE_SERVICE_ROLE_KEY,
    };
    const deps = makeDeps();
    const result = await rotatePlatformAdminPassword({
      targetEmail: "owner@example.com",
      env: incompleteEnv,
      deps,
    });

    expect(result.ok).toBe(false);
    expect(deps.findUserIdByEmail).not.toHaveBeenCalled();
  });

  it("5. target User not found fails, and no confirmation/password prompt or mutation ever runs", async () => {
    const deps = makeDeps({ findUserIdByEmail: vi.fn(async () => null) });
    const result = await rotatePlatformAdminPassword({
      targetEmail: "owner@example.com",
      env: VALID_ENV,
      deps,
    });

    expect(result.ok).toBe(false);
    expect(deps.confirmAction).not.toHaveBeenCalled();
    expect(deps.updateUserPassword).not.toHaveBeenCalled();
  });

  it("declining the confirmation prompt cancels before any password prompt or mutation", async () => {
    const deps = makeDeps({ confirmAction: vi.fn(async () => false) });
    const result = await rotatePlatformAdminPassword({
      targetEmail: "owner@example.com",
      env: VALID_ENV,
      deps,
    });

    expect(result.ok).toBe(false);
    expect(deps.promptPassword).not.toHaveBeenCalled();
    expect(deps.updateUserPassword).not.toHaveBeenCalled();
  });

  it("6. a password confirmation mismatch fails, and the mutation never runs", async () => {
    const deps = makeDeps({
      promptPassword: vi.fn(async () => ({ password: "a-long-enough-password", confirmPassword: "does-not-match" })),
    });
    const result = await rotatePlatformAdminPassword({
      targetEmail: "owner@example.com",
      env: VALID_ENV,
      deps,
    });

    expect(result.ok).toBe(false);
    expect(deps.updateUserPassword).not.toHaveBeenCalled();
  });

  it("7 & 8. the successful path resolves the exact target User.id and calls updateUserPassword with that id and the entered password", async () => {
    const deps = makeDeps();
    const result = await rotatePlatformAdminPassword({
      targetEmail: "owner@example.com",
      env: VALID_ENV,
      deps,
    });

    expect(result).toEqual({ ok: true, email: "owner@example.com" });
    expect(deps.findUserIdByEmail).toHaveBeenCalledWith("owner@example.com");
    expect(deps.updateUserPassword).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      "a-long-enough-password",
    );
  });

  it("10. a Supabase-reported failure is surfaced as a sanitized, generic failure -- never the raw provider error/response", async () => {
    const deps = makeDeps({ updateUserPassword: vi.fn(async () => ({ ok: false })) });
    const result = await rotatePlatformAdminPassword({
      targetEmail: "owner@example.com",
      env: VALID_ENV,
      deps,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error).not.toMatch(/token|key|stack|at Object/i);
  });

  it("a thrown promptPassword (e.g. no real TTY) is caught and surfaced as a plain failure, never an unhandled rejection", async () => {
    const deps = makeDeps({
      promptPassword: vi.fn(async () => {
        throw new Error("A real interactive terminal is required to enter a password. Refusing to proceed.");
      }),
    });
    const result = await rotatePlatformAdminPassword({
      targetEmail: "owner@example.com",
      env: VALID_ENV,
      deps,
    });

    expect(result.ok).toBe(false);
    expect(deps.updateUserPassword).not.toHaveBeenCalled();
  });

  it("12. the password is never present anywhere in a failure result's own error string", async () => {
    const deps = makeDeps({ updateUserPassword: vi.fn(async () => ({ ok: false })) });
    const result = await rotatePlatformAdminPassword({
      targetEmail: "owner@example.com",
      env: VALID_ENV,
      deps,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error).not.toContain("a-long-enough-password");
  });
});

describe("findUserIdByEmail (real-lookup shape, via an injected fake pg client)", () => {
  it("queries by exact normalized email and returns the matching id", async () => {
    const fakeClient = { connect: vi.fn(), query: vi.fn(async () => ({ rows: [{ id: "resolved-id" }] })), end: vi.fn() };
    const createPgClient = vi.fn(() => fakeClient);

    const result = await findUserIdByEmail("owner@example.com", VALID_ENV, { createPgClient });

    expect(result).toBe("resolved-id");
    expect(createPgClient).toHaveBeenCalledWith(VALID_ENV.DATABASE_URL);
    expect(fakeClient.query).toHaveBeenCalledWith('SELECT id FROM "User" WHERE email = $1 LIMIT 1', [
      "owner@example.com",
    ]);
  });

  it("returns null on zero rows -- never auto-creates anything", async () => {
    const fakeClient = { connect: vi.fn(), query: vi.fn(async () => ({ rows: [] })), end: vi.fn() };
    const result = await findUserIdByEmail("nobody@example.com", VALID_ENV, { createPgClient: () => fakeClient });
    expect(result).toBeNull();
  });

  it("11. always closes the connection, including when the query itself throws", async () => {
    const fakeClient = {
      connect: vi.fn(),
      query: vi.fn(async () => {
        throw new Error("simulated query failure");
      }),
      end: vi.fn(),
    };

    await expect(findUserIdByEmail("owner@example.com", VALID_ENV, { createPgClient: () => fakeClient })).rejects.toThrow();
    expect(fakeClient.end).toHaveBeenCalledTimes(1);
  });

  it("11. closes the connection exactly once on the successful path too", async () => {
    const fakeClient = { connect: vi.fn(), query: vi.fn(async () => ({ rows: [{ id: "x" }] })), end: vi.fn() };
    await findUserIdByEmail("owner@example.com", VALID_ENV, { createPgClient: () => fakeClient });
    expect(fakeClient.end).toHaveBeenCalledTimes(1);
  });
});

describe("updateUserPassword (real-mutation shape, via an injected fake Supabase admin client)", () => {
  it("8. constructs the admin client with the exact service-role env values and calls updateUserById with the resolved id and the entered password only", async () => {
    const updateUserById = vi.fn(async () => ({ data: {}, error: null }));
    const createAdminClient = vi.fn(() => ({ auth: { admin: { updateUserById } } }));

    const result = await updateUserPassword("resolved-id", "a-long-enough-password", VALID_ENV, { createAdminClient });

    expect(result).toEqual({ ok: true });
    expect(createAdminClient).toHaveBeenCalledWith(
      VALID_ENV.NEXT_PUBLIC_SUPABASE_URL,
      VALID_ENV.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    expect(updateUserById).toHaveBeenCalledWith("resolved-id", { password: "a-long-enough-password" });
  });

  it("10. a Supabase-reported error resolves to {ok:false} only -- the raw error object is never returned to any caller", async () => {
    const updateUserById = vi.fn(async () => ({ data: null, error: { message: "simulated provider failure" } }));
    const createAdminClient = vi.fn(() => ({ auth: { admin: { updateUserById } } }));

    const result = await updateUserPassword("resolved-id", "a-long-enough-password", VALID_ENV, { createAdminClient });

    expect(result).toEqual({ ok: false });
  });
});
