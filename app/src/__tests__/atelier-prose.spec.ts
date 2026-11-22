import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'

import * as moduleMarkdown from '../atelier/markdown'
import { ProseMarkdown } from '../atelier/markdown'

/**
 * Le sous-ensemble Markdown de l'Atelier (spec #1074) : paragraphes, `##`/`###`,
 * **gras**, *italique* et listes `-`/`1.`. Tout le reste — liens, URL nues,
 * HTML, syntaxe inconnue — reste du texte littéral : le texte vient d'un lien
 * partagé, donc jamais d'injection HTML, jamais de nœud fabriqué à la main.
 */
function rendre(source: string) {
  const Hote = defineComponent({ render: () => h('div', { class: 'hote' }, h(ProseMarkdown, { source })) })
  return mount(Hote)
}

describe('atelier — rendu du texte (sous-ensemble Markdown)', () => {
  it('n’exporte que le composant de lecture : aucun helper interne ne fuit', () => {
    expect(Object.keys(moduleMarkdown)).toEqual(['ProseMarkdown'])
  })

  it('rend un paragraphe joint et justifié par la classe cahier partagée', () => {
    const hote = rendre('Une première ligne.\nUne deuxième ligne.')
    expect(hote.find('p').text()).toBe('Une première ligne. Une deuxième ligne.')
    expect(hote.find('.cahier-prose').exists()).toBe(true)
    expect(hote.find('.argument-copy').exists()).toBe(true)
  })

  it('rend les titres ## et ###, sans titre de niveau 1', () => {
    const hote = rendre('## Titre\n### Sous-titre\nTexte')
    expect(hote.find('h2').text()).toBe('Titre')
    expect(hote.find('h3').text()).toBe('Sous-titre')
    expect(hote.find('h1').exists()).toBe(false)
  })

  it('rend le gras et l’italique, y compris imbriqués', () => {
    const hote = rendre('Un **mot gras** et un *mot italique*, avec **du *gras italique***.')
    expect(hote.find('strong').text()).toBe('mot gras')
    expect(hote.find('em').exists()).toBe(true)
    expect(hote.text()).toContain('Un mot gras et un mot italique')
  })

  it('rend les listes à puces et numérotées', () => {
    const hote = rendre('- une\n- deux\n\n1. premier\n2. deuxième')
    const listes = hote.findAll('ul, ol')
    expect(listes).toHaveLength(2)
    expect(listes[0]!.element.tagName).toBe('UL')
    expect(listes[0]!.findAll('li').map((li) => li.text())).toEqual(['une', 'deux'])
    expect(listes[1]!.element.tagName).toBe('OL')
    expect(listes[1]!.findAll('li').map((li) => li.text())).toEqual(['premier', 'deuxième'])
  })

  it.each([
    '<script>alert(1)</script>',
    '<img src=x onerror="alert(1)">',
    '<a href="https://hameçon.example">Cliquer</a>',
    '[Cliquer](javascript:alert(1))',
    'https://hameçon.example/chemin?a=1',
    '# pas un titre',
    '> une citation',
    '```\ndu code\n```',
  ])('rend « %s » comme texte littéral, sans nœud injecté', (payload) => {
    const hote = rendre(payload)
    expect(hote.text()).toContain(payload.replace(/\n/g, ' '))
    expect(hote.find('script').exists()).toBe(false)
    expect(hote.find('img').exists()).toBe(false)
    expect(hote.find('a').exists()).toBe(false)
    expect(hote.html()).not.toMatch(/<(script|img|a)\b/i)
  })

  it('ne construit aucun nœud HTML depuis une chaîne (pas de v-html)', () => {
    const brut = readFileSync(resolve(process.cwd(), 'src', 'atelier', 'markdown.ts'), 'utf8')
    const source = brut.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(source).toMatch(/\bh\(/)
    expect(source).not.toMatch(/v-html|innerHTML|dangerouslySetInnerHTML|document\.createElement/)
  })
})
