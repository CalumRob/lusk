import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { cadrageSousGroupeFiche, sousGroupeFiche } from '../fiche/content/ficheGrammar'
import { validerCatalogueNavigateur } from '../payload/validate'
import type { ThemeMetadata } from '../payload/types'

/**
 * Producer-bound framing clauses (#827) — transport thresholds, observation
 * boundaries, statistical units/scopes, and grant eligibility are facts of the
 * producer declaration, never app constants. Stable editorial framing stays
 * app-owned. The published theme files are the verified producer evidence here.
 */

function publie(theme: 'mobilite' | 'programmes' | 'demographie' | 'habitat' | 'economie'): ThemeMetadata {
  return validerCatalogueNavigateur(
    JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', `theme_${theme}.json`), 'utf8')),
    `theme_${theme}.json`,
  )
}

describe('cadrageSousGroupeFiche — editorial app copy vs retained factual clauses', () => {
  it('returns app-owned editorial framing without any metadata', () => {
    const editorial = sousGroupeFiche('habitat', 'composition-du-parc')!
    expect(editorial.framing).not.toBeNull()
    expect(cadrageSousGroupeFiche(editorial)).toBe(editorial.framing)
    expect(cadrageSousGroupeFiche(editorial, undefined)).toBe(editorial.framing)
  })

  it('withholds the transport clause when metadata is absent — never a hardcoded threshold', () => {
    const transport = sousGroupeFiche('mobilite', 'offre-transports-commun')!
    expect(transport.framing).toBeNull()
    expect(cadrageSousGroupeFiche(transport)).toBeNull()
    expect(cadrageSousGroupeFiche(transport, undefined)).toBeNull()
    const metadata = publie('mobilite')
    expect(cadrageSousGroupeFiche(transport, metadata))
      .toBe(metadata.subgroups.find((subgroup) => subgroup.key === 'offre-transports-commun')!.framing)
  })

  it('withholds the grant clause when metadata is absent — never a hardcoded eligibility scope', () => {
    const grants = sousGroupeFiche('programmes', 'subventions')!
    expect(grants.framing).toBeNull()
    expect(cadrageSousGroupeFiche(grants)).toBeNull()
    const metadata = publie('programmes')
    expect(cadrageSousGroupeFiche(grants, metadata))
      .toBe(metadata.subgroups.find((subgroup) => subgroup.key === 'subventions')!.framing)
  })

  it('withholds the census start year when metadata is absent and follows its verified framing', () => {
    const trajectory = sousGroupeFiche('demographie', 'trajectoire-demographique')!
    expect(trajectory.framing).toBeNull()
    expect(cadrageSousGroupeFiche(trajectory)).toBeNull()

    const metadata = publie('demographie')
    expect(cadrageSousGroupeFiche(trajectory, metadata))
      .toBe(metadata.subgroups.find((subgroup) => subgroup.key === 'trajectoire-demographique')!.framing)
  })

  it('withholds the price-per-square-metre clause when metadata is absent and follows its verified framing', () => {
    const market = sousGroupeFiche('habitat', 'marche')!
    expect(market.framing).toBeNull()
    expect(cadrageSousGroupeFiche(market)).toBeNull()

    const metadata = publie('habitat')
    expect(cadrageSousGroupeFiche(market, metadata))
      .toBe(metadata.subgroups.find((subgroup) => subgroup.key === 'marche')!.framing)
  })

  it('withholds workplace and census-scope clauses when metadata is absent and follows its verified framing', () => {
    const economy = sousGroupeFiche('economie', 'sante-et-taille')!
    expect(economy.framing).toBeNull()
    expect(cadrageSousGroupeFiche(economy)).toBeNull()

    const metadata = publie('economie')
    expect(cadrageSousGroupeFiche(economy, metadata))
      .toBe(metadata.subgroups.find((subgroup) => subgroup.key === 'sante-et-taille')!.framing)
  })

  it('follows a changed producer clause instead of freezing the previous wording', () => {
    const transport = sousGroupeFiche('mobilite', 'offre-transports-commun')!
    const changed = publie('mobilite')
    changed.subgroups.find((subgroup) => subgroup.key === 'offre-transports-commun')!.framing =
      'Cadrage factuel du réseau fourni par le producteur.'
    expect(cadrageSousGroupeFiche(transport, changed)).toBe('Cadrage factuel du réseau fourni par le producteur.')
  })
})
