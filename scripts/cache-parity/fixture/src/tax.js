const RATES = { us: 0.07, eu: 0.2, uk: 0.2, none: 0 };

export function taxRate(region) {
  return RATES[region] ?? 0;
}

export function taxCents(baseCents, region) {
  return Math.round(baseCents * taxRate(region));
}
