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
 *  pitch-rec — Step 4
 *   - 高い＝赤 / 低い＝青 に統一（譜面・音名・チューナーの針すべて）
 *   - メトロノーム（開始・停止、BPM 1刻み、拍子切替、拍の点灯）
 *   - 拍子を変えると小節線を引き直す（またぐ音符はタイで分割）
 *   - クリック音がマイクに回り込む区間は検出を止める
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
    time: { beats: 4, beatType: 4 },
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
    time: { beats: 4, beatType: 4 },
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
    time: { beats: 3, beatType: 4 },
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
    time: { beats: 3, beatType: 4 },
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

const TIME_OPTIONS = [
  { id: '2/4', beats: 2, beatType: 4 },
  { id: '3/4', beats: 3, beatType: 4 },
  { id: '4/4', beats: 4, beatType: 4 },
  { id: '5/4', beats: 5, beatType: 4 },
  { id: '6/8', beats: 6, beatType: 8 },
]

const sigId = (t) => `${t.beats}/${t.beatType}`

/* ============================================================
 *  MusicXML 生成
 *  4分音符 = divisions 4。拍子が変わったら小節線を引き直し、
 *  小節をまたぐ音符はタイで分割する。
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

/* 任意の長さを、書ける音符の並びに崩す（2.5 → 2 + 0.5） */
function decompose(d) {
  const out = []
  let rest = d
  let guard = 0
  while (rest > 1e-6 && guard++ < 8) {
    const hit = TYPE_TABLE.find((t) => t[0] <= rest + 1e-6)
    if (!hit) break
    out.push(hit[0])
    rest -= hit[0]
  }
  return out.length ? out : [d]
}

function durationToType(d) {
  const hit = TYPE_TABLE.find((t) => Math.abs(t[0] - d) < 1e-6)
  return hit ? { type: hit[1], dots: hit[2] } : { type: 'quarter', dots: 0 }
}

function pieceXML(piece) {
  const p = parseNote(piece.note.n)
  const { type, dots } = durationToType(piece.dur)
  const ties = []
  const tied = []
  if (piece.tieStop) {
    ties.push('        <tie type="stop"/>')
    tied.push('          <tied type="stop"/>')
  }
  if (piece.tieStart) {
    ties.push('        <tie type="start"/>')
    tied.push('          <tied type="start"/>')
  }
  return [
    '      <note>',
    '        <pitch>',
    `          <step>${p.step}</step>`,
    p.alter ? `          <alter>${p.alter}</alter>` : null,
    `          <octave>${p.octave}</octave>`,
    '        </pitch>',
    `        <duration>${Math.round(piece.dur * DIVISIONS)}</duration>`,
    ...ties,
    '        <voice>1</voice>',
    `        <type>${type}</type>`,
    ...Array.from({ length: dots }, () => '        <dot/>'),
    tied.length ? '        <notations>' : null,
    ...tied,
    tied.length ? '        </notations>' : null,
    '      </note>',
  ]
    .filter(Boolean)
    .join('\n')
}

/* 戻り値の map[i] は「曲データの i 番目の音」が
 * 譜面上のどの音符（複数になりうる）に対応するかの対応表 */
