// THROWAWAY heading specimens. Only imported by the development PDF adapter.
// Fixed type, two rendered lines, whole names; never measure contributors.
const nouns = { commune: 'COMMUNES', epci: 'EPCI', departement: 'DÉPARTEMENTS' }
export function comparisonHeadingMockup(section, spec) {
  const heading = section.querySelector('.concept-group-heading')
  const oldTitle = heading.querySelector('h3')
  const identity = heading.querySelector('.pdf-section-territory')
  oldTitle.remove() // Section identity survives in metadata and the section URL.
  if (spec.specimen) {
    identity.querySelector('.page-heading-territory').textContent = spec.focal.nom
    // No live observations are allowed beneath a fabricated selection heading.
    for (const child of [...section.children]) if (child !== heading) child.remove()
    const warning = document.createElement('p')
    warning.textContent = 'MAQUETTE SYNTHÉTIQUE — sélection de démonstration, aucune observation ni statistique réelle.'
    warning.style.cssText = 'font:var(--type-figure-legend);color:var(--ink);text-align:center;margin:32px 0;'
    const caption = document.createElement('p')
    caption.textContent = 'Épreuve du sous-titre de comparaison — ' + spec.description
    caption.style.cssText = 'font:var(--type-figure-title);color:var(--ink);text-align:center;'
    section.append(warning, caption)
    if (spec.specimenEvidence) {
      const evidence = document.createElement('p')
      evidence.textContent = 'Preuve comparée simulée : Territoire — [valeur fictive] / Groupe comparé — [référence fictive]. Aucun rang calculé.'
      evidence.style.cssText = 'font:var(--type-figure-legend);color:var(--muted);text-align:center;margin:24px 0;'
      section.append(evidence)
    }
    identity.removeAttribute('href')
  }
  const evidence = [...section.querySelectorAll('[data-pdf-footer-reference]')].some(node => node.getClientRects().length)
  // Specimens explicitly simulate displayed evidence, never masquerade as facts.
  if (!evidence && !spec.specimenEvidence) return { displayed: null, reason: 'no-displayed-comparison' }
  const subtitle = document.createElement('div')
  subtitle.style.cssText = 'width:100%;font-size:18px;text-align:center;line-height:26px;white-space:normal;overflow-wrap:normal;word-break:normal;'
  const prefix = document.createElement('span')
  prefix.textContent = 'Groupe comparé : '
  prefix.style.cssText = 'font:var(--type-figure-legend);font-weight:400;color:var(--muted);'
  const names = document.createElement('span')
  const focalStyle = getComputedStyle(identity.querySelector('.page-heading-territory'))
  for (const property of ['font-family', 'font-weight', 'font-style', 'color', 'letter-spacing']) names.style.setProperty(property, focalStyle.getPropertyValue(property))
  names.style.fontSize = '18px' // Fixed specimen size, not a fitted/shrinking size.
  names.style.lineHeight = '26px'
  subtitle.append(prefix, names); heading.append(subtitle)
  const measurements = []
  const fits = text => {
    names.textContent = text
    const range = document.createRange(); range.selectNodeContents(subtitle)
    const rects = [...range.getClientRects()].filter(rect => rect.width > .1)
    const result = rects.every(rect => rect.left >= subtitle.getBoundingClientRect().left - .5 && rect.right <= subtitle.getBoundingClientRect().right + .5)
      && subtitle.getBoundingClientRect().height <= 52.5
    measurements.push({ text, height: subtitle.getBoundingClientRect().height, fits: result })
    return result
  }
  const upper = text => text.toLocaleUpperCase('fr-FR')
  let sorted = [], shown = null, text, strategy = 'preset'
  if (spec.preset === 'epci') text = upper(spec.epci.nom)
  else if (spec.preset === 'bretagne') text = { commune: 'COMMUNES BRETONNES', epci: 'EPCI BRETONS', departement: 'DÉPARTEMENTS BRETONS' }[spec.level]
  else {
    sorted = [...spec.members].sort((a, b) => a.nom.localeCompare(b.nom, 'fr-FR'))
    const list = count => sorted.slice(0, count).map(member => upper(member.nom)).join(', ')
    shown = sorted.length; text = list(shown); strategy = 'all'
    if (!fits(text)) {
      strategy = 'prefix'; shown = 0
      // Try every complete prefix, not a character/count threshold. Suffix width varies with N.
      for (let count = 1; count < sorted.length; count++) {
        const omitted = sorted.length - count
        const noun = omitted === 1 ? { commune: 'COMMUNE', epci: 'EPCI', departement: 'DÉPARTEMENT' }[spec.level] : nouns[spec.level]
        const candidate = `${list(count)} ET ${omitted} ${omitted === 1 ? 'AUTRE' : 'AUTRES'} ${noun}`
        if (fits(candidate)) { shown = count; text = candidate }
      }
      if (!shown) { strategy = 'count-only'; text = `SÉLECTION DE ${sorted.length} ${nouns[spec.level]}` }
    }
  }
  if (!fits(text)) throw new Error('Heading specimen exceeds two lines')
  return { displayed: text, strategy, shown, total: sorted.length || null,
    sortedMembers: sorted, measurements, nameFontSize: getComputedStyle(names).fontSize,
    nameFontFamily: focalStyle.fontFamily, width: subtitle.clientWidth, height: subtitle.getBoundingClientRect().height }
}
