'use client'

import type { CSSProperties } from 'react'
import { LetterGlitch, type LetterGlitchProps } from './letter-glitch'

export type BackgroundLetterGlitchProps = LetterGlitchProps & {
  className?: string
  opacity?: number
}

export function BackgroundLetterGlitch({
  className,
  opacity = 0.3,
  glitchColors,
  glitchSpeed = 80,
  centerVignette = true,
  outerVignette = true,
  smooth = true,
  characters,
}: BackgroundLetterGlitchProps) {
  const style: CSSProperties = { opacity }

  return (
    <div
      aria-hidden="true"
      className={['pointer-events-none absolute inset-0 z-0', className]
        .filter(Boolean)
        .join(' ')}
      style={style}
    >
      <LetterGlitch
        glitchColors={glitchColors}
        glitchSpeed={glitchSpeed}
        centerVignette={centerVignette}
        outerVignette={outerVignette}
        smooth={smooth}
        characters={characters}
      />
    </div>
  )
}
