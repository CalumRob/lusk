import { describe, expect, it } from 'vitest'

import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  histoiresEconomieFixture,
  histoiresMilieuxFixture,
  histoiresMobiliteFixture,
  indicateursDemographieFixture,
  indicateursEconomieFixture,
  indicateursMilieuxFixture,
  indicateursMobiliteFixture,
  membresProgrammesFixture,
  programmesFixture,
  programmesVideFixture,
  runReportFraisFixture,
  subventionsProgrammesFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { PayloadError, parsePayload } from '../payload/validate'
import type { HistoireDemographie, HistoireMilieux, HistoireMobilite, Payload } from '../payload/types'

type DocumentsBruts = Parameters<typeof parsePayload>[0]

/**
 * The app's half of validate_payload() (docs/architecture.md §The fiche
 * payload): drift on the pipeline side must surface here as a loud,
 * typed error — never as silent wrong figures. The validators are pure:
 * raw JSON shapes in, typed structures out (or PayloadError).
 */

function documentsBruts(overrides: Partial<DocumentsBruts> = {}): DocumentsBruts {
  return {
    territoires: territoiresFixture,
    indicateurs: indicateursDemographieFixture,
    histoires: histoiresDemographieFixture,
    apercu: apercuAvecNAFixture,
    runReport: runReportFraisFixture,
    vintages: vintagesFixture,
    programmes: programmesFixture,
    ...overrides,
  }
}

/** The Économie documents — the same fixture payload, theme swapped. */
function documentsEconomie(overrides: Partial<DocumentsBruts> = {}): DocumentsBruts {
  return documentsBruts({
    indicateurs: indicateursEconomieFixture,
    histoires: histoiresEconomieFixture,
    ...overrides,
  })
}

/** The Mobilité documents (issue #142) — the fixture payload, theme swapped. */
function documentsMobilite(overrides: Partial<DocumentsBruts> = {}): DocumentsBruts {
  return documentsBruts({
    indicateurs: indicateursMobiliteFixture,
    histoires: histoiresMobiliteFixture,
    ...overrides,
  })
}

/** The Milieux documents (issue #171→#174) — the fixture payload, theme swapped. */
function documentsMilieux(overrides: Partial<DocumentsBruts> = {}): DocumentsBruts {
  return documentsBruts({
    indicateurs: indicateursMilieuxFixture,
    histoires: histoiresMilieuxFixture,
    ...overrides,
  })
}

function attendErreurValidation(documents: DocumentsBruts): PayloadError {
  let erreur: unknown
  try {
    parsePayload(documents)
  } catch (e) {
    erreur = e
  }
  expect(erreur).toBeInstanceOf(PayloadError)
  const payloadError = erreur as PayloadError
  expect(payloadError.kind).toBe('validation')
  return payloadError
}

describe('parsePayload — accepts the contract shape', () => {
  it('parses the fixture documents into a typed payload', () => {
    const payload = parsePayload(documentsBruts())

    expect(payload.territoires).toHaveLength(9)
    expect(payload.indicateurs).toHaveLength(indicateursDemographieFixture.length)
    expect(payload.histoires).toHaveLength(9)
    expect(payload.apercu).toHaveLength(apercuAvecNAFixture.length)
    expect(payload.runReport?.mode).toBe('full')
    expect(payload).toSatisfy((p: Payload) => p.territoires.every((t) => t.nom.length > 0))
  })

  it('accepts a null run-report (absent — the static-rhythm fallback)', () => {
    const payload = parsePayload(documentsBruts({ runReport: null }))

    expect(payload.runReport).toBeNull()
  })

  it('accepts a null apercu value (NA = non calculable) and null ranks', () => {
    const payload = parsePayload(documentsBruts())

    const na = payload.apercu.find((a) => a.value === null)
    expect(na).toBeDefined()
    const epci = payload.indicateurs.find((i) => i.territoire === '200000001')
    expect(epci?.rang_epci).toBeNull()
  })
})

