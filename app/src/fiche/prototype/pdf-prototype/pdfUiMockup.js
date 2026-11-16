// THROWAWAY: the existing territory route, enabled only by the dedicated dev server.
// One agreed top-right placement; URL-switchable ready/preparing/done/error specimens.
import { createApp, h, ref } from 'vue'
import router from '@/router'
import PdfExportUiMockup from './PdfExportUiMockup.vue'
import { instances } from './rennes'
import { AEDAR_RAMP_MODES, AEDAR_RAMP_MODE_LABELS } from '@/fiche/content/aedarTimeRampFacts'

export async function mountPdfUiMockup() {
  if (!import.meta.env.DEV) return
  const source = await new Promise(resolve => {
    const find = () => {
      const element = document.querySelector('.cahier')
      if (!element?.querySelector('.concept-group[data-section="aedar-equipment-explorer"] h3')) return false
      resolve(element); return true
    }
    if (find()) return
    const observer = new MutationObserver(() => { if (find()) observer.disconnect() })
    observer.observe(document.body, { subtree: true, childList: true })
  })
  if (source.dataset.pdfUiMockup) return
  source.dataset.pdfUiMockup = 'true'
  const sections = [...source.querySelectorAll('#figure-lecture .concept-group')].map(section => {
    const key = section.dataset.section
    const heading = section.querySelector('.concept-group-heading')
    const copy = heading.querySelector('.concept-group-heading-copy') ?? heading.querySelector('h3')
    copy.dataset.pdfUiHeadingCopy = ''
    heading.dataset.pdfUiHeading = ''
    const action = document.createElement('div'); action.dataset.pdfUiAction = key
    heading.append(action)
    return { key, label: heading.querySelector('h3').textContent.trim(), selectableModes: ['aedar-access', 'aedar-equipment-explorer'].includes(key) }
  })
  const style = document.createElement('style')
  style.textContent = `
    [data-pdf-ui-heading] { display:grid!important;grid-template-columns:minmax(150px,1fr) minmax(0,auto) minmax(150px,1fr);align-items:center!important; }
    [data-pdf-ui-heading-copy] { grid-column:2; }
    [data-pdf-ui-action] { grid-column:3;justify-self:end; }
    @media(max-width:760px) {
      [data-pdf-ui-heading] { grid-template-columns:minmax(0,1fr) auto;gap:12px!important; }
      [data-pdf-ui-heading-copy] { grid-column:1;text-align:left!important; }
      [data-pdf-ui-action] { grid-column:2; }
      [data-pdf-ui-heading]>span { display:none; }
    }
  `
  document.head.append(style)
  const host = document.createElement('div'); host.dataset.pdfUiRoot = ''
  source.append(host)
  // `variant` is already owned by the Cahier layout; don't hijack that query.
  const scenario = ref(new URL(location.href).searchParams.get('pdf-ui-state') ?? 'ready')
  const changeScenario = async value => {
    await router.replace({ query: { ...router.currentRoute.value.query, 'pdf-ui-state': value } })
    scenario.value = value
  }
  const modes = () => {
    const root = instances()[0]
    const explorer = instances().find(instance => instance.type.__name === 'AedarEquipmentExplorerCahier')
    const selected = explorer?.setupState.selectedModes ?? root?.setupState.aedarAccessSelectedModes ?? []
    return AEDAR_RAMP_MODES.filter(key => selected.includes(key)).map(key => ({ key, label: AEDAR_RAMP_MODE_LABELS[key] }))
  }
  createApp({ setup: () => () => h(PdfExportUiMockup, { sections, scenario: scenario.value, changeScenario, modes }) }).mount(host)
  window.pdfUiMockup = { sections, modes, changeScenario }
  const keys = ['ready', 'preparing', 'done', 'error']
  window.addEventListener('keydown', event => {
    if (document.querySelector('dialog[open]') || event.target.closest('input, textarea, select, [contenteditable="true"]')) return
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    changeScenario(keys[(keys.indexOf(scenario.value) + (event.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length])
  })
}
