/**
 * Local police emergency numbers by ISO 3166-1 alpha-2 country code.
 *
 * Used by the in-transit Emergency Call button: the passenger's pickup is in
 * their own selected area, so the number is resolved from that country —
 * fully offline, no geocoding on the critical path.
 *
 * Where a country has a distinct police line it is preferred over the general
 * emergency number. Fallback is 112: the GSM standard emergency number that
 * mobile networks route to local emergency services in most of the world.
 */
const POLICE: Record<string, string> = {
  // Southeast Asia
  VN: '113', SG: '999', TH: '191', MY: '999', ID: '110', PH: '911',
  MM: '199', KH: '117', BN: '993', LA: '191', TL: '112',
  // South Asia
  IN: '112', PK: '15', BD: '999', LK: '119', NP: '100',
  // East Asia
  HK: '999', MO: '999', TW: '110', JP: '110', KR: '112', CN: '110',
  // Oceania
  AU: '000', NZ: '111',
  // Central Asia & Caucasus
  KZ: '102', UZ: '102', KG: '102', TJ: '102', GE: '112', AZ: '102', AM: '102',
  // Eastern Europe
  RU: '102', UA: '102', BY: '102', MD: '112',
  // Western & Northern Europe
  GB: '999', IE: '112', FR: '17', DE: '110', NL: '112', BE: '101', LU: '113',
  CH: '117', AT: '133', SE: '112', FI: '112', NO: '112', DK: '112',
  // Southern Europe
  ES: '112', PT: '112', IT: '112', GR: '100', MT: '112', CY: '112',
  // Central & Southeastern Europe
  PL: '112', CZ: '158', SK: '158', HU: '107', RO: '112', BG: '112',
  HR: '192', SI: '113', RS: '192', BA: '122', ME: '122', MK: '192',
  AL: '129', EE: '112', LV: '112', LT: '112',
  // Middle East
  TR: '155', AE: '999', SA: '999', QA: '999', BH: '999', KW: '112',
  OM: '9999', JO: '911', LB: '112', IQ: '104', IL: '100',
  // North Africa
  EG: '122', MA: '19', TN: '197', DZ: '17',
  // Sub-Saharan Africa
  NG: '112', ZA: '10111', KE: '999', GH: '191', TZ: '112', UG: '999',
  CI: '170', SN: '17', CM: '117', ET: '991', MZ: '119', ZM: '999',
  AO: '113', ZW: '995', RW: '112', CD: '112', NA: '10111', BW: '999',
  // North & Central America, Caribbean
  US: '911', CA: '911', MX: '911', GT: '110', SV: '911', HN: '911',
  NI: '118', CR: '911', PA: '104', DO: '911', PR: '911', TT: '999',
  // South America
  BR: '190', AR: '911', CL: '133', CO: '123', PE: '105', EC: '911',
  BO: '110', PY: '911', UY: '911', VE: '911',
};

/** Police number for a country code; 112 when unknown/'XX'/empty. */
export function policeNumberFor(countryCode?: string | null): string {
  const c = (countryCode || '').trim().toUpperCase();
  return POLICE[c] || '112';
}