describe('parsePayload — rejects contract drift, loudly', () => {
  it('rejects a rank outside [0,1] (the classic 25 instead of 0.25 drift)', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    indicateurs[0].rang_epci = 25

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/rang/i)
  })

  it('rejects a negative rank', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    indicateurs[0].rang_dep = -0.5

    attendErreurValidation(documentsBruts({ indicateurs }))
  })

  it('rejects a missing required column (unit)', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    delete (indicateurs[0] as Partial<(typeof indicateursDemographieFixture)[number]>).unit

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/unit/i)
  })

  it('rejects a value of the wrong type (string instead of number)', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    indicateurs[0].value = '200' as unknown as number

    attendErreurValidation(documentsBruts({ indicateurs }))
  })

  it('rejects a malformed vintage date', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    indicateurs[0].vintage_date_reference = '2023/01/01'

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/vintage/i)
  })

  it('rejects a theme outside the canonical set', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    indicateurs[0].theme = 'energie' as unknown as 'demographie'

    const erreur = attendErreurValidation(documentsBruts({ indicateurs }))
    expect(erreur.message).toMatch(/theme/i)
  })

  it('rejects duplicate territoires in the reference table', () => {
    const territoires = JSON.parse(JSON.stringify(territoiresFixture)) as typeof territoiresFixture
    territoires.push({ ...territoires[0] })

    const erreur = attendErreurValidation(documentsBruts({ territoires }))
    expect(erreur.message).toMatch(/territoire/i)
  })

  it('accepts a commune without an EPCI in the reference table (the three islands, fix #131)', () => {
    // Les trois îles (22016, 29083, 29155) n'ont pas d'EPCI — « Sans objet » —
    // la commune sans EPCI est désormais légitime dans la référence (issue #120).
    const territoires = JSON.parse(JSON.stringify(territoiresFixture)) as typeof territoiresFixture
    territoires[0].epci = null

    const payload = parsePayload(documentsBruts({ territoires }))
    expect(payload.territoires.find((t) => t.territoire === '22001')?.epci).toBeNull()
  })

  it('rejects a commune whose EPCI is unknown to the reference (ladder integrity kept)', () => {
    // L'intégrité référentielle de l'échelle reste verrouillée : un SIREN
    // inconnu casse le contexte switcher (commune → EPCI → département → région).
    const territoires = JSON.parse(JSON.stringify(territoiresFixture)) as typeof territoiresFixture
    territoires[0].epci = '999999999'

    const erreur = attendErreurValidation(documentsBruts({ territoires }))
    expect(erreur.message).toMatch(/EPCI/i)
  })

  it('rejects a non-commune carrying an EPCI', () => {
    const territoires = JSON.parse(JSON.stringify(territoiresFixture)) as typeof territoiresFixture
    territoires[5].epci = '200000001'

    attendErreurValidation(documentsBruts({ territoires }))
  })

  it('rejects facts that cite an unknown territory', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    indicateurs[0].territoire = '99999'

    attendErreurValidation(documentsBruts({ indicateurs }))
  })

  it('rejects duplicate indicateur rows (territoire × key × detail)', () => {
    const indicateurs = JSON.parse(JSON.stringify(indicateursDemographieFixture)) as typeof indicateursDemographieFixture
    indicateurs.push({ ...indicateurs[0] })

    attendErreurValidation(documentsBruts({ indicateurs }))
  })

  it('rejects a Démographie histoire missing the annualized rates (ADR-0011)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresDemographieFixture)) as typeof histoiresDemographieFixture
    delete (histoires[0] as Partial<HistoireDemographie>).taux_solde_naturel
    delete (histoires[0] as Partial<HistoireDemographie>).taux_solde_migratoire

    attendErreurValidation(documentsBruts({ histoires }))
  })

  it('rejects duplicate apercu rows (territoire × key)', () => {
    const apercu = JSON.parse(JSON.stringify(apercuAvecNAFixture)) as typeof apercuAvecNAFixture
    apercu.push({ ...apercu[0] })

    attendErreurValidation(documentsBruts({ apercu }))
  })

  it('rejects a run-report missing its timestamp', () => {
    const runReport = JSON.parse(JSON.stringify(runReportFraisFixture)) as typeof runReportFraisFixture
    delete (runReport as Partial<typeof runReportFraisFixture>).timestamp

    attendErreurValidation(documentsBruts({ runReport }))
  })

  it('rejects a run-report with an unknown source status', () => {
    const runReport = JSON.parse(JSON.stringify(runReportFraisFixture)) as typeof runReportFraisFixture
    runReport.statuts[0].status = 'mystere' as unknown as 'frais'

    attendErreurValidation(documentsBruts({ runReport }))
  })

  it('rejects a non-array facts document (shape drift, not a content drift)', () => {
    attendErreurValidation(documentsBruts({ indicateurs: { not: 'an array' } }))
  })

  it('rejects a non-array vintages document (shape drift)', () => {
    attendErreurValidation(documentsBruts({ vintages: { id: 'serie_historique' } }))
  })

  it('rejects a vintage row missing its source', () => {
    const vintages = JSON.parse(JSON.stringify(vintagesFixture)) as typeof vintagesFixture
    delete (vintages[0] as Partial<(typeof vintagesFixture)[number]>).source

    const erreur = attendErreurValidation(documentsBruts({ vintages }))
    expect(erreur.message).toMatch(/source/i)
  })

  it('rejects a malformed vintage date — drift must be loud, never silent', () => {
    const vintages = JSON.parse(JSON.stringify(vintagesFixture)) as typeof vintagesFixture
    vintages[0].date_reference = '2023/01/01'

    const erreur = attendErreurValidation(documentsBruts({ vintages }))
    expect(erreur.message).toMatch(/date_reference/i)
  })
})

