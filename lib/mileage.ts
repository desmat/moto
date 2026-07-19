import moment from "moment";
import { Log, LogTypeMileage } from "@/types/Log";

// S15's mileage projection: turn the odometer observations scattered through a
// vehicle's logs into a km/day estimate, so km-based due items can get approximate
// dates. Small, pure, and deliberately humble about its own accuracy — the confidence
// field is where honesty lives, and consumers must branch on it.
//
// CLIENT-SAFE ON PURPOSE (same rule as lib/maintenance.ts): imports types + moment
// ONLY, never services/*. S16's card reads STALE_DAYS and projection confidence from
// client code.
//
// Projections are never stored, always computed — and never used to declare items
// overdue (S14's conservative rule): they only turn future km into approximate dates.

// fit/threshold consts, the one place to tune them (phase-3.md § S15)
export const WINDOW_DAYS = 90;    // trailing window the fit prefers
export const MIN_SPAN_DAYS = 14;  // fit spans shorter than this → "low"
export const STALE_DAYS = 60;     // newest reading older than this → "low"

// how many recent readings the fit falls back to when the 90-day window has <2
const FALLBACK_READINGS = 6;

const DATE_FORMAT = "YYYYMMDD";

export type OdometerReading = { date: string /* YYYYMMDD */, mileage: number };

export type Projection = {
  kmPerDay: number;
  lastReading: OdometerReading;
  confidence: "high" | "low" | "none";
  now: string; // YYYYMMDD reference date the fit was computed against
};

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value == "number" && isFinite(value) ? value : undefined;

// Readings, not logs: an odometer observation is any log with a mileage value — a
// mileage-type log's entry (parseFloat) or any log's `mileage` field (e.g. the reading
// printed on a receipt) — reduced to { date, mileage }, deduped per day (latest write
// wins, createdAt breaking the tie), sorted ascending by date. Non-monotonic history
// (backdated corrections) is tolerated: the fit uses what it's given.
export function extractReadings(logs: Log[]): OdometerReading[] {
  const byDay = new Map<string, { mileage: number, createdAt: number }>();

  for (const log of logs || []) {
    if (!log?.date) continue;
    const mileage = log.type == LogTypeMileage
      ? asFiniteNumber(parseFloat(log.entry))
      : asFiniteNumber(log.mileage);
    if (mileage == undefined) continue;

    const existing = byDay.get(log.date);
    if (!existing || (log.createdAt || 0) >= existing.createdAt) {
      byDay.set(log.date, { mileage, createdAt: log.createdAt || 0 });
    }
  }

  return Array.from(byDay.entries())
    .map(([date, { mileage }]) => ({ date, mileage }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Simple least-squares slope (km/day) over the trailing WINDOW_DAYS of readings —
// minimum 2, falling back to the last FALLBACK_READINGS readings when the window has
// fewer. No seasonality, no fanciness. Returns undefined only when there are no
// readings at all; a single reading yields a confidence-"none" projection (kmPerDay 0)
// so consumers still get lastReading, but no dates are ever derived from it.
export function fitProjection(readings: OdometerReading[], now: string): Projection | undefined {
  const sorted = [...(readings || [])].sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return undefined;

  const lastReading = sorted[sorted.length - 1];
  if (sorted.length < 2) {
    return { kmPerDay: 0, lastReading, confidence: "none", now };
  }

  const nowMoment = moment(now, DATE_FORMAT);
  const inWindow = sorted.filter((reading) =>
    nowMoment.diff(moment(reading.date, DATE_FORMAT), "days") <= WINDOW_DAYS);
  const fitSet = inWindow.length >= 2 ? inWindow : sorted.slice(-FALLBACK_READINGS);

  // least squares over (days-since-oldest, mileage); per-day dedup guarantees distinct
  // x values, so the denominator can't be zero with >= 2 points
  const origin = moment(fitSet[0].date, DATE_FORMAT);
  const points = fitSet.map((reading) => ({
    x: moment(reading.date, DATE_FORMAT).diff(origin, "days"),
    y: reading.mileage,
  }));
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  const kmPerDay =
    points.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0)
    / points.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0);

  const spanDays = moment(fitSet[fitSet.length - 1].date, DATE_FORMAT)
    .diff(moment(fitSet[0].date, DATE_FORMAT), "days");
  const staleDays = nowMoment.diff(moment(lastReading.date, DATE_FORMAT), "days");
  const confidence: Projection["confidence"] =
    spanDays < MIN_SPAN_DAYS || staleDays > STALE_DAYS || kmPerDay <= 0 ? "low" : "high";

  return { kmPerDay, lastReading, confidence, now };
}

// Projected odometer at a date. Clamped: never below the newest actual reading (so a
// slope <= 0 or a date before the last reading just returns the reading itself).
export function projectMileage(projection: Projection, atDate: string): number | undefined {
  if (!projection || projection.confidence == "none") return undefined;

  const days = moment(atDate, DATE_FORMAT).diff(moment(projection.lastReading.date, DATE_FORMAT), "days");
  return Math.max(
    projection.lastReading.mileage,
    projection.lastReading.mileage + projection.kmPerDay * days,
  );
}

// When does the odometer reach targetKm? The slope guard is an AC (S0 flag 4):
// confidence "none" or slope <= 0 returns undefined explicitly — no divide-by-zero, no
// negative extrapolation ever reaches a consumer, regardless of whether the caller
// checked confidence. An already-passed target (at or below the newest reading — no
// extrapolation needed) clamps to "now", the projection's reference date: the estimate
// is never in the past.
export function estimateDateForMileage(projection: Projection, targetKm: number): string | undefined {
  if (!projection || projection.confidence == "none") return undefined;
  if (asFiniteNumber(targetKm) == undefined) return undefined;

  if (targetKm <= projection.lastReading.mileage) return projection.now;

  if (projection.kmPerDay <= 0) return undefined;

  const days = Math.round((targetKm - projection.lastReading.mileage) / projection.kmPerDay);
  const estimated = moment(projection.lastReading.date, DATE_FORMAT).add(days, "days").format(DATE_FORMAT);

  // a stale reading + steep slope can put the arithmetic date behind "now": the target
  // has (probably) already passed → clamp to now, never the past
  return estimated < projection.now ? projection.now : estimated;
}
