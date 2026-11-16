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

/**
 * The stable identity a mounted action exports. It fences an in-place route
 * change (same route record, same section key, new territory) without
 * invalidating a frozen request on ordinary mode/horizon/equipment/group edits.
 */
export interface CahierPdfScopeIdentity {
  readonly territoryType: string
  readonly territoryCode: string
  readonly unitKey: string
  readonly sectionKey: string
}

export function identitePorteeDeCapture(capture: CahierExportCapture): CahierPdfScopeIdentity {
  return {
    territoryType: capture.identity.territory.type,
    territoryCode: capture.identity.territory.code,
    unitKey: capture.identity.unit.key,
    sectionKey: capture.identity.sectionKey,
  }
}

export function memesIdentites(
  left: CahierPdfScopeIdentity | null,
  right: CahierPdfScopeIdentity | null,
): boolean {
  return left !== null
    && right !== null
    && left.territoryType === right.territoryType
    && left.territoryCode === right.territoryCode
    && left.unitKey === right.unitKey
    && left.sectionKey === right.sectionKey
}

export function cleIdentite(identity: CahierPdfScopeIdentity): string {
  return [identity.territoryType, identity.territoryCode, identity.unitKey, identity.sectionKey].join('\u0000')
}

export interface CahierPdfExportControllerOptions {
  /** Synchronous immutable capture of the mounted section, or null when absent. */
  readonly capture: () => CahierExportCapture | null
  /** Null until the real browser composer is wired by integration lot E. */
  readonly generator: CahierPdfGenerator | null
  /**
   * The shell's current section/unit/territory identity. When provided, an
   * in-place change resets the controller and fences late completions; ordinary
   * within-section edits keep the frozen request retryable.
   */
  readonly identite?: () => CahierPdfScopeIdentity | null
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
  private readonly identiteSource: (() => CahierPdfScopeIdentity | null) | null
  private generator: CahierPdfGenerator | null
  private generateurEnAttente: CahierPdfGenerator | null = null
  private generateurEnAttenteDefini = false
  private captureEnAttente: CahierExportCapture | null = null
  private abort: AbortController | null = null
  private generation = 0
  private disposed = false
  private readonly objectUrls = new Set<string>()
  private readonly revocationTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** A registration/data change invalidates the reactive availability read. */
  private readonly rafraichissement = ref(0)

  readonly disponibilite: ComputedRef<CahierPdfActivation>
  readonly peutActiver: ComputedRef<boolean>

  constructor(options: CahierPdfExportControllerOptions) {
    this.captureSource = options.capture
    this.identiteSource = options.identite ?? null
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
    this.peutActiver = computed(() => {
      const disponibilite = this.disponibilite.value
      return this.generator !== null
        && this.etat.value !== 'preparing'
        && (this.etat.value === 'error' || disponibilite.ready)
    })
  }

  /** Re-read the registration and reactive owner observations after mount. */
  rafraichir(): void {
    this.rafraichissement.value += 1
  }

  /**
   * Integrate lot E may supply the real composer after mount. A change while a
   * generation is in flight is queued until that generation settles, so the
   * active request is never silently swapped mid-retry.
   */
  definirGenerateur(generator: CahierPdfGenerator | null): void {
    if (this.disposed) return
    if (this.etat.value === 'preparing') {
      // Latest prop wins, even when it is the generator already active. A
      // parent G1 -> G2 -> G1 sequence must leave G1 queued, not the stale G2.
      this.generateurEnAttente = generator
      this.generateurEnAttenteDefini = true
      return
    }
    if (this.generator === generator) return
    this.generator = generator
    this.generateurEnAttente = null
    this.generateurEnAttenteDefini = false
    this.rafraichir()
  }

