/**
 * THE SINGLE SEAM — the only module in the app that touches the raw JSON
 * payload (docs/architecture.md §The fiche payload). Nothing else imports
 * this. It fetches the JSON projections from the /data/ hosting, validates
 * each file against the contract (the app's half of validate_payload(),
 * validate.ts) and parses the merged result into a typed Payload.
 *
 * Theme discovery is payload-driven (ADR-0007): the canonical themes are
 * tried in order, a 404 on indicateurs_<theme>.json means the theme is
 * absent (dead tab — never an error), while a present theme without its
 * histoires file is contract drift (loud). run-report.json is optional —
 * a 404 means the static-rhythm freshness claim, never an error.
 *
 * Failure is typed (PayloadError, validate.ts): kind 'fetch' for transport
 * problems (the UI's error state), kind 'validation' for contract drift.
 */

import type { Indicateur, Histoire, Payload } from './types'
import { THEMES_CANONIQUES } from './types'
import {
  PayloadError,
  validerApercu,
  validerHistoires,
  validerIndicateurs,
  validerProgrammes,
  validerRapportRun,
  validerTerritoires,
  validerVintages,
} from './validate'

/** The minimal Response surface the loader needs (fetch() satisfies it). */
export interface ReponseFetch {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type FetchImpl = (url: string) => Promise<ReponseFetch>

export interface ChargerOptions {
  /** Base of the /data/ hosting — defaults to '/data/' (nginx alias, self-hosting.md). */
  baseUrl?: string
  /** Injected for tests; defaults to the real fetch. */
  fetchImpl?: FetchImpl
}

export async function chargerPayload(options: ChargerOptions = {}): Promise<Payload> {
  const baseUrl = options.baseUrl ?? '/data/'
  const fetchImpl = options.fetchImpl ?? ((url: string) => fetch(url))

  async function obtenir(fichier: string, optionnel: boolean): Promise<unknown | null> {
    const url = `${baseUrl}${fichier}`
    let reponse: ReponseFetch
    try {
      reponse = await fetchImpl(url)
    } catch (cause) {
      throw new PayloadError(
        'fetch',
        fichier,
        `Impossible de charger ${url} : ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
    if (!reponse.ok) {
      if (optionnel && reponse.status === 404) return null
      throw new PayloadError('fetch', fichier, `Réponse HTTP ${reponse.status} pour ${url}`)
    }
    try {
      return await reponse.json()
    } catch {
      throw new PayloadError('fetch', fichier, `JSON illisible dans ${url}`)
    }
  }

  const territoires = validerTerritoires(
    await obtenir('territoires.json', false),
    'territoires.json',
  )

  const indicateurs: Indicateur[] = []
  const histoires: Histoire[] = []

  for (const theme of THEMES_CANONIQUES) {
    const fichierIndicateurs = `indicateurs_${theme}.json`
    const brutIndicateurs = await obtenir(fichierIndicateurs, true)
    if (brutIndicateurs === null) continue

    const fichierHistoires = `histoires_${theme}.json`
    const brutHistoires = await obtenir(fichierHistoires, true)
    if (brutHistoires === null) {
      throw new PayloadError(
        'validation',
        fichierHistoires,
        `Le thème « ${theme} » publie des indicateurs sans histoires (${fichierHistoires} introuvable)`,
      )
    }

    indicateurs.push(...validerIndicateurs(brutIndicateurs, fichierIndicateurs, territoires))
    if (theme === 'milieux') {
      // État transitoire (spec #225 → #243) : histoires_milieux.json committé
      // porte encore l'ancien schéma (periode/conso_fenetre/…) tant que le
      // pipeline ne le régénère pas sur les états OCS-GE réels. Tolérance la
      // moins invasive : les lignes de l'ancien schéma sont écartées (jamais
      // jetées silencieusement dans le payload — les sélecteurs ne peuvent
      // pas les lire), les autres thèmes rendent. TODO #243 : supprimer cette
      // tolérance dès que le payload régénéré valide — la Story Milieux
      // redevient alors une exigence stricte du contrat.
      try {
        histoires.push(...validerHistoires(brutHistoires, fichierHistoires, territoires))
      } catch (e) {
        if (!(e instanceof PayloadError) || e.kind !== 'validation') throw e
      }
    } else {
      histoires.push(...validerHistoires(brutHistoires, fichierHistoires, territoires))
    }
  }

  const apercu = validerApercu(await obtenir('apercu.json', false), 'apercu.json', territoires)
  const runReport = validerRapportRun(await obtenir('run-report.json', true), 'run-report.json')
  const vintages = validerVintages(await obtenir('vintages.json', true), 'vintages.json')
  // Le payload programmes (issue #179) — optionnel : un 404 sur programmes.json
  // signifie que l'élément est simplement absent (l'état vide honnête), jamais
  // une erreur de chargement — la machinerie optionnelle établie (le précédent
  // run-report / vintages, ADR-0013 « 404 = table absente »).
  const programmes = validerProgrammes(
    await obtenir('programmes.json', true),
    'programmes.json',
    territoires,
  )

  return { territoires, indicateurs, histoires, apercu, runReport, vintages, programmes }
}