describe('parsePayload — the shared vintages table', () => {
  it('carries the validated vintages on the payload', () => {
    const payload = parsePayload(documentsBruts())

    expect(payload.vintages).toEqual(vintagesFixture)
  })

  it('accepts an absent vintages table (null — no invented sourcing)', () => {
    const payload = parsePayload(documentsBruts({ vintages: null }))

    expect(payload.vintages).toBeNull()
  })
})

describe('parsePayload — the Économie contract (issue #120, forme reshapée)', () => {
  it('accepts the reshaped Économie documents — 3 indicators + the multi-line Stories', () => {
    const payload = parsePayload(documentsEconomie())

    expect(payload.indicateurs).toHaveLength(indicateursEconomieFixture.length)
    expect(payload.histoires).toHaveLength(histoiresEconomieFixture.length)
    // la forme multi-lignes : 5 lignes par (territoire × story_key), pas une
    expect(payload.histoires.filter((h) => h.theme === 'economie' && h.territoire === '22001')).toHaveLength(5)
    // la région porte la lecture de structure dédiée
    const region = payload.histoires.filter((h) => h.territoire === '53')
    expect(region).toHaveLength(5)
    expect(region.every((h) => h.theme === 'economie' && h.story_key === 'ce-que-la-bretagne-abrite')).toBe(true)
  })

  it('rejects an Économie histoire with an unknown story_key (drift must be loud)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresEconomieFixture)) as typeof histoiresEconomieFixture
    ;(histoires[0] as { story_key: string }).story_key = 'le-matin-la-commune-se-vide'

    const erreur = attendErreurValidation(documentsEconomie({ histoires }))
    expect(erreur.message).toMatch(/Story Économie/)
  })

  it('rejects an Économie histoire missing the multi-line story columns (the one-line-per-territoire revert)', () => {
    // La forme d'avant la reshape : une ligne par territoire, sans les colonnes
    // du top-5 (activity_code / rang / lq) — une dérive du contrat, jamais
    // silencieuse.
    const histoires = JSON.parse(JSON.stringify(histoiresEconomieFixture)) as typeof histoiresEconomieFixture
    const ligneAncienne = histoires[0] as unknown as Record<string, unknown>
    delete ligneAncienne.activity_code
    delete ligneAncienne.activity_label
    delete ligneAncienne.rang

    const erreur = attendErreurValidation(documentsEconomie({ histoires }))
    expect(erreur.message).toMatch(/activity_code|activity_label|rang/)
  })

  it('rejects a duplicate rang within a (territoire × story_key) group', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresEconomieFixture)) as typeof histoiresEconomieFixture
    ;(histoires[1] as { rang: number }).rang = 1

    const erreur = attendErreurValidation(documentsEconomie({ histoires }))
    expect(erreur.message).toMatch(/rang/)
  })

  it('rejects a 6th line for a group — the top-5 is the contract (rang 6 = drift)', () => {
    // Le plafond de 5 lignes est porté par la contrainte rang ∈ 1..5 : une
    // sixième ligne ne peut pas être un rang valide du top-5 — c'est une
    // dérive du contrat (le pipeline aurait publié un top-6).
    const histoires = JSON.parse(JSON.stringify(histoiresEconomieFixture)) as typeof histoiresEconomieFixture
    const ligne = { ...(histoires[0] as unknown as Record<string, unknown>), rang: 6 } as typeof histoires[0]
    histoires.push(ligne)

    const erreur = attendErreurValidation(documentsEconomie({ histoires }))
    expect(erreur.message).toMatch(/rang/)
  })

  it('rejects a ce-que-la-commune-abrite row without its LQ (the reading IS the specialisation)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresEconomieFixture)) as typeof histoiresEconomieFixture
    ;(histoires[0] as { lq: number | null }).lq = null

    const erreur = attendErreurValidation(documentsEconomie({ histoires }))
    expect(erreur.message).toMatch(/lq/)
  })

  it('rejects a ce-que-la-bretagne-abrite row without its part du parc (the reading IS the structure)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresEconomieFixture)) as typeof histoiresEconomieFixture
    ;(histoires[15] as { part_parc: number | null }).part_parc = null

    const erreur = attendErreurValidation(documentsEconomie({ histoires }))
    expect(erreur.message).toMatch(/part_parc/)
  })

  it('rejects a Story vintage malformed like an indicator one (two ISO dates + source/version)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresEconomieFixture)) as typeof histoiresEconomieFixture
    ;(histoires[0] as { vintage_date_publication: string }).vintage_date_publication = '2026/05/01'

    const erreur = attendErreurValidation(documentsEconomie({ histoires }))
    expect(erreur.message).toMatch(/vintage/)
  })

  it('does NOT relax the one-line-per-territory invariant for the other themes', () => {
    // Démographie / Habitat inchangés : deux histoires pour le même territoire
    // restent une dérive du contrat (seul le thème Économie est multi-lignes).
    const histoires = JSON.parse(JSON.stringify(histoiresDemographieFixture)) as typeof histoiresDemographieFixture
    histoires.push({ ...histoires[0] })

    attendErreurValidation(documentsBruts({ histoires }))
  })
})

