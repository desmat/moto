# CB500X maintenance schedule — ground truth (manual pages 61–62)

Transcribed by the coordinator from screenshots of the actual manual. The table is a
grid: rows = items, columns = odometer frequencies expressed as MULTIPLIER HEADERS
(`× 1,000 km: 1 | 12 | 24 | 36 | 48`, i.e. 1,000 / 12,000 / 24,000 / 36,000 / 48,000 km;
the `× 1,000 mi` row is the same distances in miles), plus a Pre-ride Check column, an
Annual Check column, and a Regular Replace column. Cells contain legend icons:
I = Inspect, L = Lubricate, R = Replace, C = Clean. Note *1: "At higher odometer
reading, repeat at the frequency interval established here" — so an icon pattern like
R at 12/24/36/48 means "every 12,000 km", and R at 24/48 means "every 24,000 km".
An icon at the `1` (=1,000 km) column is the one-time break-in service → firstAtKm.
Footnotes: *2 service more often in wet/dusty areas (Air Cleaner); *3 more often in
rain / full throttle (Crankcase Breather); *4 Brake Fluid: replacement requires
mechanical skill + Regular Replace 2 years; Radiator Coolant *4-annotation on page 61
is a typo in this transcription — coolant's Regular Replace is 3 years; *5 ED/KO type
only (Evaporative Emission).

## Expected items (29 rows; km per icon-pattern decode, months from Annual Check = 12)

| key (canonical-ish) | name | action | intervalKm | intervalMonths | firstAtKm | note-must-mention |
|---|---|---|---|---|---|---|
| fuel-line | Fuel Line | inspect | 12000 | 12 | — | |
| fuel-level | Fuel Level | inspect | — | — | — | pre-ride only (row OK to omit or no-interval) |
| throttle | Throttle Operation | inspect | 12000 | 12 | — | |
| air-filter | Air Cleaner | replace | 24000 | — | — | dusty/wet areas (*2) |
| crankcase-breather | Crankcase Breather | clean | 12000 | — | — | rain / full throttle (*3) |
| spark-plugs | Spark Plug | replace | 24000 | — | — | |
| valve-clearance | Valve Clearance | inspect | 24000 | — | — | |
| engine-oil | Engine Oil | replace | 12000 | 12 | 1000 | |
| oil-filter | Engine Oil Filter | replace | 24000 | — | 1000 | |
| engine-idle-speed | Engine Idle Speed | inspect | 12000 | 12 | — | |
| coolant | Radiator Coolant | replace | — | 36 | — | inspect every 12000 km/12 mo too; "3 Years" regular replace |
| cooling-system | Cooling System | inspect | 12000 | 12 | — | |
| secondary-air-supply | Secondary Air Supply System | inspect | 24000 | — | — | |
| evaporative-emission | Evaporative Emission Control System | inspect | 24000 | — | — | ED/KO only (*5) |
| chain | Drive Chain | lubricate (or inspect) | 1000 | — | — | every 1,000 km, I+L |
| chain-slider | Drive Chain Slider | inspect | 12000 | — | — | |
| brake-fluid | Brake Fluid | replace | — | 24 | — | also inspected 12000/12; "2 Years" |
| brake-pads | Brake Pads Wear | inspect | 12000 | 12 | — | (brake-pads-front/-rear also acceptable) |
| brake-system | Brake System | inspect | 12000 | 12 | — | |
| brakelight-switch | Brakelight Switch | inspect | 12000 | 12 | — | |
| headlight-aim | Headlight Aim | inspect | 12000 | 12 | — | |
| lights-horn | Lights/Horn | inspect | — | — | — | pre-ride only (OK to omit or no-interval) |
| engine-stop-switch | Engine Stop Switch | inspect | — | — | — | pre-ride only (OK to omit or no-interval) |
| clutch | Clutch System | inspect | 12000 | 12 | — | |
| side-stand | Side Stand | inspect | 12000 | 12 | — | |
| suspension-front / suspension | Suspension | inspect | 12000 | 12 | — | |
| nuts-bolts-fasteners | Nuts, Bolts, Fasteners | inspect | 12000 | 12 | — | |
| wheels | Wheels/Tyres | inspect | 12000 | 12 | — | |
| steering-bearings | Steering Head Bearings | inspect | 12000 | 12 | — | |

## Grading (score each run against this)

1. **Interval decode rate** (the big one): of the rows with a table-derived interval,
   how many extracted items have the RIGHT intervalKm/intervalMonths? The v1 prompt got
   ~5/25 — most came back null or wrong (e.g. air-filter 12000-inspect instead of
   24000-replace, crankcase-breather 6000 instead of 12000).
2. **Key/name pairing**: no row-drift (v1 paired key=wheels with name="Nuts, Bolts…" and
   key=front-tire with name="Wheels/Tyres"). Name must correspond to its own key.
3. **Action decode**: icon → action correct (R=replace, I=inspect, C=clean, L=lubricate).
4. **firstAtKm**: engine-oil and oil-filter get 1000, nothing else does.
5. **No fabrication**: no items absent from the table; pre-ride-only rows may be omitted
   or carried without intervals — either is fine, inventing intervals for them is a fail.
6. **Coverage**: ≥ 24 of the interval-bearing rows present.
7. **Notes**: footnote conditions (*2 dusty, *3 rain, *5 ED/KO) surface in notes;
   original phrasing like "2 Years"/"3 Years" preserved.
