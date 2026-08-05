import { describe, expect, it } from 'vitest'

import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { PayloadError, parsePayload } from '../payload/validate'
import type { HistoireDemographie, Payload } from '../payload/types'

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

  it('rejects a commune without an EPCI in the reference table', () => {
    const territoires = JSON.parse(JSON.stringify(territoiresFixture)) as typeof territoiresFixture
    territoires[0].epci = null

    attendErreurValidation(documentsBruts({ territoires }))
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
})
