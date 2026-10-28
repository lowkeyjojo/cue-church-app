/**
 * Hidden media worker: uses Chromium's own decoders (so anything it can
 * thumbnail, Cue can show) plus pdf.js for PDFs. Results go back to main,
 * which writes files and updates the library.
 */
import { getDocument, GlobalWorkerOptions, PasswordException } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { ImageProbe, VideoProbe, WorkerReply, WorkerTask } from '@shared/ipc'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const bridge = window.cueWorker
const asset = (path: string) => new URL(`./pdfjs/${path}`, location.href).href

bridge.onTask((task) => {
  void run(task)
})
bridge.ready()

async function run(task: WorkerTask): Promise<void> {
  try {
    switch (task.type) {
      case 'image':
        return done(task.id, await probeImage(task.src, task.thumbSize))
      case 'video':
        return done(task.id, await probeVideo(task.src, task.thumbSize))
      case 'audio':
        return done(task.id, await probeAudio(task.src))
      case 'pdf':
        return done(task.id, await rasterizePdf(task))
    }
  } catch (err) {
    const message =
      err instanceof PasswordException
        ? 'password protected'
        : err instanceof Error
          ? err.message
          : String(err)
    bridge.reply({ id: task.id, kind: 'error', error: message })
  }
}

function done(id: string, data: Extract<WorkerReply, { kind: 'done' }>['data']): void {
  bridge.reply({ id, kind: 'done', data })
}

async function probeImage(src: string, thumbSize: number): Promise<ImageProbe> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.decoding = 'async'
  img.src = src
  try {
    await img.decode()
  } catch {
    throw new Error('Could not decode this image')
  }
  // SVGs without intrinsic size report 0; give them a sensible canvas.
  const width = img.naturalWidth || 1600
  const height = img.naturalHeight || 900
  return { width, height, thumb: await thumbnail(img, width, height, thumbSize) }
}

async function probeVideo(src: string, thumbSize: number): Promise<VideoProbe> {
  const video = document.createElement('video')
  video.crossOrigin = 'anonymous'
  video.muted = true
  video.preload = 'auto'
  video.playsInline = true
  try {
    video.src = src
    await waitFor(video, 'loadedmetadata', 20_000)
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) {
      // Audio-only file in a video container.
      return { width: 0, height: 0, duration, thumb: new Uint8Array() }
    }
    // A frame a little way in is more representative than a (often black) first frame.
    video.currentTime = Math.min(duration * 0.1, 3) || 0
    await waitFor(video, 'seeked', 15_000).catch(() => waitFor(video, 'loadeddata', 5_000))
    return { width, height, duration, thumb: await thumbnail(video, width, height, thumbSize) }
  } finally {
    video.removeAttribute('src')
    video.load()
  }
}

async function probeAudio(src: string): Promise<{ duration: number }> {
  const audio = document.createElement('audio')
  audio.preload = 'metadata'
  try {
    audio.src = src
    await waitFor(audio, 'loadedmetadata', 20_000)
    return { duration: Number.isFinite(audio.duration) ? audio.duration : 0 }
  } finally {
    audio.removeAttribute('src')
    audio.load()
  }
}

async function rasterizePdf(task: Extract<WorkerTask, { type: 'pdf' }>): Promise<{ pageCount: number }> {
  const doc = await getDocument({
    url: task.src,
    cMapUrl: asset('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: asset('standard_fonts/'),
    wasmUrl: asset('wasm/'),
    iccUrl: asset('iccs/')
  }).promise
  try {
    const pageCount = doc.numPages
    const first = await doc.getPage(1)
    const base = first.getViewport({ scale: 1 })
    bridge.reply({
      id: task.id,
      kind: 'pdf-meta',
      pageCount,
      width: Math.round(base.width),
      height: Math.round(base.height)
    })
    const canvas = document.createElement('canvas')
    for (let n = Math.max(1, task.fromPage); n <= pageCount; n++) {
      const page = n === 1 ? first : await doc.getPage(n)
      const unit = page.getViewport({ scale: 1 })
      const scale = Math.min(task.maxWidth / unit.width, task.maxHeight / unit.height)
      const viewport = page.getViewport({ scale })
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, viewport, background: '#ffffff' }).promise
      const image = await toBytes(canvas, 'image/webp', 0.92)
      const thumb = await thumbnail(canvas, canvas.width, canvas.height, task.thumbSize)
      bridge.reply({
        id: task.id,
        kind: 'pdf-page',
        page: n,
        pageCount,
        image,
        thumb,
        width: canvas.width,
        height: canvas.height
      })
      page.cleanup()
    }
    return { pageCount }
  } finally {
    await doc.loadingTask.destroy()
  }
}

async function thumbnail(
  source: CanvasImageSource,
  width: number,
  height: number,
  max: number
): Promise<Uint8Array> {
  const scale = Math.min(1, max / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return toBytes(canvas, 'image/webp', 0.84)
}

function toBytes(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Could not encode image'))
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject)
      },
      type,
      quality
    )
  })
}

function waitFor(el: HTMLMediaElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for ${event}`))
    }, timeoutMs)
    const ok = () => {
      cleanup()
      resolve()
    }
    const fail = () => {
      cleanup()
      const code = el.error?.code
      reject(
        new Error(
          code === 4
            ? 'format not supported (MEDIA_ERR_SRC_NOT_SUPPORTED)'
            : code === 3
              ? 'decode error'
              : 'could not load media'
        )
      )
    }
    const cleanup = () => {
      clearTimeout(timer)
      el.removeEventListener(event, ok)
      el.removeEventListener('error', fail)
    }
    el.addEventListener(event, ok, { once: true })
    el.addEventListener('error', fail, { once: true })
  })
}
