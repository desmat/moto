import moment from "moment";
import { Log, LogTypeMileage } from "@/types/Log";
import { Projection, estimateDateForMileage } from "@/lib/mileage";
import { MaintenanceItemStatus, VehicleMaintenance } from "@/types/Maintenance";
import { MaintenanceSchedule, ScheduleItem } from "@/types/MaintenanceSchedule";
import { Vehicle } from "@/types/Vehicle";

// S14's deterministic core: schedule + logs + vehicle in, per-item statuses out. AI at
// write time, never at read time — by the time this runs, matching is pure key equality
// (S11 receipt items[].key, S13 seeded items, and the write-time classifier's
// scheduleKeys[] all share the CANONICAL_COMPONENT_KEYS vocabulary).
//
// CLIENT-SAFE ON PURPOSE (S0 flag 1): this module imports types + moment ONLY — never
// anything under services/* (a services import drags module-scope store construction
// into the client bundle). S16's card and S17's table import from here;
// services/maintenance.ts holds the store-touching assembly.

// "Upcoming" thresholds, the one place to tune them (phase-3.md § S14): an item is
// upcoming when it's within this fraction of its km interval, or within this many days
// of its due date — whichever axis trips first.
export const UPCOMING_KM_FRACTION = 0.1;
export const UPCOMING_DAYS = 30;

const DATE_FORMAT = "YYYYMMDD";

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value == "number" && isFinite(value) ? value : undefined;

// a log "counts" for a schedule item when its structured items (S11) or its classified
// scheduleKeys (S14 write-time classifier) carry the item's key
const logMatchesItem = (log: Log, item: ScheduleItem): boolean =>
  (log.items || []).some((logItem) => logItem.key == item.key)
  || (log.scheduleKeys || []).includes(item.key);

// the newest odometer OBSERVATION in the logs (a mileage log's entry, or any log's
// mileage field, e.g. the reading printed on a receipt) — display context for the
// consumer; the due math deliberately uses vehicle.mileage instead (see below)
function lastReading(logs: Log[]): { mileage: number, date: string } | undefined {
  let best: { mileage: number, date: string } | undefined;

  for (const log of logs) {
    if (!log.date) continue;
    const reading = log.type == LogTypeMileage
      ? asFiniteNumber(parseFloat(log.entry))
      : asFiniteNumber(log.mileage);
    if (reading == undefined) continue;
    // YYYYMMDD compares lexically; newest wins
    if (!best || log.date >= best.date) {
      best = { mileage: reading, date: log.date };
    }
  }

  return best;
}

