import { useEffect, useRef, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import videojs from 'video.js'
import videojsGerman from 'video.js/dist/lang/de.json'
import 'video.js/dist/video-js.css'
import { useStore } from '../../store'
import { api } from '../../api/client'
import { formatVttTime } from '../../utils/format'
import type { Utterance } from '../../api/types'

// The player's own labels (Play, Mute, …) in German; English is built in
videojs.addLanguage('de', videojsGerman)

const mimeTypes: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
}

function generateVtt(utterances: Utterance[], speakerMappings: Record<string, string>): string {
  let vtt = 'WEBVTT\n\n'
  for (const u of utterances) {
    const start = formatVttTime(u.start)
    const end = formatVttTime(u.end)
    const speaker = u.speaker ? (speakerMappings[u.speaker] || u.speaker) : ''
    const prefix = speaker ? `[${speaker}]: ` : ''
    vtt += `${start} --> ${end}\n${prefix}${u.text}\n\n`
  }
  return vtt
}

interface Props {
  fileId: string
  mediaType: string
  hasVideo: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

export function MediaPlayer({ fileId, mediaType, hasVideo, onCollapsedChange }: Props) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage
  const containerRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null)
  const trackRef = useRef<HTMLTrackElement | null>(null)
  const blobUrlRef = useRef<string | null>(null)
  const setCurrentTime = useStore((s) => s.setCurrentTime)
  const seekTo = useStore((s) => s.seekTo)
  const setSeekTo = useStore((s) => s.setSeekTo)
  const transcriptionResult = useStore((s) => s.transcriptionResult)
  const speakerMappings = useStore((s) => s.speakerMappings)

  const [playbackErrorKey, setPlaybackErrorKey] = useState<string | null>(null)
  const [mediaNotFound, setMediaNotFound] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    onCollapsedChange?.(next)
    const player = playerRef.current
    if (player) {
      player.audioOnlyMode(next)
    }
  }

  const mediaUrl = api.getMediaUrl(fileId)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Dispose previous player if it exists (e.g. when fileId changes)
    if (playerRef.current) {
      playerRef.current.dispose()
      playerRef.current = null
      videoRef.current = null
      container.innerHTML = ''
    }

    // Create video element imperatively — video.js dispose() removes it
    // from the DOM, so a JSX <video ref> would go stale across re-renders
    const videoEl = document.createElement('video')
    videoEl.classList.add('video-js', 'vjs-theme-city')
    container.appendChild(videoEl)
    videoRef.current = videoEl

    const player = videojs(videoEl, {
      language: i18n.resolvedLanguage,
      controls: true,
      responsive: true,
      fluid: true,
      sources: [{
        src: mediaUrl,
        type: mimeTypes[mediaType] || 'audio/mpeg',
      }],
      ...(hasVideo ? {} : { audioOnlyMode: true, height: 50 }),
    })

    player.on('timeupdate', () => {
      setCurrentTime(Math.floor(player.currentTime()! * 1000))
    })

    let triedFallback = false
    player.on('error', () => {
      const error = player.error()
      const isNotFound = error?.code === 4 // MEDIA_ERR_SRC_NOT_SUPPORTED (covers 404)

      if (!triedFallback) {
        triedFallback = true
        player.src({ src: api.getMediaFallbackUrl(fileId), type: 'audio/mpeg' })
        if (hasVideo) {
          player.audioOnlyMode(true)
        }
      } else {
        if (isNotFound) {
          setMediaNotFound(true)
          setPlaybackErrorKey('player.mediaNotFound')
        } else {
          setPlaybackErrorKey('player.playbackFailed')
        }
      }
    })

    playerRef.current = player

    // Only dispose on actual unmount (component removed from DOM),
    // not on StrictMode's dev-only remount cycle
    return () => {
      // Defer disposal — if React is about to remount (StrictMode),
      // the next effect will handle cleanup before re-init
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
  }, [fileId, mediaType, hasVideo, mediaUrl, setCurrentTime, i18n])

  // A language switch while the player is open relabels its controls
  useEffect(() => {
    if (language) playerRef.current?.language(language)
  }, [language])

  // Dispose player on actual component unmount
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        playerRef.current.dispose()
        playerRef.current = null
        videoRef.current = null
      }
    }
  }, [])

  // Generate and update captions track reactively from store data
  const vttContent = useMemo(() => {
    if (!hasVideo || collapsed || !transcriptionResult?.utterances?.length) return null
    return generateVtt(transcriptionResult.utterances, speakerMappings)
  }, [hasVideo, collapsed, transcriptionResult, speakerMappings])

  useEffect(() => {
    const player = playerRef.current
    if (!player || !hasVideo) return

    player.ready(() => {
      // Always remove old track first
      if (trackRef.current) {
        player.removeRemoteTextTrack(trackRef.current as unknown as ReturnType<typeof player.addRemoteTextTrack>)
        trackRef.current = null
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }

      if (!vttContent) return

      // Create new blob URL and track
      const blob = new Blob([vttContent], { type: 'text/vtt' })
      const url = URL.createObjectURL(blob)
      blobUrlRef.current = url

      const trackEl = player.addRemoteTextTrack({
        kind: 'captions',
        srclang: 'auto',
        // Named when the track is built: rebuilding it on a language switch would turn subtitles off
        label: i18n.t('player.subtitles'),
        src: url,
        default: false,
      }, false)

      trackRef.current = trackEl as unknown as HTMLTrackElement
    })
  }, [vttContent, hasVideo, i18n])

  useEffect(() => {
    if (seekTo !== null && playerRef.current) {
      playerRef.current.currentTime(seekTo / 1000)
      if (playerRef.current.paused()) {
        playerRef.current.play()
      }
      setSeekTo(null)
    }
  }, [seekTo, setSeekTo])

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = mediaUrl
    a.download = ''
    a.click()
  }

  return (
    <div data-help="player" className={`mx-6 my-2 ${hasVideo && !collapsed ? 'flex flex-col items-center' : hasVideo ? '' : 'max-h-16 overflow-hidden'}`}>
      {playbackErrorKey && (
        <div className="p-4 bg-gray-800 rounded-lg border border-gray-700 text-center">
          <p className="text-gray-400 text-sm">{t(playbackErrorKey)}</p>
          {!mediaNotFound && (
            <button
              onClick={handleDownload}
              className="mt-2 px-3 py-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              {t('player.download')}
            </button>
          )}
        </div>
      )}
      {hasVideo && !playbackErrorKey && (
        <div className="flex justify-end w-full px-1">
          <button
            onClick={toggleCollapsed}
            className="text-xs text-gray-400 hover:text-white transition-colors py-1"
          >
            {collapsed ? t('player.showVideo') : t('player.minimize')}
          </button>
        </div>
      )}
      <div ref={containerRef} className={`${hasVideo && !collapsed ? 'w-full overflow-hidden' : ''} ${playbackErrorKey ? 'hidden' : ''} ${collapsed ? 'max-h-12' : ''}`} />
      {!playbackErrorKey && (
        <button
          onClick={handleDownload}
          className="mt-2 px-3 py-1 text-sm text-gray-400 hover:text-white transition-colors"
        >
          {t('player.download')}
        </button>
      )}
    </div>
  )
}