  /**
   * The shell observed a different section/unit/territory identity on the same
   * mounted action. Abort the old generation and clear every old visible state;
   * ordinary screen edits never call this.
   */
  changerIdentite(): void {
    if (this.disposed) return
    this.abort?.abort()
    this.abort = null
    this.generation += 1
    this.etat.value = 'idle'
    this.requete.value = null
    this.fermerChoix()
    this.annonce.value = ''
    this.appliquerGenerateurEnAttente()
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
    const identite = this.identiteSource
      ? this.lireIdentite()
      : identitePorteeDeCapture(capture)
    if (!identite || !memesIdentites(identite, identitePorteeDeCapture(capture))) {
      this.changerIdentite()
      this.annoncer('Le territoire ou la section a changé. Relancez l’export.')
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
    const identite = this.identiteCourante()
    if (!identite || !memesIdentites(identite, identitePorteeDeCapture(request.capture))) {
      this.changerIdentite()
      return
    }
    // Retry reuses the exact frozen request and its capture, even when the
    // screen moved on after the failure.
    this.demarrerRequete(request)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.abort?.abort()
    this.abort = null
    // A URL already handed to the browser keeps its next-task release. Revoking
    // it in the same task as the click can cancel the download on some engines.
    // Only an unhanded URL (no queued release) is revoked immediately.
    for (const url of this.objectUrls) {
      if (!this.revocationTimers.has(url)) {
        URL.revokeObjectURL(url)
        this.objectUrls.delete(url)
      }
    }
    this.fermerChoix()
  }

  private lireIdentite(): CahierPdfScopeIdentity | null {
    if (!this.identiteSource) return null
    try {
      return this.identiteSource()
    } catch {
      return null
    }
  }

  private identiteCourante(): CahierPdfScopeIdentity | null {
    if (this.identiteSource) return this.lireIdentite()
    const capture = this.lireCapture()
    return capture ? identitePorteeDeCapture(capture) : null
  }

  private appliquerGenerateurEnAttente(): void {
    if (!this.generateurEnAttenteDefini) return
    this.generator = this.generateurEnAttente
    this.generateurEnAttente = null
    this.generateurEnAttenteDefini = false
    this.rafraichir()
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
    const identite = this.identiteCourante()
    if (identite && !memesIdentites(identite, identitePorteeDeCapture(request.capture))) {
      this.changerIdentite()
      return
    }
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
        if (!this.identiteToujoursCourante(request)) {
          this.annulerGenerationPerimee(generation, abort)
          return
        }
        try {
          this.telecharger(artifact)
        } catch {
          this.echouer(generation, abort)
          return
        }
        if (!this.estCourante(generation, abort)) return
        this.etat.value = 'done'
        this.annoncer('PDF généré.')
        this.appliquerGenerateurEnAttente()
      }, () => {
        this.echouer(generation, abort)
      })
  }

  private identiteToujoursCourante(request: CahierExportRequest): boolean {
    const identite = this.identiteCourante()
    return identite !== null && memesIdentites(identite, identitePorteeDeCapture(request.capture))
  }

  private annulerGenerationPerimee(generation: number, abort: AbortController): void {
    if (!this.estCourante(generation, abort)) return
    abort.abort()
    this.etat.value = 'idle'
    this.requete.value = null
    this.annonce.value = ''
    this.appliquerGenerateurEnAttente()
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
    this.appliquerGenerateurEnAttente()
  }

  private telecharger(artifact: CahierPdfArtifact): void {
    if (!(artifact.blob instanceof Blob)
      || typeof artifact.fileName !== 'string'
      || artifact.fileName.trim().length === 0) {
      throw new Error('PDF generation did not produce downloadable bytes')
    }
    const url = URL.createObjectURL(artifact.blob)
    this.objectUrls.add(url)
    try {
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
      }
      // The click has handed the blob URL to the browser's download machinery.
      // Release it on the next task, never before the handoff; disposal cancels
      // the pending release and revokes immediately.
      this.planifierRevocation(url)
    } catch (error) {
      this.revoquerMaintenant(url)
      throw error
    }
  }

  private planifierRevocation(url: string): void {
    const timer = setTimeout(() => {
      this.revocationTimers.delete(url)
      this.objectUrls.delete(url)
      URL.revokeObjectURL(url)
    }, 0)
    this.revocationTimers.set(url, timer)
  }

  private revoquerMaintenant(url: string): void {
    const timer = this.revocationTimers.get(url)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.revocationTimers.delete(url)
    }
    if (this.objectUrls.delete(url)) URL.revokeObjectURL(url)
  }

  private annoncer(message: string): void {
    this.annonce.value = message
  }
}