describe('parsePayload — the Mobilité contract (issue #142, ADR-0012)', () => {
  it('accepts the Mobilité documents — le défaut multi-lignes + la saillance vélo', () => {
    const payload = parsePayload(documentsMobilite())

    expect(payload.indicateurs).toHaveLength(indicateursMobiliteFixture.length)
    const histoires = payload.histoires.filter((h) => h.theme === 'mobilite')
    expect(histoires).toHaveLength(histoiresMobiliteFixture.length)
    // la saillante porte DEUX lignes — le défaut ET le vélo
    const saillante = histoires.filter((h) => h.territoire === '22002')
    expect(saillante.map((h) => h.story_key)).toEqual([
      'vingt-minutes-sans-voiture',
      'ce-que-le-velo-preserve',
    ])
  })

  it('rejects a Mobilité histoire with an unknown story_key (drift must be loud)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMobiliteFixture)) as typeof histoiresMobiliteFixture
    ;(histoires[0] as { story_key: string }).story_key = 'la-voiture-reine'

    const erreur = attendErreurValidation(documentsMobilite({ histoires }))
    expect(erreur.message).toMatch(/Story Mobilité/)
  })

  it('rejects a Mobilité histoire missing its required reading (div_loss_t absent — loud)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMobiliteFixture)) as typeof histoiresMobiliteFixture
    delete (histoires[0] as Partial<HistoireMobilite>).div_loss_t

    const erreur = attendErreurValidation(documentsMobilite({ histoires }))
    expect(erreur.message).toMatch(/div_loss_t/)
  })

  it('rejects a negative delta — la neutralité modale (vélo ≥ à pied) est le contrat', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMobiliteFixture)) as typeof histoiresMobiliteFixture
    ;(histoires[0] as { delta: number }).delta = -3

    const erreur = attendErreurValidation(documentsMobilite({ histoires }))
    expect(erreur.message).toMatch(/delta/)
  })

  it('rejects a vélo Story without the « saillant » classification', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMobiliteFixture)) as typeof histoiresMobiliteFixture
    const velo = histoires.find(
      (h) => (h as { story_key: string }).story_key === 'ce-que-le-velo-preserve',
    ) as unknown as { classification_saillance: string }
    velo.classification_saillance = 'notable'

    const erreur = attendErreurValidation(documentsMobilite({ histoires }))
    expect(erreur.message).toMatch(/saillant/)
  })

  it('rejects an unknown saillance classification', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMobiliteFixture)) as typeof histoiresMobiliteFixture
    ;(histoires[0] as { classification_saillance: string }).classification_saillance = 'super'

    const erreur = attendErreurValidation(documentsMobilite({ histoires }))
    expect(erreur.message).toMatch(/classification_saillance/)
  })

  it('rejects a duplicate (territoire × story_key) — jamais deux fois la même Story', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMobiliteFixture)) as typeof histoiresMobiliteFixture
    histoires.push({ ...histoires[0] })

    const erreur = attendErreurValidation(documentsMobilite({ histoires }))
    expect(erreur.message).toMatch(/plusieurs Story/)
  })

  it('rejects a Story vintage malformed like an indicator one (two ISO dates + source/version)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMobiliteFixture)) as typeof histoiresMobiliteFixture
    ;(histoires[0] as { vintage_date_publication: string }).vintage_date_publication = '2026/08/06'

    const erreur = attendErreurValidation(documentsMobilite({ histoires }))
    expect(erreur.message).toMatch(/vintage/)
  })
})

