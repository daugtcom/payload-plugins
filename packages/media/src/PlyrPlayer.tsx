'use client'

import React, { useEffect, useRef, type CSSProperties } from 'react'
import 'plyr/dist/plyr.css'

/** Video or audio with the Plyr skin. With `noDownload` the browser's download entry and context menu are removed (the legacy "Disable Download"). */
export function PlyrPlayer({ kind, src, maxHeight, noDownload, className }: { kind: 'video' | 'audio'; src: string; maxHeight?: number | string; noDownload?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  useEffect(() => {
    let player: { destroy: () => void } | undefined
    let cancelled = false
    void import('plyr').then(({ default: Plyr }) => {
      if (!cancelled && ref.current) player = new Plyr(ref.current, { controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'settings', 'pip', 'fullscreen'] })
    })
    return () => { cancelled = true; player?.destroy() }
  }, [src])
  const shared = { controls: true, playsInline: true, controlsList: noDownload ? 'nodownload' : undefined, onContextMenu: noDownload ? (e: { preventDefault: () => void }) => e.preventDefault() : undefined, className, style: maxHeight ? { maxHeight } : undefined } as const
  return <div style={{ '--plyr-color-main': 'var(--color-primary-600, #7c3aed)' } as CSSProperties}>
    {kind === 'video'
      ? <video ref={ref} {...shared} preload="metadata" disablePictureInPicture={noDownload}><source src={src} /></video>
      : <audio ref={ref} {...shared} preload="metadata"><source src={src} /></audio>}
  </div>
}
