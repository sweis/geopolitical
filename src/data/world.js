// Global tracks, Oct 2026. 0-100 unless noted. oil (Brent $/bbl) is derived each turn in state.deriveWorld.
export const WORLD_START = {
  hormuz: 35,          // % of normal commercial traffic through the Strait
  redSea: 40,          // % of normal Suez / Bab el-Mandeb traffic
  oil: 0, oilAdj: 0,   // derived price and OPEC+/shock adjustment
  warIntensity: 60,    // US/Israel–Iran war: 0 = settled, 100 = all-out
  iranNuclear: 50,     // breakout progress: HEU stockpile unaccounted for after the strikes
  iranSanctions: 90,   // sanctions + blockade pressure on Iran
  gazaCeasefire: 50,   // durability of the Oct 2025 ceasefire
  hamasDisarm: 10,     // progress on the July 2026 Board of Peace disarmament roadmap
  isfDeployed: 20,     // International Stabilization Force deployment (UNSCR 2803)
  humanitarian: 25,    // Gaza humanitarian conditions (higher = better)
  westBankAnnex: 30,   // Israeli sovereignty moves in the West Bank
  hezbollahDisarm: 30, // June 2026 Lebanon framework: pilot zones south of the Litani
  normalization: 15,   // Saudi–Israel normalization
  yemenWar: 65,        // Houthi–Saudi war intensity
  isisStrength: 35,
  kurdishAutonomy: 50, // SDF self-rule vs integration into the Syrian state
  usWarSupport: 38,    // US public support for the war
};

export const WORLD_LABELS = {
  oil: 'Brent', hormuz: 'Hormuz traffic', redSea: 'Red Sea traffic', warIntensity: 'Iran war intensity',
  iranNuclear: 'Iran breakout', iranSanctions: 'Iran sanctions', gazaCeasefire: 'Gaza ceasefire',
  hamasDisarm: 'Hamas disarmament', isfDeployed: 'ISF deployed', humanitarian: 'Gaza humanitarian',
  westBankAnnex: 'West Bank annexation', hezbollahDisarm: 'Hezbollah disarmament', normalization: 'Saudi–Israel normalization',
  yemenWar: 'Yemen war', isisStrength: 'ISIS strength', kurdishAutonomy: 'Kurdish autonomy', usWarSupport: 'US war support',
};