describe('parsePayload — the Milieux contract (issue #174, ADR-0014, re-keyed par la spec #225)', () => {
  it('accepts the Milieux documents — la Story unique « Se densifier, s’étaler, ou s’en aller »', () => {
    const payload = parsePayload(documentsMilieux())

    expect(payload.indicateurs).toHaveLength(indicateursMilieuxFixture.length)
    const milieux = payload.histoires.filter((h): h is HistoireMilieux => h.theme === 'milieux')
    expect(milieux).toHaveLength(histoiresMilieuxFixture.length)
    for (const histoire of milieux) {
      expect(histoire.story_key).toBe('se-densifier-setaler-ou-sen-aller')
      expect(histoire.periode_pop).toBe('2017-2023')
      expect(histoire.periode_artif?.length ?? 0).toBeGreaterThan(0)
      expect(typeof histoire.delta_population).toBe('number')
      for (const champ of [
        'artif_m2',
        'artif_m3',
        'artif_m2_par_habitant',
        'artif_m3_par_habitant',
        'trajectoire_artif_par_habitant',
      ] as const) {
        expect(typeof histoire[champ], `« ${champ} »`).toBe('number')
      }
      // l'invariant du contrat : sign(ratio − 1) = sign(delta) — le fixture
      // entier le satisfait (la lecture et le graphe ne peuvent pas diverger) ;
      // les lignes sans trajectoire (le trou NA honnête) sortent de la preuve
      const m2 = histoire.artif_m2_par_habitant
      const m3 = histoire.artif_m3_par_habitant
      const ratio = histoire.trajectoire_artif_par_habitant
      if (m2 === null || m3 === null || ratio === null) continue
      expect(Math.sign(ratio - 1)).toBe(Math.sign(m3 - m2))
    }
    // les QUATRE lectures sont exercées dans le fixture, cas de signes mélangés
    // compris (22002 densifie en grandissant, 200000002 se vide en se renaturant)
    const lectures = new Set(milieux.map((h) => h.classification))
    expect(lectures).toEqual(
      new Set([
        'grandir-en-se-densifiant',
        'grandir-en-setalant',
        'sen-aller-et-consommer-quand-meme',
        'les-departs-laissent-la-place-a-la-renaturation',
      ]),
    )
  })

  it('rejects a Milieux histoire with an unknown story_key (drift must be loud)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    ;(histoires[0] as { story_key: string }).story_key = 'la-fuite-vers-la-campagne'

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/Story Milieux/)
  })

  it('rejects a Milieux histoire with an unknown classification', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    ;(histoires[0] as { classification: string }).classification = 'super'

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/classification/)
  })

  it('accepts a null classification — lecture NA (total incomplet), jamais une lecture inventée', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    ;(histoires[0] as { classification: string | null }).classification = null

    const payload = parsePayload(documentsMilieux({ histoires }))
    const milieux = payload.histoires.filter((h): h is HistoireMilieux => h.theme === 'milieux')
    expect(milieux[0].classification).toBeNull()
  })

  it('accepts the M2 = 0 shape — trajectoire null, classification null (la découverte #243)', () => {
    // 102 communes réelles (~8 %) n'ont AUCUNE terre artificialisée à l'état
    // initial : le ratio M3/0 est indéfini, la trajectoire est null — jamais
    // un rapport infini inventé, jamais un « s'étale » fabriqué.
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    const ligne = histoires[0] as HistoireMilieux
    ligne.artif_m2 = 0
    ligne.artif_m2_par_habitant = 0
    ligne.trajectoire_artif_par_habitant = null
    ligne.classification = null

    const payload = parsePayload(documentsMilieux({ histoires }))
    const milieux = payload.histoires.filter((h): h is HistoireMilieux => h.theme === 'milieux')
    expect(milieux[0].trajectoire_artif_par_habitant).toBeNull()
    expect(milieux[0].classification).toBeNull()
  })

  it('accepts the absent-state shape — tous les états null, la lecture absente (le trou NA honnête)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    const ligne = histoires[0] as HistoireMilieux
    ligne.artif_m2 = null
    ligne.artif_m3 = null
    ligne.artif_m2_par_habitant = null
    ligne.artif_m3_par_habitant = null
    ligne.trajectoire_artif_par_habitant = null
    ligne.classification = null

    const payload = parsePayload(documentsMilieux({ histoires }))
    const milieux = payload.histoires.filter((h): h is HistoireMilieux => h.theme === 'milieux')
    expect(milieux[0].trajectoire_artif_par_habitant).toBeNull()
    expect(milieux[0].classification).toBeNull()
  })

  it('rejects a defined trajectory with M2 = 0 — le ratio M3/0 est indéfini (fix #243)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    ;(histoires[0] as HistoireMilieux).artif_m2 = 0
    ;(histoires[0] as HistoireMilieux).artif_m2_par_habitant = 0
    // trajectoire laissée définie (1.13) — un Inf déguisé, rejeté

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/indéfini/)
  })

  it('rejects a null trajectory with M2 > 0 — la trajectoire est requise', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    ;(histoires[0] as HistoireMilieux).trajectoire_artif_par_habitant = null

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/trajectoire/)
  })

  it('rejects a classification without a trajectory — jamais une lecture sans sa seconde force', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    const ligne = histoires[0] as HistoireMilieux
    ligne.artif_m2 = 0
    ligne.artif_m2_par_habitant = 0
    ligne.trajectoire_artif_par_habitant = null
    // classification laissée définie — une lecture sans sa trajectoire, rejetée

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/classification/)
  })

  it('rejects mixed states — les quatre états sont tous présents ou tous absents, jamais un mélange', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    ;(histoires[0] as HistoireMilieux).artif_m3 = null

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/états/)
  })

  it('rejects a Milieux histoire missing its forces (delta_population / trajectoire absents)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    delete (histoires[0] as Partial<HistoireMilieux>).delta_population

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/delta_population/)
  })

  it('rejects a Milieux histoire missing the pivot columns (periode_artif / artif_m2 absents)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    delete (histoires[0] as Partial<HistoireMilieux>).periode_artif

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/periode_artif/)
  })

  it('rejects a negative artificialized area — une surface ne peut pas être négative', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    ;(histoires[0] as { artif_m2: number }).artif_m2 = -5

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/artif_m2/)
  })

  it('accepts a zero trajectory — la renaturation COMPLÈTE (M3 = 0) est une trajectoire 0 réelle', () => {
    // 11 communes réelles ont M2 > 0 et M3 = 0 (la renaturation complète) :
    // la trajectoire 0 est une valeur VRAIE, jamais une corruption — la même
    // forme que le 56001 du fixture (m2ph > 0, m3ph = 0, delta négatif).
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    const ligne = histoires[0] as HistoireMilieux
    ligne.artif_m3 = 0
    ligne.artif_m3_par_habitant = 0
    ligne.trajectoire_artif_par_habitant = 0
    ligne.classification = 'grandir-en-se-densifiant'

    const payload = parsePayload(documentsMilieux({ histoires }))
    const milieux = payload.histoires.filter((h): h is HistoireMilieux => h.theme === 'milieux')
    expect(milieux[0].trajectoire_artif_par_habitant).toBe(0)
  })

  it('rejects a negative trajectory — jamais un ratio négatif', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    ;(histoires[0] as HistoireMilieux).trajectoire_artif_par_habitant = -1

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/trajectoire/)
  })

  it('rejects the ratio/delta contradiction — un ratio < 1 doit porter un delta < 0 (l’invariant)', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    // 22001 : delta +300 (2 550 − 2 250) — un ratio < 1 se contredit
    ;(histoires[0] as { trajectoire_artif_par_habitant: number }).trajectoire_artif_par_habitant = 0.95

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/se contredisent/)
  })

  it('rejects the inverse contradiction — un ratio > 1 doit porter un delta > 0', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    // 22002 : delta −45 (855 − 900) — un ratio > 1 se contredit
    ;(histoires[1] as { trajectoire_artif_par_habitant: number }).trajectoire_artif_par_habitant = 1.2

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/se contredisent/)
  })

  it('rejects ratio == 1 avec un delta non nul — la cohérence est exacte', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    ;(histoires[0] as { trajectoire_artif_par_habitant: number }).trajectoire_artif_par_habitant = 1

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/se contredisent/)
  })

  it('rejects a duplicate Milieux histoire — une ligne par territoire, jamais deux', () => {
    const histoires = JSON.parse(JSON.stringify(histoiresMilieuxFixture)) as typeof histoiresMilieuxFixture
    histoires.push({ ...histoires[0] })

    const erreur = attendErreurValidation(documentsMilieux({ histoires }))
    expect(erreur.message).toMatch(/plusieurs histoires/)
  })
})