function buildScore(song, time) {
  const barQ = time.beats * (4 / time.beatType)
  const pickupQ = Math.min(song.pickup, barQ)

  const measures = []
  let bar = []
  let filled = 0
  let limit = pickupQ > 0 ? pickupQ : barQ
  const map = []
  let gIndex = 0

  const closeBar = () => {
    measures.push(bar)
    bar = []
    filled = 0
    limit = barQ
  }

  song.notes.forEach((nt, si) => {
    map[si] = []
    let remaining = nt.d
    let first = true
    let guard = 0
    while (remaining > 1e-6 && guard++ < 32) {
      if (limit - filled < 1e-6) closeBar()
      const take = Math.min(remaining, limit - filled)
      const restAfter = remaining - take
      const pieces = decompose(take)
      pieces.forEach((dur, pi) => {
        const more = pi < pieces.length - 1 || restAfter > 1e-6
        bar.push({ note: nt, dur, tieStop: !first, tieStart: more })
        map[si].push(gIndex++)
        first = false
      })
      filled += take
      remaining = restAfter
    }
  })
  if (bar.length) closeBar()

  const body = measures
    .map((pieces, i) => {
      const implicit = i === 0 && pickupQ > 0
      const number = pickupQ > 0 ? i : i + 1
      const attrs =
        i === 0
          ? [
              '      <attributes>',
              `        <divisions>${DIVISIONS}</divisions>`,
              `        <key><fifths>${song.fifths}</fifths><mode>major</mode></key>`,
              `        <time><beats>${time.beats}</beats><beat-type>${time.beatType}</beat-type></time>`,
              '        <clef><sign>G</sign><line>2</line></clef>',
              '      </attributes>',
            ].join('\n')
          : null
      return [
        `    <measure number="${number}"${implicit ? ' implicit="yes"' : ''}>`,
        attrs,
        ...pieces.map(pieceXML),
        '    </measure>',
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
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

  return { xml, map }
}

/* ---------- 曲の時間割 ----------
 * bpm は「拍子の分母の音符」いくつ分かで数える（6/8 なら8分音符）
 */
function buildTimeline(song, bpm, time) {
  const secPerBeat = 60 / bpm
  const beatQ = 4 / time.beatType // 1拍が4分音符いくつぶんか
  const quarterSec = secPerBeat / beatQ

  const onsets = []
  let t = 0
  for (const nt of song.notes) {
    onsets.push(t)
    t += nt.d * quarterSec
  }
  return {
    secPerBeat,
    quarterSec,
    onsets,
    durations: song.notes.map((n) => n.d * quarterSec),
    total: t,
    midis: song.notes.map((n) => noteToMidi(n.n)),
    pickupSec: Math.min(song.pickup, time.beats * beatQ) * quarterSec,
    barSec: time.beats * secPerBeat,
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

/* ---------- クリック音の回り込み対策 ----------
 * スピーカーから出た音がマイクに戻るまでの遅れを見込んで、
 * クリックの前後は検出そのものを止める
 */
const BLANK_BEFORE = 0.015
const BLANK_AFTER = 0.11

const COLOR = {
  ok: '#0f8a45',
  high: '#d5342b', // 高い＝赤
  low: '#1f5fd0', // 低い＝青
  missed: '#b9bcc6',
  ink: '#10131c',
}

const ZOOM = { portrait: 0.72, landscape: 0.58 }

function median(arr) {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/* ---------- 外れ方の札 ---------- */
function badgeOf(v) {
  if (!v || v.verdict === 'ok' || v.verdict === 'missed') return null
  const up = v.verdict === 'high'
  const semis = Math.abs(v.semis ?? 0)
  return {
    dir: up ? 'up' : 'down',
    text: semis ? `${semis}半音` : `${Math.abs(v.cents ?? 0)}¢`,
    color: up ? COLOR.high : COLOR.low,
    title: `${v.playedName ?? '別の音'} を弾いています（${up ? '高い' : '低い'}）`,
  }
}

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
 *  音声の土台（マイクとメトロノームで同じ時計を使う）
 * ============================================================ */
function useAudio() {
  const ctxRef = useRef(null)

  const ensure = useCallback(async () => {
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    if (ctxRef.current.state === 'suspended') await ctxRef.current.resume()
    return ctxRef.current
  }, [])

  const close = useCallback(() => {
    ctxRef.current?.close().catch(() => {})
    ctxRef.current = null
  }, [])

  return { ctxRef, ensure, close }
}

/* ============================================================
 *  ピッチ検出
 * ============================================================ */
function usePitch(a4, audio, blankRef) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const [reading, setReading] = useState(null)
  const [level, setLevel] = useState(0)

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
    try {
      const ctx = await audio.ensure()
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      streamRef.current = stream

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
        if (ctx.state === 'closed') return

        const audioNow = ctx.currentTime
        // クリック音が回り込んでいる間は何も見ない
        const blanked = blankRef.current.some(
          (ct) => audioNow >= ct - BLANK_BEFORE && audioNow <= ct + BLANK_AFTER
        )
        if (blanked) return

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
        const next = { freq: f, midi, cents, name, octave, clarity, at: audioNow }
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
  }, [audio, blankRef])

  useEffect(() => () => stopRef.current(), [])

  return { running, error, reading, level, start, stop, readingRef }
}

/* ============================================================
 *  メトロノーム
 *  鳴らす時刻を先に予約する。予約した時刻は blankRef に積んで
 *  ピッチ検出側に「この間は聴かないで」と伝える。
 * ============================================================ */
function useMetronome(audio, bpm, time, blankRef) {
  const [running, setRunning] = useState(false)
  const [beat, setBeat] = useState(-1)

  const originRef = useRef(0)
  const nextBeatRef = useRef(0)
  const rafRef = useRef(null)
  const runningRef = useRef(false)
  const paramRef = useRef({ bpm, time })
  paramRef.current = { bpm, time }

  const clickAt = useCallback(
    (t, accent) => {
      const ctx = audio.ctxRef.current
      if (!ctx) return
      // 短い減衰音にする。長く伸ばすと音程として検出されてしまう
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = accent ? 2000 : 1400
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(accent ? 0.3 : 0.16, t + 0.001)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.018)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.03)
      blankRef.current.push(t)
    },
    [audio.ctxRef, blankRef]
  )

  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop)
    const ctx = audio.ctxRef.current
    if (!ctx || ctx.state === 'closed') return
    const now = ctx.currentTime
    const { bpm: b, time: t } = paramRef.current
    const spb = 60 / b

    // 予約（250ms 先読み）
    while (originRef.current + nextBeatRef.current * spb < now + 0.25) {
      const at = originRef.current + nextBeatRef.current * spb
      if (at >= now - 0.05) {
        const pos = ((nextBeatRef.current % t.beats) + t.beats) % t.beats
        clickAt(at, pos === 0)
      }
      nextBeatRef.current += 1
    }

    // 表示用の拍
    const b0 = Math.floor((now - originRef.current) / spb)
    setBeat(b0 < 0 ? -1 : ((b0 % t.beats) + t.beats) % t.beats)

    // 古い予約を捨てる
    if (blankRef.current.length > 16) {
      blankRef.current = blankRef.current.filter((ct) => ct > now - 0.5)
    }
  }, [audio.ctxRef, blankRef, clickAt])

  const start = useCallback(
    async (origin, startBeat = 0) => {
      const ctx = await audio.ensure()
      originRef.current = origin ?? ctx.currentTime + 0.15
      nextBeatRef.current = startBeat
      runningRef.current = true
      setRunning(true)
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(loop)
    },
    [audio, loop]
  )

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    runningRef.current = false
    blankRef.current = []
    setRunning(false)
    setBeat(-1)
  }, [blankRef])

  /* テンポや拍子を変えたら、今の瞬間を頭にして刻み直す */
  useEffect(() => {
    if (!runningRef.current) return
    const ctx = audio.ctxRef.current
    if (!ctx) return
    originRef.current = ctx.currentTime + 0.05
    nextBeatRef.current = 0
  }, [bpm, time, audio.ctxRef])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  return { running, beat, start, stop, runningRef, originRef }
}

