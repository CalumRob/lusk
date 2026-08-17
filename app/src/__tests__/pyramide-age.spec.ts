import { describe, expect, it } from 'vitest'

import { bandesPyramideSexuee, estPyramideSexuee } from '../fiche/pyramideAge'
import { indicateursDemographieFixture } from '../payload/fixtures'
import type { Indicateur } from '../payload/types'

/**
 * Le payload legacy : sept lignes totales, une par tranche, SANS dimension
 * sexe. Synthétisé indépendamment du fixture (qui, après #390, est sexué pour
 * 22001) — sert à tester le repli honnête, sans dépendre de la forme du
 * fixture.
 */
const TRANCHES_LEGACY: ReadonlyArray<readonly [string, number]> = [
  ['<15', 0.3],
  ['15-24', 0.15],
  ['25-39', 0.2],
  ['40-54', 0.15],
  ['55-64', 0.05],
  ['65-79', 0.1],
  ['80+', 0.05],
]

function lignesLegacy(territoire = '22001'): Indicateur[] {
  const modele = indicateursDemographieFixture.find(
    (l) => l.territoire === territoire && l.key === 'structure_age' && l.detail === '<15',
  )!
  return TRANCHES_LEGACY.map(([detail, value]) => ({ ...modele, detail, value, sex: undefined }))
}

/** Le payload sexué complet (#390) : sept tranches × F et M. */
function lignesSexuees(territoire = '22001'): Indicateur[] {
  const base = lignesLegacy(territoire)
  const couples: Indicateur[] = []
  for (const sex of ['F', 'M'] as const) {
    for (const l of base) couples.push({ ...l, sex } as Indicateur)
  }
  return couples
}

/**
 * Mêmes 14 lignes, mais avec des valeurs DISTINCTES selon le sexe pour prouver
 * le sens du mapping : hommes (M) gardent la valeur de base, femmes (F) la
 * moitié. Base '<15' = 0.3 → hommes 0.3 (30 %), femmes 0.15 (15 %).
 */
function lignesSexueesDistinctes(territoire = '22001'): Indicateur[] {
  const base = lignesLegacy(territoire)
  const couples: Indicateur[] = []
  for (const sex of ['F', 'M'] as const) {
    for (const l of base) {
      const valeur = sex === 'F' ? (l.value ?? 0) / 2 : (l.value ?? 0)
      couples.push({ ...l, sex, value: valeur } as Indicateur)
    }
  }
  return couples
}

describe('pyramideAge — détection de la forme sexuée (estPyramideSexuee)', () => {
  it('rejette le payload legacy à sept lignes totales (sans sexe) — repli segmenté, pas de pyramide', () => {
    expect(estPyramideSexuee(lignesLegacy())).toBe(false)
  })

  it('rejette un payload où un sexe traîne sur seulement sept lignes (forme incomplète)', () => {
    const partiel = lignesLegacy().map((l, i) => ({ ...l, sex: i % 2 ? 'M' : 'F' } as Indicateur))
    expect(estPyramideSexuee(partiel)).toBe(false)
  })

  it('accepte la forme complète sept tranches × F+M avec sexe explicite (#390)', () => {
    expect(estPyramideSexuee(lignesSexuees())).toBe(true)
  })

  it('exige exactement 14 lignes (ni 13 ni 15)', () => {
    expect(estPyramideSexuee(lignesSexuees().slice(0, 13))).toBe(false)
    expect(estPyramideSexuee([...lignesSexuees(), { ...lignesSexuees()[0] } as Indicateur])).toBe(false)
  })

  it('rejette une paire (detail, sex) en double', () => {
    const doublon = [...lignesSexuees(), { ...lignesSexuees()[0] } as Indicateur]
    expect(estPyramideSexuee(doublon)).toBe(false)
  })

  it('rejette une forme incomplète (deux lignes F pour la même tranche)', () => {
    const lignes = lignesSexuees()
    // remplace la dernière (M, '80+') par une seconde F '<15' → F en double, M incomplet
    lignes[lignes.length - 1] = { ...lignes[0], sex: 'F' } as Indicateur
    expect(estPyramideSexuee(lignes)).toBe(false)
  })

  it('rejette une tranche hors du contrat ORDRE_AGE (les sept fixes) — repli honnête', () => {
    const lignes = lignesSexuees()
    // une tranche « 0-4 » hors ORDRE_AGE casse la forme sexuée
    lignes[0] = { ...lignes[0], detail: '0-4' } as Indicateur
    expect(estPyramideSexuee(lignes)).toBe(false)
  })
})

describe('pyramideAge — convention des codes sexe (INSEE : F = femmes, M = hommes)', () => {
  it('mappe F → côté femmes et M → côté hommes, jamais l’inverse', () => {
    const bandes = bandesPyramideSexuee(lignesSexueesDistinctes())
    // base '<15' : 0.3 (%) ; hommes (M) = 0.3 → 30, femmes (F) = 0.15 → 15
    expect(bandes[0].valeurHommes).toBeCloseTo(0.3, 6)
    expect(bandes[0].valeurFemmes).toBeCloseTo(0.15, 6)
    expect(bandes[0].texteHommes).toBe('30')
    expect(bandes[0].texteFemmes).toBe('15')
  })
})

describe('pyramideAge — bandes du pyramid à deux côtés (bandesPyramideSexuee)', () => {
  it('rend sept bandes ordonnées jeune-en-bas, un côté hommes / un côté femmes', () => {
    const bandes = bandesPyramideSexuee(lignesSexuees())
    expect(bandes).toHaveLength(7)
    expect(bandes[0].tranche).toBe('<15')
    expect(bandes[6].tranche).toBe('80+')
    for (const b of bandes) {
      expect(b.valeurHommes).not.toBeNull()
      expect(b.valeurFemmes).not.toBeNull()
      expect(b.texteHommes).not.toBe('')
      expect(b.texteFemmes).not.toBe('')
      expect(b.largeurHommes).toBeGreaterThanOrEqual(0)
      expect(b.largeurFemmes).toBeGreaterThanOrEqual(0)
    }
  })

  it('utilise le libellé de métadonnée, jamais la clé brute', () => {
    const bandes = bandesPyramideSexuee(lignesSexuees(), {
      '<15': 'Moins de 15 ans',
      '80+': '80 ans et plus',
    })
    expect(bandes[0].libelle).toBe('Moins de 15 ans')
    expect(bandes[6].libelle).toBe('80 ans et plus')
  })

  it('rend un libellé vide (jamais la clé brute) quand labelsDetail est absent', () => {
    const bandes = bandesPyramideSexuee(lignesSexuees())
    expect(bandes[0].libelle).toBe('')
    expect(bandes[6].libelle).toBe('')
    // la clé brute « <15 » / « 80+ » ne doit jamais apparaître comme libellé
    for (const b of bandes) expect(b.libelle).not.toMatch(/^<|\+$/)
  })
})
