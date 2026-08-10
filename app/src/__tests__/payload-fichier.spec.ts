import { describe, expect, it } from 'vitest'

import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  programmesFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { chargerFichier, type ChargerOptions, type ReponseFetch } from '../payload/loader'
import { PayloadError } from '../payload/validate'
import type { Territoire } from '../payload/types'

/**
 * The per-file seam of the loader (issue #297 — the T1 prefactor of the
 * progressive store, PRD #296): one named file in, its typed section out.
 * Same fetchImpl injection, same per-file validators, same « 404 = table
 * absente » contract (ADR-0013) — only the granularity changes. The
 * reference-table dependency holds for the theme / apercu / programmes
 * files: the caller passes the VALIDATED territoires, exactly the ordering
 * constraint the loader already respects. chargerPayload() behavior is
 * locked by payload-loader.spec.ts, unchanged by this ticket.
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
  'programmes.json': programmesFixture,
}

/** La table de référence VALIDÉE — le prérequis d'ordre du loader (elle se charge en premier). */
async function territoiresValides(fichiers: Record<string, unknown> = fichiersDemographie): Promise<Territoire[]> {
  return chargerFichier('territoires', optionsPour(fichiers))
}

describe('chargerFichier — the per-file seam', () => {
  it('fetches and validates ONE named file, returning its typed section', async () => {
    const options = optionsPour(fichiersDemographie)

    const territoires = await chargerFichier('territoires', options)
    expect(territoires).toHaveLength(9)

    const indicateurs = await chargerFichier('indicateurs_demographie', territoires, options)
    expect(indicateurs).toHaveLength(indicateursDemographieFixture.length)

    const histoires = await chargerFichier('histoires_demographie', territoires, options)
    expect(histoires).toHaveLength(histoiresDemographieFixture.length)

    const apercu = await chargerFichier('apercu', territoires, options)
    expect(apercu).toEqual(apercuAvecNAFixture)

    const runReport = await chargerFichier('run-report', options)
    expect(runReport).toEqual(runReportFraisFixture)

    const vintages = await chargerFichier('vintages', options)
    expect(vintages).toEqual(vintagesFixture)

    const programmes = await chargerFichier('programmes', territoires, options)
    expect(programmes).toEqual(programmesFixture)
  })

  it('treats a 404 on an optional file as absent — the « 404 = table absente » contract (ADR-0013)', async () => {
    const sansOptionnels = { 'territoires.json': territoiresFixture }
    const options = optionsPour(sansOptionnels)
    const territoires = await territoiresValides(sansOptionnels)

    await expect(chargerFichier('run-report', options)).resolves.toBeNull()
    await expect(chargerFichier('vintages', options)).resolves.toBeNull()
    await expect(chargerFichier('apercu', territoires, options)).resolves.toBeNull()
    await expect(chargerFichier('programmes', territoires, options)).resolves.toBeNull()
    await expect(chargerFichier('indicateurs_habitat', territoires, options)).resolves.toBeNull()
    await expect(chargerFichier('histoires_habitat', territoires, options)).resolves.toBeNull()
  })

  it('raises a typed fetch error on a missing mandatory file (territoires.json)', async () => {
    await expect(
      chargerFichier('territoires', optionsPour({})),
    ).rejects.toMatchObject({ kind: 'fetch', file: 'territoires.json' })
  })

  it('raises a typed VALIDATION error on a null body for the MANDATORY file — jamais un null silencieux (relecture #297)', async () => {
    // Un corps null sur territoires.json (HTTP 200) est une dérive du contrat,
    // pas une absence : le fichier mandataire ne doit JAMAIS contourner son
    // validateur — le type lie « null » serait un payload muet dans
    // chargerPayload() (le territoire de référence perdu sans erreur).
    const options = optionsPour({ 'territoires.json': null })
    const erreur = await chargerFichier('territoires', options).catch((cause: unknown) => cause)
    expect(erreur).toBeInstanceOf(PayloadError)
    expect(erreur).toMatchObject({ kind: 'validation', file: 'territoires.json' })
  })

  it('treats a null body on an optional file as absent — l\u2019absence honnête, jamais une erreur (relecture #297)', async () => {
    // Un corps null (HTTP 200) sur un fichier optionnel est le même contrat
    // que le 404 : la table est simplement absente — les validateurs
    // optionnels (validerRapportRun / validerApercu…) acceptent null et
    // retournent null, le chemin ne change pas.
    const options = optionsPour({ 'territoires.json': territoiresFixture, 'run-report.json': null, 'apercu.json': null })
    const territoires = await territoiresValides({ 'territoires.json': territoiresFixture, 'run-report.json': null, 'apercu.json': null })

    await expect(chargerFichier('run-report', options)).resolves.toBeNull()
    await expect(chargerFichier('apercu', territoires, options)).resolves.toBeNull()
  })

  it('raises a typed fetch error on network failure', async () => {
    const fetchImpl = async () => {
      throw new TypeError('Failed to fetch')
    }

    await expect(
      chargerFichier('territoires', { baseUrl: 'data/', fetchImpl }),
    ).rejects.toMatchObject({ kind: 'fetch' })
  })

  it('raises a typed fetch error on an HTTP error status', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) })

    await expect(
      chargerFichier('run-report', { baseUrl: 'data/', fetchImpl }),
    ).rejects.toMatchObject({ kind: 'fetch', file: 'run-report.json' })
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
      chargerFichier('vintages', { baseUrl: 'data/', fetchImpl }),
    ).rejects.toMatchObject({ kind: 'fetch', file: 'vintages.json' })
  })

  it('raises a typed validation error when the file drifts from the contract', async () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    indicateurs[0].rang_epci = 25

    await expect(
      chargerFichier(
        'indicateurs_demographie',
        await territoiresValides(),
        optionsPour({ ...fichiersDemographie, 'indicateurs_demographie.json': indicateurs }),
      ),
    ).rejects.toMatchObject({ kind: 'validation', file: 'indicateurs_demographie.json' })
  })

  it('validates theme files AGAINST the reference table — a fact citing an unknown territoire is drift', async () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    ;(indicateurs[0] as { territoire: string }).territoire = '99999'

    await expect(
      chargerFichier(
        'indicateurs_demographie',
        await territoiresValides(),
        optionsPour({ ...fichiersDemographie, 'indicateurs_demographie.json': indicateurs }),
      ),
    ).rejects.toMatchObject({ kind: 'validation', file: 'indicateurs_demographie.json' })
  })

  it('refuses a theme file without the reference table — a typed error, never a cryptic crash', async () => {
    // Les surcharges typées interdisent déjà cet appel en TS — le garde
    // protège les appelants JS / any : la table manquante devient une erreur
    // typée (le contrat du loader), jamais un TypeError « map is not a
    // function » venu des entrailles de la validation.
    const sansReference = chargerFichier as unknown as (
      nom: 'indicateurs_demographie',
      options?: ChargerOptions,
    ) => Promise<unknown>

    const erreur = await sansReference(
      'indicateurs_demographie',
      optionsPour(fichiersDemographie),
    ).catch((cause: unknown) => cause)
    expect(erreur).toBeInstanceOf(PayloadError)
    expect(erreur).toMatchObject({ kind: 'validation', file: 'indicateurs_demographie.json' })
  })

  it('refuses a theme file with null territoires — la référence nulle est une erreur typée, jamais un TypeError (relecture #297)', async () => {
    // Même garde pour null que pour undefined : un appelant JS / any peut
    // passer null (le type lie du loader, jamais un crash « null is not
    // iterable » venu d'indexerReference).
    const avecNull = chargerFichier as unknown as (
      nom: 'indicateurs_demographie',
      territoires: null,
      options?: ChargerOptions,
    ) => Promise<unknown>

    const erreur = await avecNull(
      'indicateurs_demographie',
      null,
      optionsPour(fichiersDemographie),
    ).catch((cause: unknown) => cause)
    expect(erreur).toBeInstanceOf(PayloadError)
    expect(erreur).toMatchObject({ kind: 'validation', file: 'indicateurs_demographie.json' })
  })

  it('fetches the bare name under the default /data/ hosting with the .json suffix', async () => {
    const demandees: string[] = []
    const fetchImpl = async (url: string) => {
      demandees.push(url)
      return { ok: false, status: 404, json: async () => ({}) }
    }

    await chargerFichier('territoires', { fetchImpl }).catch(() => {})

    expect(demandees[0]).toBe('/data/territoires.json')
  })
})
