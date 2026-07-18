import moment from "moment";
import { MemoryStore } from "@desmat/redis-store";
import { User } from "../../types/User";
import { Vehicle } from "../../types/Vehicle";
import { Log } from "../../types/Log";
import { Attachment } from "../../types/Attachment";
import { Document } from "../../types/Document";
import { MaintenanceSchedule } from "../../types/MaintenanceSchedule";
import { storeConfigs, StoreEntityName } from "./config";

// Keep in sync with playwright.config.ts's IMPERSONATE_USER_ID -- vehicles/logs are
// scoped by exact user id, so the seeded history below only shows up (record buttons,
// entries list, etc.) when this exact user is impersonated.
export const smokeTestUserId = "user_smoketest";

const smokeTestVehicleId = "vehicle-smoketest";
const smokeTestVehicle2Id = "vehicle-smoketest-2";
const crf250rlVehicleId = "vehicle-crf250rl";
const gsxr750VehicleId = "vehicle-gsxr750";

// Hard-coded (rather than loaded from a file) so this module has no I/O: it needs to work
// identically whether it's pulled in from a Node.js API route or from middleware.ts, which
// Next.js runs in the Edge runtime -- and the Edge runtime has no `fs` module. The seeded
// vehicle also keeps the "add your first vehicle" onboarding dialog from blocking the
// Playwright suite (it only shows when the user has no vehicles).
// YYYYMMDD n days ago — keep the seeded vehicle.components dates in lockstep with the
// relative-dated log seeds they point at (see buildLogSeeds below)
const seedDate = (daysAgo: number) => moment().subtract(daysAgo, "days").format("YYYYMMDD");

const seed: Partial<Record<StoreEntityName, any[]>> = {
  users: [
    {
      id: smokeTestUserId,
      createdAt: 1700000000000,
      providerId: "provider_smoketest",
      authProvider: "mock",
      email: "smoketest@example.com",
      name: "Smoke Test",
    },
  ],
  vehicles: [
    {
      id: smokeTestVehicleId,
      createdAt: 1700000000000,
      userId: smokeTestUserId,
      type: "motorcycle",
      maker: "Honda",
      model: "CB500X",
      year: 2021,
      mileage: 18250,
      modifications: ["crash bars", "heated grips"],
      // S12: the current-setup snapshot the seeded SERVICE logs below (smoke-log-3,
      // smoke-log-7) would have produced through saveLog — seeded statically because
      // seeds bypass the service layer, so the vehicle page's "Current setup" card has
      // rows out of the box
      components: {
        "engine-oil": { name: "Engine oil", detail: "Full synthetic 10W-30", action: "replace", date: seedDate(3), logId: "smoke-log-3" },
        "oil-filter": { name: "Oil filter", detail: "Oil filter", action: "replace", date: seedDate(3), logId: "smoke-log-3" },
        "front-tire": { name: "Front tire", detail: "Michelin Anakee Adventure", action: "replace", date: seedDate(10), logId: "smoke-log-7" },
        "rear-tire": { name: "Rear tire", detail: "Michelin Anakee Adventure", action: "replace", date: seedDate(10), logId: "smoke-log-7" },
      },
    },
    {
      id: smokeTestVehicle2Id,
      createdAt: 1700000001000,
      userId: smokeTestUserId,
      type: "motorcycle",
      maker: "Yamaha",
      model: "XT250",
      year: 2018,
      mileage: 9400,
      modifications: [],
    },
    // added for the manual → schedule seeding pass (see scheduleSeeds below)
    {
      id: crf250rlVehicleId,
      createdAt: 1700000001500,
      userId: smokeTestUserId,
      type: "motorcycle",
      maker: "Honda",
      model: "CRF250RL",
      year: 2020,
      mileage: 3200,
      modifications: [],
    },
    {
      id: gsxr750VehicleId,
      createdAt: 1700000001600,
      userId: smokeTestUserId,
      type: "motorcycle",
      maker: "Suzuki",
      model: "GSX-R 750",
      year: 2009,
      mileage: 22500,
      modifications: [],
    },
  ],
  // one image attachment linked to the seeded "new tires" log (smoke-log-7, see
  // buildLogSeeds below) so attachment indicators/galleries have something to render out
  // of the box. The pathname is fake-but-well-formed (`moto/{userId}/...`); the url is a
  // tiny inline data-URL PNG so nothing depends on a real Blob store.
  attachments: [
    {
      id: "attachment-smoketest",
      createdAt: 1700000002000,
      userId: smokeTestUserId,
      logId: "smoke-log-7",
      vehicleId: smokeTestVehicleId,
      url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      pathname: `moto/${smokeTestUserId}/seed-new-tires.png`,
      contentType: "image/png",
      size: 68,
      filename: "new-tires.png",
    },
  ],
};

