import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import { THEMES_CONSTRUITS, THEMES_METHODES, ancreIndicateur } from '../methodes/indicateurs'
import type { ThemeConstruit } from '../methodes/indicateurs'
import { ancreSource } from '../methodes/sources'
import {
  apercuAvecNAFixture,
  chargerAvec,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  territoiresFixture,
} from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { Payload, Vintage } from '../payload/types'
import { routes } from '../router'
import MethodologieView from '../views/MethodologieView.vue'

/**
 * /methodologie — les blocs d'indicateurs (issue #129, layouts.md §5) : dans
 * l'onglet Méthodes du shell à onglets (#332, ?onglet=methodes), chaque
 * onglet intérieur de thème (?section=<theme>) montre le bloc d'ancre de ce
 * thème seul (#demographie, #habitat, #economie) — la rampe du thème, les
 * définitions des indicateurs (label, définition, unité, source) puis les
 * Stories. Jamais de bannière de construction (principles.md §1).
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

async function monter(theme: ThemeConstruit) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(`/methodologie?onglet=methodes&section=${theme}`)
  await router.isReady()
  const wrapper = mount(MethodologieView, {
    global: {
      plugins: [router],
      provide: { [PAYLOAD_CHARGER_KEY]: chargerAvec(payload) },
    },
  })
  await flushPromises()
  return wrapper
}

describe('MethodologieView — Méthodes · <thème> (les blocs d\u2019indicateurs)', () => {
  it('rend le bloc du thème sélectionné à son ancre — et lui seul', async () => {
    for (const theme of THEMES_CONSTRUITS) {
      const wrapper = await monter(theme)

      expect(wrapper.find(`section#indicateurs article#${theme}`).exists(), `bloc « ${theme} »`).toBe(
        true,
      )
      for (const autre of THEMES_CONSTRUITS) {
        if (autre === theme) continue
        expect(
          wrapper.find(`section#indicateurs article#${autre}`).exists(),
          `bloc « ${autre} » rendu sous ${theme}`,
        ).toBe(false)
      }
    }
  })

  it('chaque bloc de thème porte la rampe du thème (strong/wash/line)', async () => {
    for (const theme of THEMES_CONSTRUITS) {
      const wrapper = await monter(theme)

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
    for (const theme of THEMES_CONSTRUITS) {
      const wrapper = await monter(theme)

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

  it('chaque bloc d\u2019indicateur porte l\u2019ancre #indicateur-<clef> de sa clé de payload', async () => {
    for (const theme of THEMES_CONSTRUITS) {
      const wrapper = await monter(theme)

      const bloc = wrapper.find(`section#indicateurs article#${theme}`)
      for (const [clef] of Object.entries(THEMES_METHODES[theme].indicateurs)) {
        const blocIndicateur = bloc.find(`.bloc-indicateur[data-clef="${clef}"]`)
        expect(
          blocIndicateur.attributes('id'),
          `« ${theme}.${clef} » sans ancre #indicateur-<clef>`,
        ).toBe(ancreIndicateur(clef))
      }
    }
  })

  it('ne met aucune ancre sur les blocs de Stories (le contrat n\u2019est pas minté — #308)', async () => {
    for (const theme of THEMES_CONSTRUITS) {
      const wrapper = await monter(theme)

      const bloc = wrapper.find(`section#indicateurs article#${theme}`)
      const storiesAvecAncre = bloc.findAll('.bloc-story[id]')
      expect(storiesAvecAncre.length, `« ${theme} » — des Stories ancrées`).toBe(0)
    }
  })

  it('documente chaque Story du registre avec son titre, sa définition et ses lectures', async () => {
    for (const theme of THEMES_CONSTRUITS) {
      const wrapper = await monter(theme)

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

  it('ne documente plus la Story de la région « Ce que la Bretagne abrite » (retirée du contrat, #367)', async () => {
    const wrapper = await monter('economie')

    const bloc = wrapper.find('section#indicateurs article#economie')
    const texte = bloc.text()
    expect(texte).not.toContain('Ce que la Bretagne abrite')
    // la Story unique reste documentée — et porte la mention du retrait
    expect(texte).toContain('Ce que la commune abrite')
  })

  it('rend la table « Le sens des classements » par thème — chaque indicateur et sa direction', async () => {
    for (const theme of THEMES_CONSTRUITS) {
      const wrapper = await monter(theme)

      const bloc = wrapper.find(`section#indicateurs article#${theme}`)
      const table = bloc.find('.groupe-ordinalite .table-ordinalite')
      expect(table.exists(), `« ${theme} » sans table ordinale`).toBe(true)
      expect(bloc.find('.groupe-ordinalite .ordinalite-intro').text()).toMatch(/1er est toujours bon/)

      for (const [clef, indicateur] of Object.entries(THEMES_METHODES[theme].indicateurs)) {
        const ligne = table.find(`.ligne-ordinalite[data-clef="${clef}"]`)
        expect(ligne.exists(), `ligne « ${theme}.${clef} » absente`).toBe(true)
        expect(ligne.text()).toContain(indicateur.label)
        expect(ligne.text(), `direction « ${theme}.${clef} »`).toContain(
          indicateur.direction === 'plus-est-mieux' ? 'plus = mieux' : 'moins = mieux',
        )
      }
    }
  })

  it('chaque bloc d\u2019indicateur porte le sens de son classement dans ses métadonnées', async () => {
    for (const theme of THEMES_CONSTRUITS) {
      const wrapper = await monter(theme)

      const bloc = wrapper.find(`section#indicateurs article#${theme}`)
      for (const [clef, indicateur] of Object.entries(THEMES_METHODES[theme].indicateurs)) {
        const blocIndicateur = bloc.find(`.bloc-indicateur[data-clef="${clef}"]`)
        const meta = blocIndicateur.find('.meta-direction')
        expect(meta.exists(), `« ${theme}.${clef} » sans sens du classement`).toBe(true)
        expect(meta.text()).toContain(
          indicateur.direction === 'plus-est-mieux' ? 'plus = mieux' : 'moins = mieux',
        )
      }
    }
  })

  it('documente l\u2019horloge lente dans le bloc mobilité — fait de première classe (ADR-0012)', async () => {
    const wrapper = await monter('mobilite')

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
    const wrapper = await monter('milieux')

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
    const wrapper = await monter('mobilite')

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
    const wrapper = await monter('mobilite')

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
    const wrapper = await monter('economie')

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
    const wrapper = await monter('demographie')

    const texte = wrapper.text()
    expect(texte).not.toMatch(/à venir|en construction|bientôt|under construction/i)
  })
})

describe('MethodologieView — le lien « Source » pointe l\u2019en-tête du jeu (matrice #336)', () => {
  it('chaque indicateur lié cible l\u2019ancre de l\u2019en-tête de SON jeu — jamais une ligne vintage', async () => {
    // le sens inverse de la matrice : le lien « Source » d'un indicateur doit
    // atterrir sur l'en-tête du jeu (#source-<dataset>), y compris pour les
    // sources multi-vintage jadis injoignables (DVF, DPE, OCS-GE)
    const attendus: Record<string, string> = {
      prix_m2: ancreSource('dvf'),
      part_passoires: ancreSource('dpe'),
      distribution_dpe: ancreSource('dpe'),
      artif_par_habitant: ancreSource('ocsge_artificialisation'),
      densite: ancreSource('serie_historique'),
      nb_buildings: ancreSource('mobilite_snapshot'),
    }

    for (const theme of THEMES_CONSTRUITS) {
      const wrapper = await monter(theme)
      const bloc = wrapper.find(`section#indicateurs article#${theme}`)
      for (const clef of Object.keys(THEMES_METHODES[theme].indicateurs)) {
        const blocIndicateur = bloc.find(`.bloc-indicateur[data-clef="${clef}"]`)
        const lien = blocIndicateur.find('a.meta-source-lien')
        if (clef in attendus) {
          expect(lien.exists(), `« ${theme}.${clef} » sans lien Source`).toBe(true)
          expect(
            lien.attributes('href'),
            `« ${theme}.${clef} » → ${lien.attributes('href')}`,
          ).toBe(`#${attendus[clef]}`)
        }
      }
    }
  })
})
