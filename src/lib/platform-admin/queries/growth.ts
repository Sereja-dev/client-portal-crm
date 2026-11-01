import type { Prisma } from "@/generated/prisma/client";
import type { Role, SignupOrigin } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/platform-admin/authorization";
import { startOfUtcDay } from "@/lib/platform-admin/queries/platform-dashboard";
import {
  PAGE_SIZE,
  getOffset,
  parseEnumParam,
  parsePageParam,
  parseSearchParam,
  parseSortParam,
  type RawSearchParams,
} from "@/lib/list-params";

/**
 * Platform Admin Growth V1, Slice B. Read-only, cross-organization,
 * Platform-Admin-only reads over SignupAttempt (recorded Staff signup
 * identities) and Prisma User (authoritative app accounts).
 *
 * Vocabulary — these are four different things and are never summed or
 * presented as interchangeable:
 *   - signup identity: one SignupAttempt row = one Supabase Auth identity
 *     this application recorded a Staff signup for.
 *   - recorded attempt: one count unit inside SignupAttempt.attemptCount.
 *     Attempts Supabase rejected before returning an Auth user id were never
 *     recorded, so this is a lower bound.
 *   - activated account: a Prisma User row. User.createdAt is the
 *     authoritative app-account creation time. SignupAttempt.activatedAt is
 *     only a recorded copy of it and is cross-checked against User
 *     existence, never trusted as the sole signal.
 *   - workspace registration: an Organization row — a different entity.
 *
 * Historical honesty: SignupAttempt recording began with the November 1,
 * 2026 Production release and no backfill has been run. Signup figures
 * therefore describe the recording period only; a zero before it proves
 * nothing. Account figures come from User rows and cover all time. No
 * email-confirmation timestamp is ever shown: Supabase Auth is never
 * queried here.
 *
 * Bounds: every read is a count, an aggregate, a page of PAGE_SIZE rows, or
 * a single-column read capped at TREND_ROW_CAP / RECONCILE_CAP. When a cap is
 * hit the result says so instead of reporting a wrong total.
 *
 * Every exported async function calls requirePlatformAdmin() first
 * (check-platform-admin-security.mjs enforces it).
 */

/** The UTC day SignupAttempt recording began (the Production release). */
export const SIGNUP_RECORDING_STARTED_DAY = "2026-11-01";
const SIGNUP_RECORDING_STARTED_AT = new Date(`${SIGNUP_RECORDING_STARTED_DAY}T00:00:00.000Z`);

export const GROWTH_PERIOD_DAYS = [7, 30, 90] as const;
export type GrowthPeriodDays = (typeof GROWTH_PERIOD_DAYS)[number];
export const DEFAULT_GROWTH_PERIOD_DAYS: GrowthPeriodDays = 30;

/** Max rows read to draw the daily trend; beyond this the chart is withheld, not drawn wrong. */
export const TREND_ROW_CAP = 20_000;
/** Max pending identities cross-checked against User existence in one read. */
export const RECONCILE_CAP = 2_000;
/** Memberships shown per row; the rest are only counted. */
export const MEMBERSHIPS_PER_ROW = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export const REGISTRATION_SORT_FIELDS = ["firstAttemptedAt", "lastAttemptedAt", "attemptCount", "email"] as const;
export type RegistrationSortField = (typeof REGISTRATION_SORT_FIELDS)[number];

export type GrowthParams = {
  periodDays: GrowthPeriodDays;
  q: string;
  sortField: RegistrationSortField;
  sortDir: "asc" | "desc";
  sortCombined: string;
  page: number;
};

export function parseGrowthParams(searchParams: RawSearchParams): GrowthParams {
  const rawPeriod = parseEnumParam(
    typeof searchParams.period === "string" ? searchParams.period : undefined,
    ["7", "30", "90"] as const,
  );
  const periodDays = (rawPeriod ? Number(rawPeriod) : DEFAULT_GROWTH_PERIOD_DAYS) as GrowthPeriodDays;
  const { field, dir, combined } = parseSortParam(searchParams.sort, REGISTRATION_SORT_FIELDS, "firstAttemptedAt:desc");
  return {
    periodDays,
    q: parseSearchParam(searchParams.q),
    sortField: field,
    sortDir: dir,
    sortCombined: combined,
    page: parsePageParam(searchParams.page),
  };
}

export type GrowthTrendPoint = {
  /** UTC calendar day, YYYY-MM-DD. */
  date: string;
  /** Recorded signup identities first seen that day, or null for a day before recording began (no data, not zero). */
  signups: number | null;
  /** Staff accounts (User.createdAt) created that day. Authoritative for all time. */
  accounts: number;
};

/**
 * Pure bucketing, exported for tests. The window is the last `days` UTC
 * calendar days INCLUDING today (today is partial): [startOfUtcDay(now) -
 * (days-1) days, startOfUtcDay(now) + 1 day). An event at exactly the window
 * start is included, one at exactly the exclusive end is not. Every day in
 * the window appears — zero-event days are 0, never omitted. Days before
 * recording began report signups as null.
 */
