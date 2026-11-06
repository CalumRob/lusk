import { describe, expect, it } from 'vitest'

import {
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  metadonneesThemesFixtures,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { chargerFichier, type ChargerOptions, type Fichier, type ReponseFetch } from '../payload/loader'
import { PayloadError, validerHistoires, validerIndicateurs } from '../payload/validate'
import type { Territoire, ThemeMetadata } from '../payload/types'

/**
 * The per-file seam of the loader (issue #297 — the T1 prefactor of the
 * progressive store, PRD #296): one named file in, its typed section out.
 * Same fetchImpl injection, same per-file validators, same « 404 = table
 * absente » contract (ADR-0013) — only the granularity changes. The
 * reference-table dependency holds for the theme
 * files: the caller passes the VALIDATED territoires, exactly the ordering
 * constraint owned by the progressive per-file boundary.
 * #894: 'apercu' is not a file anymore — the retired apercu.json has no
 * per-file entry (see the dedicated test below).
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
  'theme_demographie.json': metadonneesThemesFixtures.demographie,
  'run-report.json': runReportFraisFixture,
  'vintages.json': vintagesFixture,
}

/** La table de référence VALIDÉE — le prérequis d'ordre du loader (elle se charge en premier). */
async function territoiresValides(fichiers: Record<string, unknown> = fichiersDemographie): Promise<Territoire[]> {
  return chargerFichier('territoires', optionsPour(fichiers))
}

describe('chargerFichier — the retained per-file seam', () => {
  it('fetches and validates retained named files, returning their typed sections', async () => {
    const options = optionsPour(fichiersDemographie)

    const territoires = await chargerFichier('territoires', options)
    expect(territoires).toHaveLength(9)

    // Numerical row shape validation remains available to API adapters and
    // in-memory consumers, but it no longer crosses the JSON loader boundary.
    const indicateurs = validerIndicateurs(indicateursDemographieFixture, 'indicateurs_demographie.json', territoires)
    expect(indicateurs).toHaveLength(indicateursDemographieFixture.length)

    const histoires = validerHistoires(histoiresDemographieFixture, 'histoires_demographie.json', territoires)
    expect(histoires).toHaveLength(histoiresDemographieFixture.length)

    const runReport = await chargerFichier('run-report', options)
    expect(runReport).toEqual(runReportFraisFixture)

    const vintages = await chargerFichier('vintages', options)
    expect(vintages).toEqual(vintagesFixture)
  })

  it('has no per-file entry for the retired programmes.json (#893) — the name is not a file anymore', () => {
    // Le type Fichier ne contient plus 'programmes' : aucun chargeur ne peut
    // plus demander ce fichier (le typage l'interdit, testé ci-dessous).
    // @ts-expect-error — 'programmes' n'est plus un Fichier depuis #893
    const nom: Fichier = 'programmes'
    expect(nom).toBe('programmes')
  })

  it('has no per-file entry for the retired apercu.json (#894) — the name is not a file anymore', () => {
    // Le type Fichier ne contient plus 'apercu' : aucun chargeur ne peut
    // plus demander ce fichier (le typage l'interdit, testé ci-dessous).
    // @ts-expect-error — 'apercu' n'est plus un Fichier depuis #894
    const nom: Fichier = 'apercu'
    expect(nom).toBe('apercu')
  })

  it('treats a 404 on an optional file as absent — the « 404 = table absente » contract (ADR-0013)', async () => {
    const sansOptionnels = { 'territoires.json': territoiresFixture }
    const options = optionsPour(sansOptionnels)

    await expect(chargerFichier('run-report', options)).resolves.toBeNull()
    await expect(chargerFichier('vintages', options)).resolves.toBeNull()
    await expect(chargerFichier('theme_habitat', options)).resolves.toBeNull()
  })

  it('returns every retired numerical export as absent without making an HTTP request', async () => {
    const demandes: string[] = []
    const options: ChargerOptions = {
      baseUrl: 'data/',
      fetchImpl: async (url) => {
        demandes.push(url)
        return { ok: false, status: 404, json: async () => null }
      },
    }

    await expect(chargerFichier('indicateurs_demographie', options)).resolves.toBeNull()
    await expect(chargerFichier('histoires_demographie', options)).resolves.toBeNull()
    await expect(chargerFichier('indicateurs_programmes', options)).resolves.toBeNull()
    await expect(chargerFichier('histoires_programmes', options)).resolves.toBeNull()

    expect(demandes).toEqual([])
  })

  it('fetches and validates theme_<theme>.json — the typed ThemeMetadata section (#313)', async () => {
    const meta = await chargerFichier('theme_demographie', optionsPour(fichiersDemographie))

    expect(meta).toEqual(metadonneesThemesFixtures.demographie)
  })

  it('raises a typed validation error when theme metadata drifts from the contract', async () => {
    const meta = JSON.parse(JSON.stringify(metadonneesThemesFixtures.demographie)) as ThemeMetadata
    ;(meta as unknown as Record<string, unknown>).theme = 'programmes'

    await expect(
      chargerFichier(
        'theme_demographie',
        optionsPour({ ...fichiersDemographie, 'theme_demographie.json': meta }),
      ),
    ).rejects.toMatchObject({ kind: 'validation', file: 'theme_demographie.json' })
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
    // le chemin per-file (le territoire de référence perdu sans erreur).
    const options = optionsPour({ 'territoires.json': null })
    const erreur = await chargerFichier('territoires', options).catch((cause: unknown) => cause)
    expect(erreur).toBeInstanceOf(PayloadError)
    expect(erreur).toMatchObject({ kind: 'validation', file: 'territoires.json' })
  })

  it('treats a null body on an optional file as absent — l\u2019absence honnête, jamais une erreur (relecture #297)', async () => {
    // Un corps null (HTTP 200) sur un fichier optionnel est le même contrat
    // que le 404 : la table est simplement absente — les validateurs
    // optionnels (validerRapportRun…) acceptent null et
    // retournent null, le chemin ne change pas.
    const options = optionsPour({ 'territoires.json': territoiresFixture, 'run-report.json': null })

    await expect(chargerFichier('run-report', options)).resolves.toBeNull()
    await expect(chargerFichier('vintages', options)).resolves.toBeNull()
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

  it('the API validator raises a typed error when numerical rows drift from the contract', async () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    // la dérive ordinale classique (ADR-0015) : une fraction (le percentile retiré)
    indicateurs[0].rang_epci = 0.25

    let erreur: unknown
    try {
      validerIndicateurs(indicateurs, 'indicateurs_demographie.json', await territoiresValides())
    } catch (cause) {
      erreur = cause
    }
    expect(erreur).toBeInstanceOf(PayloadError)
    expect(erreur).toMatchObject({ kind: 'validation', file: 'indicateurs_demographie.json' })
  })

  it('the API validator rejects numerical rows citing an unknown territoire', async () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    ;(indicateurs[0] as { territoire: string }).territoire = '99999'

    let erreur: unknown
    try {
      validerIndicateurs(indicateurs, 'indicateurs_demographie.json', await territoiresValides())
    } catch (cause) {
      erreur = cause
    }
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
