import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import clsx from 'clsx'
import { Globe } from 'lucide-react'
import { googleImagesUrl, queryFromGoogleUrl } from '@shared/google'
import { useApp, useSettings } from '../../lib/store'
import { useUI, type GuestPick } from '../../lib/ui'
import { PickBar } from './PickBar'
import { ORIGINAL_WAIT_MS, ingestGooglePick, isOriginalOf, type GuestHandle } from './googlePick'
import { previewMedia } from '../../lib/planActions'
import s from './SearchView.module.css'

/** Turn Chromium's network error codes into something an operator can act on. */
function friendlyLoadError(code: number, description: string): string {
  // -100…-199 are connection errors; -800s are DNS.
  if (code === -106) return 'No internet connection'
  if ((code <= -100 && code > -200) || code <= -800) return "Can't reach Google right now"
  if (code === -501 || code === -200 || (code <= -200 && code > -300)) return 'Secure connection failed'
  return description ? `This page couldn't load (${description})` : "This page couldn't load"
}

/** The parts of Electron's <webview> element Cue uses. */
export interface WebviewElement extends HTMLElement {
  loadURL(url: string): Promise<void>
  getURL(): string
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  reload(): void
  stop(): void
  isLoading(): boolean
  getWebContentsId(): number
  getZoomFactor(): number
  send(channel: string, ...args: unknown[]): void
}

/**
 * Ask the page where an image is right now. Electron copies images out of a
 * <webview> by a point in the host window, so translate from page coordinates.
 */
function locateIn(wv: WebviewElement, url: string): ReturnType<GuestHandle['locate']> {
  return new Promise((resolve) => {
    const finish = (at: Awaited<ReturnType<GuestHandle['locate']>>) => {
      clearTimeout(timer)
      wv.removeEventListener('ipc-message', onMessage)
      resolve(at)
    }
    const onMessage = (e: Event) => {
      const ev = e as Event & { channel: string; args: unknown[] }
      if (ev.channel !== 'cue:located') return
      const at = ev.args[0] as { url: string; x: number; y: number; width: number; height: number } | null
      if (at && at.url !== url) return
      if (!at) return finish(null)
      const box = wv.getBoundingClientRect()
      const zoom = wv.getZoomFactor() || 1
      finish({ x: box.left + at.x * zoom, y: box.top + at.y * zoom, width: at.width, height: at.height })
    }
    const timer = setTimeout(() => finish(null), 800)
    wv.addEventListener('ipc-message', onMessage)
    wv.send('cue:locate', url)
  })
}

export interface BrowserHandle {
  search(query: string): void
  open(url: string): void
  back(): void
  forward(): void
  reload(): void
  home(): void
  contentsId(): number | null
}

export interface BrowserState {
  loading: boolean
  canBack: boolean
  canForward: boolean
  url: string
  failed: string | null
}

/**
 * The real Google Images, embedded. Cue never scrapes results: the operator
 * browses Google normally and Cue simply notices the image they open.
 */
export const GoogleBrowser = forwardRef<
  BrowserHandle,
  { visible: boolean; onState: (s: BrowserState) => void }
