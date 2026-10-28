import { resolve, join } from 'node:path'
import { createReadStream, existsSync, statSync, cpSync } from 'node:fs'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const root = import.meta.dirname
const shared = resolve(root, 'src/shared')

/**
 * pdf.js needs its character maps, standard fonts and wasm decoders at runtime.
 * Serve them from node_modules in dev and copy them next to the renderer bundle
 * in production, so PDFs render fully offline.
 */
function pdfjsAssets(): Plugin {
  const pkg = resolve(root, 'node_modules/pdfjs-dist')
  const dirs = ['cmaps', 'standard_fonts', 'wasm', 'iccs']
  let outDir = ''
  return {
    name: 'cue:pdfjs-assets',
    configResolved(config) {
      outDir = config.build.outDir
    },
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '')
        const [dir] = rel.split('/')
        const file = join(pkg, rel)
        if (!dirs.includes(dir) || !file.startsWith(pkg) || !existsSync(file) || !statSync(file).isFile()) {
          return next()
        }
        if (file.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm')
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      for (const dir of dirs) {
        const from = join(pkg, dir)
        if (existsSync(from)) cpSync(from, join(outDir, 'pdfjs', dir), { recursive: true })
      }
    }
  }
}

/** Content-Security-Policy per page, slightly relaxed in dev for Vite's HMR client. */
function contentSecurityPolicy(): Plugin {
  let dev = false
  return {
    name: 'cue:csp',
    configResolved(config) {
      dev = config.command === 'serve'
    },
    transformIndexHtml(html, ctx) {
      const page = ctx.filename.split(/[\\/]/).pop()
      const devScript = dev ? " 'unsafe-inline'" : ''
      const devConnect = dev ? ' ws://localhost:* http://localhost:*' : ''
      const common = [
        "default-src 'self'",
        `script-src 'self'${devScript} 'wasm-unsafe-eval'`,
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self' data:",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'"
      ]
      const perPage: Record<string, string[]> = {
        // The control window shows web search thumbnails, so it may load https images.
        'control.html': [
          "img-src 'self' data: blob: cue-media: https:",
          "media-src 'self' blob: cue-media:",
          `connect-src 'self' cue-media:${devConnect}`
        ],
        // The audience output only ever shows local, already-downloaded media.
        'audience.html': [
          "img-src 'self' data: blob: cue-media:",
          "media-src 'self' blob: cue-media:",
          `connect-src 'self' cue-media:${devConnect}`
        ],
        'worker.html': [
          "img-src 'self' data: blob: cue-media:",
          "media-src 'self' blob: cue-media:",
          `connect-src 'self' cue-media: data:${devConnect}`
        ]
      }
      const csp = [...common, ...(perPage[page ?? ''] ?? perPage['audience.html'])].join('; ')
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`
      )
    }
  }
}

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: {
      rolldownOptions: {
        input: { index: resolve(root, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: {
      // Sandboxed preloads cannot require() sibling chunks, so every preload
      // must be a single, self-contained CommonJS file.
      isolatedEntries: true,
      externalizeDeps: false,
      rolldownOptions: {
        input: {
          control: resolve(root, 'src/preload/control.ts'),
          audience: resolve(root, 'src/preload/audience.ts'),
          worker: resolve(root, 'src/preload/worker.ts'),
          webview: resolve(root, 'src/preload/webview.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    resolve: {
      alias: {
        '@shared': shared,
        '@renderer': resolve(root, 'src/renderer')
      }
    },
    plugins: [react(), pdfjsAssets(), contentSecurityPolicy()],
    build: {
      target: 'chrome140',
      rolldownOptions: {
        input: {
          control: resolve(root, 'src/renderer/control.html'),
          audience: resolve(root, 'src/renderer/audience.html'),
          worker: resolve(root, 'src/renderer/worker.html')
        }
      }
    },
    worker: { format: 'es' }
  }
})
