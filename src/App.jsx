import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { PitchDetector } from 'pitchy'
import { OpenSheetMusicDisplay, GraphicalNote } from 'opensheetmusicdisplay'

/* ============================================================
 *  pitch-rec — Step 3.5
 *  追加:
 *   1. 外れた音符の上に「どちらへ・どれだけ」外れたかの札を出す
 *      ▲1半音 / ▼32¢ のように、方向と量をその場で読めるようにする
 *   2. 画面が裏に回ったらマイクを閉じる（録音インジケータも電池も落とす）
 * ============================================================ */

/* ---------- 音名ユーティリティ ---------- */
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function parseNote(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name)
  if (!m) return null
  const alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
  return { step: m[1], alter, octave: Number(m[3]) }
}

function noteToMidi(name) {
  const p = parseNote(name)
  if (!p) return null
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[p.step]
  return (p.octave + 1) * 12 + base + p.alter
}

function midiToName(midi) {
  const n = Math.round(midi)
  return { name: SHARP_NAMES[((n % 12) + 12) % 12], octave: Math.floor(n / 12) - 1 }
}

function midiToLabel(midi) {
  const { name, octave } = midiToName(midi)
  return `${name}${octave}`
}

function freqToMidiFloat(freq, a4) {
  return 69 + 12 * Math.log2(freq / a4)
}

/* ---------- デモ曲（すべてパブリックドメイン） ---------- */
const SONGS = [
  {
    id: 'twinkle',
    title: 'きらきら星',
    subtitle: 'フランス民謡 / Suzuki Vol.1',
    keyName: 'イ長調',
    fifths: 3,
    time: [4, 4],
    pickup: 0,
    bpm: 88,
    level: '入門',
    note: '全部単音でテンポも遅い。判定の動作確認に最適。',
    notes: [
      { n: 'A4', d: 1 }, { n: 'A4', d: 1 }, { n: 'E5', d: 1 }, { n: 'E5', d: 1 },
      { n: 'F#5', d: 1 }, { n: 'F#5', d: 1 }, { n: 'E5', d: 2 },
      { n: 'D5', d: 1 }, { n: 'D5', d: 1 }, { n: 'C#5', d: 1 }, { n: 'C#5', d: 1 },
      { n: 'B4', d: 1 }, { n: 'B4', d: 1 }, { n: 'A4', d: 2 },
    ],
  },
  {
    id: 'ode',
    title: '歓喜の歌',
    subtitle: 'ベートーヴェン 交響曲第9番',
    keyName: 'ニ長調',
    fifths: 2,
    time: [4, 4],
    pickup: 0,
    bpm: 100,
    level: '入門',
    note: '隣り合う音の動きが多く、半音のズレが見つけやすい。',
    notes: [
      { n: 'F#4', d: 1 }, { n: 'F#4', d: 1 }, { n: 'G4', d: 1 }, { n: 'A4', d: 1 },
      { n: 'A4', d: 1 }, { n: 'G4', d: 1 }, { n: 'F#4', d: 1 }, { n: 'E4', d: 1 },
      { n: 'D4', d: 1 }, { n: 'D4', d: 1 }, { n: 'E4', d: 1 }, { n: 'F#4', d: 1 },
      { n: 'F#4', d: 1.5 }, { n: 'E4', d: 0.5 }, { n: 'E4', d: 2 },
    ],
  },
  {
    id: 'amazing',
    title: 'アメイジング・グレイス',
    subtitle: 'アメリカ伝統歌',
    keyName: 'ニ長調',
    fifths: 2,
    time: [3, 4],
    pickup: 1,
    bpm: 72,
    level: '初級',
    note: '伸ばす音が多い＝音程の安定を見せる曲。',
    notes: [
      { n: 'A3', d: 1 },
      { n: 'D4', d: 2 }, { n: 'F#4', d: 0.5 }, { n: 'D4', d: 0.5 },
      { n: 'F#4', d: 2 }, { n: 'E4', d: 1 },
      { n: 'D4', d: 2 }, { n: 'B3', d: 1 },
      { n: 'A3', d: 2 }, { n: 'A3', d: 1 },
      { n: 'D4', d: 2 }, { n: 'F#4', d: 0.5 }, { n: 'D4', d: 0.5 },
      { n: 'F#4', d: 2 }, { n: 'E4', d: 1 },
      { n: 'D4', d: 2 }, { n: 'F#4', d: 1 },
      { n: 'A4', d: 3 },
    ],
  },
  {
    id: 'minuet',
    title: 'メヌエット ト長調',
    subtitle: 'ペツォールト（旧 J.S.バッハ作とされた曲）',
    keyName: 'ト長調',
    fifths: 1,
    time: [3, 4],
    pickup: 0,
    bpm: 120,
    level: '初中級',
    note: '3拍子で音数が多め。"ちゃんとした曲"の手応え。',
    notes: [
      { n: 'D5', d: 1 }, { n: 'G4', d: 0.5 }, { n: 'A4', d: 0.5 }, { n: 'B4', d: 0.5 }, { n: 'C5', d: 0.5 },
      { n: 'D5', d: 1 }, { n: 'G4', d: 1 }, { n: 'G4', d: 1 },
      { n: 'E5', d: 1 }, { n: 'C5', d: 0.5 }, { n: 'D5', d: 0.5 }, { n: 'E5', d: 0.5 }, { n: 'F#5', d: 0.5 },
      { n: 'G5', d: 1 }, { n: 'G4', d: 1 }, { n: 'G4', d: 1 },
    ],
  },
]

/* ============================================================
 *  MusicXML 生成（4分音符 = divisions 4）
 * ============================================================ */
const DIVISIONS = 4

const TYPE_TABLE = [
  [4, 'whole', 0],
  [3, 'half', 1],
  [2, 'half', 0],
  [1.5, 'quarter', 1],
  [1, 'quarter', 0],
  [0.75, 'eighth', 1],
  [0.5, 'eighth', 0],
  [0.375, '16th', 1],
  [0.25, '16th', 0],
]

function durationToType(d) {
  const hit = TYPE_TABLE.find((t) => Math.abs(t[0] - d) < 1e-6)
  return hit ? { type: hit[1], dots: hit[2] } : { type: 'quarter', dots: 0 }
}

