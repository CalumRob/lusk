import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

import { chargerAvec, indicateursDemographieFixture, metadonneesThemesFixtures, territoiresFixture, vintagesFixture } from '../payload/fixtures'
import { creerMagasinPayload } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import type { Fichier } from '../payload/loader'

/**
 * OVERLAPPING in-flight pair (#827). Both the metadata and the indicator
 * request are independently deferred on ONE real store: the metadata request
 * starts first and stays pending, then the reference + indicators start and
 * stay pending, then the two are released in each order. The store must
 * reconcile the pair on EITHER settlement, not only on the indicator one.
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

function deferrer<T>() {
  let resolve!: (valeur: T) => void
  const promesse = new Promise<T>((r) => { resolve = r })
  return { promesse, resolve }
}

function chargerOverlap(options: { indicateursPresents: boolean; metadonneesPresentes: boolean }) {
  const demandes: Fichier[] = []
  const indicateurs = deferrer<unknown>()
  const metadonnees = deferrer<unknown>()
  const charger = async (fichier: Fichier) => {
    demandes.push(fichier)
    if (fichier === 'indicateurs_demographie') return indicateurs.promesse
    if (fichier === 'theme_demographie') return metadonnees.promesse
    return chargerAvec(payload)(fichier)
  }
  return {
    charger,
    demandes,
    libererIndicateurs: () => indicateurs.resolve(options.indicateursPresents ? indicateursDemographieFixture : null),
    libererMetadonnees: () => metadonnees.resolve(options.metadonneesPresentes ? metadonneesThemesFixtures.demographie : null),
  }
}

const CAS = [
  {
    nom: 'indicateurs présents / métadonnée 404 → dérive typée',
    indicateursPresents: true,
    metadonneesPresentes: false,
    verifier: (magasin: ReturnType<typeof creerMagasinPayload>, consoleError: ReturnType<typeof vi.spyOn>) => {
      const meta = magasin.etats.get('theme_demographie')
      expect(meta?.etat).toBe('echec')
      expect(meta?.erreur).toMatchObject({ kind: 'validation', file: 'theme_demographie.json' })
      expect(consoleError).toHaveBeenCalled()
      expect(magasin.payload.value.themeMetadata).toEqual({})
    },
  },
  {
    nom: 'indicateurs absents / métadonnée présente → aucune métadonnée orpheline',
    indicateursPresents: false,
    metadonneesPresentes: true,
    verifier: (magasin: ReturnType<typeof creerMagasinPayload>, consoleError: ReturnType<typeof vi.spyOn>) => {
      expect(magasin.etats.get('indicateurs_demographie')?.valeur).toBeNull()
      expect(magasin.payload.value.themeMetadata).toEqual({})
      expect(consoleError).not.toHaveBeenCalled()
    },
  },
] as const

describe('magasin — paire métadonnées/indicateurs EN VOL', () => {
  for (const cas of CAS) {
    for (const ordre of ['indicateurs puis métadonnée', 'métadonnée puis indicateurs'] as const) {
      it(`${cas.nom} — libération ${ordre}`, async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        const overlap = chargerOverlap(cas)
        const magasin = creerMagasinPayload(overlap.charger)

        // 1. The metadata request starts FIRST and stays pending.
        magasin.demarrer(['theme_demographie'])
        await flushPromises()
        // 2. Reference + indicators start and stay pending too.
        magasin.demarrer(['territoires', 'indicateurs_demographie'])
        await flushPromises()

        expect(overlap.demandes).toContain('theme_demographie')
        expect(overlap.demandes).toContain('indicateurs_demographie')
        expect(magasin.etats.get('theme_demographie')?.etat).toBe('en-cours')
        expect(magasin.etats.get('indicateurs_demographie')?.etat).toBe('en-cours')

        if (ordre === 'indicateurs puis métadonnée') {
          overlap.libererIndicateurs()
          await flushPromises()
          overlap.libererMetadonnees()
          await flushPromises()
        } else {
          overlap.libererMetadonnees()
          await flushPromises()
          overlap.libererIndicateurs()
          await flushPromises()
        }

        cas.verifier(magasin, consoleError)
        consoleError.mockRestore()
      })
    }
  }

  it('récupération métadonnée-seule sans relire les indicateurs', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const overlap = chargerOverlap({ indicateursPresents: true, metadonneesPresentes: false })
    const magasin = creerMagasinPayload(overlap.charger)

    magasin.demarrer(['theme_demographie'])
    await flushPromises()
    magasin.demarrer(['territoires', 'indicateurs_demographie'])
    await flushPromises()
    overlap.libererIndicateurs()
    await flushPromises()
    overlap.libererMetadonnees()
    await flushPromises()
    expect(magasin.etats.get('theme_demographie')?.etat).toBe('echec')

    const lecturesIndicateurs = overlap.demandes.filter((f) => f === 'indicateurs_demographie').length
    const lecturesTerritoriales = overlap.demandes.filter((f) => f === 'territoires').length
    magasin.recharger()
    await flushPromises()

    expect(overlap.demandes.filter((f) => f === 'indicateurs_demographie').length).toBe(lecturesIndicateurs)
    expect(overlap.demandes.filter((f) => f === 'territoires').length).toBe(lecturesTerritoriales)
    consoleError.mockRestore()
  })
})
