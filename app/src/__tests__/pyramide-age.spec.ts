import { describe, expect, it } from 'vitest'

import { bandesPyramideSexuee, estPyramideSexuee } from '../fiche/pyramideAge'
import { indicateursDemographieFixture } from '../payload/fixtures'
import type { Indicateur } from '../payload/types'

/** Le payload legacy : sept lignes totales, une par tranche, SANS dimension sexe. */
function lignesLegacy(territoire = '22001'): Indicateur[] {
  return indicateursDemographieFixture.filter(
    (l) => l.territoire === territoire && l.key === 'structure_age',
  )
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
})
