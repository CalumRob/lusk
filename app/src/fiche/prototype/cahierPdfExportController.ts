/**
 * Shared PDF interaction controller (#1023).
 *
 * The controller consumes #1021's public capture and a browser-side generator.
 * It owns only interaction state: the direct/chooser path, the immutable request
 * chosen for a generation, the real browser delivery, retry of the *same* failed
 * request and cleanup of late work. It owns no factual value, no PDF template
 * and no acquisition.
 */
import { computed, ref, shallowRef } from 'vue'
import type { ComputedRef } from 'vue'

import {
  CAHIER_EXPORT_MAX_MODES,
  projeterRequeteExport,
} from './cahierExportCapture'
import type {
  CahierExportCapture,
  CahierExportMode,
  CahierExportRequest,
} from './cahierExportCapture'
import {
  evaluerDisponibiliteExportPdf,
  messageActivationPdf,
} from './cahierPdfExport'
import type { CahierPdfActivation } from './cahierPdfExport'

export interface CahierPdfArtifact {
  readonly blob: Blob
  readonly fileName: string
}

export type CahierPdfGenerator = (
  request: CahierExportRequest,
  options: { readonly signal: AbortSignal },
) => Promise<CahierPdfArtifact>

export type CahierPdfExportState = 'idle' | 'preparing' | 'done' | 'error'

export interface CahierPdfExportControllerOptions {
  /** Synchronous immutable capture of the mounted section, or null when absent. */
  readonly capture: () => CahierExportCapture | null
  /** Null until the real browser composer is wired by integration lot E. */
  readonly generator: CahierPdfGenerator | null
}

export class CahierPdfExportController {
  readonly etat = ref<CahierPdfExportState>('idle')
  readonly modaleOuverte = ref(false)
  readonly modesProposes = ref<readonly CahierExportMode[]>([])
  readonly choix = ref<readonly string[]>([])
  readonly requete = shallowRef<CahierExportRequest | null>(null)
  /** Short accessible announcement; the button itself carries the visible state. */
  readonly annonce = ref('')

  readonly nombreChoix = computed(() => this.choix.value.length)
  readonly choixValide = computed(() =>
    this.nombreChoix.value > 0 && this.nombreChoix.value <= CAHIER_EXPORT_MAX_MODES)

  private readonly captureSource: () => CahierExportCapture | null
  private readonly generator: CahierPdfGenerator | null
  private captureEnAttente: CahierExportCapture | null = null
  private abort: AbortController | null = null
  private generation = 0
  private disposed = false
  private readonly objectUrls = new Set<string>()
  /** A registration/data change invalidates the reactive availability read. */
  private readonly rafraichissement = ref(0)

  readonly disponibilite: ComputedRef<CahierPdfActivation>
  readonly peutActiver: ComputedRef<boolean>

  constructor(options: CahierPdfExportControllerOptions) {
    this.captureSource = options.capture
    this.generator = options.generator
    this.disponibilite = computed(() => {
      this.rafraichissement.value
      if (!this.generator) {
        return {
          ready: false as const,
          reason: 'generator-unavailable' as const,
          message: messageActivationPdf('generator-unavailable'),
        }
      }
      const capture = this.lireCapture()
      if (!capture) {
        return {
          ready: false as const,
          reason: 'capture-unavailable' as const,
          message: messageActivationPdf('capture-unavailable'),
        }
      }
      return evaluerDisponibiliteExportPdf(capture)
    })
    this.peutActiver = computed(() => this.generator !== null
      && this.etat.value !== 'preparing'
      && (this.etat.value === 'error' || this.disponibilite.value.ready))
  }

  /** Re-read the registration and reactive owner observations after mount. */
  rafraichir(): void {
    this.rafraichissement.value += 1
  }

  activer(): void {
    if (this.disposed || this.etat.value === 'preparing') return
    if (this.etat.value === 'error') {
      this.reessayer()
      return
    }
    if (!this.generator) {
      this.annoncer(messageActivationPdf('generator-unavailable'))
      return
    }
    const capture = this.lireCapture()
    if (!capture) {
      this.annoncer(messageActivationPdf('capture-unavailable'))
      return
    }
    const activation = evaluerDisponibiliteExportPdf(capture)
    if (!activation.ready) {
      this.annoncer(activation.message)
      return
    }

    const offered = capture.capabilities.selectableSeries
    const selected = capture.capabilities.selectedSeries
    if (offered.length > 0 && (selected.length < 1 || selected.length > CAHIER_EXPORT_MAX_MODES)) {
      this.ouvrirChoix(capture, offered)
      return
    }
    this.demarrer(capture, offered.length === 0 ? [] : selected)
  }

