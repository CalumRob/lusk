import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { cadrageSousGroupeFiche, sousGroupeFiche } from '../fiche/content/ficheGrammar'
import { validerThemeMetadata } from '../payload/validate'
import type { ThemeMetadata } from '../payload/types'

/**
 * The two retained producer-bound framing clauses (#827) — the transport
 * thresholds and the grant eligibility scope are facts of the producer
 * declaration, never app constants. Stable editorial framing stays app-owned.
 * The published theme files are the verified producer evidence here.
 */

function publie(theme: 'mobilite' | 'programmes'): ThemeMetadata {
  return validerThemeMetadata(
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

  it('follows a changed producer clause instead of freezing the previous wording', () => {
    const transport = sousGroupeFiche('mobilite', 'offre-transports-commun')!
    const changed = publie('mobilite')
    changed.subgroups.find((subgroup) => subgroup.key === 'offre-transports-commun')!.framing =
      'Cadrage factuel du réseau fourni par le producteur.'
    expect(cadrageSousGroupeFiche(transport, changed)).toBe('Cadrage factuel du réseau fourni par le producteur.')
  })
})
