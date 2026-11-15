import { useEffect, useRef, useState } from 'react'
import type { AmbientThemeId } from '@shared/types'

/** Four-stop palettes: deep base, body, glow, highlight. */
export const AMBIENT_THEMES: Record<
  AmbientThemeId,
  { label: string; colors: [string, string, string, string] }
> = {
  ember: { label: 'Ember', colors: ['#0b0807', '#3d1c0a', '#a8571b', '#f2a33a'] },
  dawn: { label: 'Dawn', colors: ['#100a10', '#46223a', '#c0705a', '#f5c27a'] },
  ocean: { label: 'Ocean', colors: ['#03080e', '#0b2a40', '#1b6b84', '#6fd3d6'] },
  aurora: { label: 'Aurora', colors: ['#05060c', '#1b1442', '#2a8a72', '#9b7dff'] },
  graphite: { label: 'Graphite', colors: ['#09090a', '#1b1c20', '#3a3c44', '#8d909a'] }
}

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dot(hash2(i), f), dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
             mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = r * p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime * 0.045;
  vec2 q = vec2(fbm(p * 1.1 + vec2(0.0, t)), fbm(p * 1.1 + vec2(5.2, -t * 0.8)));
  vec2 r = vec2(fbm(p * 1.5 + 2.2 * q + vec2(1.7, 9.2) + 0.55 * t), fbm(p * 1.5 + 2.2 * q + vec2(8.3, 2.8) - 0.45 * t));
  float f = fbm(p * 1.3 + 2.6 * r) * 0.5 + 0.5;
  vec3 col = mix(uC0, uC1, smoothstep(0.1, 0.7, f));
  col = mix(col, uC2, smoothstep(0.25, 0.95, length(q) * 1.3) * 0.8);
  col = mix(col, uC3, smoothstep(0.5, 0.95, f * (0.65 + 0.7 * r.x)) * 0.7);
  // Two slow, soft light sources drifting across the field.
  float g1 = exp(-3.2 * length(p - vec2(0.42 * sin(t * 1.1), 0.18 * cos(t * 0.9))));
  float g2 = exp(-4.0 * length(p - vec2(-0.5 * cos(t * 0.7), -0.25 * sin(t * 1.3))));
  col += uC3 * g1 * 0.16 + uC2 * g2 * 0.12;
  float vig = smoothstep(1.25, 0.15, length((uv - 0.5) * vec2(1.2, 1.0)));
  col *= mix(0.6, 1.05, vig);
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) / 160.0;
  gl_FragColor = vec4(col, 1.0);
}
`

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

interface Props {
  theme: AmbientThemeId
  /** Render resolution relative to the element (lower = cheaper; the field is smooth). */
  resolution?: number
  fps?: number
}

/**
 * Slow, warm generative motion for breaks and walk-in. Rendered in WebGL at a
 * reduced resolution; time comes from the wall clock so every window shows the
 * same frame.
 */
export function GenerativeBackground({ theme, resolution = 0.5, fps = 30 }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [fallback, setFallback] = useState(false)
  const colors = (AMBIENT_THEMES[theme] ?? AMBIENT_THEMES.ember).colors
  // The render loop reads these, so a new theme doesn't rebuild the WebGL context.
  const settings = useRef({ colors, resolution, fps })
  useEffect(() => {
    settings.current = { colors, resolution, fps }
  }, [colors, resolution, fps])

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const gl = el.getContext('webgl', {
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power'
    })
    if (!gl) {
      setFallback(true)
      return
    }
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      setFallback(true)
      return
    }
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'aPos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const uRes = gl.getUniformLocation(prog, 'uRes')
    const uTime = gl.getUniformLocation(prog, 'uTime')
    const uColors = [0, 1, 2, 3].map((i) => gl.getUniformLocation(prog, `uC${i}`))

    let raf = 0
    let last = 0
    let palette: readonly string[] | null = null
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const { colors, resolution, fps } = settings.current
      if (now - last < 1000 / fps) return
      last = now
      if (palette !== colors) {
        colors.forEach((c, i) => gl.uniform3fv(uColors[i], rgb(c)))
        palette = colors
      }
      const w = Math.max(2, Math.round(el.clientWidth * resolution))
      const h = Math.max(2, Math.round(el.clientHeight * resolution))
      if (el.width !== w || el.height !== h) {
        el.width = w
        el.height = h
        gl.viewport(0, 0, w, h)
      }
      gl.uniform2f(uRes, w, h)
      // Wall-clock time keeps the output and the monitors on the same frame.
      gl.uniform1f(uTime, (Date.now() % 100_000_000) / 1000 - 50_000)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    raf = requestAnimationFrame(frame)
    const lost = (e: Event) => {
      e.preventDefault()
      cancelAnimationFrame(raf)
      setFallback(true)
    }
    el.addEventListener('webglcontextlost', lost)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('webglcontextlost', lost)
      // Only on unmount: a lost context can't be used again on the same canvas.
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [])

  if (fallback) {
    const [c0, c1, c2, c3] = colors
    return (
      <div
        className="stage-fill ambient-fallback"
        style={{
          background: `radial-gradient(60% 70% at 30% 35%, ${c2}88, transparent 70%), radial-gradient(50% 60% at 70% 65%, ${c3}55, transparent 70%), linear-gradient(160deg, ${c1}, ${c0})`
        }}
      />
    )
  }
  return <canvas ref={canvas} className="stage-fill ambient-canvas" />
}
