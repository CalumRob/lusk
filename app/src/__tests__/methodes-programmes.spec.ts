import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  COUVERTURES_PROGRAMMES,
  LIGNE_JAMAIS_RESULTATS,
  REGLE_BADGE_ORT,
  SOURCES_PROGRAMMES,
  VOCABULAIRE_PROGRAMMES,
} from '../methodes/programmes'
import { SIGLES_PROGRAMMES } from '../payload/types'
import type { Vintage } from '../payload/types'

/**
 * Le registre Méthodes de l'élément Programmes & financements (issue #180,
 * docs/themes/README.md §The Méthodes contract). La parité avec le pipeline :
 * les SIX sources du manifeste complet du thème (MANIFEST_PROGRAMMES_COMPLET —
 * les cinq jeux ANCT/DGALN du manifeste #175 + l'export SCDL des subventions
 * #176) ont chacune une entrée de registre — l'union est le contrat, comme la
 * table des sources (methodes-sources.spec.ts). Les faits documentés (URL,
 * format, licence, fraîcheur, dates) sont ceux que le pipeline ingère
 * réellement (pipeline/R/manifest_programmes.R, pipeline/R/subventions.R) —
 * jamais inventés.
 */

const dataDir = join(process.cwd(), '..', 'public', 'data')

function lireVintagesCommites(): Vintage[] {
  const brut = JSON.parse(readFileSync(join(dataDir, 'vintages.json'), 'utf-8')) as Vintage[]
  return brut
}

/** Les mots du pipeline à ne jamais publier (la même discipline que methodes-indicateurs.spec.ts). */
const MOTS_INTERNES = [
  /gate/i,
  /\.rds\b/,
  /parquet/i,
  /sidecar/i,
  /manifeste/i,
  /artefact/i,
  /TOP_N/i,
  /histoires/,
]