>(function GoogleBrowser({ visible, onState }, ref) {
  const view = useRef<WebviewElement | null>(null)
  const ready = useRef(false)
  const pending = useRef<string | null>(null)
  const settings = useSettings()!
  const base = useApp((st) => st.info?.googleBase)
  const [failed, setFailed] = useState<string | null>(null)
  const pickSeq = useRef(0)
  const onStateRef = useRef(onState)
  onStateRef.current = onState

  const homeUrl = base
    ? `${base}?home=1`
    : `https://www.google.com/imghp?hl=en${settings.search.safeSearch ? '&safe=active' : ''}`
  const [initial] = useState(homeUrl)

  const load = (url: string) => {
    const wv = view.current
    if (!wv || !ready.current) {
      pending.current = url
      return
    }
    void wv.loadURL(url).catch(() => undefined)
  }

  const guest = (): GuestHandle | null => {
    const wv = view.current
    if (!wv || !ready.current) return null
    return { contentsId: wv.getWebContentsId(), locate: (url) => locateIn(wv, url) }
  }

  useImperativeHandle(ref, () => ({
    search(query: string) {
      const { filters } = useUI.getState().search
      load(
        googleImagesUrl(
          query,
          {
            safeSearch: useApp.getState().settings?.search.safeSearch ?? true,
            licensedOnly: filters.licensedOnly,
            size: filters.size,
            type: filters.type
          },
          base ?? undefined
        )
      )
    },
    open: load,
    back: () => view.current?.canGoBack() && view.current.goBack(),
    forward: () => view.current?.canGoForward() && view.current.goForward(),
    reload: () => view.current?.reload(),
    home: () => load(homeUrl),
    contentsId: () => (ready.current && view.current ? view.current.getWebContentsId() : null)
  }))

  useEffect(() => {
    const wv = view.current
    if (!wv) return
    const emit = () => {
      if (!ready.current) return
      onStateRef.current({
        loading: wv.isLoading(),
        canBack: wv.canGoBack(),
        canForward: wv.canGoForward(),
        url: wv.getURL(),
        failed
      })
    }
    const onReady = () => {
      ready.current = true
      if (pending.current) {
        const url = pending.current
        pending.current = null
        void wv.loadURL(url).catch(() => undefined)
      }
      emit()
    }
    const onNavigate = (e: Event) => {
      const url = (e as Event & { url: string }).url
      const q = queryFromGoogleUrl(url)
      if (q !== null) useUI.getState().setSearch({ query: q, submitted: q })
      useUI.getState().setSearch({ pick: null })
      setFailed(null)
      emit()
    }
    const onFail = (e: Event) => {
      const ev = e as Event & { errorCode: number; errorDescription: string; isMainFrame: boolean }
      // -3 is an aborted load (e.g. a new navigation started); not an error.
      if (!ev.isMainFrame || ev.errorCode === -3) return
      setFailed(friendlyLoadError(ev.errorCode, ev.errorDescription))
    }
    const onMessage = (e: Event) => {
      const ev = e as Event & { channel: string; args: unknown[] }
      if (ev.channel !== 'cue:pick') return
      const pick = (ev.args[0] as GuestPick | null) ?? null
      const seq = ++pickSeq.current
      const before = useUI.getState().search
      const auto = !!useApp.getState().settings?.search.autoPreview
      // The original of the result that is already picked: what came in for it stays in hand until
      // the original has.
      const standIn = auto && pick && isOriginalOf(pick, before.pick) ? before.pickedMediaId : null
      useUI
        .getState()
        .setSearch({ pick, pickedMediaId: standIn, pickedVia: standIn ? before.pickedVia : null })
      if (!pick || !auto) return
      // Give Google a moment to swap in the original. If it doesn't (it never does for most social
      // and video sites), the best copy there is comes in instead, and the original replaces it
      // should it still arrive.
      const wait = pick.full ? 250 : ORIGINAL_WAIT_MS
      setTimeout(async () => {
        if (seq !== pickSeq.current) return
        const got = await ingestGooglePick(pick, guest(), { query: useUI.getState().search.submitted })
        if (seq !== pickSeq.current) return
        if (!got) {
          if (!standIn) useUI.getState().setSearch({ pickedVia: 'failed' })
          return
        }
        useUI.getState().setSearch({ pickedMediaId: got.item.id, pickedVia: got.via })
        // A late original takes its stand-in's place in Preview, never the place of something the
        // operator has put there since (or leaves empty after showing the stand-in).
        const replaced = standIn && useApp.getState().show?.preview?.mediaId !== standIn
        if (got.item.id !== standIn && !replaced) previewMedia(got.item.id)
      }, wait)
    }
    // Leaving the page, or dismissing the pick, calls off a pick that hasn't come in yet.
    const onLeave = (e: Event) => {
      pickSeq.current++
      onNavigate(e)
    }
    const events: [string, (e: Event) => void][] = [
      ['dom-ready', onReady],
      ['did-start-loading', emit],
      ['did-stop-loading', emit],
      ['did-navigate', onLeave],
      ['did-navigate-in-page', (e) => (e as Event & { isMainFrame: boolean }).isMainFrame && onNavigate(e)],
      ['did-fail-load', onFail],
      ['ipc-message', onMessage]
    ]
    for (const [name, fn] of events) wv.addEventListener(name, fn)
    return () => {
      for (const [name, fn] of events) wv.removeEventListener(name, fn)
    }
    // The webview element lives for the whole session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const browse = (e: Event) => load((e as CustomEvent<string>).detail)
    window.addEventListener('cue:browse', browse)
    return () => window.removeEventListener('cue:browse', browse)
  })

  return (
    <div className={clsx(s.browser, !visible && s.hidden)}>
      <webview
        ref={(el) => void (view.current = el as WebviewElement | null)}
        src={initial}
        partition="persist:web"
        className={s.webview}
        data-testid="google-webview"
      />
      {failed && (
        <div className={s.failed}>
          <Globe size={22} />
          <div className={s.failedTitle}>{failed}</div>
          <div className={s.failedText}>
            Check the internet connection. Your library, slides and anything you've already shown still work
            offline.
          </div>
          <button className={s.failedRetry} onClick={() => view.current?.reload()}>
            Try again
          </button>
        </div>
      )}
      <PickBar guest={guest} onDismiss={() => void pickSeq.current++} />
    </div>
  )
})
