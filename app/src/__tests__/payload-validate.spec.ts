import { describe, expect, it } from 'vitest'

import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  histoiresEconomieFixture,
  histoiresMobiliteFixture,
  indicateursDemographieFixture,
  indicateursEconomieFixture,
  indicateursMobiliteFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { PayloadError, parsePayload } from '../payload/validate'
import type { HistoireDemographie, HistoireMobilite, Payload } from '../payload/types'

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