// A handful of Log records for smokeTestUserId spread over the last couple of weeks so
// the dashboard's Entries section has something to show out of the box. Computed relative
// to "now" (not literal date strings) so this stays meaningful whenever the dev server
// happens to start.
function buildLogSeeds(): any[] {
  const mk = (daysAgo: number, type: string, entry: string, suffix: string, extra: Record<string, any> = {}) => {
    const createdAt = moment().subtract(daysAgo, "days").hour(10).minute(0).second(0).valueOf();

    return {
      id: `smoke-log-${suffix}`,
      createdAt,
      userId: smokeTestUserId,
      vehicleId: smokeTestVehicleId,
      type,
      date: moment(createdAt).format("YYYYMMDD"),
      entry,
      ...extra,
    };
  };

  // the former "oil change"/"new tires" custom-type seeds are proper `service` logs
  // since S11, with structured `items` keyed to CANONICAL_COMPONENT_KEYS -- gives S12
  // and Phase 3 seeded structure to work against out of the box (ids/dates/entries
  // unchanged; smoke-log-7 keeps its seeded attachment link)
  return [
    mk(0, "journal", "Chain cleaned and lubed after the weekend ride.", "1"),
    mk(1, "mileage", "18250", "2"),
    mk(3, "service", "Full synthetic 10W-30, new filter.", "3", {
      items: [
        { key: "engine-oil", name: "Engine oil", action: "replace", note: "Full synthetic 10W-30" },
        { key: "oil-filter", name: "Oil filter", action: "replace" },
      ],
    }),
    mk(5, "chain adjustment", "Tightened to 35mm slack, cleaned and lubed.", "6"),
    mk(8, "journal", "Front brake lever feels spongy, bleed brakes soon.", "4"),
    mk(10, "service", "Michelin Anakee Adventure front and rear.", "7", {
      items: [
        { key: "front-tire", name: "Front tire", action: "replace", note: "Michelin Anakee Adventure" },
        { key: "rear-tire", name: "Rear tire", action: "replace", note: "Michelin Anakee Adventure" },
      ],
    }),
    mk(12, "mileage", "17980", "5"),
  ];
}

