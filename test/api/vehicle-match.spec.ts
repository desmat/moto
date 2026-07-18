import { test, expect } from '@playwright/test';
import { matchVehicleDescription } from '../../types/Vehicle';

// covers the pure receipt-vehicle resolver (types/Vehicle.ts) the service-log dialog
// uses to auto-select the vehicle picker from the description a shop prints on the
// receipt. No server involved — plain function tests (Playwright is the only runner
// configured, so they live here alongside the API specs).

const vehicle = (id: string, maker: string, model: string, year: number) =>
  ({ id, createdAt: 0, userId: 'u', type: 'motorcycle', maker, model, year } as any);

const garage = [
  vehicle('cb', 'Honda', 'CB500X', 2021),
  vehicle('xt', 'Yamaha', 'XT250', 2018),
];

test('matches on model regardless of case, spacing, and punctuation', () => {
  expect(matchVehicleDescription('2021 HONDA CB500X', garage)?.id).toBe('cb');
  expect(matchVehicleDescription('Honda CB 500-X', garage)?.id).toBe('cb');
  expect(matchVehicleDescription('YAMAHA XT250 (2018)', garage)?.id).toBe('xt');
});

test('punctuation differences in the stored model never block a match', () => {
  const gsxr = [vehicle('gsxr', 'Suzuki', 'GSX-R750', 2019)];
  expect(matchVehicleDescription('SUZUKI GSXR750', gsxr)?.id).toBe('gsxr');
});

test('loose model overlap: a shop\'s naming variant still matches (real-receipt case)', () => {
  // the record says CRF250RL; the shop printed "CRF250 Rally" plus the VIN — the
  // shared "CRF250" prefix (75% of the model) is enough evidence
  const crf = [...garage, vehicle('crf', 'Honda', 'CRF250RL', 2020)];
  expect(matchVehicleDescription('Honda CRF250 Rally - MLHMD4426L5300137', crf)?.id).toBe('crf');

  // and the reverse: a verbose record model vs the shop's terse variant
  const rally = [vehicle('rally', 'Honda', 'CRF250 Rally', 2020)];
  expect(matchVehicleDescription('HONDA CRF250RL', rally)?.id).toBe('rally');
});

test('no model match → undefined (maker alone is not enough)', () => {
  expect(matchVehicleDescription('2021 HONDA AFRICA TWIN', garage)).toBeUndefined();
  expect(matchVehicleDescription('', garage)).toBeUndefined();
  expect(matchVehicleDescription(undefined, garage)).toBeUndefined();
  expect(matchVehicleDescription('2021 HONDA CB500X', [])).toBeUndefined();
});

test('maker and year break a tie between same-model vehicles', () => {
  const twins = [
    vehicle('a', 'Honda', 'CB500X', 2019),
    vehicle('b', 'Honda', 'CB500X', 2021),
  ];
  expect(matchVehicleDescription('2021 HONDA CB500X', twins)?.id).toBe('b');
});

test('a genuinely ambiguous description → undefined rather than a guess', () => {
  const twins = [
    vehicle('a', 'Honda', 'CB500X', 2019),
    vehicle('b', 'Honda', 'CB500X', 2021),
  ];
  expect(matchVehicleDescription('HONDA CB500X', twins)).toBeUndefined();
});
