'use client'

import { useEffect, useRef } from 'react'

// Inspired by the Letter Glitch background from React Bits:
// https://github.com/DavidHDev/react-bits/tree/main/src/ts-tailwind/Backgrounds/LetterGlitch
export type LetterGlitchProps = {
  glitchColors?: string[]
  glitchSpeed?: number
  centerVignette?: boolean
  outerVignette?: boolean
  smooth?: boolean
  characters?: string
}

type Cell = {
  character: string
  color: string
  fromColor: string
  changedAt: number
}

const DEFAULT_CHARACTERS = '01{}[]<>/=:;_-'
const DEFAULT_COLORS = [
  'var(--glitch-slate-1)',
  'var(--glitch-slate-1)',
  'var(--glitch-slate-2)',
  'var(--glitch-slate-2)',
  'var(--glitch-slate-3)',
  'var(--glitch-ice)',
]
const CELL_WIDTH = 12
const CELL_HEIGHT = 20

function resolveColor(value: string, element: HTMLElement) {
  const match = value.match(/^var\((--[\w-]+)(?:,\s*(.+))?\)$/)
  const color = match
    ? getComputedStyle(element).getPropertyValue(match[1]).trim() || match[2] || ''
    : value
  return color || 'transparent'
}

function pick<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)]
}

function rgb(value: string, context: CanvasRenderingContext2D) {
  context.fillStyle = value
  const normalized = context.fillStyle
  const hex = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1]
  if (hex) {
    const expanded = hex.length === 3 ? [...hex].map((part) => part + part).join('') : hex
    return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16))
  }
  const channels = normalized.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
  return channels ? channels.slice(1, 4).map(Number) : [0, 0, 0]
}

