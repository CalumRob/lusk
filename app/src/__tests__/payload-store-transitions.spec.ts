import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

import { chargerAvec, indicateursDemographieFixture, metadonneesThemesFixtures, territoiresFixture, vintagesFixture } from '../payload/fixtures'
import { creerMagasinPayload } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import type { Fichier } from '../payload/loader'

/**
 * Staged-start store seam (#827). ONE store instance, explicit staged starts:
 * a metadata-only load (Sources) can settle its 404 first, then the SAME store
 * later learns actual indicator presence. These tests drive the real store, not
 * a per-call injected default that would start every file in a fixed order.
 */

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: [],
  apercu: null,
  runReport: null,
  vintages: vintagesFixture,
  programmes: null,
  themeMetadata: { demographie: metadonneesThemesFixtures.demographie },
}

/** A charger whose indicator request can be deferred until the test releases it. */
function chargerDiffere(options: { metadonneesAbsentes?: boolean; indicateursAbsents?: boolean } = {}) {
  const demandes: Fichier[] = []
  let metadonneesAbsentes = options.metadonneesAbsentes ?? false
  let libererIndicateurs: (() => void) | null = null
  const indicateurs = new Promise<unknown>((resolve) => {
    libererIndicateurs = () => resolve(options.indicateursAbsents ? null : indicateursDemographieFixture)
  })
  const charger = async (fichier: Fichier) => {
    demandes.push(fichier)
    if (fichier === 'theme_demographie') return metadonneesAbsentes ? null : metadonneesThemesFixtures.demographie
    if (fichier === 'indicateurs_demographie') return indicateurs
    return chargerAvec(payload)(fichier)
  }
  return {
    charger,
    demandes,
    liberer: () => libererIndicateurs?.(),
    metadonneesPresentes: () => { metadonneesAbsentes = false },
  }
}

describe('magasin — transitions de présence métadonnées / indicateurs', () => {
  it('métadonnée 404 seule puis indicateurs PRÉSENTS → dérive typée, scopée et retryable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const differe = chargerDiffere({ metadonneesAbsentes: true })
    const magasin = creerMagasinPayload(differe.charger)

    // 1. Sources-only: metadata settles as an honest absence.
    magasin.demarrer(['territoires-metadata', 'vintages', 'theme_demographie'])
    await flushPromises()
    expect(magasin.etats.get('theme_demographie')?.etat).toBe('succes')
    expect(magasin.etats.get('theme_demographie')?.valeur).toBeNull()
    expect(consoleError).not.toHaveBeenCalled()

    // 2. The SAME store later learns the theme is genuinely present.
    magasin.demarrer(['territoires', 'indicateurs_demographie'])
    differe.liberer()
    await flushPromises()

    const meta = magasin.etats.get('theme_demographie')
    expect(meta?.etat).toBe('echec')
    expect(meta?.erreur).toMatchObject({ kind: 'validation', file: 'theme_demographie.json' })
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(magasin.payload.value.themeMetadata).toEqual({})

    // 3. Metadata-only recovery: only the metadata file is refetched.
    differe.metadonneesPresentes()
    const avant = differe.demandes.length
    magasin.recharger()
    await flushPromises()
    expect(differe.demandes.slice(avant)).toEqual(['theme_demographie'])
    expect(magasin.etats.get('theme_demographie')?.etat).toBe('succes')
    consoleError.mockRestore()
  })

  it('indicateurs PRÉSENTS puis métadonnée 404 → dérive typée dès le premier règlement', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const differe = chargerDiffere({ metadonneesAbsentes: true })
    const magasin = creerMagasinPayload(differe.charger)

    // The indicator table is present (it validates against the reference table).
    magasin.demarrer(['territoires', 'indicateurs_demographie'])
    differe.liberer()
    await flushPromises()
    magasin.demarrer(['theme_demographie'])
    await flushPromises()

    const meta = magasin.etats.get('theme_demographie')
    expect(meta?.etat).toBe('echec')
    expect(meta?.erreur).toMatchObject({ kind: 'validation', file: 'theme_demographie.json' })
    expect(magasin.payload.value.themeMetadata).toEqual({})
    consoleError.mockRestore()
  })

  it('indicateurs ABSENTS puis métadonnée présente → aucune métadonnée orpheline', async () => {
    const differe = chargerDiffere({ indicateursAbsents: true })
    const magasin = creerMagasinPayload(differe.charger)

    magasin.demarrer(['territoires', 'indicateurs_demographie'])
    differe.liberer()
    await flushPromises()
    magasin.demarrer(['theme_demographie'])
    await flushPromises()

    expect(magasin.etats.get('indicateurs_demographie')?.valeur).toBeNull()
    expect(magasin.etats.get('theme_demographie')?.valeur).toBeNull()
    expect(magasin.payload.value.themeMetadata).toEqual({})
  })

  it('métadonnée présente puis indicateurs ABSENTS → aucune métadonnée orpheline', async () => {
    const differe = chargerDiffere({ indicateursAbsents: true })
    const magasin = creerMagasinPayload(differe.charger)

    magasin.demarrer(['theme_demographie'])
    await flushPromises()
    expect(magasin.payload.value.themeMetadata?.demographie).toBeDefined()
    magasin.demarrer(['territoires', 'indicateurs_demographie'])
    differe.liberer()
    await flushPromises()

    expect(magasin.etats.get('indicateurs_demographie')?.valeur).toBeNull()
    expect(magasin.payload.value.themeMetadata).toEqual({})
  })

  it('Sources-only ne lit ni table territoriale ni table numérique', async () => {
    const differe = chargerDiffere()
    const magasin = creerMagasinPayload(differe.charger)

    magasin.demarrer(['territoires-metadata', 'vintages', 'theme_demographie'])
    await flushPromises()

    expect(differe.demandes.some((fichier) => fichier === 'territoires')).toBe(false)
    expect(differe.demandes.some((fichier) => fichier.startsWith('indicateurs_'))).toBe(false)
    expect(differe.demandes.some((fichier) => fichier.startsWith('histoires_'))).toBe(false)
  })
})
