import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  apercuAvecNAFixture,
  chargerAvec,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  metadonneesThemesFixtures,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY, usePayload, type ChargerFichier } from '../payload/usePayload'
import type { Fichier } from '../payload/loader'
import type { Payload } from '../payload/types'
import { PayloadError } from '../payload/validate'

/**
 * The progressive store (issue #298 — the T2 heart of PRD #296 « la page
 * d'abord, le reste en arrière-plan ») : per-file promises feeding one
 * reactive Payload that grows as files land. These tests observe the store
 * through its public seam — usePayload({ attendre }) with an injected
 * per-file charger — never its internals.
 */

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
  programmes: null,
  themeMetadata: { demographie: metadonneesThemesFixtures.demographie },
}

const Harness = defineComponent({
  props: {
    attendre: { type: Array as () => Fichier[] | undefined, default: undefined },
  },
  setup(props) {
    const etat = usePayload({ attendre: props.attendre })
    return { etat }
  },
  render: () => h('div'),
})

let montee: ReturnType<typeof mount> | null = null

async function monter(charger: ChargerFichier, attendre?: Fichier[]) {
  const wrapper = mount(Harness, {
    props: { attendre },
    global: { provide: { [PAYLOAD_CHARGER_KEY]: charger } },
  })
  montee = wrapper
  await flushPromises()
  return wrapper
}

afterEach(() => {
  montee?.unmount()
  montee = null
  vi.restoreAllMocks()
})

describe('le store progressif — la gating par wait-set', () => {
  it('ingère un thème avec un grand payload sans dépasser la pile d’arguments', async () => {
    const lignes = Array.from({ length: 70_000 }, (_, index) => ({
      ...indicateursDemographieFixture[0]!,
      territoire: String(index).padStart(5, '0'),
    }))
    const wrapper = await monter(
      chargerAvec({ ...payload, indicateurs: lignes }),
      ['territoires'],
    )

    expect(wrapper.vm.etat.payload.value?.indicateurs).toHaveLength(lignes.length)
  })

  it('no-arg = le full set : chargement false une fois tout réglé, payload complet', async () => {
    const wrapper = await monter(chargerAvec(payload))
    const { payload: p, erreur, chargement } = wrapper.vm.etat

    expect(chargement.value).toBe(false)
    expect(erreur.value).toBeNull()
    expect(p.value?.territoires).toEqual(territoiresFixture)
    expect(p.value?.indicateurs).toEqual(indicateursDemographieFixture)
    expect(p.value?.histoires).toEqual(histoiresDemographieFixture)
    expect(p.value?.runReport).toEqual(runReportFraisFixture)
    // La métadonnée du thème présent peuple le payload qui grandit.
    expect(p.value?.themeMetadata?.demographie).toEqual(metadonneesThemesFixtures.demographie)
  })

  it('attendre = gate de rendu : chargement false dès que le wait-set est réglé, même si le reste pend', async () => {
    let resoudreHabitat: (v: unknown) => void = () => {}
    const enAttente = new Promise<unknown>((resoudre) => {
      resoudreHabitat = resoudre
    })
    const wrapper = await monter(
      async (fichier) => {
        if (fichier === 'indicateurs_habitat') return enAttente
        return chargerAvec(payload)(fichier)
      },
      ['territoires', 'run-report'],
    )
    const { payload: p, chargement } = wrapper.vm.etat

    // Le wait-set est réglé — la page est vivante alors que l'habitat pend.
    expect(chargement.value).toBe(false)
    expect(p.value?.territoires).toEqual(territoiresFixture)

    // La section pendante reste vide honnête tant qu'elle n'est pas là.
    expect(p.value?.indicateurs).toEqual(indicateursDemographieFixture)

    // Une fois l'habitat réglé (thème absent — null), il ne contribue rien.
    resoudreHabitat(null)
    await flushPromises()
    expect(p.value?.indicateurs).toEqual(indicateursDemographieFixture)
  })

  it('une section est lisible AVANT que le wait-set ne soit réglé (le payload grandit)', async () => {
    let resoudreRun: (v: unknown) => void = () => {}
    const runEnAttente = new Promise<unknown>((resoudre) => {
      resoudreRun = resoudre
    })
    const wrapper = await monter(
      async (fichier) => (fichier === 'run-report' ? runEnAttente : chargerAvec(payload)(fichier)),
      ['territoires', 'run-report'],
    )
    const { payload: p, chargement } = wrapper.vm.etat

    // run-report pend → chargement encore true, mais territoires déjà lisible.
    expect(chargement.value).toBe(true)
    expect(p.value?.territoires).toEqual(territoiresFixture)

    resoudreRun(runReportFraisFixture)
    await flushPromises()
    expect(chargement.value).toBe(false)
  })

  it('un échec de wait-set → l’erreur typée, kind préservé', async () => {
    const wrapper = await monter(
      async (fichier) => {
        if (fichier === 'territoires') throw new PayloadError('fetch', 'territoires.json', 'boom')
        return chargerAvec(payload)(fichier)
      },
      ['territoires'],
    )
    const { erreur, chargement } = wrapper.vm.etat

    expect(chargement.value).toBe(false)
    expect(erreur.value).toBeInstanceOf(PayloadError)
    expect(erreur.value).toMatchObject({ kind: 'fetch', file: 'territoires.json' })
  })
})

