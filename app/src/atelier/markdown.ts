/**
 * Le sous-ensemble Markdown de l'Atelier (spec #1074), porté du prototype
 * `prototype/atelier-cell-picker` (0657b2fe).
 *
 * Un lecteur écrit ce texte et le partage par lien : il vient donc d'un
 * étranger. Chaque morceau passe par `h()` comme enfant texte — jamais
 * `v-html`, jamais une chaîne HTML. Paragraphes, `##`/`###`, **gras**,
 * *italique*, listes `-`/`1.`. Liens `[a](b)`, URL nues, HTML et syntaxe
 * inconnue restent du texte littéral : aucun nœud `<a>`, `<img>`, `<script>`
 * n'est fabriqué. Le style de prose vient de `cahierLayout.css` importé par la
 * page (classes `cahier-prose` + `argument-copy`), jamais redéfini ici.
 */
import { defineComponent, h, type VNodeChild } from 'vue'

/** Ferme un `*` simple : ni `**`, ni précédé d'une espace (évite `a * b`). */
function fermeSimple(src: string, depuis: number): number {
  for (let k = depuis; k < src.length; k++) {
    if (src[k] === '*' && src[k + 1] !== '*' && src[k - 1] !== '*' && src[k - 1] !== ' ') return k
  }
  return -1
}

function enLigne(src: string): VNodeChild[] {
  const sortie: VNodeChild[] = []
  let tampon = ''
  const vider = () => {
    if (tampon) sortie.push(tampon)
    tampon = ''
  }
  let i = 0
  while (i < src.length) {
    if (src.startsWith('**', i)) {
      const j = src.indexOf('**', i + 2)
      if (j > i + 2) {
        vider()
        sortie.push(h('strong', enLigne(src.slice(i + 2, j))))
        i = j + 2
        continue
      }
    }
    if (src[i] === '*' && src[i + 1] !== '*' && src[i + 1] !== ' ' && src[i + 1] !== undefined) {
      const j = fermeSimple(src, i + 1)
      if (j > i + 1) {
        vider()
        sortie.push(h('em', enLigne(src.slice(i + 1, j))))
        i = j + 1
        continue
      }
    }
    tampon += src[i]
    i++
  }
  vider()
  return sortie
}

const TITRE = /^(#{2,3}) (.+)$/
const PUCE = /^- (.*)$/
const NUMERO = /^\d+\. (.*)$/

function rendreMarkdown(source: string): VNodeChild[] {
  const lignes = source.replace(/\r/g, '').split('\n')
  const sortie: VNodeChild[] = []
  let i = 0
  while (i < lignes.length) {
    const ligne = lignes[i]!
    if (!ligne.trim()) {
      i++
      continue
    }
    const titre = TITRE.exec(ligne)
    if (titre) {
      const niveau = titre[1]!.length === 2 ? 'h2' : 'h3'
      sortie.push(h(niveau, { class: niveau === 'h2' ? 'atelier-md-h2' : 'atelier-md-h3' }, enLigne(titre[2]!.trim())))
      i++
      continue
    }
    const liste = PUCE.test(ligne) ? 'ul' : NUMERO.test(ligne) ? 'ol' : null
    if (liste) {
      const motif = liste === 'ul' ? PUCE : NUMERO
      const elements: VNodeChild[] = []
      while (i < lignes.length && motif.test(lignes[i]!)) {
        elements.push(h('li', enLigne(motif.exec(lignes[i]!)![1]!.trim())))
        i++
      }
      sortie.push(h(liste, { class: 'atelier-md-liste' }, elements))
      continue
    }
    const paragraphe: string[] = []
    while (i < lignes.length && lignes[i]!.trim() && !TITRE.test(lignes[i]!) && !PUCE.test(lignes[i]!) && !NUMERO.test(lignes[i]!)) {
      paragraphe.push(lignes[i]!.trim())
      i++
    }
    sortie.push(h('p', enLigne(paragraphe.join(' '))))
  }
  return sortie
}

/** Composant de lecture — le même nœud `div` que le prototype, avec les classes de production. */
export const ProseMarkdown = defineComponent({
  name: 'ProseMarkdown',
  props: { source: { type: String, required: true } },
  setup: (props) => () => h('div', { class: 'cahier-prose argument-copy atelier-md' }, rendreMarkdown(props.source)),
})
