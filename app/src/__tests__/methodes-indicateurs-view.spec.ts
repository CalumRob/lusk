import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import { THEMES_CONSTRUITS, THEMES_METHODES } from '../methodes/indicateurs'
import {
  apercuAvecNAFixture,
  chargerAvec,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  territoiresFixture,
} from '../payload/fixtures'
import type { ChargerFichier } from '../payload/usePayload'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { Payload, Vintage } from '../payload/types'
import { routes } from '../router'
import MethodologieView from '../views/MethodologieView.vue'

/**
 * /methodologie — la section « les indicateurs » (issue #129, layouts.md §5) :
 * pour chaque thème construit, un bloc d'ancre (#demographie, #habitat,
 * #economie) qui porte la rampe du thème, les définitions des indicateurs
 * (label, définition, unité, source) puis les Stories. Jamais de bannière de
 * construction (principles.md §1).
 */

const dataDir = join(process.cwd(), '..', 'public', 'data')

function vintagesCommites(): Vintage[] {
  return JSON.parse(readFileSync(join(dataDir, 'vintages.json'), 'utf-8')) as Vintage[]
}

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: null,
  vintages: vintagesCommites(),
  programmes: null,
}

async function monter(charger: ChargerFichier) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/methodologie')
  await router.isReady()
  const wrapper = mount(MethodologieView, {
    global: {
      plugins: [router],
      provide: { [PAYLOAD_CHARGER_KEY]: charger },
    },
  })
  await flushPromises()
  return wrapper
}