function interpolateColor(from: number[], to: number[], progress: number) {
  const start = from
  const end = to
  const channels = start.map((channel, index) => Math.round(channel + ((end[index] ?? channel) - channel) * progress))
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`
}

export function LetterGlitch({
  glitchColors = DEFAULT_COLORS,
  glitchSpeed = 80,
  centerVignette = true,
  outerVignette = true,
  smooth = true,
  characters = DEFAULT_CHARACTERS,
}: LetterGlitchProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const host = canvas.parentElement
    if (!host) return

    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const colors = (glitchColors.length ? glitchColors : DEFAULT_COLORS).map((color) => resolveColor(color, host))
    const colorChannels = new Map(colors.map((color) => [color, rgb(color, context)]))
    const glyphs = Array.from(characters || DEFAULT_CHARACTERS)
    const cellStates: Cell[] = []
    const safeSpeed = Math.max(60, glitchSpeed)
    let columns = 0
    let rows = 0
    let width = 0
    let height = 0
    let frame = 0
    let timer: number | undefined
    let visible = true
    let pageVisible = !document.hidden
    let reducedMotion = motionPreference.matches
    let staticFrameDrawn = false
    let lastDrawnAt = 0
    let disposed = false

    const draw = (time: number) => {
      if (disposed || !visible || !pageVisible) return

      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.clearRect(0, 0, width, height)
      context.font = '12px "IBM Plex Mono", ui-monospace, monospace'
      context.textBaseline = 'top'

      for (let index = 0; index < cellStates.length; index += 1) {
        const cell = cellStates[index]
        const progress = reducedMotion || !smooth
          ? 1
          : Math.min(1, Math.max(0, (time - cell.changedAt) / Math.min(safeSpeed, 300)))
        const color = smooth
          ? interpolateColor(colorChannels.get(cell.fromColor) ?? [0, 0, 0], colorChannels.get(cell.color) ?? [0, 0, 0], progress)
          : cell.color
        const x = (index % columns) * CELL_WIDTH
        const y = Math.floor(index / columns) * CELL_HEIGHT
        context.fillStyle = color
        context.fillText(cell.character, x, y)
      }

      const background = resolveColor('var(--background)', host)
      if (centerVignette) {
        const gradient = context.createRadialGradient(
          width * 0.5,
          height * 0.5,
          Math.min(width, height) * 0.08,
          width * 0.5,
          height * 0.5,
          Math.max(width, height) * 0.58,
        )
        gradient.addColorStop(0, background)
        gradient.addColorStop(1, 'transparent')
        context.fillStyle = gradient
        context.fillRect(0, 0, width, height)
      }
      if (outerVignette) {
        const gradient = context.createRadialGradient(
          width * 0.5,
          height * 0.5,
          Math.min(width, height) * 0.25,
          width * 0.5,
          height * 0.5,
          Math.max(width, height) * 0.72,
        )
        gradient.addColorStop(0, 'transparent')
        gradient.addColorStop(1, background)
        context.fillStyle = gradient
        context.fillRect(0, 0, width, height)
      }
    }

    const seed = (now: number) => {
      cellStates.length = columns * rows
      for (let index = 0; index < cellStates.length; index += 1) {
        const color = pickWeightedColor()
        cellStates[index] = {
          character: pick(glyphs),
          color,
          fromColor: color,
          changedAt: now,
        }
      }
    }

    const pickWeightedColor = () => {
      if (colors.length <= 1) return colors[0] ?? 'transparent'
      // Four-color palettes reserve one occasional pick for the final accent color.
      if (colors.length === 4) {
        return Math.random() < 1 / 12 ? colors[colors.length - 1] : pick(colors.slice(0, -1))
      }
      return pick(colors)
    }

    const updateCells = (now: number) => {
      const changeCount = Math.max(1, Math.floor(cellStates.length * 0.012))
      for (let count = 0; count < changeCount; count += 1) {
        const cell = cellStates[Math.floor(Math.random() * cellStates.length)]
        if (!cell) continue
        cell.character = pick(glyphs)
        cell.fromColor = cell.color
        cell.color = pickWeightedColor()
        cell.changedAt = now
      }
    }

    const tick = (now: number) => {
      if (now - lastDrawnAt >= 50) {
        draw(now)
        lastDrawnAt = now
      }
      if (!reducedMotion && visible && pageVisible && !disposed) {
        frame = window.requestAnimationFrame(tick)
      }
    }

    const stop = () => {
      window.cancelAnimationFrame(frame)
      if (timer !== undefined) window.clearInterval(timer)
      timer = undefined
    }

    const start = () => {
      stop()
      if (disposed || !visible || !pageVisible) return
      if (reducedMotion) {
        if (!staticFrameDrawn) {
          draw(performance.now())
          staticFrameDrawn = true
        }
        return
      }
      timer = window.setInterval(() => updateCells(performance.now()), safeSpeed)
      lastDrawnAt = 0
      frame = window.requestAnimationFrame(tick)
    }

    const resize = () => {
      const bounds = host.getBoundingClientRect()
      const nextWidth = Math.max(0, bounds.width)
      const nextHeight = Math.max(0, bounds.height)
      if (nextWidth === width && nextHeight === height && cellStates.length) return
      width = nextWidth
      height = nextHeight
      if (!width || !height) return

      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * pixelRatio)
      canvas.height = Math.round(height * pixelRatio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      columns = Math.ceil(width / CELL_WIDTH)
      rows = Math.ceil(height / CELL_HEIGHT)
      seed(performance.now())
      staticFrameDrawn = false
      start()
    }

    const onVisibilityChange = () => {
      pageVisible = !document.hidden
      start()
    }
    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches
      staticFrameDrawn = false
      start()
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(host)
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      start()
    })
    intersectionObserver.observe(host)
    document.addEventListener('visibilitychange', onVisibilityChange)
    motionPreference.addEventListener('change', onMotionChange)
    resize()

    return () => {
      disposed = true
      stop()
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      motionPreference.removeEventListener('change', onMotionChange)
    }
  }, [centerVignette, characters, glitchColors, glitchSpeed, outerVignette, smooth])

  return <canvas ref={canvasRef} aria-hidden="true" className="block h-full w-full" />
}
