import { describe, expect, it } from 'vitest'

import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  histoiresHabitatFixture,
  indicateursDemographieFixture,
  indicateursHabitatFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { chargerPayload, type ChargerOptions, type ReponseFetch } from '../payload/loader'
import { PayloadError } from '../payload/validate'

/**
 * The loader — THE SINGLE SEAM: the only module that touches the raw JSONs.
 * Nothing else imports it. Tests hit external behavior with an injected
 * fetch: no DOM, no network.
 */

/** A fetch stub keyed by file name — returns fixture JSON or a configurable response. */
function stubFetch(fichiers: Record<string, unknown>): (url: string) => Promise<ReponseFetch> {
  return async (url: string) => {
    const nom = url.split('/').pop() ?? url
    if (nom in fichiers) {
      return { ok: true, status: 200, json: async () => fichiers[nom] }
    }
    return { ok: false, status: 404, json: async () => { throw new Error('404') } }
  }
}

function optionsPour(fichiers: Record<string, unknown>): ChargerOptions {
  return { baseUrl: 'data/', fetchImpl: stubFetch(fichiers) }
}

const fichiersDemographie = {
  'territoires.json': territoiresFixture,
  'indicateurs_demographie.json': indicateursDemographieFixture,
  'histoires_demographie.json': histoiresDemographieFixture,
  'apercu.json': apercuAvecNAFixture,
  'run-report.json': runReportFraisFixture,
  'vintages.json': vintagesFixture,
}

describe('chargerPayload — the single seam', () => {
  it('fetches, validates and parses the payload from the JSON projections', async () => {
    const payload = await chargerPayload(optionsPour(fichiersDemographie))

    expect(payload.territoires).toHaveLength(9)
    expect(payload.indicateurs).toHaveLength(indicateursDemographieFixture.length)
    expect(payload.histoires).toHaveLength(9)
    expect(payload.apercu).toHaveLength(apercuAvecNAFixture.length)
    expect(payload.runReport).toEqual(runReportFraisFixture)
  })

  it('loads the shared vintages table — the story blocks cite their datasets from it', async () => {
    const payload = await chargerPayload(optionsPour(fichiersDemographie))

    expect(payload.vintages).toEqual(vintagesFixture)
  })

  it('treats a missing vintages.json (404) as absent — no invented sourcing', async () => {
    const { 'vintages.json': _vintages, ...sansVintages } = fichiersDemographie

    const payload = await chargerPayload(optionsPour(sansVintages))
    expect(payload.vintages).toBeNull()
  })

  it('raises a typed validation error when vintages.json drifts from the contract', async () => {
    const vintages = JSON.parse(JSON.stringify(vintagesFixture)) as typeof vintagesFixture
    vintages[0].date_reference = '2023/01/01'

    await expect(
      chargerPayload(optionsPour({ ...fichiersDemographie, 'vintages.json': vintages })),
    ).rejects.toMatchObject({ kind: 'validation', file: 'vintages.json' })
  })

  it('fetches every present theme and merges their facts', async () => {
    const payload = await chargerPayload(
      optionsPour({
        ...fichiersDemographie,
        'indicateurs_habitat.json': indicateursHabitatFixture,
        'histoires_habitat.json': histoiresHabitatFixture,
      }),
    )

    expect(payload.indicateurs).toHaveLength(
      indicateursDemographieFixture.length + indicateursHabitatFixture.length,
    )
    expect(payload.histoires).toHaveLength(
      histoiresDemographieFixture.length + histoiresHabitatFixture.length,
    )
  })

  it('skips a missing theme file (404) — dead tabs never render', async () => {
    const payload = await chargerPayload(optionsPour(fichiersDemographie))

    expect(payload.indicateurs.every((i) => i.theme === 'demographie')).toBe(true)
    expect(payload.histoires.every((h) => h.theme === 'demographie')).toBe(true)
  })

  it('treats a missing run-report (404) as absent — the static-rhythm fallback', async () => {
    const { 'run-report.json': _rapport, ...sansRapport } = fichiersDemographie

    const payload = await chargerPayload(optionsPour(sansRapport))

    expect(payload.runReport).toBeNull()
  })

  it('raises a typed fetch error when a required file is missing', async () => {
    const { 'territoires.json': _territoires, ...sansTerritoires } = fichiersDemographie

    await expect(chargerPayload(optionsPour(sansTerritoires))).rejects.toBeInstanceOf(PayloadError)
  })

  it('raises a typed fetch error on network failure', async () => {
    const fetchImpl = async () => {
      throw new TypeError('Failed to fetch')
    }

    await expect(
      chargerPayload({ baseUrl: 'data/', fetchImpl }),
    ).rejects.toMatchObject({ kind: 'fetch' })
  })

  it('raises a typed fetch error on an HTTP error status', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) })

    await expect(
      chargerPayload({ baseUrl: 'data/', fetchImpl }),
    ).rejects.toMatchObject({ kind: 'fetch', file: 'territoires.json' })
  })

  it('raises a typed fetch error when a file is not valid JSON', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })

    await expect(
      chargerPayload({ baseUrl: 'data/', fetchImpl }),
    ).rejects.toMatchObject({ kind: 'fetch' })
  })

  it('raises a typed validation error when the payload drifts from the contract', async () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    indicateurs[0].rang_epci = 25

    await expect(
      chargerPayload(optionsPour({ ...fichiersDemographie, 'indicateurs_demographie.json': indicateurs })),
    ).rejects.toMatchObject({ kind: 'validation', file: 'indicateurs_demographie.json' })
  })

  it('raises a typed validation error when a story file is missing for a present theme', async () => {
    const { 'histoires_demographie.json': _histoires, ...sansHistoires } = fichiersDemographie

    await expect(
      chargerPayload(optionsPour(sansHistoires)),
    ).rejects.toMatchObject({ kind: 'validation', file: 'histoires_demographie.json' })
  })

  it('defaults to the /data/ hosting (the nginx alias, self-hosting.md)', async () => {
    const demandees: string[] = []
    const fetchImpl = async (url: string) => {
      demandees.push(url)
      return { ok: false, status: 404, json: async () => ({}) }
    }

    await chargerPayload({ fetchImpl }).catch(() => {})

    expect(demandees[0]).toBe('/data/territoires.json')
  })
})
