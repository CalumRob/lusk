// Inventory of fiche → indicator-page handoffs, from the committed payload.
// Audit #481 — deterministic derivation, no app boot needed.
import { readFileSync } from 'node:fs'

const THEMES = ['mobilite', 'demographie', 'habitat', 'economie', 'milieux', 'programmes']
const rows = []
for (const t of THEMES) {
  const j = JSON.parse(readFileSync(new URL(`../../../../public/data/theme_${t}.json`, import.meta.url), 'utf8'))
  const pages = j.indicator_pages ?? {}
  console.log(`\n==== ${t.toUpperCase()} — ${Object.keys(pages).length} pages publiées ====`)
  for (const sg of j.subgroups ?? []) {
    const figKey = sg.figure?.indicator
    const figTxt = sg.figure ? `${sg.figure.family} → ${figKey}${pages[figKey] ? ' [PAGE]' : ' [pas de page]'}` : '—'
    console.log(`  [${sg.key}]  figure compacte : ${figTxt}`)
    if (sg.reading) console.log(`      lecture : ${sg.reading.story_key}`)
    for (const k of sg.indicators ?? []) {
      if (k === figKey) continue
      rows.push({ theme: t, sousGroupe: sg.key, site: 'grille', clef: k, page: Boolean(pages[k]), label: j.indicator_labels?.[k] })
      console.log(`      grille : ${k}${pages[k] ? ' [PAGE]' : ' [pas de page]'}`)
    }
    if (figKey) {
      rows.push({ theme: t, sousGroupe: sg.key, site: 'figure compacte', clef: figKey, page: Boolean(pages[figKey]), label: j.indicator_labels?.[figKey] })
    }
  }
}
console.log('\n---- résumé ----')
console.log(`sites de grille/compacte : ${rows.length}, avec page : ${rows.filter((r) => r.page).length}`)
for (const r of rows.filter((r) => !r.page)) console.log(`  sans page : ${r.theme}/${r.clef} (${r.site})`)
