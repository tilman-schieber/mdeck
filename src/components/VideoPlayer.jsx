import { h } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { t } from '../core/labels.js'
import './video-player.css'

function getEmbedUrl(rawUrl, autoplay = false) {
  const ap = autoplay
  const yt = rawUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/)
  if (yt) return `https://www.youtube.com/embed/${yt[1]}?rel=0${ap ? '&autoplay=1&mute=1' : ''}`
  const vi = rawUrl.match(/vimeo\.com\/(\d+)/)
  if (vi) return `https://player.vimeo.com/video/${vi[1]}${ap ? '?autoplay=1&muted=1' : ''}`
  const sw = rawUrl.match(/tube\.switch\.ch\/(?:videos|embed)\/([\w-]+)/)
  if (sw) return `https://tube.switch.ch/embed/${sw[1]}${ap ? '?autoplay=1' : ''}`
  return rawUrl
}

export default function VideoPlayer({ src, url, play = 'click', aspect, muted }) {
  const containerRef = useRef(null)
  const videoRef     = useRef(null)

  // The HtmlContent hydration wrapper has no width; stretch it so percentage widths work
  useEffect(() => {
    if (containerRef.current?.parentElement) {
      containerRef.current.parentElement.style.width = '100%'
    }
  }, [])

  // Preact doesn't reliably apply the muted attribute via props — set it on the DOM node directly
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = (play === 'auto' || muted != null)
  }, [play, muted])
  // Web video: click mode renders immediately; auto mode starts null and is set by slidechange
  const [iframeSrc, setIframeSrc] = useState(
    url && play === 'click' ? getEmbedUrl(url, false) : null
  )

  // Local video: pause on slide deactivation for all modes; also play on activation for "auto"
  useEffect(() => {
    if (!src) return
    const stage = document.querySelector('deck-stage')
    if (!stage) return

    // If already on the active slide when we mount, play immediately for auto mode
    if (play === 'auto') {
      const active = stage.querySelector('[data-deck-active]')
      if (active?.contains(containerRef.current)) videoRef.current?.play()
    }

    function onSlideChange(e) {
      const active = e.detail.slide?.contains(containerRef.current)
      if (active && play === 'auto') {
        videoRef.current?.play()
      } else if (!active) {
        videoRef.current?.pause()
        if (play === 'auto' && videoRef.current) videoRef.current.currentTime = 0
      }
    }
    stage.addEventListener('slidechange', onSlideChange)
    return () => stage.removeEventListener('slidechange', onSlideChange)
  }, [play, src])

  // Local video between the screens of a talk: play, pause or a jump on one
  // (an iPad presenting) does the same on the others (the projector),
  // through the stage event `mediacontrol`, which the ink bus carries
  // (src/runtime/ink/bus.js). A video is known by its slide and its place on
  // it. Only the slide on screen follows, and a phone following the talk
  // does not. The presenter view's own copy goes silent while another
  // screen shows the deck, so the sound comes from there. A screen that may
  // not start sound yet (nobody clicked it) plays silently and offers sound.
  const [offerSound, setOfferSound] = useState(false)
  useEffect(() => {
    const video = videoRef.current
    const stage = containerRef.current?.closest('deck-stage')
    if (!src || !video || !stage || new URLSearchParams(location.search).get('view') === 'follow') return
    const slide = () => containerRef.current?.closest('deck-stage > *')
    const key = () => {
      const own = slide()
      if (!own) return null
      return `${[...stage.children].indexOf(own)}:${[...own.querySelectorAll('.video-player-container')].indexOf(containerRef.current)}`
    }
    // Changes made to follow another screen are not sent back.
    let following = 0
    const tell = action => {
      if (Date.now() < following || !slide()?.hasAttribute('data-deck-active')) return
      if (action === 'play' && stage.hasAttribute('data-others-watching')) video.muted = true
      stage.dispatchEvent(new CustomEvent('mediacontrol', { detail: { video: key(), action, time: video.currentTime, local: true } }))
    }
    const onPlay = () => tell('play')
    const onPause = () => tell('pause')
    const onSeeked = () => tell(video.paused ? 'pause' : 'play')
    const follow = ({ detail }) => {
      if (!detail || detail.local || detail.video !== key() || !slide()?.hasAttribute('data-deck-active')) return
      following = Date.now() + 600
      if (Number.isFinite(detail.time) && Math.abs(video.currentTime - detail.time) > 0.4) video.currentTime = detail.time
      if (detail.action === 'pause') { video.pause(); return }
      // Only a refusal to start sound is retried silently; a pause that came
      // in while it was starting cancels it (AbortError) and stays.
      video.play().catch(error => {
        if (error?.name !== 'NotAllowedError') return
        following = Date.now() + 600
        video.muted = true
        setOfferSound(true)
        return video.play()
      }).catch(() => {})
    }
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('seeked', onSeeked)
    stage.addEventListener('mediacontrol', follow)
    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('seeked', onSeeked)
      stage.removeEventListener('mediacontrol', follow)
    }
  }, [src])
  const turnSoundOn = () => {
    if (videoRef.current) videoRef.current.muted = false
    setOfferSound(false)
  }

  // Web video auto mode: clear/restore src on slide change to stop/start playback
  useEffect(() => {
    if (play !== 'auto' || !url) return
    const stage = document.querySelector('deck-stage')
    if (!stage) return
    const embedUrl = getEmbedUrl(url, true)

    // Check immediately in case we mounted after the init slidechange fired
    const active = stage.querySelector('[data-deck-active]')
    if (active?.contains(containerRef.current)) setIframeSrc(embedUrl)

    function onSlideChange(e) {
      const active = e.detail.slide?.contains(containerRef.current)
      setIframeSrc(active ? embedUrl : null)
    }
    stage.addEventListener('slidechange', onSlideChange)
    return () => stage.removeEventListener('slidechange', onSlideChange)
  }, [play, url])

  // Web video click mode: slides stay mounted, so a playing video would go on
  // (with sound) on the next slide. Leaving the slide unloads the player;
  // coming back shows it ready to play again.
  useEffect(() => {
    if (play !== 'click' || !url) return
    const stage = document.querySelector('deck-stage')
    if (!stage) return
    const embedUrl = getEmbedUrl(url, false)
    function onSlideChange(e) {
      const active = e.detail.slide?.contains(containerRef.current)
      setIframeSrc(current => active ? (current ?? embedUrl) : null)
    }
    stage.addEventListener('slidechange', onSlideChange)
    return () => stage.removeEventListener('slidechange', onSlideChange)
  }, [play, url])

  const fixedAspect = typeof aspect === 'string' && aspect.trim() !== ''

  return (
    <div
      ref={containerRef}
      class="video-player-container"
      // max-height: 800px würde das aspectRatio sonst überstimmen: der Kasten
      // wird flacher als das Video und dieses innen eingepasst -> schwarze
      // Ränder. Also die Breite passend zur Höhenbegrenzung mitdeckeln.
      style={fixedAspect
        ? { aspectRatio: aspect, maxWidth: `calc(800px * (${aspect}))`, margin: '0 auto' }
        : undefined}
    >
      {url ? (
        iframeSrc
          // A deck served through a server (an iPad paired over the internet)
          // comes with "Referrer-Policy: no-referrer", so pairing links never
          // leak; YouTube refuses to play an embed that names no page
          // ("This video is unavailable"). The player alone sends the
          // deck's origin, never its path.
          ? <iframe src={iframeSrc} allow="autoplay; fullscreen" allowFullScreen referrerpolicy="strict-origin"
              style={{ width: '100%', height: fixedAspect ? '100%' : 'auto', aspectRatio: fixedAspect ? undefined : '16 / 9', border: '0', display: 'block' }} />
          : <div class="video-player-placeholder" />
      ) : (
        <>
          <video
            ref={videoRef}
            src={src}
            controls
            style={{ width: '100%', height: fixedAspect ? '100%' : 'auto', display: 'block' }}
          />
          {offerSound && <button type="button" class="video-player-sound" onClick={turnSoundOn}>{t('video.sound')}</button>}
        </>
      )}
    </div>
  )
}