describe('le store progressif — échecs scopés (option C)', () => {
  it('un échec d’arrière-plan laisse erreur null et la section absente — la page vit', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = await monter(
      async (fichier) => {
        if (fichier === 'indicateurs_habitat') {
          throw new PayloadError('validation', 'indicateurs_habitat.json', 'drift')
        }
        return chargerAvec(payload)(fichier)
      },
      ['territoires', 'run-report'],
    )
    const { payload: p, erreur, chargement } = wrapper.vm.etat

    expect(erreur.value).toBeNull()
    expect(chargement.value).toBe(false)
    // La section reste à son état vide honnête — jamais un rendu cassé.
    expect(p.value?.indicateurs).toEqual(indicateursDemographieFixture)
    // La dérive de validation reste LOUD (canari) — jamais muette.
    expect(consoleError).toHaveBeenCalled()
  })

  it('une dérive de validation d’arrière-plan est distinguable d’un échec de transport', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = await monter(
      async (fichier) => {
        if (fichier === 'indicateurs_habitat') {
          throw new PayloadError('fetch', 'indicateurs_habitat.json', 'réseau')
        }
        return chargerAvec(payload)(fichier)
      },
      ['territoires'],
    )
    const { erreur } = wrapper.vm.etat

    // Transport = transitoire, silencieux (jamais une dérive) — la page vit.
    expect(erreur.value).toBeNull()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('un thème présent sans histoires = dérive de validation LOUD, jamais une absence silencieuse', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = await monter(
      async (fichier) => {
        if (fichier === 'histoires_demographie') return null
        return chargerAvec(payload)(fichier)
      },
      ['territoires'],
    )
    const { erreur, chargement } = wrapper.vm.etat

    // Le thème est présent (indicateurs) mais son histoires 404 → dérive.
    expect(consoleError).toHaveBeenCalled()
    expect(chargement.value).toBe(false)
    // L'échec reste scopé : il n'est PAS dans le wait-set → erreur null, page vivante.
    expect(erreur.value).toBeNull()
  })

  it('un thème présent sans métadonnées = dérive de validation LOUD, jamais une absence silencieuse (#313)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = await monter(
      async (fichier) => {
        if (fichier === 'theme_demographie') return null
        return chargerAvec(payload)(fichier)
      },
      ['territoires'],
    )
    const { erreur, chargement, payload: p } = wrapper.vm.etat

    // Le thème est présent (indicateurs) mais sa métadonnée 404 → dérive.
    expect(consoleError).toHaveBeenCalled()
    expect(chargement.value).toBe(false)
    // L'échec reste scopé : erreur null, page vivante, la section reste à son
    // état vide honnête — aucune entrée de métadonnée pour le thème dérivé.
    expect(erreur.value).toBeNull()
    expect(p.value?.themeMetadata).toEqual({})
  })

  it('un thème absent (404 sur tout le jeu) ne contribue aucune entrée de métadonnées', async () => {
    const wrapper = await monter(chargerAvec(payload))
    const { payload: p } = wrapper.vm.etat

    // L'habitat est absent : ses indicateurs, histoires ET métadonnées sont
    // absents ensemble — seule la Démographie porte sa métadonnée.
    expect(p.value?.themeMetadata).toEqual({ demographie: metadonneesThemesFixtures.demographie })
  })

  it('recharger refetch UNIQUEMENT les fichiers échoués — jamais le full set', async () => {
    const demandes: Fichier[] = []
    let vintagesEchoue = true
    const wrapper = await monter(
      async (fichier) => {
        demandes.push(fichier)
        if (fichier === 'vintages' && vintagesEchoue) {
          vintagesEchoue = false
          throw new PayloadError('fetch', 'vintages.json', 'boom')
        }
        return chargerAvec(payload)(fichier)
      },
      ['territoires'],
    )
    const { erreur, recharger, payload: p } = wrapper.vm.etat

    // vintages est un échec d'arrière-plan : la page vit, vintages absent.
    expect(erreur.value).toBeNull()
    expect(p.value?.vintages).toBeNull()
    const demandesInitiales = demandes.length

    recharger()
    await flushPromises()

    // Seul vintages a été re-demandé (il était le seul échoué).
    const nouvellesDemandes = demandes.slice(demandesInitiales)
    expect(nouvellesDemandes).toEqual(['vintages'])
    // Et la section revient.
    expect(p.value?.vintages).toEqual(vintagesFixture)
  })

  it('recharger après un échec de wait-set : le retry remet la page debout', async () => {
    let territoiresEchoue = true
    const wrapper = await monter(
      async (fichier) => {
        if (fichier === 'territoires' && territoiresEchoue) {
          territoiresEchoue = false
          throw new PayloadError('fetch', 'territoires.json', 'boom')
        }
        return chargerAvec(payload)(fichier)
      },
      ['territoires'],
    )
    const { erreur, recharger, chargement } = wrapper.vm.etat

    expect(erreur.value).toMatchObject({ kind: 'fetch' })

    recharger()
    await flushPromises()

    expect(erreur.value).toBeNull()
    expect(chargement.value).toBe(false)
  })
})
