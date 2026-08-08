import { describe, expect, it } from 'vitest'

import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  histoiresHabitatFixture,
  indicateursDemographieFixture,
  indicateursHabitatFixture,
  indicateursMilieuxFixture,
  membresProgrammesFixture,
  programmesFixture,
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

const fichiersProgrammes = {
  ...fichiersDemographie,
  'programmes.json': programmesFixture,
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

  it('loads the pivot-schema Milieux histoires strictly (le re-key #225/#243 est exigé, plus aucune tolérance)', async () => {
    // Le payload régénéré (spec #225 → #243) porte le nouveau schéma — la
    // Story Milieux redevient une exigence STRICTE du contrat : les lignes du
    // nouveau schéma chargent, celles de l'ancien (periode/conso_fenetre/…)
    // sont rejetées par la validation, jamais écartées en silence.
    const nouveauSchema = [
      {
        territoire: '22001',
        type: 'commune',
        theme: 'milieux',
        story_key: 'se-densifier-setaler-ou-sen-aller',
        periode_pop: '2017-2023',
        periode_artif: '2021-2025',
        delta_population: -15,
        artif_m2: 0.84571,
        artif_m3: 2.8089577,
        artif_m2_par_habitant: 14.0018,
        artif_m3_par_habitant: 47.6902,
        trajectoire_artif_par_habitant: 3.406,
        classification: 'sen-aller-et-consommer-quand-meme',
      },
    ]

    const payload = await chargerPayload(
      optionsPour({
        ...fichiersDemographie,
        'indicateurs_milieux.json': indicateursMilieuxFixture,
        'histoires_milieux.json': nouveauSchema,
      }),
    )

    expect(payload.histoires.filter((h) => h.theme === 'milieux')).toHaveLength(1)
    expect(payload.histoires.filter((h) => h.theme === 'demographie')).toHaveLength(9)
    expect(payload.indicateurs.some((i) => i.theme === 'milieux')).toBe(true)

    // l'ancien schéma est rejeté fort — la tolérance a disparu
    const ancienSchema = [
      {
        territoire: '22001',
        type: 'commune',
        theme: 'milieux',
        story_key: 'se-densifier-setaler-ou-sen-aller',
        periode: '2017-2023',
        delta_population: -15,
        conso_fenetre: 2.605,
        intensite_m2_par_habitant: null,
        classification: 'sen-aller-et-consommer-quand-meme',
      },
    ]

    await expect(
      chargerPayload(
        optionsPour({
          ...fichiersDemographie,
          'indicateurs_milieux.json': indicateursMilieuxFixture,
          'histoires_milieux.json': ancienSchema,
        }),
      ),
    ).rejects.toMatchObject({ kind: 'validation' })
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

describe('chargerPayload — the programmes payload (issue #179, ADR-0013)', () => {
  it('loads programmes.json — the { membres, subventions } object — onto the assembled payload', async () => {
    const payload = await chargerPayload(optionsPour(fichiersProgrammes))

    expect(payload.programmes).toEqual(programmesFixture)
    expect(payload.programmes?.membres).toHaveLength(membresProgrammesFixture.length)
  })

  it('treats a 404 on programmes.json as the element being absent — null, no error', async () => {
    const payload = await chargerPayload(optionsPour(fichiersDemographie))

    expect(payload.programmes).toBeNull()
  })

  it('raises a typed fetch error when programmes.json fails with a non-404 status', async () => {
    const { 'programmes.json': _programmes, ...sansProgrammes } = fichiersProgrammes
    const fetchImpl = async (url: string) => {
      const nom = url.split('/').pop() ?? url
      if (nom === 'programmes.json') {
        return { ok: false, status: 500, json: async () => { throw new Error('500') } }
      }
      return stubFetch(sansProgrammes)(url)
    }

    await expect(
      chargerPayload({ baseUrl: 'data/', fetchImpl }),
    ).rejects.toMatchObject({ kind: 'fetch', file: 'programmes.json' })
  })

  it('raises a typed validation error when programmes.json drifts from the contract', async () => {
    const programmes = JSON.parse(JSON.stringify(programmesFixture)) as typeof programmesFixture
    ;(programmes.membres[0] as { sigle: string }).sigle = 'inconnu'

    await expect(
      chargerPayload(optionsPour({ ...fichiersProgrammes, 'programmes.json': programmes })),
    ).rejects.toMatchObject({ kind: 'validation', file: 'programmes.json' })
  })

  it('exposes an empty programmes payload when the file carries empty tables', async () => {
    const vide = { membres: [], subventions: [] }
    const payload = await chargerPayload(optionsPour({ ...fichiersProgrammes, 'programmes.json': vide }))

    expect(payload.programmes).toEqual(vide)
  })
})
