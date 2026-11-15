// THROWAWAY export-only choice. Never persists or silently discards a mode.
export function choosePdfModes(modes) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog')
    dialog.dataset.pdfModeChoice = ''
    dialog.setAttribute('aria-labelledby', 'pdf-mode-choice-title')
    dialog.style.cssText = 'max-width:440px;width:calc(100% - 48px);padding:24px;border:1px solid var(--border-default);border-radius:var(--radius-md);background:var(--paper);color:var(--ink);font:var(--type-figure-label);'
    const title = document.createElement('h3')
    title.id = 'pdf-mode-choice-title'; title.textContent = 'Choisir les modes du PDF'
    title.style.cssText = 'font:var(--text-h3);margin:0 0 12px;'
    const help = document.createElement('p')
    help.textContent = 'Trois modes maximum pour garder les tableaux lisibles. Votre sélection sur la page restera inchangée.'
    help.style.cssText = 'margin:0 0 16px;line-height:1.5;'
    const list = document.createElement('div')
    list.style.cssText = 'display:grid;gap:12px;'
    const inputs = modes.map(mode => {
      const label = document.createElement('label')
      label.style.cssText = 'display:flex;gap:10px;align-items:center;'
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = mode.key
      label.append(input, document.createTextNode(mode.label)); list.append(label); return input
    })
    const status = document.createElement('p'); status.setAttribute('aria-live', 'polite')
    const actions = document.createElement('div'); actions.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;'
    const cancel = document.createElement('button'); cancel.textContent = 'Annuler'
    const accept = document.createElement('button'); accept.textContent = 'Exporter'; accept.dataset.pdfConfirmModes = ''
    for (const button of [cancel, accept]) button.style.cssText = 'font:inherit;color:inherit;background:var(--paper);border:1px solid var(--border-default);padding:8px 12px;border-radius:var(--radius-sm);'
    const update = () => {
      const count = inputs.filter(input => input.checked).length
      status.textContent = `${count} / 3 modes sélectionnés`
      accept.disabled = count < 1 || count > 3
    }
    list.addEventListener('change', update); update()
    const finish = selection => { dialog.close(); dialog.remove(); resolve(selection) }
    cancel.onclick = () => finish(null)
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null) })
    accept.onclick = () => { if (!accept.disabled) finish(inputs.filter(input => input.checked).map(input => input.value)) }
    actions.append(cancel, accept); dialog.append(title, help, list, status, actions)
    document.querySelector('.cahier').append(dialog); dialog.showModal()
  })
}
