// Map hotspots. lon/lat are projected onto the baked map at runtime.
// controller: the actor whose stability/forces take the hit when the theater is attacked.
// infl: starting influence (0-100) of actors with presence on the ground.
export const THEATERS = [
  { id: 'gaza', name: 'Gaza Strip', lon: 34.42, lat: 31.42, controller: 'hamas', tension: 60,
    infl: { israel: 55, hamas: 40, pij: 15, egypt: 15, us: 5 }, adj: ['israelHome', 'sinai', 'westbank'] },
  { id: 'westbank', name: 'West Bank', lon: 35.3, lat: 32.0, controller: 'israel', tension: 50,
    infl: { israel: 70, hamas: 15, pij: 10 }, adj: ['israelHome', 'gaza'] },
  { id: 'israelHome', label: 'Central Israel', name: 'Central Israel', lon: 34.85, lat: 32.4, controller: 'israel', tension: 45,
    infl: { israel: 95 }, adj: ['gaza', 'westbank', 'southLebanon', 'southSyria'] },
  { id: 'southLebanon', label: 'S. Lebanon', name: 'South Lebanon', lon: 35.45, lat: 33.25, controller: 'lebanon', tension: 55,
    infl: { hezbollah: 45, israel: 30, lebanon: 30 }, adj: ['israelHome', 'beirut', 'southSyria'] },
  { id: 'beirut', name: 'Beirut', lon: 35.6, lat: 33.95, controller: 'lebanon', tension: 40,
    infl: { lebanon: 55, hezbollah: 35, saudi: 10, eu: 5 }, adj: ['southLebanon', 'damascus', 'tartus'] },
  { id: 'southSyria', label: 'S. Syria (Golan)', name: 'Southern Syria (Golan / Sweida)', lon: 36.3, lat: 32.75, controller: 'syria', tension: 45,
    infl: { syria: 40, israel: 35 }, adj: ['israelHome', 'southLebanon', 'damascus'] },
  { id: 'damascus', name: 'Damascus', lon: 36.6, lat: 33.6, controller: 'syria', tension: 30,
    infl: { syria: 75, turkey: 20, saudi: 10, russia: 5 }, adj: ['southSyria', 'beirut', 'badiya', 'tartus'] },
  { id: 'tartus', label: 'Latakia / Tartus', name: 'Latakia / Tartus', lon: 35.95, lat: 35.2, controller: 'syria', tension: 20,
    infl: { syria: 50, russia: 40 }, adj: ['damascus', 'beirut', 'ankara'] },
  { id: 'badiya', label: 'Badiya desert', name: 'Syrian Desert (Badiya)', lon: 39.2, lat: 34.6, controller: 'syria', tension: 45,
    infl: { isis: 35, syria: 30, sdf: 10 }, adj: ['damascus', 'neSyria', 'baghdad'] },
  { id: 'neSyria', label: 'NE Syria', name: 'NE Syria (Rojava)', lon: 40.9, lat: 36.6, controller: 'sdf', tension: 50,
    infl: { sdf: 60, syria: 20, isis: 15, turkey: 10, us: 5 }, adj: ['badiya', 'ankara', 'kurdistan'] },
  { id: 'ankara', name: 'Ankara', lon: 32.85, lat: 39.93, controller: 'turkey', tension: 20,
    infl: { turkey: 95 }, adj: ['neSyria', 'tartus', 'kurdistan'] },
  { id: 'kurdistan', label: 'Erbil (KRG)', name: 'Iraqi Kurdistan (Erbil)', lon: 44.0, lat: 36.2, controller: 'krg', tension: 40,
    infl: { krg: 70, turkey: 20, iran: 10, iraqMilitias: 5 }, adj: ['neSyria', 'baghdad', 'tehran', 'ankara'] },
  { id: 'baghdad', name: 'Baghdad', lon: 44.4, lat: 33.3, controller: 'iraqMilitias', tension: 45,
    infl: { iraqMilitias: 55, iran: 30, us: 5 }, adj: ['badiya', 'kurdistan', 'tehran', 'riyadh'] },
  { id: 'tehran', name: 'Tehran', lon: 51.4, lat: 35.7, controller: 'iran', tension: 70,
    infl: { iran: 95 }, adj: ['baghdad', 'kurdistan', 'nuclearSites', 'hormuz'] },
  { id: 'nuclearSites', label: 'Isfahan–Natanz', name: 'Isfahan–Natanz–Fordow', lon: 51.7, lat: 33.4, controller: 'iran', tension: 70,
    infl: { iran: 90 }, adj: ['tehran', 'hormuz'] },
  { id: 'hormuz', label: 'Strait of Hormuz', name: 'Strait of Hormuz', lon: 56.4, lat: 26.5, controller: 'iran', tension: 85,
    infl: { iran: 65, us: 40, china: 5 }, adj: ['nuclearSites', 'gulfBases', 'tehran'] },
  { id: 'gulfBases', label: 'Gulf bases', name: 'Gulf bases (Qatar / Bahrain)', lon: 51.2, lat: 25.6, controller: 'us', tension: 55,
    infl: { us: 70, saudi: 10 }, adj: ['hormuz', 'riyadh'] },
  { id: 'riyadh', name: 'Riyadh', lon: 46.7, lat: 24.7, controller: 'saudi', tension: 40,
    infl: { saudi: 95, us: 10, china: 5 }, adj: ['gulfBases', 'northYemen', 'baghdad', 'redSea'] },
  { id: 'northYemen', label: "Sana'a", name: "Sana'a / North Yemen", lon: 44.2, lat: 15.35, controller: 'houthis', tension: 65,
    infl: { houthis: 80, saudi: 10 }, adj: ['riyadh', 'babElMandeb'] },
  { id: 'babElMandeb', label: 'Bab el-Mandeb', name: 'Bab el-Mandeb', lon: 43.3, lat: 12.6, controller: 'houthis', tension: 75,
    infl: { houthis: 45, us: 25, eu: 15, china: 5 }, adj: ['northYemen', 'redSea'] },
  { id: 'redSea', label: 'Red Sea lanes', name: 'Red Sea lanes', lon: 38.3, lat: 21.0, controller: 'egypt', tension: 55,
    infl: { us: 20, eu: 20, egypt: 20, saudi: 20 }, adj: ['babElMandeb', 'sinai', 'riyadh'] },
  { id: 'sinai', label: 'Sinai / Rafah', name: 'Sinai & Rafah', lon: 33.8, lat: 29.9, controller: 'egypt', tension: 35,
    infl: { egypt: 85 }, adj: ['redSea', 'gaza'] },
];

export const THEATER_BY_ID = Object.fromEntries(THEATERS.map((t) => [t.id, t]));

// Off-map anchor points for actors whose capitals sit outside the theater (arcs start here).
export const ANCHORS = {
  eu: { lon: 25.2, lat: 40.6, label: 'EU' },
  russia: { lon: 47.5, lat: 42.0, label: 'Russia' },
  china: { lon: 62.8, lat: 30.5, label: 'China' },
};