  basculerMode(modeId: string, coche: boolean): void {
    const next = new Set(this.choix.value)
    if (coche) next.add(modeId)
    else next.delete(modeId)
    this.choix.value = [...next]
  }

  confirmer(): void {
    if (!this.captureEnAttente || !this.choixValide.value) return
    const projection = projeterRequeteExport(this.captureEnAttente, [...this.choix.value])
    if (projection.status !== 'ready') {
      this.annoncer(projection.message)
      return
    }
    this.fermerChoix()
    this.demarrerRequete(projection.request)
  }

  annuler(): void {
    this.fermerChoix()
    this.annonce.value = ''
  }

  reessayer(): void {
    if (this.disposed || this.etat.value !== 'error') return
    const request = this.requete.value
    if (!request) return
    // Retry reuses the exact frozen request and its capture, even when the
    // screen moved on after the failure.
    this.demarrerRequete(request)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.abort?.abort()
    this.abort = null
    for (const url of this.objectUrls) URL.revokeObjectURL(url)
    this.objectUrls.clear()
    this.fermerChoix()
  }

  private lireCapture(): CahierExportCapture | null {
    try {
      return this.captureSource()
    } catch {
      return null
    }
  }

  private ouvrirChoix(
    capture: CahierExportCapture,
    offered: readonly CahierExportMode[],
  ): void {
    this.captureEnAttente = capture
    this.modesProposes.value = offered
    this.choix.value = []
    this.modaleOuverte.value = true
    this.annoncer('Choisissez les modes à inclure dans le PDF.')
  }

  private fermerChoix(): void {
    this.modaleOuverte.value = false
    this.captureEnAttente = null
    this.modesProposes.value = []
    this.choix.value = []
  }

  private demarrer(capture: CahierExportCapture, modeIds: readonly string[]): void {
    const projection = projeterRequeteExport(capture, modeIds)
    if (projection.status !== 'ready') {
      this.annoncer(projection.message)
      return
    }
    this.demarrerRequete(projection.request)
  }

  private demarrerRequete(request: CahierExportRequest): void {
    if (this.disposed || !this.generator) return
    this.abort?.abort()
    const abort = new AbortController()
    this.abort = abort
    this.requete.value = request
    const generation = ++this.generation
    this.etat.value = 'preparing'
    this.annoncer('Préparation du PDF.')

    const generator = this.generator
    // A microtask lets the button render its busy state before a fast generator
    // settles. This is not the prototype timer and never fabricates success.
    Promise.resolve()
      .then(() => generator(request, { signal: abort.signal }))
      .then((artifact) => {
        if (!this.estCourante(generation, abort)) return
        try {
          this.telecharger(artifact)
        } catch {
          this.echouer(generation, abort)
          return
        }
        if (!this.estCourante(generation, abort)) return
        this.etat.value = 'done'
        this.annoncer('PDF généré.')
      }, () => {
        this.echouer(generation, abort)
      })
  }

  private estCourante(generation: number, abort: AbortController): boolean {
    return !this.disposed
      && !abort.signal.aborted
      && generation === this.generation
      && this.etat.value === 'preparing'
  }

  private echouer(generation: number, abort: AbortController): void {
    if (!this.estCourante(generation, abort)) return
    this.etat.value = 'error'
    this.annoncer('La génération du PDF a échoué. Vous pouvez réessayer.')
  }

  private telecharger(artifact: CahierPdfArtifact): void {
    if (!(artifact.blob instanceof Blob)
      || typeof artifact.fileName !== 'string'
      || artifact.fileName.trim().length === 0) {
      throw new Error('PDF generation did not produce downloadable bytes')
    }
    const url = URL.createObjectURL(artifact.blob)
    this.objectUrls.add(url)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = artifact.fileName
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    try {
      anchor.click()
    } finally {
      anchor.remove()
      URL.revokeObjectURL(url)
      this.objectUrls.delete(url)
    }
  }

  private annoncer(message: string): void {
    this.annonce.value = message
  }
}