describe('MethodologieView — la section « les indicateurs »', () => {
  it('rend une section par thème construit, chacune à son ancre', async () => {
    const wrapper = await monter(chargerAvec(payload))

    for (const theme of THEMES_CONSTRUITS) {
      const bloc = wrapper.find(`section#indicateurs article#${theme}`)
      expect(bloc.exists(), `bloc « ${theme} » introuvable`).toBe(true)
    }
  })

  it('chaque bloc de thème porte la rampe du thème (strong/wash/line)', async () => {
    const wrapper = await monter(chargerAvec(payload))

    for (const theme of THEMES_CONSTRUITS) {
      const bloc = wrapper.find(`section#indicateurs article#${theme}`)
      expect(bloc.classes()).toContain(`bloc-theme--${theme}`)
      const style = bloc.attributes('style') ?? ''
      expect(style, `« ${theme} » sans rampe strong`).toContain(
        `var(--theme-${theme}-strong)`,
      )
      expect(style).toContain(`var(--theme-${theme}-wash)`)
      expect(style).toContain(`var(--theme-${theme}-line)`)
    }
  })

  it('liste chaque indicateur du registre avec sa définition, son unité et sa source', async () => {
    const wrapper = await monter(chargerAvec(payload))

    for (const theme of THEMES_CONSTRUITS) {
      const bloc = wrapper.find(`section#indicateurs article#${theme}`)
      for (const [clef, indicateur] of Object.entries(THEMES_METHODES[theme].indicateurs)) {
        const blocIndicateur = bloc.find(`.bloc-indicateur[data-clef="${clef}"]`)
        expect(blocIndicateur.exists(), `bloc « ${theme}.${clef} » introuvable`).toBe(true)
        const texte = blocIndicateur.text()
        expect(texte, `« ${theme}.${clef} » sans label`).toContain(indicateur.label)
        expect(texte, `« ${theme}.${clef} » sans définition`).toContain(indicateur.definition)
        expect(texte, `« ${theme}.${clef} » sans source`).toContain(indicateur.source)
        // une unité vide (rapport sans unité) rend « sans unité », jamais une case vide
        expect(texte).toContain(indicateur.unite || 'sans unité')
      }
    }
  })

  it('documente chaque Story du registre avec son titre, sa définition et ses lectures', async () => {
    const wrapper = await monter(chargerAvec(payload))

    for (const theme of THEMES_CONSTRUITS) {
      const bloc = wrapper.find(`section#indicateurs article#${theme}`)
      const texte = bloc.text()
      for (const story of THEMES_METHODES[theme].stories) {
        expect(texte, `« ${theme}.${story.clef} » sans titre`).toContain(story.titre)
        expect(texte, `« ${theme}.${story.clef} » sans définition`).toContain(story.definition)
        for (const lecture of story.lectures) {
          expect(texte, `« ${theme}.${story.clef} » sans lecture « ${lecture.nom} »`).toContain(
            lecture.nom,
          )
        }
      }
    }
  })

  it('documente la Story de la région « Ce que la Bretagne abrite » dans le bloc économie', async () => {
    const wrapper = await monter(chargerAvec(payload))

    const bloc = wrapper.find('section#indicateurs article#economie')
    const texte = bloc.text()
    expect(texte).toContain('Ce que la Bretagne abrite')
    expect(texte).toContain('les cinq types d’établissements les plus présents')
  })

  it('documente l\u2019horloge lente dans le bloc mobilité — fait de première classe (ADR-0012)', async () => {
    const wrapper = await monter(chargerAvec(payload))

    const bloc = wrapper.find('section#indicateurs article#mobilite')
    expect(bloc.exists()).toBe(true)
    const texte = bloc.text()
    const horloge = THEMES_METHODES.mobilite.horlogeLente
    expect(horloge).toBeDefined()
    expect(texte).toContain('L’horloge lente')
    expect(texte).toContain(horloge!.consommation)
    expect(texte).toContain(horloge!.declencheur)
    for (const entree of horloge!.entrees) {
      expect(texte).toContain(entree.donnee)
    }
  })

  it('documente les horloges dans le bloc milieux — fait de première classe (ADR-0014, étendu ADR-0017)', async () => {
    const wrapper = await monter(chargerAvec(payload))

    const bloc = wrapper.find('section#indicateurs article#milieux')
    expect(bloc.exists()).toBe(true)
    const texte = bloc.text()
    const horloges = THEMES_METHODES.milieux.deuxHorloges
    expect(horloges).toBeDefined()
    expect(texte).toContain('Les horloges du thème')
    expect(texte).toContain(horloges!.consommation)
    expect(texte).toContain(horloges!.declencheur)
    for (const entree of horloges!.entrees) {
      expect(texte).toContain(entree.donnee)
    }
  })

  it('rend la figure « L\u2019offre cyclable » dans le bloc mobilité — la documentation de la règle (issue #233)', async () => {
    const wrapper = await monter(chargerAvec(payload))

    const bloc = wrapper.find('section#indicateurs article#mobilite')
    expect(bloc.exists()).toBe(true)
    const figure = THEMES_METHODES.mobilite.indicateurs.offre_cyclable
    expect(figure).toBeDefined()
    const blocFigure = bloc.find('.bloc-indicateur[data-clef="offre_cyclable"]')
    expect(blocFigure.exists(), '« mobilite.offre_cyclable » non rendue').toBe(true)
    expect(blocFigure.text()).toContain(figure!.label)
    expect(blocFigure.text()).toContain(figure!.definition)
    expect(blocFigure.text()).toContain(figure!.source)
    expect(blocFigure.text()).toContain('km')
  })

  it('documente les deux horloges du ratio dans le bloc mobilité — fait de première classe (issue #233)', async () => {
    const wrapper = await monter(chargerAvec(payload))

    const bloc = wrapper.find('section#indicateurs article#mobilite')
    expect(bloc.exists()).toBe(true)
    const texte = bloc.text()
    const horloges = THEMES_METHODES.mobilite.deuxHorloges
    expect(horloges).toBeDefined()
    expect(texte).toContain('Les horloges du thème')
    expect(texte).toContain(horloges!.consommation)
    expect(texte).toContain(horloges!.declencheur)
    for (const entree of horloges!.entrees) {
      expect(texte).toContain(entree.donnee)
    }
  })

  it('marque la Story en pause comme non publiée, jamais comme une Story active', async () => {
    const wrapper = await monter(chargerAvec(payload))

    const bloc = wrapper.find('section#indicateurs article#economie')
    const marqueur = bloc.find('.bloc-story--en-pause .bloc-story-pause')
    expect(marqueur.exists()).toBe(true)
    expect(marqueur.text()).toMatch(/en pause/i)
    expect(marqueur.text()).toMatch(/non publiée/i)
    // les lectures du dortoir restent documentées, mais dans la note en pause
    expect(bloc.find('.bloc-story--en-pause').text()).toContain('Dortoir profond')
    expect(bloc.find('.bloc-story--en-pause').text()).toContain('Équilibre')
  })

  it('ne rend aucune bannière de construction', async () => {
    const wrapper = await monter(chargerAvec(payload))

    const texte = wrapper.text()
    expect(texte).not.toMatch(/à venir|en construction|bientôt|under construction/i)
  })

  it('la section des indicateurs vient après celle des sources', async () => {
    const wrapper = await monter(chargerAvec(payload))

    const sources = wrapper.find('section#sources')
    const indicateurs = wrapper.find('section#indicateurs')
    expect(sources.exists()).toBe(true)
    expect(indicateurs.exists()).toBe(true)
    expect(sources.element.compareDocumentPosition(indicateurs.element)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })
})