export function buildGrowthTrend(params: {
  now: Date;
  days: number;
  signupTimes: readonly Date[];
  accountTimes: readonly Date[];
}): GrowthTrendPoint[] {
  const today = startOfUtcDay(params.now).getTime();
  const windowStart = today - (params.days - 1) * DAY_MS;
  const windowEnd = today + DAY_MS;

  const signups = new Map<number, number>();
  const accounts = new Map<number, number>();
  const bump = (map: Map<number, number>, time: Date) => {
    const t = time.getTime();
    if (t < windowStart || t >= windowEnd) return;
    const day = Math.floor((t - windowStart) / DAY_MS);
    map.set(day, (map.get(day) ?? 0) + 1);
  };
  params.signupTimes.forEach((t) => bump(signups, t));
  params.accountTimes.forEach((t) => bump(accounts, t));

  return Array.from({ length: params.days }, (_, i) => {
    const dayStart = windowStart + i * DAY_MS;
    return {
      date: new Date(dayStart).toISOString().slice(0, 10),
      signups: dayStart < SIGNUP_RECORDING_STARTED_AT.getTime() ? null : (signups.get(i) ?? 0),
      accounts: accounts.get(i) ?? 0,
    };
  });
}

export type GrowthSummary = {
  period: { days: GrowthPeriodDays; startsAt: Date; endsBefore: Date; predatesRecording: boolean };
  recording: { startedDay: string; earliestRecordedAt: Date | null };
  signups: {
    /** Signup identities (one per Supabase Auth identity), recording period only. */
    identities: number;
    /** Sum of attemptCount — recorded attempts only; a lower bound. */
    recordedAttempts: number;
    /** Identities with an app account (User exists, or an activation was recorded). */
    activated: number;
    /** Identities with no app account. When statusComplete is false this is an upper bound and `activated` a lower bound. */
    pending: number;
    statusComplete: boolean;
  };
  accounts: {
    /** All Staff accounts (User rows), all time. */
    staffAccounts: number;
    /** Accounts with no recorded signup (pre-recording, or the record failed to write). Null when it cannot be determined. */
    withoutRecordedSignup: number | null;
  };
  inPeriod: {
    newSignupIdentities: number;
    newStaffAccounts: number;
    /** Organizations created — workspaces, not people. */
    workspacesCreated: number;
  };
  /** Null when the daily rows exceeded TREND_ROW_CAP and the chart is withheld rather than drawn from partial data. */
  trend: GrowthTrendPoint[] | null;
};

export async function getGrowthSummary(params: Pick<GrowthParams, "periodDays">, now: Date): Promise<GrowthSummary> {
  await requirePlatformAdmin();

  const days = params.periodDays;
  const todayStart = startOfUtcDay(now);
  const startsAt = new Date(todayStart.getTime() - (days - 1) * DAY_MS);
  const endsBefore = new Date(todayStart.getTime() + DAY_MS);
  const inWindow = (field: "firstAttemptedAt" | "createdAt") => ({ [field]: { gte: startsAt, lt: endsBefore } });

  const [
    identities,
    attemptSum,
    activatedMarked,
    pendingMarked,
    earliest,
    staffAccounts,
    newSignupIdentities,
    newStaffAccounts,
    workspacesCreated,
    signupRows,
    accountRows,
  ] = await Promise.all([
    prisma.signupAttempt.count(),
    prisma.signupAttempt.aggregate({ _sum: { attemptCount: true } }),
    prisma.signupAttempt.count({ where: { activatedAt: { not: null } } }),
    prisma.signupAttempt.count({ where: { activatedAt: null } }),
    prisma.signupAttempt.aggregate({ _min: { firstAttemptedAt: true }, where: { recordedVia: "LIVE" } }),
    prisma.user.count(),
    prisma.signupAttempt.count({ where: inWindow("firstAttemptedAt") as Prisma.SignupAttemptWhereInput }),
    prisma.user.count({ where: inWindow("createdAt") as Prisma.UserWhereInput }),
    prisma.organization.count({ where: inWindow("createdAt") as Prisma.OrganizationWhereInput }),
    prisma.signupAttempt.findMany({
      where: inWindow("firstAttemptedAt") as Prisma.SignupAttemptWhereInput,
      select: { firstAttemptedAt: true },
      orderBy: { firstAttemptedAt: "asc" },
      take: TREND_ROW_CAP + 1,
    }),
    prisma.user.findMany({
      where: inWindow("createdAt") as Prisma.UserWhereInput,
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
      take: TREND_ROW_CAP + 1,
    }),
  ]);

  // Pending rows whose User already exists are activated accounts whose
  // activation write was missed; User existence is authoritative.
  let statusComplete = pendingMarked <= RECONCILE_CAP;
  let reconciledToActivated = 0;
  if (statusComplete && pendingMarked > 0) {
    const pendingIds = await prisma.signupAttempt.findMany({
      where: { activatedAt: null },
      select: { authUserId: true },
      orderBy: { id: "asc" },
      take: RECONCILE_CAP,
    });
    reconciledToActivated = await prisma.user.count({ where: { id: { in: pendingIds.map((r) => r.authUserId) } } });
    statusComplete = pendingIds.length === pendingMarked;
  }

  const activated = activatedMarked + (statusComplete ? reconciledToActivated : 0);
  const pending = statusComplete ? pendingMarked - reconciledToActivated : pendingMarked;

  const truncated = signupRows.length > TREND_ROW_CAP || accountRows.length > TREND_ROW_CAP;
  const trend = truncated
    ? null
    : buildGrowthTrend({
        now,
        days,
        signupTimes: signupRows.map((r) => r.firstAttemptedAt),
        accountTimes: accountRows.map((r) => r.createdAt),
      });

  return {
    period: { days, startsAt, endsBefore, predatesRecording: startsAt < SIGNUP_RECORDING_STARTED_AT },
    recording: { startedDay: SIGNUP_RECORDING_STARTED_DAY, earliestRecordedAt: earliest._min.firstAttemptedAt },
    signups: {
      identities,
      recordedAttempts: attemptSum._sum.attemptCount ?? 0,
      activated,
      pending,
      statusComplete,
    },
    accounts: {
      staffAccounts,
      withoutRecordedSignup: statusComplete ? Math.max(0, staffAccounts - activated) : null,
    },
    inPeriod: { newSignupIdentities, newStaffAccounts, workspacesCreated },
    trend,
  };
}