describe('parsePayload — the programmes contract (issue #179, ADR-0013)', () => {
  it('accepts the fixture programmes payload — the two tables parsed into types', () => {
    const payload = parsePayload(documentsBruts())

    expect(payload.programmes).toEqual(programmesFixture)
    expect(payload.programmes?.membres).toHaveLength(membresProgrammesFixture.length)
    expect(payload.programmes?.subventions).toHaveLength(subventionsProgrammesFixture.length)
  })

  it('carries the five sigles and the two anchor levels on the membership rows', () => {
    const payload = parsePayload(documentsBruts())
    const membres = payload.programmes?.membres ?? []

    expect(new Set(membres.map((m) => m.sigle))).toEqual(
      new Set(['ACV', 'PVD', 'CRTE', "Territoires d'industrie", 'ORT']),
    )
    expect(membres.every((m) => m.type === 'commune' || m.type === 'epci')).toBe(true)
    // l'ACV 22001 porte le rider « convention valant ORT » sur SA ligne de label
    expect(membres.find((m) => m.territoire === '22001' && m.sigle === 'ACV')).toMatchObject({
      type: 'commune',
      convention_valant_ort: true,
    })
  })

  it('accepts a null programmes document — the element is simply absent (404)', () => {
    const payload = parsePayload(documentsBruts({ programmes: null }))

    expect(payload.programmes).toBeNull()
  })

  it('rejects an unknown programme sigle — drift must be loud', () => {
    const programmes = JSON.parse(JSON.stringify(programmesFixture)) as typeof programmesFixture
    ;(programmes.membres[0] as { sigle: string }).sigle = 'GALAXIE'

    const erreur = attendErreurValidation(documentsBruts({ programmes }))
    expect(erreur.message).toMatch(/sigle/i)
  })

  it('rejects a membership row referencing an unknown territoire', () => {
    const programmes = JSON.parse(JSON.stringify(programmesFixture)) as typeof programmesFixture
    programmes.membres[0].territoire = '99999'

    const erreur = attendErreurValidation(documentsBruts({ programmes }))
    expect(erreur.message).toMatch(/territoire/i)
  })

  it('rejects a broken membership row — missing required field', () => {
    const programmes = JSON.parse(JSON.stringify(programmesFixture)) as typeof programmesFixture
    delete (programmes.membres[0] as Partial<(typeof programmes.membres)[number]>).convention_valant_ort

    attendErreurValidation(documentsBruts({ programmes }))
  })

  it('rejects a broken membership row — wrong type (string instead of boolean)', () => {
    const programmes = JSON.parse(JSON.stringify(programmesFixture)) as typeof programmesFixture
    ;(programmes.membres[0] as { convention_valant_ort: unknown }).convention_valant_ort = 'true'

    attendErreurValidation(documentsBruts({ programmes }))
  })

  it('rejects an ORT row without its per-row actualisation (date_reference null)', () => {
    const programmes = JSON.parse(JSON.stringify(programmesFixture)) as typeof programmesFixture
    const ort = programmes.membres.find((m) => m.sigle === 'ORT')
    ;(ort as { vintage_date_reference: string | null }).vintage_date_reference = null

    attendErreurValidation(documentsBruts({ programmes }))
  })

  it('rejects the « convention valant ORT » rider on a non-label row', () => {
    const programmes = JSON.parse(JSON.stringify(programmesFixture)) as typeof programmesFixture
    const crte = programmes.membres.find((m) => m.sigle === 'CRTE')
    ;(crte as { convention_valant_ort: boolean }).convention_valant_ort = true

    attendErreurValidation(documentsBruts({ programmes }))
  })

  it('rejects a subvention row with a non-numeric montant', () => {
    const programmes = JSON.parse(JSON.stringify(programmesFixture)) as typeof programmesFixture
    ;(programmes.subventions[0] as { montant: unknown }).montant = 'trente mille'

    attendErreurValidation(documentsBruts({ programmes }))
  })

  it('rejects a subvention aggregate row carrying a programme_libl (null by contract)', () => {
    const programmes = JSON.parse(JSON.stringify(programmesFixture)) as typeof programmesFixture
    const epci = programmes.subventions.find((s) => s.type === 'epci')
    ;(epci as { programme_libl: string | null }).programme_libl = 'Développement économique'

    attendErreurValidation(documentsBruts({ programmes }))
  })

  it('rejects a non-object programmes document — the file is { membres, subventions }, NOT an array', () => {
    // la dérive de forme que le PR #186 a épinglée : programmes.json est un
    // OBJET, jamais un tableau — un tableau doit échouer fort
    const programmes = membresProgrammesFixture

    const erreur = attendErreurValidation(documentsBruts({ programmes }))
    expect(erreur.message).toMatch(/objet|tableau/i)
  })

  it('rejects a programmes document missing the subventions table', () => {
    const { subventions: _subventions, ...sansSubventions } = programmesFixture

    attendErreurValidation(documentsBruts({ programmes: sansSubventions }))
  })

  it('accepts a programmes document with an empty table — honest empty state, not drift', () => {
    const payload = parsePayload(documentsBruts({ programmes: programmesVideFixture }))

    expect(payload.programmes).toEqual({ membres: [], subventions: [] })
  })
})
