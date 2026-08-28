/**
 * [PROTOTYPE #511 — JETABLE]
 *
 * A tiny projection of the Mobilité snapshot used only by Variant D while the
 * full `share_*_{t,b,c}` facts are not part of the public histoires contract.
 * Values were read from mobilite_snapshot.rds (snapshot 2026-02), not invented
 * for the screen. The adapter is deliberately local to the prototype and must
 * disappear or move behind the payload seam before this page becomes product.
 */

export type ServiceMobiliteCahier =
  | 'administration'
  | 'alimentation'
  | 'sante'
  | 'banque'
  | 'ecole'

export type ModeMobiliteCahier = 'c' | 'b' | 't'

export interface PartsAccesMobiliteCahier {
  c: number
  b: number
  t: number
}

export interface DonneesMobiliteCahier {
  totalBatimentsBretons: number
  batimentsTerritoire: number
  parts: Record<ServiceMobiliteCahier, PartsAccesMobiliteCahier>
  medianes: Record<ServiceMobiliteCahier, PartsAccesMobiliteCahier>
  rangsPied: Record<ServiceMobiliteCahier, { rang: number; total: number }>
}

const donneesLorient: DonneesMobiliteCahier = {
  totalBatimentsBretons: 1_175_048,
  batimentsTerritoire: 65_078,
  parts: {
    administration: { c: 1, b: 0.86, t: 0.78 },
    alimentation: { c: 1, b: 0.89, t: 0.86 },
    sante: { c: 1, b: 0.86, t: 0.82 },
    banque: { c: 1, b: 0.84, t: 0.78 },
    ecole: { c: 1, b: 0.88, t: 0.83 },
  },
  medianes: {
    administration: { c: 1, b: 0.695, t: 0.605 },
    alimentation: { c: 1, b: 0.66, t: 0.6 },
    sante: { c: 1, b: 0.57, t: 0.51 },
    banque: { c: 1, b: 0.45, t: 0.37 },
    ecole: { c: 1, b: 0.695, t: 0.61 },
  },
  rangsPied: {
    administration: { rang: 3, total: 60 },
    alimentation: { rang: 4, total: 60 },
    sante: { rang: 2, total: 60 },
    banque: { rang: 2, total: 60 },
    ecole: { rang: 3, total: 60 },
  },
}

// Commune de Lorient, the commune slice paired with the EPCI above. The
// EPCI medians stay the same so switching the territory does not silently
// switch the comparison universe.
const donneesLorientCommune: DonneesMobiliteCahier = {
  totalBatimentsBretons: donneesLorient.totalBatimentsBretons,
  batimentsTerritoire: 11_455,
  parts: {
    administration: { c: 1, b: 1, t: 0.98 },
    alimentation: { c: 1, b: 1, t: 1 },
    sante: { c: 1, b: 1, t: 1 },
    banque: { c: 1, b: 1, t: 1 },
    ecole: { c: 1, b: 1, t: 1 },
  },
  medianes: donneesLorient.medianes,
  rangsPied: {
    administration: { rang: 3, total: 25 },
    alimentation: { rang: 1, total: 25 },
    sante: { rang: 1, total: 25 },
    banque: { rang: 1, total: 25 },
    ecole: { rang: 1, total: 25 },
  },
}

const donneesParTerritoire: Readonly<Record<string, DonneesMobiliteCahier>> = {
  // CA Lorient Agglomération
  '200042174': donneesLorient,
  // Commune de Lorient, the corresponding commune page in this prototype slice
  '56121': donneesLorientCommune,
}

export function donneesMobiliteCahierPour(territoire: string): DonneesMobiliteCahier | null {
  return donneesParTerritoire[territoire] ?? null
}