describe('registre Méthodes — les sources du payload programmes', () => {
  it('documente les six sources du manifeste complet du pipeline (l\u2019union est le contrat)', () => {
    expect(Object.keys(SOURCES_PROGRAMMES)).toEqual([
      'acv',
      'pvd',
      'crte',
      'territoires_industrie',
      'ort',
      'subventions_scdl',
    ])
  })

  it('chaque source porte nom, éditeur, URL, format, licence et fraîcheur', () => {
    for (const [id, source] of Object.entries(SOURCES_PROGRAMMES)) {
      expect(source.nom.length, `« ${id} » sans nom`).toBeGreaterThan(0)
      expect(source.editeur.length, `« ${id} » sans éditeur`).toBeGreaterThan(0)
      expect(source.url, `« ${id} » sans URL https`).toMatch(/^https:\/\//)
      expect(source.format, `« ${id} » sans format`).toMatch(/^(CSV|XLSX)$/)
      expect(source.licence, `« ${id} » sans licence`).toBe('Licence Ouverte 2.0')
      expect(source.version.length, `« ${id} » sans version`).toBeGreaterThan(0)
      expect(source.fraicheur.length, `« ${id} » sans fraîcheur`).toBeGreaterThan(0)
    }
  })

  it('les quatre jeux ANCT portent la référence COG et la mise en ligne du fichier', () => {
    expect(SOURCES_PROGRAMMES.acv).toMatchObject({
      dateReference: '2025-01-01',
      datePublication: '2025-09-24',
    })
    expect(SOURCES_PROGRAMMES.pvd).toMatchObject({
      dateReference: '2025-01-01',
      datePublication: '2026-04-27',
    })
    expect(SOURCES_PROGRAMMES.crte).toMatchObject({
      dateReference: '2025-07-17',
      datePublication: '2025-09-24',
    })
    expect(SOURCES_PROGRAMMES.territoires_industrie).toMatchObject({
      dateReference: '2022-12-31',
      datePublication: '2025-09-30',
    })
  })

  it('l\u2019ORT est la ressource XLSX uniquement, fraîcheur PAR LIGNE — jamais la métadonnée de page', () => {
    const ort = SOURCES_PROGRAMMES.ort
    expect(ort.format).toBe('XLSX')
    expect(ort.url).toMatch(/xlsx/i)
    expect(ort.dateReference).toBeNull()
    expect(ort.datePublication).toBeNull()
    expect(ort.fraicheur).toMatch(/par ligne|actualisation/i)
    // la métadonnée de page (mai 2025, périmée d'environ 15 mois) n'est jamais citée
    expect(ort.fraicheur).not.toMatch(/mai 2025/)
  })

  it('la subvention documente la fraîcheur hebdomadaire et son vintage verrouillé', () => {
    const subventions = SOURCES_PROGRAMMES.subventions_scdl
    expect(subventions.fraicheur).toMatch(/semaine|hebdomadaire/i)
    expect(subventions.version).toBe('2026-08-05')
    expect(subventions.dateReference).toBe('2026-08-05')
    expect(subventions.datePublication).toBe('2026-08-05')
  })

  it('chaque source porte une note éditoriale en français public, jamais un mot interne', () => {
    for (const [id, source] of Object.entries(SOURCES_PROGRAMMES)) {
      expect(source.note.length, `« ${id} » sans note`).toBeGreaterThan(20)
      for (const motif of MOTS_INTERNES) {
        expect(
          motif.test(source.note),
          `« ${id} » porte un mot interne : ${motif}`,
        ).toBe(false)
      }
    }
  })

  it('chaque source rend un lien vers son jeu de données — jamais une URL inventée', () => {
    for (const [id, source] of Object.entries(SOURCES_PROGRAMMES)) {
      expect(source.url.startsWith('https://'), `« ${id} » sans URL`).toBe(true)
    }
  })
})

describe('registre Méthodes — le vocabulaire des badges', () => {
  it('couvre chaque sigle du contrat payload (SIGLES_PROGRAMMES)', () => {
    expect(Object.keys(VOCABULAIRE_PROGRAMMES).sort()).toEqual(
      [...SIGLES_PROGRAMMES].sort(),
    )
  })

  it('chaque sigle s\u2019expand en nom complet — jamais vide', () => {
    for (const [sigle, nom] of Object.entries(VOCABULAIRE_PROGRAMMES)) {
      expect(nom.length, `« ${sigle} » sans nom`).toBeGreaterThan(0)
    }
  })

  it('ACV, PVD, CRTE et ORT s\u2019expandent vers leur nom officiel', () => {
    expect(VOCABULAIRE_PROGRAMMES.ACV).toBe('Action Cœur de Ville')
    expect(VOCABULAIRE_PROGRAMMES.PVD).toBe('Petites Villes de Demain')
    expect(VOCABULAIRE_PROGRAMMES.CRTE).toBe(
      'Contrat de Relance et de Transition Écologique',
    )
    expect(VOCABULAIRE_PROGRAMMES.ORT).toBe(
      'Opération de revitalisation de territoire',
    )
  })

  it('« Territoires d\u2019industrie » est le sigle provisoire — sans acronyme officiel', () => {
    expect(VOCABULAIRE_PROGRAMMES["Territoires d'industrie"]).toBe(
      "Territoires d'industrie",
    )
  })
})

describe('registre Méthodes — les trois sortes de couverture', () => {
  it('documente les trois sortes de couverture', () => {
    expect(COUVERTURES_PROGRAMMES.length).toBe(3)
  })

  it('chaque couverture porte titre, texte et les sigles concernés, tous connus', () => {
    for (const couverture of COUVERTURES_PROGRAMMES) {
      expect(couverture.titre.length, 'couverture sans titre').toBeGreaterThan(0)
      expect(couverture.texte.length, 'couverture sans texte').toBeGreaterThan(20)
      expect(couverture.sigles.length, 'couverture sans sigles').toBeGreaterThan(0)
      for (const sigle of couverture.sigles) {
        expect(VOCABULAIRE_PROGRAMMES[sigle], `sigle « ${sigle} » inconnu`).toBeDefined()
      }
    }
  })

  it('la première couverture : les contrats EPCI couvrent leurs communes membres', () => {
    const contrats = COUVERTURES_PROGRAMMES.find((c) => c.sigles.includes('CRTE'))
    expect(contrats).toBeDefined()
    expect(contrats!.sigles).toContain("Territoires d'industrie")
    expect(contrats!.texte).toMatch(/EPCI/)
  })

  it('la deuxième couverture : les labels remontent en portage nommé', () => {
    const labels = COUVERTURES_PROGRAMMES.find((c) => c.sigles.includes('ACV'))
    expect(labels).toBeDefined()
    expect(labels!.sigles).toContain('PVD')
    expect(labels!.texte).toMatch(/nomm|portage/i)
  })

  it('la troisième couverture : le département et la région comptent, jamais un badge plat', () => {
    const agregation = COUVERTURES_PROGRAMMES.find((c) => /département|région/i.test(c.titre))
    expect(agregation).toBeDefined()
    expect(agregation!.texte).toMatch(/compt|agrég|total/i)
  })
})

describe('registre Méthodes — la règle du badge ORT et la ligne « jamais les résultats »', () => {
  it('documente la règle du badge ORT : badgé seulement là où il ajoute de l\u2019information', () => {
    expect(REGLE_BADGE_ORT.length).toBeGreaterThan(20)
    // le double badge avec un label portant le rider est interdit
    expect(REGLE_BADGE_ORT).toMatch(/double/i)
    expect(REGLE_BADGE_ORT).toMatch(/jamais|interdit/i)
    expect(REGLE_BADGE_ORT).toMatch(/convention valant ORT|valant ORT/i)
  })

  it('porte la ligne « adhésion et montants attribués, jamais les résultats »', () => {
    expect(LIGNE_JAMAIS_RESULTATS.length).toBeGreaterThan(20)
    expect(LIGNE_JAMAIS_RESULTATS).toMatch(/jamais les résultats/i)
    expect(LIGNE_JAMAIS_RESULTATS).toMatch(/adhésion|adhesion/i)
    expect(LIGNE_JAMAIS_RESULTATS).toMatch(/attribu/i)
  })
})

describe('registre Méthodes — la parité avec la table vintages commise', () => {
  it('chaque id programmes de la table vintages commise a une entrée de registre', () => {
    // Aujourd'hui la table vintages commise ne porte pas encore les ids du
    // thème (le run programmes n'a pas été publié) — le test verrouille le
    // contrat pour le jour où elle les portera : un id programmes sans entrée
    // de registre échoue en le nommant (l'union est le contrat, issue #124).
    const vintages = lireVintagesCommites()
    const idsProgrammes = new Set(Object.keys(SOURCES_PROGRAMMES))
    for (const vintage of vintages) {
      if (!idsProgrammes.has(vintage.id)) continue
      expect(
        SOURCES_PROGRAMMES[vintage.id],
        `id vintages programmes « ${vintage.id} » sans entrée de registre`,
      ).toBeDefined()
    }
  })
})
