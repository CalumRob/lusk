import { describe, expect, it } from 'vitest'

import { echelleContexte } from '../fiche/echelleContexte'
import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Payload } from '../payload/types'

/**
 * The context switcher's ladder (site-map.md §Fiche — internal navigation):
 * commune → son EPCI → son département → la région, powered by
 * territoires.epci. Steps that don't apply are omitted: an EPCI has no EPCI
 * parent, the région has no parents.
 */

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
}

describe('echelleContexte — the context-switcher ladder', () => {
  it('climbs a commune → son EPCI → son département → la région', () => {
    const echelons = echelleContexte(payload, '29002')

    expect(echelons.map((t) => t.nom)).toEqual([
      'Commune C',
      'EPCI Y',
      'Département 29',
      'Bretagne',
    ])
  })

  it('climbs from an EPCI → son département → la région (no EPCI parent)', () => {
    const echelons = echelleContexte(payload, '200000002')

    expect(echelons.map((t) => t.nom)).toEqual(['EPCI Y', 'Département 29', 'Bretagne'])
  })

  it('climbs from a département → la région', () => {
    const echelons = echelleContexte(payload, '22')

    expect(echelons.map((t) => t.nom)).toEqual(['Département 22', 'Bretagne'])
  })

  it('stops at the région (no parents)', () => {
    const echelons = echelleContexte(payload, '53')

    expect(echelons.map((t) => t.nom)).toEqual(['Bretagne'])
  })

  it('returns an empty ladder for an unknown territory', () => {
    expect(echelleContexte(payload, '99999')).toEqual([])
  })
})
