import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

import { chargerAvec, indicateursDemographieFixture, metadonneesThemesFixtures, territoiresFixture, vintagesFixture } from '../payload/fixtures'
import { creerMagasinPayload, usePayload } from '../payload/usePayload'
import { THEMES_CANONIQUES, type Payload } from '../payload/types'
import type { Fichier } from '../payload/loader'

/**
 * Staged-start store seam (#827). Injected in-memory rows exercise explicit
 * staged starts: a metadata-only load can settle first, then the SAME store
 * learns legacy indicator presence. This presence contract is not used by
 * production networking, where retired numerical JSON cannot signal drift.
 */

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: [],
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

function intercepterFetchProduction(): string[] {
  const demandes: string[] = []
  const classes = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [String(index + 1), {
    code: String(index + 1),
    libelle_insee: `Libellé INSEE ${index + 1}`,
    libelle_public: `Libellé public ${index + 1}`,
  }]))
  const documents: Record<string, unknown> = {
    'territoires.json': territoiresFixture,
    'territoires-metadata.json': {
      schema_version: '1',
      territory_reference_label: 'Référentiel territorial — classes de densité communale',
      source_records: {
        classe_densite_communale: {
          dataset: 'Grille de densité 2025 — maille communale',
          publisher: 'INSEE',
          url: 'https://www.insee.fr/fr/statistiques/fichier/8571524/fichier_diffusion_2026.xlsx',
          licence: 'Licence Ouverte 2.0',
          sha256: '8ebf3011743db45ab94c4ffb74d1bcb06929f0076ecd5b8247011bca861ca978',
          vintage: 'Classification 2025 · géographie communale au 01/01/2026 · RP 2021',
          freshness: 'Publication INSEE du 15 mai 2026',
        },
      },
      density_classes: classes,
    },
    'run-report.json': payload.runReport,
    'vintages.json': vintagesFixture,
    'theme_demographie.json': metadonneesThemesFixtures.demographie,
  }
  vi.stubGlobal('fetch', async (url: string) => {
    demandes.push(url)
    const document = documents[url.split('/').pop() ?? url]
    return document === undefined
      ? { ok: false, status: 404, json: async () => null }
      : { ok: true, status: 200, json: async () => document }
  })
  return demandes
}

describe('magasin — production retained starts and injected metadata transitions', () => {
  it('le démarrage de production sans argument ne demande que les projections retenues', async () => {
    const demandes = intercepterFetchProduction()
    const wrapper = mount(defineComponent({
      setup() {
        return { etat: usePayload() }
      },
      render: () => h('div'),
    }))
    try {
      await flushPromises()

      expect(demandes.filter((url) => /\/(indicateurs|histoires)_[^/]+\.json$/.test(url))).toEqual([])
      expect(demandes).toContain('/data/territoires.json')
      expect(demandes).toContain('/data/territoires-metadata.json')
      expect(demandes).toContain('/data/run-report.json')
      expect(demandes).toContain('/data/vintages.json')
      expect(demandes).toContain('/data/theme_demographie.json')
      expect(wrapper.vm.etat.erreur.value).toBeNull()
      expect(wrapper.vm.etat.chargement.value).toBe(false)
      expect(wrapper.vm.etat.payload.value.territoires).toEqual(territoiresFixture)
      expect(wrapper.vm.etat.payload.value.territoryMetadata).not.toBeNull()
      expect(wrapper.vm.etat.payload.value.runReport).toEqual(payload.runReport)
      expect(wrapper.vm.etat.payload.value.vintages).toEqual(vintagesFixture)
      expect(wrapper.vm.etat.payload.value.themeMetadata?.demographie).toEqual(metadonneesThemesFixtures.demographie)
    } finally {
      wrapper.unmount()
      vi.unstubAllGlobals()
    }
  })

  it('les demandes explicites de tous les exports numériques retirés ne font aucun HTTP et ne bloquent pas les métadonnées', async () => {
    const demandes = intercepterFetchProduction()
    try {
      const magasin = creerMagasinPayload()
      const anciensExports = THEMES_CANONIQUES.flatMap((theme) => [
        `indicateurs_${theme}` as Fichier,
        `histoires_${theme}` as Fichier,
      ])
      magasin.demarrer([...anciensExports, 'theme_demographie'])
      await flushPromises()

      expect(demandes.filter((url) => /\/(indicateurs|histoires)_[^/]+\.json$/.test(url))).toEqual([])
      expect(demandes).toContain('/data/theme_demographie.json')
      expect(magasin.etats.get('indicateurs_demographie')?.valeur).toBeNull()
      expect(magasin.etats.get('histoires_demographie')?.valeur).toBeNull()
      expect(magasin.etats.get('theme_demographie')?.erreur).toBeNull()
      expect(magasin.payload.value.themeMetadata?.demographie).toEqual(metadonneesThemesFixtures.demographie)
    } finally {
      vi.unstubAllGlobals()
    }
  })

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
