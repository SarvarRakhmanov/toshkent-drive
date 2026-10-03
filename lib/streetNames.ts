// GTA5-style road names — real Buffalo, NY street names since that's the
// city this map is themed after. Shared by Minimap.tsx (rotated, player-up
// radar) and BigMap.tsx (fixed, north-up overview) so both label the exact
// same street the exact same way; was previously defined only in Minimap.tsx,
// which meant BigMap's identical road grid had no names on it at all.
//
// Every road line (world coord ≡ 50 mod 100, City.tsx's CELL=100 grid) gets a
// permanent name: its integer street-index (which multiple of CELL it falls
// on) picks deterministically from one of two lists, so the same street
// always shows the same name no matter which map is drawing it or from what
// angle.
const NS_STREET_NAMES = ["AMIR TEMUR SH.", "NAVOIY KO'CHASI", "SHOTA RUSTAVELI", "BOBUR KO'CHASI", "MIRZO ULUG'BEK", "BUYUK IPAK YO'LI", "OYBEK KO'CHASI", "MUSTAQILLIK SH.", "FARG'ONA YO'LI", "SAYILGOH KO'CHASI"];
const EW_STREET_NAMES = ["BUNYODKOR SH.", "CHILONZOR KO'CHASI", "BESHYOG'OCH", "OLMAZOR KO'CHASI", "NUKUS KO'CHASI", "TARAS SHEVCHENKO", "ABDULLA QODIRIY", "LABZAK KO'CHASI", "QORASUV KO'CHASI", "YUNUSOBOD YO'LI"];
const CELL = 100; // City.tsx CELL

export function streetName(coord: number, axis: "x" | "z"): string {
  const idx = Math.round((coord - 50) / CELL);
  const arr = axis === "x" ? NS_STREET_NAMES : EW_STREET_NAMES;
  return arr[((idx % arr.length) + arr.length) % arr.length];
}