/* ============================================================
 *  楽譜（OpenSheetMusicDisplay）
 * ============================================================ */
function useScore(song, time, mode) {
  const hostRef = useRef(null)
  const innerRef = useRef(null)
  const scrollRef = useRef(null)
  const osmdRef = useRef(null)
  const notesRef = useRef([])
  const elemsRef = useRef([])
  const colorsRef = useRef([])
  const mapRef = useRef([])
  const cursorAtRef = useRef(0)
  const [status, setStatus] = useState('loading')
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

  /* 曲データの i 番目 → 譜面上の音符（タイで分かれていれば複数） */
  const paint = useCallback(
    (i, color) => {
      const ids = mapRef.current[i] ?? []
      ids.forEach((g) => {
        colorsRef.current[g] = color
        if (!paintElement(elemsRef.current[g], color)) {
          const note = notesRef.current[g]
          if (note) {
            note.NoteheadColor = color
            note.StemColorXml = color
          }
        }
      })
    },
    [paintElement]
  )

  const repaintAll = useCallback(() => {
    colorsRef.current.forEach((c, g) => {
      if (c && c !== COLOR.ink) paintElement(elemsRef.current[g], c)
    })
  }, [paintElement])

  const resetColors = useCallback(() => {
    colorsRef.current = notesRef.current.map(() => COLOR.ink)
    elemsRef.current.forEach((el) => paintElement(el, COLOR.ink))
  }, [paintElement])

  const anchorOf = useCallback((i) => {
    const g = mapRef.current[i]?.[0]
    const el = g == null ? null : elemsRef.current[g]
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
    const g = mapRef.current[i]?.[0] ?? 0
    try {
      osmd.cursor.reset()
      for (let k = 0; k < g; k++) osmd.cursor.next()
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
      defaultColorMusic: COLOR.ink,
      cursorsOptions: [{ type: 0, color: '#25327a', alpha: 0.2, follow: false }],
    })
    osmdRef.current = osmd

    const built = buildScore(song, time)
    mapRef.current = built.map

    osmd
      .load(built.xml)
      .then(() => {
        if (cancelled) return
        osmd.zoom = ZOOM[modeRef.current]
        osmd.render()
        notesRef.current = flattenNotes(osmd)
        colorsRef.current = notesRef.current.map(() => COLOR.ink)
        cacheElements()
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
  }, [song, time, cacheElements])

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

  return { hostRef, innerRef, scrollRef, status, layout, paint, resetColors, cursorTo, anchorOf }
}

/* ============================================================
 *  演奏セッション
 * ============================================================ */
function useSession({ song, bpm, time, startMode, audio, pitch, score, metro }) {
  const [phase, setPhase] = useState('idle') // idle | armed | countin | playing | done
  const [index, setIndex] = useState(0)
  const [verdicts, setVerdicts] = useState([])
  const [countBeat, setCountBeat] = useState(0)

  const timeline = useMemo(() => buildTimeline(song, bpm, time), [song, bpm, time])
  const timelineRef = useRef(timeline)
  timelineRef.current = timeline

  const rafRef = useRef(null)
  const phaseRef = useRef('idle')
  const startAtRef = useRef(0)
  const idxRef = useRef(0)
  const statsRef = useRef(null)
  const verdictsRef = useRef([])
  const armMatchRef = useRef(0)
  const metroOwnedRef = useRef(false)

  const setPhaseBoth = useCallback((p) => {
    phaseRef.current = p
    setPhase(p)
  }, [])

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
        return c ? Math.round((st.cents.get(midi) ?? 0) / c) : 0
      }

      let record
      if (st.samples < MIN_SAMPLES) {
        record = { verdict: 'missed', cents: null, semis: 0, playedName: null, dev: null }
      } else if (hits / st.samples < NAME_HIT_RATIO) {
        const semis = dominant - expect
        const dev = semis * 100 + avgOf(dominant)
        record = {
          verdict: dev > 0 ? 'high' : 'low',
          cents: avgOf(dominant),
          semis,
          playedName: midiToLabel(dominant),
          dev,
        }
      } else {
        const dev = avgOf(expect)
        record = {
          verdict: Math.abs(dev) <= GOOD_CENTS ? 'ok' : dev > 0 ? 'high' : 'low',
          cents: dev,
          semis: 0,
          playedName: midiToLabel(expect),
          dev,
        }
      }

      verdictsRef.current[i] = record
      setVerdicts([...verdictsRef.current])
      score.paint(i, COLOR[record.verdict])
      statsRef.current = null
    },
    [score]
  )

  const stopSession = useCallback(
    (nextPhase = 'idle') => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      statsRef.current = null
      if (metroOwnedRef.current) {
        metro.stop()
        metroOwnedRef.current = false
      }
      setPhaseBoth(nextPhase)
      setCountBeat(0)
    },
    [metro, setPhaseBoth]
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
    const ctx = audio.ctxRef.current
    if (!ctx || ctx.state === 'closed') {
      stopSession('idle')
      return
    }
    const tl = timelineRef.current
    const now = ctx.currentTime

    /* --- 開始待ち --- */
    if (phaseRef.current === 'armed') {
      const r = pitch.readingRef.current
      const expect = tl.midis[0]
      if (r && r.midi === expect && Math.abs(r.cents) < 60) {
        if (!armMatchRef.current) armMatchRef.current = now
        if (now - armMatchRef.current >= 0.1) {
          let origin = armMatchRef.current
          // メトロノームが動いていれば、いちばん近い拍に吸着させる
          if (metro.runningRef.current) {
            const spb = tl.secPerBeat
            const k = Math.round((origin - metro.originRef.current) / spb)
            const snapped = metro.originRef.current + k * spb
            if (Math.abs(snapped - origin) < spb * 0.4) origin = snapped
          }
          startAtRef.current = origin
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
      setCountBeat(Math.max(0, Math.ceil(remain / tl.secPerBeat)))
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
  }, [audio.ctxRef, finalizeNote, metro, openNote, pitch.readingRef, score, setPhaseBoth, stopSession])

  const begin = useCallback(async () => {
    const ctx = await audio.ensure()
    if (!pitch.running) await pitch.start()
    const tl = timelineRef.current

    verdictsRef.current = []
    setVerdicts([])
    score.resetColors()
    score.cursorTo(0)
    idxRef.current = 0
    setIndex(0)
    armMatchRef.current = 0

    if (startMode === 'countin') {
      const lead = 0.3
      const countStart = ctx.currentTime + lead
      const downbeat = countStart + time.beats * tl.secPerBeat
      startAtRef.current = downbeat - tl.pickupSec
      if (!metro.runningRef.current) metroOwnedRef.current = true
      await metro.start(countStart, 0)
      setPhaseBoth('countin')
    } else {
      setPhaseBoth('armed')
    }

    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(loop)
  }, [audio, loop, metro, pitch, score, setPhaseBoth, startMode, time.beats])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    statsRef.current = null
    phaseRef.current = 'idle'
    setPhase('idle')
    setCountBeat(0)
    idxRef.current = 0
    setIndex(0)
    verdictsRef.current = []
    setVerdicts([])
  }, [song, bpm, time])

  const summary = useMemo(() => {
    const done = verdicts.filter(Boolean)
    if (!done.length) return null
    const ok = done.filter((v) => v.verdict === 'ok').length
    const tuned = done.filter((v) => v.verdict !== 'missed' && !v.semis)
    const avg = tuned.length
      ? Math.round(tuned.reduce((a, b) => a + b.cents, 0) / tuned.length)
      : null
    return { ok, total: done.length, avg }
  }, [verdicts])

  return { phase, index, verdicts, countBeat, summary, begin, reset, stop: () => stopSession('idle') }
}