function computeItemStatus(item: ScheduleItem, logs: Log[], currentKm: number | undefined, now: string, projection?: Projection): MaintenanceItemStatus {
  // lastDone = the newest matching log by date (YYYYMMDD lexical; createdAt breaks
  // same-day ties in favor of the later write)
  const done = logs
    .filter((log) => log.date && logMatchesItem(log, item))
    .sort((a, b) => a.date == b.date
      ? (a.createdAt || 0) - (b.createdAt || 0)
      : a.date.localeCompare(b.date));
  const last = done[done.length - 1];
  const lastDoneMileage = last && asFiniteNumber(last.mileage);
  const lastDone = last && {
    date: last.date,
    ...lastDoneMileage != undefined && { mileage: lastDoneMileage },
    logId: last.id,
  };

  // due math: interval past the last time it was done; never done → firstAtKm anchors
  // the km axis (else due-by-km is unknowable — deliberately no guess from vehicle age
  // or a zero start), and months-based has no anchor at all
  const nextDue: MaintenanceItemStatus["nextDue"] = {};
  if (lastDone) {
    if (item.intervalKm && lastDone.mileage != undefined) {
      nextDue.km = lastDone.mileage + item.intervalKm;
    }
    if (item.intervalMonths) {
      nextDue.date = moment(lastDone.date, DATE_FORMAT).add(item.intervalMonths, "months").format(DATE_FORMAT);
    }
  } else if (item.firstAtKm != undefined) {
    nextDue.km = item.firstAtKm;
  }

  // S15: turn a km-due into an approximate date via the mileage projection, marked
  // `estimated: true`. EARLIER WINS, mirroring the two-axis status rule below: the item
  // actually comes due at whichever axis trips first, so a months-derived date is only
  // replaced when the km-derived estimate is EARLIER (a later estimate would hide the
  // real, sooner date-due; a later months date is superseded because the km axis will
  // trip before it). Skipped entirely at confidence "none"; estimateDateForMileage
  // itself refuses slope <= 0, and clamps already-passed targets to "now" — so an
  // estimated date is never in the past and can therefore never create overdueByDays:
  // it feeds ONLY the upcoming window (time-awareness, the story's point). Overdue
  // stays anchored to actual km/real dates (S14's conservative rule).
  if (projection && projection.confidence != "none" && nextDue.km != undefined) {
    const estimated = estimateDateForMileage(projection, nextDue.km);
    if (estimated != undefined && (nextDue.date == undefined || estimated < nextDue.date)) {
      nextDue.date = estimated;
      nextDue.estimated = true;
    }
  }

  // per-axis remaining; an axis only participates when both its due value and the
  // current position are known. When both axes exist, earlier wins — implemented as
  // "worst status across axes" (overdue > upcoming > ok).
  const kmRemaining = nextDue.km != undefined && currentKm != undefined ? nextDue.km - currentKm : undefined;
  const daysRemaining = nextDue.date != undefined
    ? moment(nextDue.date, DATE_FORMAT).diff(moment(now, DATE_FORMAT), "days")
    : undefined;

  // overdue = STRICTLY past the due km/date (at exactly due → upcoming, not overdue)
  const overdueByKm = kmRemaining != undefined && kmRemaining < 0 ? -kmRemaining : undefined;
  const overdueByDays = daysRemaining != undefined && daysRemaining < 0 ? -daysRemaining : undefined;

  // the km upcoming-window is a fraction of the interval (firstAtKm stands in for
  // never-done break-in items with no interval)
  const kmWindow = (item.intervalKm ?? item.firstAtKm ?? 0) * UPCOMING_KM_FRACTION;
  const upcoming = (kmRemaining != undefined && kmRemaining <= kmWindow)
    || (daysRemaining != undefined && daysRemaining <= UPCOMING_DAYS);

  const status: MaintenanceItemStatus["status"] =
    overdueByKm != undefined || overdueByDays != undefined ? "overdue"
      : upcoming ? "upcoming"
        : kmRemaining != undefined || daysRemaining != undefined ? "ok"
          : "unknown";

  return {
    item,
    ...lastDone && { lastDone },
    nextDue,
    status,
    ...overdueByKm != undefined && { overdueByKm },
    ...overdueByDays != undefined && { overdueByDays },
  };
}

// The engine. Pure and store-free: everything comes in as arguments, including `now`
// (YYYYMMDD), so tests and the S15 projection can pin time. `schedule` must already be
// the vehicle's CONFIRMED schedule (or undefined — the caller filters; a dangling
// proposal is inert by design). No schedule → scheduleId absent + empty items: the
// distinct "no schedule" shape, not an error, so UIs can funnel to manual upload.
export function computeMaintenanceStatus({ schedule, logs, vehicle, now, projection }: {
  schedule?: MaintenanceSchedule,
  logs: Log[],
  vehicle: Vehicle,
  now: string, // YYYYMMDD
  projection?: Projection, // S15: turns km-dues into estimated dates; optional on purpose
}): VehicleMaintenance {
  const reading = lastReading(logs || []);
  // surfaced (kmPerDay + confidence only) so S16's stale-mileage funnel can branch on
  // confidence alongside lastReading
  const projectionSummary = projection
    && { kmPerDay: projection.kmPerDay, confidence: projection.confidence };

  if (!schedule) {
    return {
      vehicleId: vehicle.id,
      ...reading && { lastReading: reading },
      ...projectionSummary && { projection: projectionSummary },
      items: [],
    };
  }

  // current position = vehicle.mileage, the last ACTUAL reading (saveLog keeps it in
  // sync) — deliberately conservative; S15's projection converts future km to dates for
  // display but never declares something overdue on projected kilometers
  const currentKm = asFiniteNumber(vehicle.mileage);

  return {
    vehicleId: vehicle.id,
    scheduleId: schedule.id,
    ...reading && { lastReading: reading },
    ...projectionSummary && { projection: projectionSummary },
    items: (schedule.items || []).map((item) => computeItemStatus(item, logs || [], currentKm, now, projection)),
  };
}