// ---------------------------------------------------------------------------
// TEMPORARY (S10 follow-up): real extracted-and-confirmed maintenance schedules,
// pasted in by hand after running each bike's actual owner's manual through the real
// pipeline (AI_MOCK=false). Remove this whole block (and the copy button) once enough 
// seed data exists and the mechanism is no longer needed.
const scheduleSeeds: Record<string, any[]> = {
  [smokeTestVehicleId]: [
    {
      "key": "fuel-line",
      "name": "Fuel Line",
      "action": "inspect",
      "intervalMonths": 12
    },
    {
      "key": "throttle",
      "name": "Throttle Operation",
      "action": "inspect",
      "intervalMonths": 12
    },
    {
      "key": "air-filter",
      "name": "Air Cleaner",
      "action": "inspect",
      "intervalMonths": 12,
      "notes": "Service more frequently when riding in unusually wet or dusty areas."
    },
    {
      "key": "crankcase-breather",
      "name": "Crankcase Breather",
      "action": "clean",
      "intervalMonths": 12,
      "notes": "Service more frequently when riding in rain or at full throttle."
    },
    {
      "key": "spark-plugs",
      "name": "Spark Plug",
      "action": "inspect",
      "intervalMonths": 12
    },
    {
      "key": "valve-clearance",
      "name": "Valve Clearance",
      "action": "inspect",
      "intervalMonths": 12
    },
    {
      "key": "engine-oil",
      "name": "Engine Oil",
      "action": "replace",
      "intervalKm": 12000,
      "intervalMonths": 12,
      "firstAtKm": 1000
    },
    {
      "key": "oil-filter",
      "name": "Engine Oil Filter",
      "action": "replace",
      "intervalKm": 12000,
      "firstAtKm": 1000
    },
    {
      "key": "engine-idle-speed",
      "name": "Engine Idle Speed",
      "action": "inspect",
      "intervalMonths": 12
    },
    {
      "key": "coolant",
      "name": "Radiator Coolant",
      "action": "replace",
      "intervalMonths": 36,
      "notes": "3 Years; inspect every 12,000 km"
    },
    {
      "key": "cooling-system",
      "name": "Cooling System",
      "action": "inspect",
      "intervalMonths": 12
    },
    {
      "key": "secondary-air-supply-system",
      "name": "Secondary Air Supply System",
      "action": "inspect",
      "intervalMonths": 12
    },
    {
      "key": "evaporative-emission-control-system",
      "name": "Evaporative Emission Control System",
      "action": "inspect",
      "intervalMonths": 12,
      "notes": "ED, KO type only."
    },
    {
      "key": "chain",
      "name": "Drive Chain",
      "action": "lubricate",
      "intervalKm": 1000,
      "notes": "Every 1,000 km (600 mi)"
    },
    {
      "key": "chain-slider",
      "name": "Drive Chain Slider",
      "action": "inspect",
      "intervalMonths": 12
    },
    {
      "key": "brake-fluid",
      "name": "Brake Fluid",
      "action": "replace",
      "intervalMonths": 24,
      "notes": "2 Years; inspect every 12,000 km"
    },
    {
      "key": "brake-pads-front",
      "name": "Brake Pads Wear",
      "action": "inspect",
      "intervalMonths": 12
    },
    {
      "key": "brake-system",
      "name": "Brake System",
      "action": "inspect",
      "intervalMonths": 12
    },
    {
      "key": "brakelight-switch",
      "name": "Brakelight Switch",
      "action": "inspect",
      "intervalMonths": 12
    },
    {
      "key": "lights",
      "name": "Lights/Horn",
      "action": "inspect",
      "intervalMonths": 12
    },
    {
      "key": "clutch",
      "name": "Clutch System",
      "action": "inspect",
      "intervalMonths": 12
    },
    {
      "key": "side-stand",
      "name": "Side Stand",
      "action": "inspect",
      "intervalMonths": 12
    },
    {
      "key": "suspension",
      "name": "Suspension",
      "action": "inspect",
      "intervalMonths": 12
    },
    {
      "key": "nuts-bolts-fasteners",
      "name": "Nuts, Bolts, Fasteners",
      "action": "inspect",
      "intervalMonths": 12
    },
    {
      "key": "wheels",
      "name": "Wheels/Tyres",
      "action": "inspect",
      "intervalMonths": 12,
      "notes": "Service more frequently when riding in rain or at full throttle."
    },
    {
      "key": "steering-bearings",
      "name": "Steering Head Bearings",
      "action": "inspect",
      "intervalMonths": 12
    }
  ],
  [crf250rlVehicleId]: [
    {
      "action": "inspect",
      "key": "fuel-line",
      "name": "Fuel Line",
      "intervalKm": 12800
    },
    {
      "intervalKm": 12800,
      "key": "throttle",
      "name": "Throttle Operation",
      "action": "inspect"
    },
    {
      "action": "replace",
      "intervalKm": 19200,
      "key": "air-filter",
      "name": "Air Cleaner",
      "notes": ""
    },
    {
      "notes": "",
      "action": "clean",
      "intervalKm": 6400,
      "key": "crankcase-breather",
      "name": "Crankcase Breather"
    },
    {
      "action": "inspect",
      "intervalKm": 25600,
      "key": "spark-plugs",
      "name": "Spark Plug"
    },
    {
      "key": "spark-plugs",
      "name": "Spark Plugs",
      "action": "replace",
      "intervalKm": 51200
    },
    {
      "intervalKm": 25600,
      "action": "inspect",
      "key": "valve-clearance",
      "name": "Valve Clearance"
    },
    {
      "name": "Engine Oil",
      "notes": "",
      "action": "replace",
      "firstAtKm": 1000,
      "intervalKm": 12800,
      "intervalMonths": 12,
      "key": "engine-oil"
    },
    {
      "action": "replace",
      "firstAtKm": 1000,
      "intervalKm": 25600,
      "key": "oil-filter",
      "name": "Engine Oil Filter"
    },
    {
      "key": "engine-idle-speed",
      "name": "Engine Idle Speed",
      "intervalKm": 12800,
      "action": "inspect"
    },
    {
      "action": "replace",
      "intervalMonths": 36,
      "key": "coolant",
      "name": "Radiator Coolant",
      "notes": ""
    },
    {
      "key": "coolant",
      "name": "Radiator Coolant",
      "action": "inspect",
      "intervalKm": 12800
    },
    {
      "action": "inspect",
      "key": "cooling-system",
      "name": "Cooling System",
      "intervalKm": 12800
    },
    {
      "action": "inspect",
      "key": "secondary-air-system",
      "name": "Secondary Air Supply System",
      "intervalKm": 25600
    },
    {
      "key": "evaporative-emission",
      "name": "Evaporative Emission Control System",
      "intervalKm": 25600,
      "action": "inspect"
    },
    {
      "key": "chain",
      "name": "Drive Chain",
      "intervalKm": 1000,
      "action": "inspect"
    },
    {
      "key": "chain",
      "name": "Drive Chain",
      "intervalKm": 1000,
      "action": "lubricate"
    },
    {
      "key": "chain-slide",
      "name": "Drive Chain Slider",
      "intervalKm": 6400,
      "action": "inspect"
    },
    {
      "key": "brake-fuild",
      "name": "Brake Fluid",
      "intervalKm": 6400,
      "action": "inspect"
    },
    {
      "key": "brake-fuild",
      "name": "Brake Fluid",
      "intervalMonths": 24,
      "action": "replace"
    },
    {
      "key": "brake-system",
      "name": "Brake System",
      "intervalKm": 12800,
      "action": "inspect"
    },
    {
      "key": "brake-light-switch",
      "name": "Brake Light Switch",
      "intervalKm": 12800,
      "action": "inspect"
    },
    {
      "key": "headlight-aim",
      "name": "Headlight Aim",
      "intervalKm": 12800,
      "action": "inspect"
    },
    {
      "key": "clutch",
      "name": "Clutch System",
      "intervalKm": 6400,
      "action": "inspect"
    },
    {
      "key": "side-stand",
      "name": "Side Stand",
      "intervalKm": 12800,
      "action": "inspect"
    },
    {
      "key": "suspension",
      "name": "Suspension",
      "intervalKm": 12800,
      "action": "inspect"
    },
    {
      "key": "spark-arrester",
      "name": "Spark Arrester",
      "intervalKm": 6400,
      "action": "clean"
    },
    {
      "key": "nut-bolts-fasteners",
      "name": "Nuts, Botz, Fasteners",
      "intervalKm": 12800,
      "action": "inspect"
    },
    {
      "key": "wheels-tires",
      "name": "Wheels/Tires",
      "intervalKm": 6400,
      "action": "inspect"
    },
    {
      "key": "steering-ead-bearings",
      "name": "steering Head Bearings",
      "intervalKm": 12800,
      "action": "inspect"
    }
  ],
  [smokeTestVehicle2Id]: [
    {
      "key": "fuel-line",
      "name": "Fuel line",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Check fuel hoses for cracks or damage. Replace if necessary."
    },
    {
      "key": "spark-plugs",
      "name": "Spark plug",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 12,
      "firstAtKm": 1000,
      "notes": "Check condition. Adjust gap and clean. Replace at 7000 mi (11000 km) or 12 months and thereafter every 6000 mi (10000 km) or 12 months."
    },
    {
      "key": "spark-arrester",
      "name": "Spark arrester",
      "action": "clean",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000
    },
    {
      "key": "valve-clearance",
      "name": "Valve clearance",
      "action": "inspect",
      "intervalKm": 12000,
      "intervalMonths": 12,
      "firstAtKm": 1000,
      "notes": "Check and adjust valve clearance when engine is cold."
    },
    {
      "key": "crankcase-breather",
      "name": "Crankcase breather system",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Check breather hose for cracks or damage. Replace if necessary."
    },
    {
      "key": "idle-speed",
      "name": "Idle speed",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Check and adjust engine idle speed."
    },
    {
      "key": "exhaust-system",
      "name": "Exhaust system",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "notes": "Check for leakage. Tighten if necessary. Replace gasket(s) if necessary."
    },
    {
      "key": "evaporative-emission-control-system",
      "name": "Evaporative emission control system",
      "action": "inspect",
      "intervalKm": 4000,
      "intervalMonths": 24,
      "notes": "For California only. Check control system for damage. Replace if necessary."
    },
    {
      "key": "air-filter",
      "name": "Air filter element",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Check condition and for damage. Replace if necessary. Replace at 13000 mi (21000 km) and thereafter every 12000 mi (20000 km)."
    },
    {
      "key": "clutch",
      "name": "Clutch",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Check operation. Adjust or replace cable."
    },
    {
      "key": "front-brake",
      "name": "Front brake",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Check operation, fluid level, and for fluid leakage. Replace brake pads if necessary."
    },
    {
      "key": "rear-brake",
      "name": "Rear brake",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Check operation, fluid level, and for fluid leakage. Replace brake pads if necessary."
    },
    {
      "key": "brake-hoses",
      "name": "Brake hose",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Check for cracks or damage. Replace every 4 years."
    },
    {
      "key": "wheels",
      "name": "Wheels",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Check runout, spoke tightness and for damage. Tighten spokes if necessary."
    },
    {
      "key": "tires",
      "name": "Tires",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Check tread depth and for damage. Replace if necessary. Check air pressure. Correct if necessary."
    },
    {
      "key": "wheel-bearings",
      "name": "Wheel bearings",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Check bearings for smooth operation. Replace if necessary."
    },
    {
      "key": "swingarm-pivot-bushes",
      "name": "Swingarm pivot bushes",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Check bush assemblies for looseness. Lubricate with lithium-soap-based grease."
    },
    {
      "key": "chain",
      "name": "Drive chain",
      "action": "inspect",
      "intervalKm": 500,
      "firstAtKm": 1000,
      "notes": "Check chain slack, alignment and condition. Adjust and lubricate chain with a special O-ring chain lubricant thoroughly. Every 300 mi (500 km) and after washing the motorcycle or riding in the rain."
    },
    {
      "key": "steering-bearings",
      "name": "Steering bearings",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Check bearing assemblies for looseness. Moderately repack with lithium-soap-based grease."
    },
    {
      "key": "chassis-fasteners",
      "name": "Chassis fasteners",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Check all chassis fitting and fasteners. Correct if necessary."
    },
    {
      "key": "brake-lever",
      "name": "Brake lever pivot shaft",
      "action": "lubricate",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Apply silicone grease lightly."
    },
    {
      "key": "brake-pedal",
      "name": "Brake pedal pivot shaft",
      "action": "lubricate",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Apply lithium-soap-based grease lightly."
    },
    {
      "key": "clutch-lever",
      "name": "Clutch lever pivot shaft",
      "action": "lubricate",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Apply lithium-soap-based grease lightly."
    },
    {
      "key": "shift-pedal",
      "name": "Shift pedal pivot shaft",
      "action": "lubricate",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Apply lithium-soap-based grease lightly."
    },
    {
      "key": "sidestand",
      "name": "Sidestand pivot",
      "action": "lubricate",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Check operation. Apply lithium-soap-based grease lightly."
    },
    {
      "key": "sidestand-switch",
      "name": "Sidestand switch",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Check operation and replace if necessary."
    },
    {
      "key": "suspension-front",
      "name": "Front fork",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Check operation and for oil leakage. Replace if necessary."
    },
    {
      "key": "suspension-rear",
      "name": "Shock absorber assembly",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Check operation and for oil leakage. Replace if necessary."
    },
    {
      "key": "rear-suspension",
      "name": "Rear suspension link pivots",
      "action": "inspect",
      "intervalKm": 12000,
      "intervalMonths": 24,
      "notes": "Check operation. Correct if necessary."
    },
    {
      "key": "engine-oil",
      "name": "Engine oil",
      "action": "replace",
      "intervalKm": 3000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Change (warm engine before draining)."
    },
    {
      "key": "oil-filter",
      "name": "Engine oil filter element",
      "action": "replace",
      "intervalKm": 6000,
      "intervalMonths": 12,
      "firstAtKm": 1000
    },
    {
      "key": "brake-switches",
      "name": "Front and rear brake switches",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Check operation."
    },
    {
      "key": "control-cables",
      "name": "Control cables",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Apply Yamaha chain and cable lube or engine oil SAE 10W-30 thoroughly."
    },
    {
      "key": "throttle",
      "name": "Throttle grip housing and cable",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Check operation and free play. Adjust the throttle cable free play if necessary. Lubricate the throttle grip housing and cable."
    },
    {
      "key": "lights",
      "name": "Lights, signals and switches",
      "action": "inspect",
      "intervalKm": 6000,
      "intervalMonths": 6,
      "firstAtKm": 1000,
      "notes": "Adjust headlight beam."
    }
  ],
};