/* ============================================================
 *  UI パーツ
 * ============================================================ */
function TunerMeter({ cents, state }) {
  const active = state !== 'idle'
  const clamped = Math.max(-50, Math.min(50, cents ?? 0))
  const pos = 50 + clamped

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
        <span className="lab-low">低い ▼</span>
        <span className="cents">{active ? `${cents > 0 ? '+' : ''}${cents} cent` : '—'}</span>
        <span className="lab-high">▲ 高い</span>
      </div>
    </div>
  )
}

function Metronome({ bpm, setBpm, time, setTime, metro, disabled }) {
  const unit = time.beatType === 8 ? '♪' : '♩'
  return (
    <div className="metro">
      <div className="beats" aria-hidden="true">
        {Array.from({ length: time.beats }, (_, i) => (
          <span
            key={i}
            className="beat"
            data-on={metro.running && metro.beat === i}
            data-accent={i === 0}
          />
        ))}
      </div>

      <div className="metro-row">
        <div className="bpm">
          <button onClick={() => setBpm((v) => Math.max(30, v - 1))} aria-label="テンポを1下げる">
            −
          </button>
          <span className="bpm-val">
            {unit}= <b>{bpm}</b>
          </span>
          <button onClick={() => setBpm((v) => Math.min(240, v + 1))} aria-label="テンポを1上げる">
            ＋
          </button>
        </div>

        <select
          className="mini"
          value={sigId(time)}
          onChange={(e) => {
            const t = TIME_OPTIONS.find((o) => o.id === e.target.value)
            setTime({ beats: t.beats, beatType: t.beatType })
          }}
          disabled={disabled}
          aria-label="拍子"
        >
          {TIME_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.id}
            </option>
          ))}
        </select>

        <button
          className="metro-btn"
          data-on={metro.running}
          onClick={() => (metro.running ? metro.stop() : metro.start())}
        >
          {metro.running ? '停止' : '開始'}
        </button>
      </div>

      <input
        className="bpm-slider"
        type="range"
        min={30}
        max={240}
        value={bpm}
        onChange={(e) => setBpm(Number(e.target.value))}
        aria-label="テンポ"
      />
    </div>
  )
}