function noteXML(nt) {
  const p = parseNote(nt.n)
  const { type, dots } = durationToType(nt.d)
  return [
    '      <note>',
    '        <pitch>',
    `          <step>${p.step}</step>`,
    p.alter ? `          <alter>${p.alter}</alter>` : null,
    `          <octave>${p.octave}</octave>`,
    '        </pitch>',
    `        <duration>${Math.round(nt.d * DIVISIONS)}</duration>`,
    '        <voice>1</voice>',
    `        <type>${type}</type>`,
    ...Array.from({ length: dots }, () => '        <dot/>'),
    '      </note>',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildMusicXML(song) {
  const [beats, beatType] = song.time
  const barLength = beats * (4 / beatType)
  const measures = []
  let current = []
  let filled = 0
  let limit = song.pickup > 0 ? song.pickup : barLength

  for (const nt of song.notes) {
    current.push(nt)
    filled += nt.d
    if (filled >= limit - 1e-6) {
      measures.push(current)
      current = []
      filled = 0
      limit = barLength
    }
  }
  if (current.length) measures.push(current)

  const body = measures
    .map((bar, i) => {
      const implicit = i === 0 && song.pickup > 0
      const number = song.pickup > 0 ? i : i + 1
      const attrs =
        i === 0
          ? [
              '      <attributes>',
              `        <divisions>${DIVISIONS}</divisions>`,
              `        <key><fifths>${song.fifths}</fifths><mode>major</mode></key>`,
              `        <time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>`,
              '        <clef><sign>G</sign><line>2</line></clef>',
              '      </attributes>',
            ].join('\n')
          : null
      return [
        `    <measure number="${number}"${implicit ? ' implicit="yes"' : ''}>`,
        attrs,
        ...bar.map(noteXML),
        '    </measure>',
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>${song.title}</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Violin</part-name></score-part>
  </part-list>
  <part id="P1">
${body}
  </part>
</score-partwise>`
}

/* ---------- 曲の時間割 ---------- */
function buildTimeline(song, bpm) {
  const spb = 60 / bpm
  const onsets = []
  let t = 0
  for (const nt of song.notes) {
    onsets.push(t)
    t += nt.d * spb
  }
  return {
    spb,
    onsets,
    durations: song.notes.map((n) => n.d * spb),
    total: t,
    midis: song.notes.map((n) => noteToMidi(n.n)),
    pickupSec: song.pickup * spb,
    barSec: song.time[0] * (4 / song.time[1]) * spb,
  }
}

/* ---------- OSMD の内部モデルから音符を順番に取り出す ---------- */
function flattenNotes(osmd) {
  const out = []
  osmd.Sheet?.SourceMeasures?.forEach((measure) => {
    measure.VerticalSourceStaffEntryContainers?.forEach((container) => {
      container.StaffEntries?.forEach((staffEntry) => {
        staffEntry?.VoiceEntries?.forEach((voiceEntry) => {
          voiceEntry.Notes?.forEach((note) => {
            if (!note.isRest?.()) out.push(note)
          })
        })
      })
    })
  })
  return out
}

/* ---------- 検出パラメータ ---------- */
const MIN_HZ = 170
const MAX_HZ = 3200
const CLARITY_MIN = 0.88
const RMS_MIN = 0.008
const HOLD_MS = 350
const IN_TUNE_CENTS = 8

/* ---------- 判定パラメータ ---------- */
const ATTACK_SKIP = 0.12
const RELEASE_SKIP = 0.06
const MIN_SAMPLES = 3
const NAME_HIT_RATIO = 0.5
const GOOD_CENTS = 15

const VERDICT = {
  ok: { color: '#0f8a45', label: '合格' },
  sharp: { color: '#c9821a', label: '高め' },
  flat: { color: '#c9821a', label: '低め' },
  wrong: { color: '#d5342b', label: '違う音' },
  missed: { color: '#b9bcc6', label: '鳴らず' },
}
const COLOR_DEFAULT = '#10131c'

const ZOOM = { portrait: 0.72, landscape: 0.58 }

function median(arr) {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/* ---------- 外れ方の札 ---------- */
function badgeOf(v) {
  if (!v) return null
  if (v.verdict === 'sharp' || v.verdict === 'flat') {
    const up = v.avgCents > 0
    return {
      dir: up ? 'up' : 'down',
      text: `${Math.abs(v.avgCents)}¢`,
      color: VERDICT[v.verdict].color,
      title: `${up ? '高い' : '低い'}（${Math.abs(v.avgCents)}セント）`,
    }
  }
  if (v.verdict === 'wrong') {
    const up = v.semis > 0
    const n = Math.abs(v.semis)
    return {
      dir: up ? 'up' : 'down',
      text: n ? `${n}半音` : `${Math.abs(v.avgCents ?? 0)}¢`,
      color: VERDICT.wrong.color,
      title: `${v.playedName ?? '別の音'} を弾いています（${up ? '高い' : '低い'}）`,
    }
  }
  return null
}

/* 札の中身が同じかどうか（再レンダーを止めるために使う） */
function sameBadges(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (
      x.i !== y.i ||
      x.text !== y.text ||
      x.dir !== y.dir ||
      Math.abs(x.left - y.left) > 0.5 ||
      Math.abs(x.top - y.top) > 0.5
    ) {
      return false
    }
  }
  return true
}

/* ============================================================
 *  画面の向き
 * ============================================================ */
const LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 560px)'

function useLayoutMode() {
  const [mode, setMode] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(LANDSCAPE_QUERY).matches
      ? 'landscape'
      : 'portrait'
  )
  useEffect(() => {
    const mql = window.matchMedia(LANDSCAPE_QUERY)
    const onChange = (e) => setMode(e.matches ? 'landscape' : 'portrait')
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return mode
}

/* ============================================================
 *  ピッチ検出
 * ============================================================ */
function usePitch(a4) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const [reading, setReading] = useState(null)
  const [level, setLevel] = useState(0)
  const [autoStopped, setAutoStopped] = useState(false)

  const ctxRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef = useRef(null)
  const bufRef = useRef([])
  const lastOkRef = useRef(0)
  const readingRef = useRef(null)
  const lastPushRef = useRef(0)
  const a4Ref = useRef(a4)
  a4Ref.current = a4

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    ctxRef.current?.close().catch(() => {})
    ctxRef.current = null
    streamRef.current = null
    bufRef.current = []
    readingRef.current = null
    setReading(null)
    setLevel(0)
    setRunning(false)
  }, [])

  const stopRef = useRef(stop)
  stopRef.current = stop

  const start = useCallback(async () => {
    setError(null)
    setAutoStopped(false)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      streamRef.current = stream

      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      await ctx.resume()
      ctxRef.current = ctx

      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 4096
      source.connect(analyser)

      const detector = PitchDetector.forFloat32Array(analyser.fftSize)
      detector.minVolumeDecibels = -40
      const input = new Float32Array(detector.inputLength)

      setRunning(true)

      const clear = () => {
        if (performance.now() - lastOkRef.current > HOLD_MS) {
          bufRef.current = []
          readingRef.current = null
          setReading(null)
        }
      }

      const tick = () => {
        rafRef.current = requestAnimationFrame(tick)
        analyser.getFloatTimeDomainData(input)

        let sum = 0
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
        const rms = Math.sqrt(sum / input.length)

        const now = performance.now()
        const push = now - lastPushRef.current > 50
        if (push) setLevel(Math.min(1, rms * 12))

        if (rms < RMS_MIN) {
          clear()
          if (push) lastPushRef.current = now
          return
        }

        const [freq, clarity] = detector.findPitch(input, ctx.sampleRate)
        if (!freq || clarity < CLARITY_MIN || freq < MIN_HZ || freq > MAX_HZ) {
          clear()
          if (push) lastPushRef.current = now
          return
        }

        bufRef.current.push(freq)
        if (bufRef.current.length > 5) bufRef.current.shift()
        const f = median(bufRef.current)

        const midiFloat = freqToMidiFloat(f, a4Ref.current)
        const midi = Math.round(midiFloat)
        const cents = Math.round((midiFloat - midi) * 100)
        const { name, octave } = midiToName(midi)

        lastOkRef.current = now
        const next = { freq: f, midi, cents, name, octave, clarity, at: ctx.currentTime }
        readingRef.current = next
        if (push) {
          lastPushRef.current = now
          setReading(next)
        }
      }
      tick()
    } catch (e) {
      setError(
        e?.name === 'NotAllowedError'
          ? 'マイクの使用が許可されていません。ブラウザの設定でマイクを許可してから、もう一度開始してください。'
          : 'マイクを開始できませんでした。他のアプリがマイクを使っていないか確認してください。'
      )
      setRunning(false)
    }
  }, [])

  /* 画面が裏に回ったらマイクを閉じる（録音インジケータを消し、電池を使わない） */
  useEffect(() => {
    const release = () => {
      if (!ctxRef.current) return
      stopRef.current()
      setAutoStopped(true)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') release()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', release)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', release)
    }
  }, [])

  useEffect(() => () => stopRef.current(), [])

  return { running, error, reading, level, autoStopped, start, stop, ctxRef, readingRef }
}

/* ============================================================
 *  楽譜（OpenSheetMusicDisplay）
 * ============================================================ */
function useScore(song, mode) {
  const hostRef = useRef(null)
  const innerRef = useRef(null)
  const scrollRef = useRef(null)
  const osmdRef = useRef(null)
  const notesRef = useRef([])
  const elemsRef = useRef([])
  const colorsRef = useRef([])
  const cursorAtRef = useRef(0)
  const [status, setStatus] = useState('loading')
  const [total, setTotal] = useState(0)
  const [layout, bumpLayout] = useReducer((n) => n + 1, 0)
  const modeRef = useRef(mode)
  modeRef.current = mode

  const cacheElements = useCallback(() => {
    const osmd = osmdRef.current
    if (!osmd) return
    const rules = osmd.rules ?? osmd.EngravingRules
    elemsRef.current = notesRef.current.map((note) => {
      try {
        const g = GraphicalNote?.FromNote?.(note, rules)
        return g?.getSVGGElement?.() ?? null
      } catch {
        return null
      }
    })
  }, [])

  const paintElement = useCallback((el, color) => {
    if (!el) return false
    el.querySelectorAll('path, ellipse, rect, text, tspan').forEach((n) => {
      n.setAttribute('fill', color)
      if (n.getAttribute('stroke')) n.setAttribute('stroke', color)
    })
    return true
  }, [])

  const paint = useCallback(
    (i, color) => {
      colorsRef.current[i] = color
      if (paintElement(elemsRef.current[i], color)) return
      const note = notesRef.current[i]
      if (note) {
        note.NoteheadColor = color
        note.StemColorXml = color
      }
    },
    [paintElement]
  )

  const repaintAll = useCallback(() => {
    colorsRef.current.forEach((c, i) => {
      if (c && c !== COLOR_DEFAULT) paintElement(elemsRef.current[i], c)
    })
  }, [paintElement])

  const resetColors = useCallback(() => {
    colorsRef.current = notesRef.current.map(() => COLOR_DEFAULT)
    elemsRef.current.forEach((el) => paintElement(el, COLOR_DEFAULT))
  }, [paintElement])

  /* 音符の位置（札を置くための座標） */
  const anchorOf = useCallback((i) => {
    const el = elemsRef.current[i]
    const inner = innerRef.current
    if (!el || !inner) return null
    const r = el.getBoundingClientRect()
    if (!r.width && !r.height) return null
    const b = inner.getBoundingClientRect()
    return { left: r.left - b.left + r.width / 2, top: r.top - b.top }
  }, [])

  const cursorTo = useCallback((i) => {
    const osmd = osmdRef.current
    if (!osmd?.cursor) return
    try {
      osmd.cursor.reset()
      for (let k = 0; k < i; k++) osmd.cursor.next()
      osmd.cursor.show()
      cursorAtRef.current = i

      const el = osmd.cursor.cursorElement
      const box = scrollRef.current
      if (el && box && box.scrollHeight - box.clientHeight > 8) {
        const h = el.offsetHeight || 40
        const top = el.offsetTop
        if (top < box.scrollTop || top + h > box.scrollTop + box.clientHeight) {
          box.scrollTo({ top: Math.max(0, top - box.clientHeight / 2 + h / 2), behavior: 'smooth' })
        }
      }
    } catch {
      /* 再描画と競合したときは黙って諦める */
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false

    setStatus('loading')
    host.innerHTML = ''
    cursorAtRef.current = 0

    const osmd = new OpenSheetMusicDisplay(host, {
      backend: 'svg',
      autoResize: true,
      autoBeam: true,
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawPartNames: false,
      drawMeasureNumbers: true,
      defaultColorMusic: COLOR_DEFAULT,
      cursorsOptions: [{ type: 0, color: '#25327a', alpha: 0.2, follow: false }],
    })
    osmdRef.current = osmd

    osmd
      .load(buildMusicXML(song))
      .then(() => {
        if (cancelled) return
        osmd.zoom = ZOOM[modeRef.current]
        osmd.render()
        notesRef.current = flattenNotes(osmd)
        colorsRef.current = notesRef.current.map(() => COLOR_DEFAULT)
        cacheElements()
        setTotal(notesRef.current.length)
        osmd.cursor.show()
        setStatus('ready')
        bumpLayout()
      })
      .catch((e) => {
        if (cancelled) return
        console.error('[osmd]', e)
        setStatus('error')
      })

    return () => {
      cancelled = true
      try {
        osmd.clear()
      } catch {
        /* 破棄時のエラーは無視 */
      }
      host.innerHTML = ''
      osmdRef.current = null
      notesRef.current = []
      elemsRef.current = []
    }
  }, [song, cacheElements])

  useEffect(() => {
    const osmd = osmdRef.current
    if (!osmd || status !== 'ready') return
    const id = requestAnimationFrame(() => {
      try {
        osmd.zoom = ZOOM[mode]
        osmd.render()
        cacheElements()
        repaintAll()
        cursorTo(cursorAtRef.current)
        bumpLayout()
      } catch (e) {
        console.error('[osmd resize]', e)
      }
    })
    return () => cancelAnimationFrame(id)
  }, [mode, status, cacheElements, repaintAll, cursorTo])

  useEffect(() => {
    let timer
    const onResize = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        cacheElements()
        repaintAll()
        cursorTo(cursorAtRef.current)
        bumpLayout()
      }, 300)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      clearTimeout(timer)
    }
  }, [cacheElements, repaintAll, cursorTo])

  return {
    hostRef,
    innerRef,
    scrollRef,
    status,
    total,
    layout,
    paint,
    resetColors,
    cursorTo,
    anchorOf,
  }
}

/* ============================================================
 *  演奏セッション（同期・判定・クリック音）
 * ============================================================ */
function useSession({ song, bpm, startMode, click, pitch, score }) {
  const [phase, setPhase] = useState('idle') // idle | armed | countin | playing | done
  const [index, setIndex] = useState(0)
  const [verdicts, setVerdicts] = useState([])
  const [countBeat, setCountBeat] = useState(0)

  const timeline = useMemo(() => buildTimeline(song, bpm), [song, bpm])
  const timelineRef = useRef(timeline)
  timelineRef.current = timeline

  const rafRef = useRef(null)
  const phaseRef = useRef('idle')
  const startAtRef = useRef(0)
  const idxRef = useRef(0)
  const statsRef = useRef(null)
  const verdictsRef = useRef([])
  const armMatchRef = useRef(0)
  const nextClickRef = useRef(0)

  const setPhaseBoth = useCallback((p) => {
    phaseRef.current = p
    setPhase(p)
  }, [])

  const scheduleClick = useCallback(
    (time, accent) => {
      const ctx = pitch.ctxRef.current
      if (!ctx) return
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = accent ? 1600 : 1100
      gain.gain.setValueAtTime(0.0001, time)
      gain.gain.exponentialRampToValueAtTime(accent ? 0.25 : 0.14, time + 0.002)
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05)
      osc.connect(gain).connect(ctx.destination)
      osc.start(time)
      osc.stop(time + 0.07)
    },
    [pitch.ctxRef]
  )

  const openNote = useCallback((i) => {
    statsRef.current = { index: i, samples: 0, counts: new Map(), cents: new Map() }
  }, [])

  const finalizeNote = useCallback(
    (i) => {
      const st = statsRef.current
      if (!st || st.index !== i) return
      const expect = timelineRef.current.midis[i]
      const hits = st.counts.get(expect) ?? 0

      let dominant = expect
      let best = -1
      st.counts.forEach((c, midi) => {
        if (c > best) {
          best = c
          dominant = midi
        }
      })

      const avgOf = (midi) => {
        const c = st.counts.get(midi) ?? 0
        return c ? Math.round((st.cents.get(midi) ?? 0) / c) : null
      }

      let record
      if (st.samples < MIN_SAMPLES) {
        record = { verdict: 'missed', avgCents: null, semis: 0, playedName: null }
      } else if (hits / st.samples < NAME_HIT_RATIO) {
        record = {
          verdict: 'wrong',
          avgCents: avgOf(dominant),
          semis: dominant - expect,
          playedName: midiToLabel(dominant),
        }
      } else {
        const avg = avgOf(expect) ?? 0
        record = {
          verdict: Math.abs(avg) <= GOOD_CENTS ? 'ok' : avg > 0 ? 'sharp' : 'flat',
          avgCents: avg,
          semis: 0,
          playedName: midiToLabel(expect),
        }
      }

      verdictsRef.current[i] = record
      setVerdicts([...verdictsRef.current])
      score.paint(i, VERDICT[record.verdict].color)
      statsRef.current = null
    },
    [score]
  )

  const stopSession = useCallback(
    (nextPhase = 'idle') => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      statsRef.current = null
      setPhaseBoth(nextPhase)
      setCountBeat(0)
    },
    [setPhaseBoth]
  )

  const reset = useCallback(() => {
    stopSession('idle')
    idxRef.current = 0
    setIndex(0)
    verdictsRef.current = []
    setVerdicts([])
    score.resetColors()
    score.cursorTo(0)
  }, [stopSession, score])

  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop)
    const ctx = pitch.ctxRef.current
    if (!ctx) {
      // マイクが閉じられた（バックグラウンド等）
      stopSession('idle')
      return
    }
    const tl = timelineRef.current
    const now = ctx.currentTime

    /* --- 開始待ち：最初の音を聴く --- */
    if (phaseRef.current === 'armed') {
      const r = pitch.readingRef.current
      const expect = tl.midis[0]
      if (r && r.midi === expect && Math.abs(r.cents) < 60) {
        if (!armMatchRef.current) armMatchRef.current = now
        if (now - armMatchRef.current >= 0.1) {
          startAtRef.current = armMatchRef.current
          nextClickRef.current = -Math.round(tl.pickupSec / tl.spb)
          openNote(0)
          idxRef.current = 0
          setIndex(0)
          setPhaseBoth('playing')
        }
      } else {
        armMatchRef.current = 0
      }
      return
    }

    /* --- カウントイン --- */
    if (phaseRef.current === 'countin') {
      const remain = startAtRef.current + tl.pickupSec - now
      setCountBeat(Math.max(0, Math.ceil(remain / tl.spb)))
      if (now >= startAtRef.current) {
        openNote(0)
        idxRef.current = 0
        setIndex(0)
        setPhaseBoth('playing')
      }
      return
    }

    if (phaseRef.current !== 'playing') return

    /* --- 演奏中 --- */
    const t = now - startAtRef.current

    if (click) {
      while (startAtRef.current + tl.pickupSec + nextClickRef.current * tl.spb < now + 0.25) {
        const beatTime = startAtRef.current + tl.pickupSec + nextClickRef.current * tl.spb
        if (beatTime >= now - 0.02 && beatTime <= startAtRef.current + tl.total + 0.1) {
          const beatsPerBar = Math.round(tl.barSec / tl.spb)
          const pos = ((nextClickRef.current % beatsPerBar) + beatsPerBar) % beatsPerBar
          scheduleClick(beatTime, pos === 0)
        }
        nextClickRef.current += 1
      }
    }

    let i = idxRef.current
    while (i + 1 < tl.onsets.length && t >= tl.onsets[i + 1]) i += 1

    if (i !== idxRef.current) {
      for (let k = idxRef.current; k < i; k++) finalizeNote(k)
      idxRef.current = i
      setIndex(i)
      openNote(i)
      score.cursorTo(i)
    }

    const st = statsRef.current
    if (st) {
      const rel = t - tl.onsets[i]
      const dur = tl.durations[i]
      const inWindow =
        rel >= Math.min(ATTACK_SKIP, dur * 0.3) && rel <= dur - Math.min(RELEASE_SKIP, dur * 0.15)
      if (inWindow) {
        const r = pitch.readingRef.current
        if (r && now - r.at < 0.12) {
          st.samples += 1
          st.counts.set(r.midi, (st.counts.get(r.midi) ?? 0) + 1)
          st.cents.set(r.midi, (st.cents.get(r.midi) ?? 0) + r.cents)
        }
      }
    }

    if (t >= tl.total) {
      finalizeNote(idxRef.current)
      stopSession('done')
    }
  }, [click, finalizeNote, openNote, pitch.ctxRef, pitch.readingRef, scheduleClick, score, stopSession])

  const begin = useCallback(async () => {
    if (!pitch.ctxRef.current) await pitch.start()
    requestAnimationFrame(() => {
      const ctx = pitch.ctxRef.current
      if (!ctx) return
      const tl = timelineRef.current
      verdictsRef.current = []
      setVerdicts([])
      score.resetColors()
      score.cursorTo(0)
      idxRef.current = 0
      setIndex(0)
      armMatchRef.current = 0

      if (startMode === 'countin') {
        const beatsPerBar = Math.round(tl.barSec / tl.spb)
        const lead = 0.3
        const downbeat = ctx.currentTime + lead + beatsPerBar * tl.spb
        startAtRef.current = downbeat - tl.pickupSec
        nextClickRef.current = 0
        for (let k = 0; k < beatsPerBar; k++) {
          scheduleClick(downbeat - (beatsPerBar - k) * tl.spb, k === 0)
        }
        setPhaseBoth('countin')
      } else {
        setPhaseBoth('armed')
      }
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(loop)
    })
  }, [loop, pitch, scheduleClick, score, setPhaseBoth, startMode])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  useEffect(() => {
    stopSession('idle')
    idxRef.current = 0
    setIndex(0)
    verdictsRef.current = []
    setVerdicts([])
  }, [song, bpm, stopSession])

  const summary = useMemo(() => {
    const done = verdicts.filter(Boolean)
    if (!done.length) return null
    const ok = done.filter((v) => v.verdict === 'ok').length
    const tuned = done.filter((v) => v.verdict !== 'missed' && v.avgCents != null && !v.semis)
    const avg = tuned.length
      ? Math.round(tuned.reduce((a, b) => a + b.avgCents, 0) / tuned.length)
      : null
    return { ok, total: done.length, avg }
  }, [verdicts])

  return { phase, index, verdicts, countBeat, summary, begin, reset, stop: () => stopSession('idle') }
}

/* ============================================================
 *  UI パーツ
 * ============================================================ */
function TunerMeter({ cents, active }) {
  const clamped = Math.max(-50, Math.min(50, cents ?? 0))
  const pos = 50 + clamped
  const inTune = active && Math.abs(cents ?? 99) <= IN_TUNE_CENTS
  const state = !active ? 'idle' : inTune ? 'ok' : 'off'

  return (
    <div className="meter" data-state={state}>
      <div className="meter-scale">
        {[-50, -25, 0, 25, 50].map((t) => (
          <span key={t} className="tick" style={{ left: `${50 + t}%` }} data-center={t === 0} />
        ))}
        <div className="meter-zone" />
        <div className="needle" style={{ left: `${pos}%`, opacity: active ? 1 : 0.25 }} />
      </div>
      <div className="meter-labels">
        <span>♭ 低い</span>
        <span className="cents">{active ? `${cents > 0 ? '+' : ''}${cents} cent` : '—'}</span>
        <span>高い ♯</span>
      </div>
    </div>
  )
}

/* ============================================================
 *  エラー境界
 *  何かで落ちても真っ白にせず、原因を画面に出す
 * ============================================================ */
class Boundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[pitch-rec]', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash">
          <style>{CSS}</style>
          <h2>アプリを表示できませんでした</h2>
          <p>読み込み直すと復帰することがあります。</p>
          <pre>{String(this.state.error?.message ?? this.state.error)}</pre>
          <button onClick={() => window.location.reload()}>読み込み直す</button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  return (
    <Boundary>
      <Studio />
    </Boundary>
  )
}

/* ============================================================
 *  アプリ本体
 * ============================================================ */
function Studio() {
  const [songId, setSongId] = useState(SONGS[0].id)
  const [a4, setA4] = useState(440)
  const [startMode, setStartMode] = useState('listen')
  const [click, setClick] = useState(true)
  const song = useMemo(() => SONGS.find((s) => s.id === songId), [songId])
  const [bpm, setBpm] = useState(song.bpm)

  useEffect(() => setBpm(song.bpm), [song])

  const mode = useLayoutMode()
  const pitch = usePitch(a4)
  const score = useScore(song, mode)
  const session = useSession({ song, bpm, startMode, click, pitch, score })

  const active = pitch.running && !!pitch.reading
  const inTune = active && Math.abs(pitch.reading.cents) <= IN_TUNE_CENTS
  const target = song.notes[session.index]?.n ?? '—'
  const playing = session.phase === 'playing'
  const busy = session.phase !== 'idle' && session.phase !== 'done'

  /* 外れた音符の上に置く札の位置を計算する
   * 依存に score オブジェクトそのものを入れると、毎レンダーで新しい参照になり
   * setBadges → 再レンダー → 依存が変わる…の無限ループになる。
   * 中身が同じときは前の配列を返して再レンダーを止める。 */
  const [badges, setBadges] = useState([])
  const anchorOf = score.anchorOf
  const layout = score.layout
  const verdicts = session.verdicts

  useLayoutEffect(() => {
    const next = []
    verdicts.forEach((v, i) => {
      const b = badgeOf(v)
      if (!b) return
      let a = null
      try {
        a = anchorOf(i)
      } catch {
        a = null
      }
      if (!a) return
      next.push({ i, ...b, left: a.left, top: a.top })
    })
    setBadges((prev) => (sameBadges(prev, next) ? prev : next))
  }, [verdicts, anchorOf, layout, mode])

  const primaryLabel = {
    idle: '演奏を始める',
    armed: `${song.notes[0].n} を待っています`,
    countin: `カウント ${session.countBeat}`,
    playing: '演奏中 — 止める',
    done: 'もう一度',
  }[session.phase]

  const onPrimary = () => {
    if (busy) session.stop()
    else session.begin()
  }

  return (
    <div className="app" data-state={!active ? 'idle' : inTune ? 'ok' : 'off'} data-mode={mode}>
      <style>{CSS}</style>

      <header className="head">
        <h1>
          <span className="clef">𝄞</span> pitch-rec
        </h1>
        <p className="head-sub">単音・リアルタイム音程チェック</p>
        <label className="songs-select">
          <select
            value={songId}
            onChange={(e) => setSongId(e.target.value)}
            disabled={busy}
            aria-label="曲を選ぶ"
          >
            {SONGS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}（{s.keyName} {s.time[0]}/{s.time[1]}）
              </option>
            ))}
          </select>
        </label>
      </header>

      {/* 上：曲を選ぶ */}
      <section className="block songs">
        <h2 className="label">曲を選ぶ</h2>
        <div className="cards" role="radiogroup" aria-label="デモ曲">
          {SONGS.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={s.id === songId}
              className="card"
              data-on={s.id === songId}
              disabled={busy}
              onClick={() => setSongId(s.id)}
            >
              <span className="card-level">{s.level}</span>
              <span className="card-title">{s.title}</span>
              <span className="card-sub">{s.subtitle}</span>
              <span className="card-meta">
                {s.keyName} · {s.time[0]}/{s.time[1]} · ♩= {s.bpm}
              </span>
            </button>
          ))}
        </div>
        <p className="hint">{song.note}</p>
      </section>

      {/* 真ん中：楽譜 */}
      <section className="block score-area">
        <h2 className="label">楽譜</h2>

        <div className="score" data-playing={playing} ref={score.scrollRef}>
          <div className="score-inner" ref={score.innerRef}>
            <div ref={score.hostRef} className="score-host" />
            <div className="marks" aria-hidden="true">
              {badges.map((b) => (
                <span
                  key={b.i}
                  className="mark"
                  data-dir={b.dir}
                  title={b.title}
                  style={{ left: `${b.left}px`, top: `${b.top}px`, '--c': b.color }}
                >
                  <span className="mark-arrow">{b.dir === 'up' ? '▲' : '▼'}</span>
                  {b.text}
                </span>
              ))}
            </div>
          </div>
          {score.status === 'loading' && <p className="score-msg">楽譜を組み立てています…</p>}
          {score.status === 'error' && (
            <p className="score-msg error">
              楽譜を表示できませんでした。ページを再読み込みしてください。
            </p>
          )}
        </div>

        <div className="score-controls">
          <span className="score-count">
            {score.status === 'ready' ? `${session.index + 1} / ${score.total}` : '…'}
          </span>
          <div className="tempo">
            <button onClick={() => setBpm((v) => Math.max(40, v - 4))} disabled={busy} aria-label="テンポを下げる">
              −
            </button>
            <span>♩= {bpm}</span>
            <button onClick={() => setBpm((v) => Math.min(160, v + 4))} disabled={busy} aria-label="テンポを上げる">
              ＋
            </button>
          </div>
          <select
            className="mini"
            value={startMode}
            onChange={(e) => setStartMode(e.target.value)}
            disabled={busy}
            aria-label="開始方法"
          >
            <option value="listen">弾き出しで開始</option>
            <option value="countin">1小節カウント</option>
          </select>
          <button className="mini toggle" data-on={click} onClick={() => setClick((v) => !v)}>
            クリック
          </button>
        </div>

        {session.summary && session.phase === 'done' && (
          <p className="summary">
            {session.summary.total} 音中 <b>{session.summary.ok}</b> 音が合格
            {session.summary.avg != null && (
              <>
                {' '}／ 平均 {session.summary.avg > 0 ? '+' : ''}
                {session.summary.avg} cent
                {Math.abs(session.summary.avg) > GOOD_CENTS &&
                  `（全体に${session.summary.avg > 0 ? '高め' : '低め'}）`}
              </>
            )}
          </p>
        )}

        <p className="hint rotate-hint">
          緑＝合格、黄＝音程が甘い、赤＝違う音、灰＝鳴っていない。外れた音符には
          ▲（高い）▼（低い）と外れ幅が付きます。
        </p>
      </section>

      {/* 下（横画面では右）：マイクと音名 */}
      <section className="block readout-block">
        <div className="readout">
          <div className="note">
            <span className="note-name">
              {active ? pitch.reading.name.replace('#', '') : '—'}
              {active && pitch.reading.name.includes('#') && <sup>♯</sup>}
            </span>
            <span className="note-oct">{active ? pitch.reading.octave : ''}</span>
          </div>
          <div className="freq">
            {playing || session.phase === 'armed'
              ? `譜面 ${target}${active ? ` ／ ${pitch.reading.freq.toFixed(1)} Hz` : ''}`
              : active
                ? `${pitch.reading.freq.toFixed(1)} Hz`
                : pitch.running
                  ? '音を待っています'
                  : 'マイクは停止中'}
          </div>
        </div>

        <TunerMeter cents={pitch.reading?.cents ?? 0} active={active} />

        <div className="level" aria-hidden="true">
          <div className="level-bar" style={{ width: `${Math.round(pitch.level * 100)}%` }} />
        </div>

        {pitch.error && <p className="error">{pitch.error}</p>}
        {pitch.autoStopped && !pitch.running && (
          <p className="notice">画面を離れたのでマイクを閉じました。もう一度押すと再開します。</p>
        )}

        <div className="controls">
          <button className="mic" data-phase={session.phase} onClick={onPrimary}>
            {primaryLabel}
          </button>
          <button className="reset" onClick={session.reset} disabled={busy}>
            戻す
          </button>
        </div>
        <label className="a4">
          <span>基準 A</span>
          <select value={a4} onChange={(e) => setA4(Number(e.target.value))} disabled={busy}>
            <option value={440}>440 Hz</option>
            <option value={441}>441 Hz</option>
            <option value={442}>442 Hz</option>
            <option value={443}>443 Hz</option>
          </select>
        </label>
      </section>

      <footer className="foot">
        <span>データは端末の中だけで処理され、どこにも送信されません。</span>
      </footer>
    </div>
  )
}

/* ============================================================
 *  スタイル
 * ============================================================ */
const CSS = `
:root {
  --ink: #10131c;
  --ink-60: #5a6072;
  --ink-30: #a7adbd;
  --paper: #ffffff;
  --paper-2: #f6f6f4;
  --line: #e5e5e0;
  --accent: #25327a;
  --ok: #0f8a45;
  --off: #d5342b;
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; }
body {
  margin: 0;
  background: var(--paper-2);
  color: var(--ink);
  font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
  overscroll-behavior: none;
}
.app {
  max-width: 480px;
  margin: 0 auto;
  min-height: 100%;
  background: var(--paper);
  padding: 20px 18px 40px;
  display: flex;
  flex-direction: column;
  gap: 26px;
}

.head h1 {
  margin: 0;
  font-family: Iowan Old Style, "Times New Roman", serif;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: .02em;
  color: var(--accent);
}
.head .clef { font-size: 26px; margin-right: 4px; }
.head-sub { margin: 4px 0 0; font-size: 12px; color: var(--ink-60); }
.songs-select { display: none; }

.label {
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .14em;
  color: var(--ink-60);
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 曲カード */
.cards {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
}
.cards::-webkit-scrollbar { display: none; }
.card {
  flex: 0 0 62%;
  scroll-snap-align: start;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 13px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
  cursor: pointer;
  transition: border-color .16s, background .16s;
}
.card[data-on="true"] { border-color: var(--accent); background: #f7f8fd; }
.card:disabled { opacity: .5; }
.card-level { font-size: 10px; color: var(--accent); letter-spacing: .08em; }
.card-title {
  font-family: Iowan Old Style, "Times New Roman", serif;
  font-size: 16px;
  font-weight: 600;
}
.card-sub { font-size: 11px; color: var(--ink-60); }
.card-meta { font-size: 11px; color: var(--ink-30); margin-top: 2px; }
.hint { margin: 10px 2px 0; font-size: 12px; color: var(--ink-60); line-height: 1.6; }

/* 楽譜 */
.score {
  position: relative;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--paper);
  min-height: 220px;
  padding: 10px 6px;
  overflow-x: hidden;
  transition: border-color .2s;
}
.score[data-playing="true"] { border-color: var(--accent); }
.score-inner { position: relative; width: 100%; }
.score-host { width: 100%; }
.score-host svg { display: block; max-width: 100%; height: auto; }
.score-msg {
  position: absolute;
  inset: 0;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--ink-30);
  background: var(--paper);
  border-radius: 14px;
}
.score-msg.error { color: var(--off); padding: 0 24px; text-align: center; }

/* 外れ方の札 */
.marks { position: absolute; inset: 0; pointer-events: none; }
.mark {
  position: absolute;
  transform: translate(-50%, -100%);
  margin-top: -3px;
  display: inline-flex;
  align-items: center;
  gap: 1px;
  padding: 1px 5px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid var(--c);
  color: var(--c);
  box-shadow: 0 1px 3px rgba(16,19,28,.12);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.5;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.mark-arrow { font-size: 8px; }

.score-controls {
  margin-top: 12px;
  display: flex;
  gap: 8px;
  align-items: stretch;
  flex-wrap: wrap;
}
.score-count {
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-size: 12px;
  color: var(--accent);
  background: #eef0f9;
  border-radius: 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.tempo {
  display: flex;
  align-items: center;
  gap: 2px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0 4px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.tempo button {
  border: 0;
  background: none;
  color: var(--accent);
  font-size: 15px;
  padding: 6px 7px;
  cursor: pointer;
}
.tempo button:disabled { color: var(--ink-30); cursor: default; }
.mini {
  font-size: 12px;
  padding: 7px 8px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
}
.toggle[data-on="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }

.summary {
  margin: 12px 2px 0;
  font-size: 13px;
  color: var(--ink);
  background: var(--paper-2);
  border-radius: 10px;
  padding: 10px 12px;
  line-height: 1.6;
}
.summary b { color: var(--ok); }

/* 音名表示 */
.readout-block { border-top: 1px solid var(--line); padding-top: 22px; }
.readout { text-align: center; }
.note {
  font-family: Iowan Old Style, "Times New Roman", serif;
  line-height: 1;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 2px;
  color: var(--ink-30);
  transition: color .12s;
}
.app[data-state="ok"] .note { color: var(--ok); }
.app[data-state="off"] .note { color: var(--off); }
.note-name { font-size: 72px; font-weight: 500; }
.note-name sup { font-size: 30px; }
.note-oct { font-size: 26px; color: var(--ink-30); }
.freq { margin-top: 6px; font-size: 12px; color: var(--ink-60); font-variant-numeric: tabular-nums; }

/* メーター */
.meter { margin-top: 22px; }
.meter-scale { position: relative; height: 44px; border-bottom: 1px solid var(--line); }
.tick {
  position: absolute; bottom: 0; width: 1px; height: 8px;
  background: var(--ink-30); transform: translateX(-50%);
}
.tick[data-center="true"] { height: 100%; background: var(--line); }
.meter-zone {
  position: absolute; bottom: 0; left: 42%; width: 16%; height: 100%;
  background: rgba(15,138,69,.07);
}
.needle {
  position: absolute; bottom: 0; width: 2px; height: 100%;
  background: var(--ink-30); transform: translateX(-50%);
  transition: left .07s linear, background .12s; border-radius: 1px;
}
.meter[data-state="ok"] .needle { background: var(--ok); }
.meter[data-state="off"] .needle { background: var(--off); }
.meter-labels {
  display: flex; justify-content: space-between; margin-top: 7px;
  font-size: 11px; color: var(--ink-30);
}
.cents { color: var(--ink-60); font-variant-numeric: tabular-nums; }

.level { margin-top: 16px; height: 3px; background: var(--paper-2); border-radius: 2px; overflow: hidden; }
.level-bar { height: 100%; background: var(--accent); opacity: .35; transition: width .08s linear; }

.controls { margin-top: 18px; display: flex; align-items: stretch; gap: 10px; }
.mic {
  flex: 1; padding: 15px 10px; border: 0; border-radius: 12px;
  background: var(--accent); color: #fff; font-size: 15px; font-weight: 600; cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.mic[data-phase="armed"] { background: #6b74a8; }
.mic[data-phase="countin"] { background: var(--ink); }
.mic[data-phase="playing"] { background: var(--ok); }
.reset {
  padding: 0 16px; border: 1px solid var(--line); border-radius: 12px;
  background: var(--paper); color: var(--ink-60); font-size: 13px; cursor: pointer;
}
.reset:disabled { color: var(--ink-30); cursor: default; }
.a4 {
  margin-top: 12px; font-size: 11px; color: var(--ink-60);
  display: flex; align-items: center; gap: 8px;
}
.a4 select {
  font-size: 13px; padding: 6px 8px; border: 1px solid var(--line);
  border-radius: 8px; background: var(--paper); color: var(--ink);
}
.error { margin: 14px 0 0; font-size: 12px; color: var(--off); line-height: 1.6; }
.notice { margin: 12px 0 0; font-size: 11px; color: var(--ink-60); line-height: 1.6; }
.foot { font-size: 11px; color: var(--ink-30); text-align: center; }

/* クラッシュ画面 */
.crash {
  max-width: 480px; margin: 0 auto; padding: 40px 20px;
  background: var(--paper); min-height: 100%;
}
.crash h2 { font-size: 17px; margin: 0 0 8px; }
.crash p { font-size: 13px; color: var(--ink-60); margin: 0 0 14px; }
.crash pre {
  font-size: 11px; color: var(--off); background: var(--paper-2);
  padding: 10px 12px; border-radius: 10px; white-space: pre-wrap; word-break: break-word;
}
.crash button {
  margin-top: 14px; padding: 12px 18px; border: 0; border-radius: 12px;
  background: var(--accent); color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;
}

button:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }

/* ============================================================
 *  横画面（スマホ横持ち）
 * ============================================================ */
@media (orientation: landscape) and (max-height: 560px) {
  body { background: var(--paper); }
  .app {
    max-width: none;
    height: 100vh;
    height: 100dvh;
    padding:
      6px
      calc(12px + env(safe-area-inset-right))
      calc(6px + env(safe-area-inset-bottom))
      calc(12px + env(safe-area-inset-left));
    display: grid;
    grid-template-columns: minmax(0, 1fr) 190px;
    grid-template-rows: auto minmax(0, 1fr);
    column-gap: 14px;
    row-gap: 6px;
    overflow: hidden;
  }

  .head { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; }
  .head h1 { font-size: 15px; }
  .head .clef { font-size: 18px; }
  .head-sub { display: none; }
  .songs-select { display: block; margin-left: auto; }
  .songs-select select {
    font-size: 12px; padding: 5px 8px; border: 1px solid var(--line);
    border-radius: 8px; background: var(--paper); color: var(--ink); max-width: 44vw;
  }

  .songs, .foot, .rotate-hint, .label { display: none; }

  .score-area { grid-column: 1; grid-row: 2; min-height: 0; display: flex; flex-direction: column; }
  .score {
    flex: 1; min-height: 0; overflow-y: auto;
    -webkit-overflow-scrolling: touch; border-radius: 10px; padding: 6px 4px;
  }
  .score-controls { margin-top: 6px; gap: 6px; flex-wrap: nowrap; }
  .score-controls .mini { padding: 5px 6px; font-size: 11px; }
  .score-count { font-size: 11px; padding: 0 8px; }
  .tempo { font-size: 11px; }
  .tempo button { padding: 4px 6px; }
  .summary { margin-top: 6px; padding: 6px 8px; font-size: 11px; }

  .readout-block {
    grid-column: 2; grid-row: 2; min-height: 0;
    border-top: 0; padding-top: 0;
    display: flex; flex-direction: column; justify-content: center;
  }
  .note-name { font-size: 44px; }
  .note-name sup { font-size: 19px; }
  .note-oct { font-size: 17px; }
  .freq { margin-top: 2px; font-size: 10px; }
  .meter { margin-top: 10px; }
  .meter-scale { height: 24px; }
  .meter-labels { font-size: 9px; margin-top: 4px; }
  .level { margin-top: 8px; }
  .controls { margin-top: 10px; gap: 6px; }
  .mic { padding: 11px 6px; font-size: 12px; border-radius: 10px; }
  .reset { padding: 0 10px; font-size: 11px; border-radius: 10px; }
  .a4 { margin-top: 8px; font-size: 10px; }
  .a4 select { font-size: 11px; padding: 4px 6px; }
  .error, .notice { margin-top: 8px; font-size: 10px; }
}
`