function buildScheduleSeeds(): any[] {
  return Object.entries(scheduleSeeds)
    .filter(([, items]) => items.length > 0)
    .map(([vehicleId, items], i) => ({
      id: `schedule-seed-${i}`,
      createdAt: 1700000002500 + i,
      userId: smokeTestUserId,
      vehicleId,
      source: "manual",
      status: "confirmed",
      items,
    }));
}

function buildStore({ debug }: { debug?: boolean }) {
  debug && console.log(`services.stores.memory.create`);

  return {
    users: new MemoryStore<User>({ ...storeConfigs.users, debug, seed: seed.users }),
    vehicles: new MemoryStore<Vehicle>({ ...storeConfigs.vehicles, debug, seed: seed.vehicles }),
    logs: new MemoryStore<Log>({ ...storeConfigs.logs, debug, seed: buildLogSeeds() }),
    attachments: new MemoryStore<Attachment>({ ...storeConfigs.attachments, debug, seed: seed.attachments }),
    // no seeded documents on purpose: a seeded "ready" doc would also need seeded mock
    // vectors (not worth the coupling); S9's spec creates its own fixture document
    documents: new MemoryStore<Document>({ ...storeConfigs.documents, debug, seed: seed.documents }),
    // seeded only from scheduleSeeds above (empty until real manuals are copied in);
    // S10's spec still creates its own fixtures via the API regardless
    schedules: new MemoryStore<MaintenanceSchedule>({ ...storeConfigs.schedules, debug, seed: buildScheduleSeeds() }),
  };
}

type MemoryStoreInstance = ReturnType<typeof buildStore>;

// Unlike RedisStore (a stateless client against one shared external Redis server, so it
// doesn't matter how many separate instances get constructed), a MemoryStore's data only
// lives in its own JS Maps -- every services/*.ts module calls createStore() independently
// at import time, so without a true process-wide singleton each module would get its own
// disconnected copy of "the store" and writes in one service would be invisible to
// another. Caching on globalThis (rather than a module-level variable) also survives
// Next.js dev's per-route module duplication, the same reason Prisma clients are cached
// there this way.
const globalForMemoryStore = globalThis as unknown as { __motoMemoryStore?: MemoryStoreInstance };

export function createStore({
  debug
}: {
  debug?: boolean
}) {
  if (!globalForMemoryStore.__motoMemoryStore) {
    globalForMemoryStore.__motoMemoryStore = buildStore({ debug });
  }

  return globalForMemoryStore.__motoMemoryStore;
};