/* ============================================================
 *  エラー境界
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
  const song = useMemo(() => SONGS.find((s) => s.id === songId), [songId])

  const [bpm, setBpm] = useState(song.bpm)
  const [time, setTime] = useState(song.time)
  const [autoStopped, setAutoStopped] = useState(false)

  /* 曲を変えたらテンポと拍子はその曲のものへ戻す */
  useEffect(() => {
    setBpm(song.bpm)
    setTime(song.time)
  }, [song])

  const mode = useLayoutMode()
  const blankRef = useRef([])
  const audio = useAudio()
  const pitch = usePitch(a4, audio, blankRef)
  const metro = useMetronome(audio, bpm, time, blankRef)
  const score = useScore(song, time, mode)
  const session = useSession({ song, bpm, time, startMode, audio, pitch, score, metro })

  /* 画面が裏に回ったら全部止めて、マイクを解放する */
  const teardown = useRef(null)
  teardown.current = () => {
    if (!audio.ctxRef.current && !pitch.running) return
    session.stop()
    metro.stop()
    pitch.stop()
    audio.close()
    blankRef.current = []
    setAutoStopped(true)
  }

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') teardown.current?.()
    }
    const onPageHide = () => teardown.current?.()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [])

  const reading = pitch.reading
  const live = pitch.running && !!reading
  const tunerState = !live
    ? 'idle'
    : Math.abs(reading.cents) <= IN_TUNE_CENTS
      ? 'ok'
      : reading.cents > 0
        ? 'high'
        : 'low'

  const target = song.notes[session.index]?.n ?? '—'
  const playing = session.phase === 'playing'
  const busy = session.phase !== 'idle' && session.phase !== 'done'

  /* 外れた音符の上に置く札 */
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
    setAutoStopped(false)
    if (busy) session.stop()
    else session.begin()
  }

  const metroApi = {
    running: metro.running,
    beat: metro.beat,
    start: () => {
      setAutoStopped(false)
      metro.start()
    },
    stop: metro.stop,
  }

  return (
    <div className="app" data-state={tunerState} data-mode={mode}>
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
                {s.title}（{s.keyName} {sigId(s.time)}）
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
                {s.keyName} · {sigId(s.time)} · ♩= {s.bpm}
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
            {score.status === 'ready' ? `${session.index + 1} / ${song.notes.length}` : '…'}
          </span>
          <select
            className="mini grow"
            value={startMode}
            onChange={(e) => setStartMode(e.target.value)}
            disabled={busy}
            aria-label="開始方法"
          >
            <option value="listen">弾き出しで開始</option>
            <option value="countin">1小節カウント</option>
          </select>
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
          緑＝合格、<span className="sw-high">赤＝高い</span>、
          <span className="sw-low">青＝低い</span>、灰＝鳴っていない。
          音符の上に外れ幅（▲▼と半音／セント）が付きます。
        </p>
      </section>

      {/* 譜面の下（横画面では右下）：メトロノーム */}
      <section className="block metronome">
        <h2 className="label">メトロノーム</h2>
        <Metronome
          bpm={bpm}
          setBpm={setBpm}
          time={time}
          setTime={setTime}
          metro={metroApi}
          disabled={busy}
        />
        <p className="hint rotate-hint">
          拍子を変えると小節線を引き直します（またぐ音符はタイでつなぎます）。
          クリック音がマイクに入るのを避けたいときはイヤホンをどうぞ。
        </p>
      </section>

      {/* 下（横画面では右上）：マイクと音名 */}
      <section className="block readout-block">
        <div className="readout">
          <div className="note">
            <span className="note-name">
              {live ? reading.name.replace('#', '') : '—'}
              {live && reading.name.includes('#') && <sup>♯</sup>}
            </span>
            <span className="note-oct">{live ? reading.octave : ''}</span>
          </div>
          <div className="freq">
            {playing || session.phase === 'armed'
              ? `譜面 ${target}${live ? ` ／ ${reading.freq.toFixed(1)} Hz` : ''}`
              : live
                ? `${reading.freq.toFixed(1)} Hz`
                : pitch.running
                  ? '音を待っています'
                  : 'マイクは停止中'}
          </div>
        </div>

        <TunerMeter cents={reading?.cents ?? 0} state={tunerState} />

        <div className="level" aria-hidden="true">
          <div className="level-bar" style={{ width: `${Math.round(pitch.level * 100)}%` }} />
        </div>

        {pitch.error && <p className="error">{pitch.error}</p>}
        {autoStopped && !pitch.running && (
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
  --high: #d5342b;
  --low: #1f5fd0;
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
.sw-high { color: var(--high); font-weight: 700; }
.sw-low { color: var(--low); font-weight: 700; }

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
.score-msg.error { color: var(--high); padding: 0 24px; text-align: center; }

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

.score-controls { margin-top: 12px; display: flex; gap: 8px; align-items: stretch; }
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
.mini {
  font-size: 12px;
  padding: 7px 8px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
}
.mini.grow { flex: 1; }

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

/* メトロノーム */
.metro {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.beats { display: flex; gap: 8px; align-items: center; justify-content: center; height: 22px; }
.beat {
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--paper-2);
  border: 1px solid var(--line);
  transition: transform .06s ease-out, background .06s, border-color .06s;
}
.beat[data-accent="true"] { width: 15px; height: 15px; }
.beat[data-on="true"] {
  background: var(--accent); border-color: var(--accent); transform: scale(1.35);
}
.beat[data-accent="true"][data-on="true"] { background: var(--ink); border-color: var(--ink); }

.metro-row { display: flex; gap: 8px; align-items: stretch; }
.bpm {
  display: flex; align-items: center; gap: 2px;
  border: 1px solid var(--line); border-radius: 10px; padding: 0 4px;
  font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap;
}
.bpm button {
  border: 0; background: none; color: var(--accent);
  font-size: 17px; padding: 6px 9px; cursor: pointer;
}
.bpm-val b { font-size: 15px; }
.metro-btn {
  flex: 1;
  border: 1px solid var(--accent); border-radius: 10px;
  background: var(--paper); color: var(--accent);
  font-size: 13px; font-weight: 600; cursor: pointer; padding: 8px;
}
.metro-btn[data-on="true"] { background: var(--accent); color: #fff; }
.bpm-slider { width: 100%; accent-color: var(--accent); }

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
.app[data-state="high"] .note { color: var(--high); }
.app[data-state="low"] .note { color: var(--low); }
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
.meter[data-state="high"] .needle { background: var(--high); }
.meter[data-state="low"] .needle { background: var(--low); }
.meter-labels {
  display: flex; justify-content: space-between; margin-top: 7px;
  font-size: 11px; color: var(--ink-30);
}
.lab-low { color: var(--low); }
.lab-high { color: var(--high); }
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
.error { margin: 14px 0 0; font-size: 12px; color: var(--high); line-height: 1.6; }
.notice { margin: 12px 0 0; font-size: 11px; color: var(--ink-60); line-height: 1.6; }
.foot { font-size: 11px; color: var(--ink-30); text-align: center; }

/* クラッシュ画面 */
.crash { max-width: 480px; margin: 0 auto; padding: 40px 20px; background: var(--paper); min-height: 100%; }
.crash h2 { font-size: 17px; margin: 0 0 8px; }
.crash p { font-size: 13px; color: var(--ink-60); margin: 0 0 14px; }
.crash pre {
  font-size: 11px; color: var(--high); background: var(--paper-2);
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
 *  左：譜面（全高） 右上：チューナー 右下：メトロノーム
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
    grid-template-columns: minmax(0, 1fr) 196px;
    grid-template-rows: auto minmax(0, 1fr) auto;
    column-gap: 14px;
    row-gap: 6px;
    overflow: hidden;
  }

  .head { grid-column: 1 / -1; grid-row: 1; display: flex; align-items: center; gap: 10px; }
  .head h1 { font-size: 15px; }
  .head .clef { font-size: 18px; }
  .head-sub { display: none; }
  .songs-select { display: block; margin-left: auto; }
  .songs-select select {
    font-size: 12px; padding: 5px 8px; border: 1px solid var(--line);
    border-radius: 8px; background: var(--paper); color: var(--ink); max-width: 42vw;
  }

  .songs, .foot, .rotate-hint, .label { display: none; }

  .score-area {
    grid-column: 1; grid-row: 2 / span 2;
    min-height: 0; display: flex; flex-direction: column;
  }
  .score {
    flex: 1; min-height: 0; overflow-y: auto;
    -webkit-overflow-scrolling: touch; border-radius: 10px; padding: 6px 4px;
  }
  .score-controls { margin-top: 6px; gap: 6px; }
  .score-controls .mini { padding: 5px 6px; font-size: 11px; }
  .score-count { font-size: 11px; padding: 0 8px; }
  .summary { margin-top: 6px; padding: 6px 8px; font-size: 11px; }

  .readout-block {
    grid-column: 2; grid-row: 2; min-height: 0;
    border-top: 0; padding-top: 0;
    display: flex; flex-direction: column; justify-content: center;
  }
  .note-name { font-size: 38px; }
  .note-name sup { font-size: 17px; }
  .note-oct { font-size: 15px; }
  .freq { margin-top: 2px; font-size: 10px; }
  .meter { margin-top: 8px; }
  .meter-scale { height: 22px; }
  .meter-labels { font-size: 9px; margin-top: 3px; }
  .level { margin-top: 6px; }
  .controls { margin-top: 8px; gap: 6px; }
  .mic { padding: 10px 6px; font-size: 12px; border-radius: 10px; }
  .reset { padding: 0 10px; font-size: 11px; border-radius: 10px; }
  .a4 { margin-top: 6px; font-size: 10px; }
  .a4 select { font-size: 11px; padding: 3px 6px; }
  .error, .notice { margin-top: 6px; font-size: 10px; }

  .metronome { grid-column: 2; grid-row: 3; }
  .metro { padding: 8px; gap: 7px; border-radius: 10px; }
  .beats { height: 14px; gap: 6px; }
  .beat { width: 9px; height: 9px; }
  .beat[data-accent="true"] { width: 11px; height: 11px; }
  .metro-row { gap: 6px; }
  .bpm { font-size: 11px; }
  .bpm button { padding: 4px 7px; font-size: 15px; }
  .bpm-val b { font-size: 13px; }
  .metro-btn { padding: 6px; font-size: 11px; }
  .bpm-slider { display: none; }
}
`