// ---------------------------------------------------------------------------
// S16/S17 severity ranking — one comparator so the dashboard card and the schedule
// table sort identically. Pure and client-safe like everything else in this module.

// one flattened, sortable entry: a MaintenanceItemStatus plus which vehicle it belongs
// to and (when derivable) how many km away its due point is. `kmGap` is computed from
// the vehicle's lastReading — display-grade context, mirroring how the engine's
// authoritative math already ran against vehicle.mileage server-side.
export type RankedMaintenanceItem = {
  vehicleId: string;
  status: MaintenanceItemStatus;
  kmGap?: number; // nextDue.km - lastReading.mileage, when both are known
};

const STATUS_ORDER: Record<MaintenanceItemStatus["status"], number> = {
  overdue: 0, upcoming: 1, ok: 2, unknown: 3,
};

// Normalized "how badly overdue" score, so a 500-km-overdue oil change can outrank a
// 2-day-overdue inspection: max(overdueByKm / kmInterval, overdueByDays / 30). The km
// axis normalizes by intervalKm, falling back to firstAtKm (never-done break-in items
// carry their only km anchor there); with neither, only the days axis scores — and an
// overdue item with no scorable axis at all ranks at 0 (still overdue, just last among
// overdue).
export function overdueSeverity(status: MaintenanceItemStatus): number {
  const kmInterval = status.item.intervalKm ?? status.item.firstAtKm;
  const kmAxis = status.overdueByKm != undefined && kmInterval
    ? status.overdueByKm / kmInterval
    : undefined;
  const daysAxis = status.overdueByDays != undefined
    ? status.overdueByDays / 30
    : undefined;
  return Math.max(kmAxis ?? 0, daysAxis ?? 0);
}

// THE comparator (stable, documented — S17 must sort with this exact function):
// 1. status class: overdue < upcoming < ok < unknown;
// 2. among overdue: overdueSeverity descending;
// 3. then soonest nextDue.date ascending (dated entries before undated ones);
// 4. then smallest kmGap ascending (known gaps before unknown ones);
// 5. finally item key, then vehicleId, lexically — full determinism so equal-severity
//    rows never swap between renders.
export function compareRankedItems(a: RankedMaintenanceItem, b: RankedMaintenanceItem): number {
  const statusDiff = STATUS_ORDER[a.status.status] - STATUS_ORDER[b.status.status];
  if (statusDiff) return statusDiff;

  if (a.status.status == "overdue") {
    const severityDiff = overdueSeverity(b.status) - overdueSeverity(a.status);
    if (severityDiff) return severityDiff;
  }

  const aDate = a.status.nextDue.date;
  const bDate = b.status.nextDue.date;
  if (aDate != bDate) {
    if (aDate == undefined) return 1;
    if (bDate == undefined) return -1;
    const dateDiff = aDate.localeCompare(bDate);
    if (dateDiff) return dateDiff;
  }

  if (a.kmGap != b.kmGap) {
    if (a.kmGap == undefined) return 1;
    if (b.kmGap == undefined) return -1;
    return a.kmGap - b.kmGap;
  }

  return (a.status.item.key || "").localeCompare(b.status.item.key || "")
    || a.vehicleId.localeCompare(b.vehicleId);
}

// Flatten every vehicle's items into one list sorted by compareRankedItems. Returns ALL
// items (ok/unknown included, ranked last) — S16's card slices the due ones off the
// front and reads the first "ok" entry for its "next up" line; S17 renders the lot.
export function rankMaintenanceItems(vehicles: VehicleMaintenance[]): RankedMaintenanceItem[] {
  return (vehicles || [])
    .flatMap((vehicle) => (vehicle.items || []).map((status) => ({
      vehicleId: vehicle.vehicleId,
      status,
      ...status.nextDue.km != undefined && vehicle.lastReading
        && { kmGap: status.nextDue.km - vehicle.lastReading.mileage },
    })))
    .sort(compareRankedItems);
}