/**
 * ACTIVATED — a Prisma User exists (authoritative, even if the recorded
 *   activatedAt is missing).
 * NO_APP_ACCOUNT — a signup was recorded and no app account exists.
 * ACCOUNT_NOT_FOUND — an activation was recorded but no User exists now
 *   (unknown/incomplete state; shown as such, never as pending).
 */
export type RegistrationStatus = "ACTIVATED" | "NO_APP_ACCOUNT" | "ACCOUNT_NOT_FOUND";

export type RegistrationRow = {
  /** SignupAttempt.id — a React key only, never rendered. */
  id: string;
  email: string;
  origin: SignupOrigin;
  recordedVia: "LIVE" | "BACKFILL";
  firstAttemptedAt: Date;
  lastAttemptedAt: Date;
  attemptCount: number;
  status: RegistrationStatus;
  /** User.createdAt — the authoritative app-account creation time; null when no User exists. */
  accountCreatedAt: Date | null;
  /** The activation time recorded on the SignupAttempt, shown only for ACCOUNT_NOT_FOUND. */
  recordedActivationAt: Date | null;
  workspaceCount: number;
  workspaces: { organizationId: string; name: string; role: Role }[];
};

export function resolveRegistrationStatus(row: { activatedAt: Date | null }, userExists: boolean): RegistrationStatus {
  if (userExists) return "ACTIVATED";
  return row.activatedAt ? "ACCOUNT_NOT_FOUND" : "NO_APP_ACCOUNT";
}

export async function listRegistrations(
  params: Pick<GrowthParams, "q" | "sortField" | "sortDir" | "page">,
): Promise<{ rows: RegistrationRow[]; total: number }> {
  await requirePlatformAdmin();

  const where: Prisma.SignupAttemptWhereInput = params.q
    ? { email: { contains: params.q, mode: "insensitive" as const } }
    : {};

  const [attempts, total] = await prisma.$transaction([
    prisma.signupAttempt.findMany({
      where,
      // id is the stable tiebreaker: equal sort keys can never shuffle across pages.
      orderBy: [{ [params.sortField]: params.sortDir }, { id: params.sortDir }],
      skip: getOffset(params.page),
      take: PAGE_SIZE,
      select: {
        id: true,
        authUserId: true,
        email: true,
        origin: true,
        recordedVia: true,
        firstAttemptedAt: true,
        lastAttemptedAt: true,
        attemptCount: true,
        activatedAt: true,
      },
    }),
    prisma.signupAttempt.count({ where }),
  ]);

  const users = attempts.length
    ? await prisma.user.findMany({
        where: { id: { in: attempts.map((a) => a.authUserId) } },
        select: {
          id: true,
          createdAt: true,
          _count: { select: { memberships: true } },
          memberships: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: MEMBERSHIPS_PER_ROW,
            select: { role: true, organization: { select: { id: true, name: true } } },
          },
        },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const rows: RegistrationRow[] = attempts.map((attempt) => {
    const user = userById.get(attempt.authUserId);
    const status = resolveRegistrationStatus(attempt, Boolean(user));
    return {
      id: attempt.id,
      email: attempt.email,
      origin: attempt.origin,
      recordedVia: attempt.recordedVia,
      firstAttemptedAt: attempt.firstAttemptedAt,
      lastAttemptedAt: attempt.lastAttemptedAt,
      attemptCount: attempt.attemptCount,
      status,
      accountCreatedAt: user?.createdAt ?? null,
      recordedActivationAt: status === "ACCOUNT_NOT_FOUND" ? attempt.activatedAt : null,
      workspaceCount: user?._count.memberships ?? 0,
      workspaces:
        user?.memberships.map((m) => ({ organizationId: m.organization.id, name: m.organization.name, role: m.role })) ?? [],
    };
  });

  return { rows, total };
}
