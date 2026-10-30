import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { THEMES_CANONIQUES } from '../payload/types'
import type { Theme, ThemeMetadata } from '../payload/types'
import { validerThemeMetadata } from '../payload/validate'

/**
 * #868 — contrat du catalogue navigateur servi. Les fichiers public/data/theme_*.json
 * sont la PROJECTION SERVIE AU NAVIGATEUR (nginx en production, Vite en dev/build via
 * copy-payload-build) : ils ne portent plus les champs producer-only que ni le
 * navigateur ni les lecteurs du payload committé ne lisent (story_keys,
 * observed_collection_contracts, semantic_resources). Le canon producteur complet
 * reste épinglé sous pipeline/inst/extdata/theme-metadata/ (publish/API/recovery).
 *
 * Ce spec verrouille les deux côtés : la projection servie se valide avec le
 * validateur navigateur (story_keys devenu optionnel) et exclut les champs retirés ;
 * le canon épinglé les porte toujours. Les clauses factuelles retenues (les deux
 * cadrages #827, libellés, source_records, indicator_pages, sources) restent servies.
 */

const CHAMPS_HORS_NAVIGATEUR = ['story_keys', 'observed_collection_contracts', 'semantic_resources'] as const

function lireJson(relatif: string): Record<string, any> {
  return JSON.parse(readFileSync(resolve(process.cwd(), '..', ...relatif.split('/')), 'utf8'))
}

const PUBLIC = (theme: string) => `public/data/theme_${theme}.json`
const CANON = (theme: string) => `pipeline/inst/extdata/theme-metadata/theme_${theme}.json`

describe('catalogue navigateur servi (#868) — projection réduite, canon complet conservé', () => {
  it.each(THEMES_CANONIQUES)('theme_%s.json servi : champs producer-only absents, contrat navigateur valide', (theme: Theme) => {
    const brut = lireJson(PUBLIC(theme))
    for (const champ of CHAMPS_HORS_NAVIGATEUR) {
      expect(champ in brut, `le champ producer-only « ${champ} » ne doit plus être servi`).toBe(false)
    }
    // la projection servie passe le validateur navigateur (story_keys optionnel)
    const metadata = validerThemeMetadata(brut, PUBLIC(theme))
    expect(metadata.theme).toBe(theme)
    expect(metadata.subgroups.length).toBeGreaterThan(0)
    expect(Object.keys(metadata.indicator_labels).length).toBeGreaterThan(0)
    expect(metadata.source_records).toBeDefined()
    expect(metadata.indicator_pages).toBeDefined()
  })

  it.each(THEMES_CANONIQUES)('canon producteur theme_%s.json (extdata) : champs complets toujours présents', (theme: Theme) => {
    const canon = lireJson(CANON(theme))
    expect('story_keys' in canon).toBe(true)
    expect(Array.isArray(canon.story_keys)).toBe(true)
    expect('source_records' in canon).toBe(true)
    expect('subgroups' in canon).toBe(true)
    // semantic_resources / observed_collection_contracts restent côté producteur quand déclarés
    if (theme !== 'mobilite' && theme !== 'programmes') {
      expect('semantic_resources' in canon).toBe(true)
    }
    if (theme === 'programmes') {
      expect('observed_collection_contracts' in canon).toBe(true)
    }
  })

  it('les deux clauses factuelles retenues (#827) restent servies bit à bit', () => {
    const mobilite = validerThemeMetadata(lireJson(PUBLIC('mobilite')), PUBLIC('mobilite'))
    const programmes = validerThemeMetadata(lireJson(PUBLIC('programmes')), PUBLIC('programmes'))
    const cadrageTransport = mobilite.subgroups.find((g) => g.key === 'offre-transports-commun')?.framing
    const cadrageSubventions = programmes.subgroups.find((g) => g.key === 'subventions')?.framing
    expect(typeof cadrageTransport).toBe('string')
    expect(cadrageTransport!.length).toBeGreaterThan(0)
    expect(typeof cadrageSubventions).toBe('string')
    expect(cadrageSubventions!.length).toBeGreaterThan(0)
    // identiques au canon producteur (aucune copie de fait côté TypeScript)
    const canonMobilite = lireJson(CANON('mobilite'))
    const canonProgrammes = lireJson(CANON('programmes'))
    expect(cadrageTransport).toBe(canonMobilite.subgroups.find((g: any) => g.key === 'offre-transports-commun').framing)
    expect(cadrageSubventions).toBe(canonProgrammes.subgroups.find((g: any) => g.key === 'subventions').framing)
  })

  it('les registres et sources lus par la carte/fiche restent servis (indicator_keys, sources, labels)', () => {
    for (const theme of THEMES_CANONIQUES) {
      const metadata: ThemeMetadata = validerThemeMetadata(lireJson(PUBLIC(theme)), PUBLIC(theme))
      expect(metadata.indicator_keys.length).toBeGreaterThan(0)
      expect(Object.keys(metadata.sources).sort()).toEqual([...metadata.indicator_keys].sort())
      expect(Object.keys(metadata.indicator_labels).sort()).toEqual([...metadata.indicator_keys].sort())
    }
  })
})
