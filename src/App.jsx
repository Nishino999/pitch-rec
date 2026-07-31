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
 *  pitch-rec — Step 5
 *   タブで2つのモードを切り替える
 *    ・練習     … デモ曲を弾いて判定してもらう（従来）
 *    ・フリー演奏 … 弾いた音を録って、そこから譜面を起こす
 * ============================================================ */

/* ---------- 音名ユーティリティ ---------- */
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

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

/* 調号に合わせて ♯ か ♭ で綴る */
function midiToLabelIn(midi, fifths) {
  const n = Math.round(midi)
  const pc = ((n % 12) + 12) % 12
  const octave = Math.floor(n / 12) - 1
  return `${(fifths < 0 ? FLAT_NAMES : SHARP_NAMES)[pc]}${octave}`
}

function freqToMidiFloat(freq, a4) {
  return 69 + 12 * Math.log2(freq / a4)
}

/* 使われた音から調号を推定する。
 * ① 音階から外れる音がいちばん少ない調に絞り、
 * ② その中で主音と属音がよく出てくる調を選ぶ（旋律の重心を見る）、
 * ③ それでも並んだら調号の少ない方。 */
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11]

function guessFifths(midis) {
  if (!midis.length) return 0
  const count = new Array(12).fill(0)
  midis.forEach((m) => {
    count[((m % 12) + 12) % 12] += 1
  })
  const used = count.map((c, pc) => (c ? pc : -1)).filter((pc) => pc >= 0)

  const scored = []
  for (let f = -4; f <= 5; f++) {
    const tonic = (((7 * f) % 12) + 12) % 12
    const dominant = (tonic + 7) % 12
    const scale = new Set(MAJOR_STEPS.map((st) => (tonic + st) % 12))
    const miss = used.filter((pc) => !scale.has(pc)).length
    scored.push({ f, miss, weight: count[tonic] * 2 + count[dominant] })
  }
  scored.sort((a, b) => a.miss - b.miss || b.weight - a.weight || Math.abs(a.f) - Math.abs(b.f))
  return scored[0].f
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

const KEY_NAMES = {
  '-4': '変イ長調 ♭4',
  '-3': '変ホ長調 ♭3',
  '-2': '変ロ長調 ♭2',
  '-1': 'ヘ長調 ♭1',
  0: 'ハ長調',
  1: 'ト長調 ♯1',
  2: 'ニ長調 ♯2',
  3: 'イ長調 ♯3',
  4: 'ホ長調 ♯4',
  5: 'ロ長調 ♯5',
}

const sigId = (t) => `${t.beats}/${t.beatType}`

/* ============================================================
 *  MusicXML 生成
 *  4分音符 = divisions 4。小節をまたぐ音符はタイで分割する。
 *  notes の要素は { n, d } か { rest: true, d }
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
  const { type, dots } = durationToType(piece.dur)
  const dur = `        <duration>${Math.round(piece.dur * DIVISIONS)}</duration>`

  if (piece.rest) {
    return [
      '      <note>',
      '        <rest/>',
      dur,
      '        <voice>1</voice>',
      `        <type>${type}</type>`,
      ...Array.from({ length: dots }, () => '        <dot/>'),
      '      </note>',
    ].join('\n')
  }

  const p = parseNote(piece.name)
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
    dur,
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

/* map[i] は「曲データの i 番目」が譜面上のどの音符に対応するかの対応表。
 * 休符は音符として数えない（OSMD 側の一覧が休符を含まないため） */
function buildScore(piece, time) {
  const barQ = time.beats * (4 / time.beatType)
  const pickupQ = Math.min(piece.pickup ?? 0, barQ)

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

  piece.notes.forEach((nt, si) => {
    map[si] = []
    let remaining = nt.d
    let first = true
    let guard = 0
    while (remaining > 1e-6 && guard++ < 64) {
      if (limit - filled < 1e-6) closeBar()
      const take = Math.min(remaining, limit - filled)
      const restAfter = remaining - take
      decompose(take).forEach((dur, pi, arr) => {
        const more = pi < arr.length - 1 || restAfter > 1e-6
        if (nt.rest) {
          bar.push({ rest: true, dur })
        } else {
          bar.push({ name: nt.n, dur, tieStop: !first, tieStart: more })
          map[si].push(gIndex++)
        }
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
              `        <key><fifths>${piece.fifths}</fifths><mode>major</mode></key>`,
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
  <work><work-title>${piece.title}</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Violin</part-name></score-part>
  </part-list>
  <part id="P1">
${body}
  </part>
</score-partwise>`

  return { xml, map }
}

/* ---------- 曲の時間割 ---------- */
function buildTimeline(song, bpm, time) {
  const secPerBeat = 60 / bpm
  const beatQ = 4 / time.beatType
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

/* ---------- 採譜パラメータ ---------- */
const SEG_CONFIRM = 3 // 音が変わったと認めるのに要るフレーム数
const SEG_MIN_SEC = 0.1 // これより短い音は捨てる
const SEG_GAP = 0.07 // 無音がこれ以上続いたら音の切れ目（弓の返しを拾うため短め）
const SEG_BRIDGE = 0.09 // クリックで検出を止めた区間を「音が続いていた」とみなす上限
const REST_MIN_UNITS = 2 // 16分音符いくつぶん空いたら休符にするか（それ未満は前の音を伸ばす）
const REC_MAX_SEC = 180

/* ---------- クリック音の回り込み対策 ---------- */
const BLANK_BEFORE = 0.015
const BLANK_AFTER = 0.03

const COLOR = {
  ok: '#0f8a45',
  high: '#d5342b',
  low: '#1f5fd0',
  missed: '#b9bcc6',
  ink: '#10131c',
}

const ZOOM = { portrait: 0.72, landscape: 0.58 }

function median(arr) {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

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
 *  音声の土台
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
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      // 検出レンジ(MAX_HZ)より上の音にする。こうするとクリックが音程として拾われない
      osc.frequency.value = accent ? 4699 : 3520
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(accent ? 0.34 : 0.15, t + 0.001)
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

    while (originRef.current + nextBeatRef.current * spb < now + 0.25) {
      const at = originRef.current + nextBeatRef.current * spb
      if (at >= now - 0.05) {
        const pos = ((nextBeatRef.current % t.beats) + t.beats) % t.beats
        clickAt(at, pos === 0)
      }
      nextBeatRef.current += 1
    }

    const b0 = Math.floor((now - originRef.current) / spb)
    setBeat(b0 < 0 ? -1 : ((b0 % t.beats) + t.beats) % t.beats)

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
function useScore(piece, time, mode) {
  const hostRef = useRef(null)
  const innerRef = useRef(null)
  const scrollRef = useRef(null)
  const osmdRef = useRef(null)
  const notesRef = useRef([])
  const elemsRef = useRef([])
  const colorsRef = useRef([])
  const mapRef = useRef([])
  const cursorAtRef = useRef(0)
  const [status, setStatus] = useState('empty')
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

    if (!piece || !piece.notes?.length) {
      host.innerHTML = ''
      osmdRef.current = null
      notesRef.current = []
      elemsRef.current = []
      mapRef.current = []
      setStatus('empty')
      return
    }

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

    const built = buildScore(piece, time)
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
  }, [piece, time, cacheElements])

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
 *  演奏セッション（練習モード）
 * ============================================================ */
function useSession({ song, bpm, time, startMode, audio, pitch, score, metro }) {
  const [phase, setPhase] = useState('idle')
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
        record = { verdict: 'missed', cents: null, semis: 0, playedName: null }
      } else if (hits / st.samples < NAME_HIT_RATIO) {
        const semis = dominant - expect
        const dev = semis * 100 + avgOf(dominant)
        record = {
          verdict: dev > 0 ? 'high' : 'low',
          cents: avgOf(dominant),
          semis,
          playedName: midiToLabel(dominant),
        }
      } else {
        const dev = avgOf(expect)
        record = {
          verdict: Math.abs(dev) <= GOOD_CENTS ? 'ok' : dev > 0 ? 'high' : 'low',
          cents: dev,
          semis: 0,
          playedName: midiToLabel(expect),
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

    if (phaseRef.current === 'armed') {
      const r = pitch.readingRef.current
      const expect = tl.midis[0]
      if (r && r.midi === expect && Math.abs(r.cents) < 60) {
        if (!armMatchRef.current) armMatchRef.current = now
        if (now - armMatchRef.current >= 0.1) {
          let origin = armMatchRef.current
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
      const countStart = ctx.currentTime + 0.3
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
    const avg = tuned.length ? Math.round(tuned.reduce((a, b) => a + b.cents, 0) / tuned.length) : null
    return { ok, total: done.length, avg }
  }, [verdicts])

  return { phase, index, verdicts, countBeat, summary, begin, reset, stop: () => stopSession('idle') }
}

/* ============================================================
 *  フリー演奏（録音 → 採譜）
 *
 *  1. 弾いている間、検出できた音を毎フレーム貯める
 *  2. 止めたら、同じ音が続いている区間をひとつの音符にまとめる
 *  3. テンポの格子に合わせて長さを丸め、隙間は休符にする
 *  生データは残してあるので、テンポや拍子を変えると採譜し直す
 * ============================================================ */
function segmentEvents(samples) {
  const events = []
  let cur = null
  let pending = null
  let lastBlank = -1

  const close = (endAt) => {
    if (cur && endAt - cur.start >= SEG_MIN_SEC) {
      events.push({
        midi: cur.midi,
        start: cur.start,
        end: endAt,
        cents: Math.round(cur.centsSum / cur.n),
      })
    }
    cur = null
  }

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]

    // クリック音で検出を止めていた区間。印だけ覚えておく
    if (s.blank) {
      lastBlank = s.t
      continue
    }

    if (cur) {
      const gap = s.t - cur.last
      if (gap > SEG_GAP) {
        // 空白がクリックのせいで、前後が同じ音なら続いていたとみなす
        const bridged = lastBlank > cur.last && s.midi === cur.midi && gap <= SEG_BRIDGE
        if (!bridged) {
          close(cur.last)
          pending = null
        }
      }
    }

    if (!cur) {
      cur = { midi: s.midi, start: s.t, last: s.t, n: 1, centsSum: s.cents }
      pending = null
      continue
    }
    if (s.midi === cur.midi) {
      cur.last = s.t
      cur.n += 1
      cur.centsSum += s.cents
      pending = null
      continue
    }
    // 違う音。数フレーム続いたら本物とみなす
    if (!pending || pending.midi !== s.midi) {
      pending = { midi: s.midi, start: s.t, n: 1, centsSum: s.cents }
    } else {
      pending.n += 1
      pending.centsSum += s.cents
    }
    if (pending.n >= SEG_CONFIRM) {
      close(pending.start)
      cur = {
        midi: pending.midi,
        start: pending.start,
        last: s.t,
        n: pending.n,
        centsSum: pending.centsSum,
      }
      pending = null
    }
  }
  if (cur) close(cur.last)
  return events
}

function transcribe(events, bpm, time, keyOverride) {
  if (!events.length) return null
  const secPerBeat = 60 / bpm
  const quarterSec = secPerBeat / (4 / time.beatType)
  const gridSec = quarterSec / 4 // 16分音符の格子

  const t0 = events[0].start

  // 頭と終わりを格子に丸める。頭が重なったら1つずらす
  const grid = []
  events.forEach((e) => {
    let gs = Math.max(0, Math.round((e.start - t0) / gridSec))
    const prev = grid[grid.length - 1]
    if (prev && gs <= prev.gs) gs = prev.gs + 1
    let ge = Math.round((e.end - t0) / gridSec)
    if (ge <= gs) ge = gs + 1
    grid.push({ gs, ge, midi: e.midi })
  })

  /* 音符の長さは「次の音が始まるまで」。
   * 弓を離した程度の短い隙間で休符を挟むと譜面が読めなくなるため、
   * はっきり空いたところ（16分2つ分以上）だけ休符にする。 */
  const notes = []
  let cursor = 0
  grid.forEach((g, i) => {
    if (g.gs > cursor) notes.push({ rest: true, d: (g.gs - cursor) / 4 })
    const next = grid[i + 1]
    let end = g.ge
    if (next) {
      const gapUnits = next.gs - g.ge
      if (gapUnits > 0 && gapUnits < REST_MIN_UNITS) end = next.gs
    } else {
      // 最後の音は次が無いので、拍の切れ目まで伸ばして丸める
      const beatUnits = 16 / time.beatType
      end = Math.max(g.gs + 1, Math.ceil(g.ge / beatUnits) * beatUnits)
    }
    notes.push({ n: null, midi: g.midi, d: (end - g.gs) / 4 })
    cursor = end
  })

  const fifths = keyOverride ?? guessFifths(grid.map((g) => g.midi))
  notes.forEach((n) => {
    if (!n.rest) n.n = midiToLabelIn(n.midi, fifths)
  })

  return {
    title: 'フリー演奏',
    fifths,
    pickup: 0,
    notes,
    noteCount: grid.length,
    seconds: events[events.length - 1].end - t0,
  }
}

function useFreeMode({ audio, pitch, metro, bpm, time, blankRef, keyOverride }) {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [events, setEvents] = useState([])

  const samplesRef = useRef([])
  const rafRef = useRef(null)
  const t0Ref = useRef(0)
  const lastAtRef = useRef(-1)

  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop)
    const ctx = audio.ctxRef.current
    if (!ctx || ctx.state === 'closed') return
    const now = ctx.currentTime
    setElapsed(now - t0Ref.current)

    // クリック音のせいで検出を止めていた区間には印を置く
    const blanked = blankRef.current.some(
      (ct) => now >= ct - BLANK_BEFORE && now <= ct + BLANK_AFTER
    )
    if (blanked) {
      samplesRef.current.push({ t: now - t0Ref.current, blank: true })
    } else {
      const r = pitch.readingRef.current
      if (r && r.at !== lastAtRef.current && now - r.at < 0.12) {
        lastAtRef.current = r.at
        samplesRef.current.push({ t: r.at - t0Ref.current, midi: r.midi, cents: r.cents })
      }
    }

    if (now - t0Ref.current > REC_MAX_SEC) stopRef.current()
  }, [audio.ctxRef, blankRef, pitch.readingRef])

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    setRecording(false)
    setEvents(segmentEvents(samplesRef.current))
  }, [])

  const stopRef = useRef(stop)
  stopRef.current = stop

  const start = useCallback(async () => {
    const ctx = await audio.ensure()
    if (!pitch.running) await pitch.start()
    samplesRef.current = []
    lastAtRef.current = -1
    setEvents([])
    // メトロノームが動いていれば拍の頭に合わせる
    let t0 = ctx.currentTime
    if (metro.runningRef.current) {
      const spb = 60 / bpm
      const k = Math.ceil((t0 - metro.originRef.current) / spb)
      t0 = metro.originRef.current + k * spb
    }
    t0Ref.current = t0
    setElapsed(0)
    setRecording(true)
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(loop)
  }, [audio, bpm, loop, metro, pitch])

  const clear = useCallback(() => {
    samplesRef.current = []
    setEvents([])
    setElapsed(0)
  }, [])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  /* テンポ・拍子・調号を変えたら採譜し直す（録音はそのまま） */
  const piece = useMemo(
    () => transcribe(events, bpm, time, keyOverride),
    [events, bpm, time, keyOverride]
  )

  return { recording, elapsed, events, piece, start, stop, clear }
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
  const [tab, setTab] = useState('practice') // practice | free
  const [songId, setSongId] = useState(SONGS[0].id)
  const [a4, setA4] = useState(440)
  const [startMode, setStartMode] = useState('listen')
  const song = useMemo(() => SONGS.find((s) => s.id === songId), [songId])

  const [bpm, setBpm] = useState(song.bpm)
  const [time, setTime] = useState(song.time)
  const [freeKey, setFreeKey] = useState(null) // null なら自動推定
  const [autoStopped, setAutoStopped] = useState(false)

  useEffect(() => {
    setBpm(song.bpm)
    setTime(song.time)
  }, [song])

  const mode = useLayoutMode()
  const blankRef = useRef([])
  const audio = useAudio()
  const pitch = usePitch(a4, audio, blankRef)
  const metro = useMetronome(audio, bpm, time, blankRef)
  const free = useFreeMode({ audio, pitch, metro, bpm, time, blankRef, keyOverride: freeKey })

  /* 譜面はタブによって中身が入れ替わる */
  const piece = tab === 'free' ? free.piece : song
  const score = useScore(piece, time, mode)
  const session = useSession({ song, bpm, time, startMode, audio, pitch, score, metro })

  /* 画面が裏に回ったら全部止める */
  const teardown = useRef(null)
  teardown.current = () => {
    if (!audio.ctxRef.current && !pitch.running) return
    session.stop()
    if (free.recording) free.stop()
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
  const practiceBusy = session.phase !== 'idle' && session.phase !== 'done'
  const busy = tab === 'practice' ? practiceBusy : free.recording

  /* タブを切り替えるときは走っているものを止める */
  const switchTab = (next) => {
    if (next === tab) return
    session.stop()
    if (free.recording) free.stop()
    setTab(next)
  }

  /* 外れた音符の上に置く札（練習モードのみ） */
  const [badges, setBadges] = useState([])
  const anchorOf = score.anchorOf
  const layout = score.layout
  const verdicts = tab === 'practice' ? session.verdicts : []

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

  const practiceLabel = {
    idle: '演奏を始める',
    armed: `${song.notes[0].n} を待っています`,
    countin: `カウント ${session.countBeat}`,
    playing: '演奏中 — 止める',
    done: 'もう一度',
  }[session.phase]

  const primaryLabel =
    tab === 'free'
      ? free.recording
        ? `停止して採譜（${free.elapsed.toFixed(1)}秒）`
        : free.piece
          ? 'もう一度 録音する'
          : '録音を開始'
      : practiceLabel

  const onPrimary = () => {
    setAutoStopped(false)
    if (tab === 'free') {
      if (free.recording) free.stop()
      else free.start()
    } else if (practiceBusy) {
      session.stop()
    } else {
      session.begin()
    }
  }

  const micPhase = tab === 'free' ? (free.recording ? 'playing' : 'idle') : session.phase

  const saveXml = () => {
    if (!free.piece) return
    const { xml } = buildScore(free.piece, time)
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `pitch-rec-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.musicxml`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
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
    <div className="app" data-state={tunerState} data-mode={mode} data-tab={tab}>
      <style>{CSS}</style>

      <header className="head">
        <h1>
          <span className="clef">𝄞</span> pitch-rec
        </h1>

        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'practice'}
            data-on={tab === 'practice'}
            onClick={() => switchTab('practice')}
          >
            練習
          </button>
          <button
            role="tab"
            aria-selected={tab === 'free'}
            data-on={tab === 'free'}
            onClick={() => switchTab('free')}
          >
            フリー演奏
          </button>
        </div>

        <label className="songs-select">
          <select
            value={songId}
            onChange={(e) => setSongId(e.target.value)}
            disabled={busy || tab === 'free'}
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

      {/* 上：曲を選ぶ（練習モードのみ） */}
      {tab === 'practice' && (
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
      )}

      {/* 真ん中：楽譜 */}
      <section className="block score-area">
        <h2 className="label">{tab === 'free' ? '採譜した楽譜' : '楽譜'}</h2>

        <div className="score" data-playing={playing || free.recording} ref={score.scrollRef}>
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
          {score.status === 'empty' && (
            <p className="score-msg">
              {free.recording
                ? '弾いてください。止めると譜面になります。'
                : '「録音を開始」を押して弾いてみてください。'}
            </p>
          )}
        </div>

        {tab === 'practice' ? (
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
        ) : (
          <div className="score-controls">
            <span className="score-count">
              {free.recording
                ? `録音中 ${free.elapsed.toFixed(1)}秒`
                : free.piece
                  ? `${free.piece.noteCount}音 · ${KEY_NAMES[free.piece.fifths]}`
                  : '未録音'}
            </span>
            <select
              className="mini"
              value={freeKey === null ? 'auto' : String(freeKey)}
              onChange={(e) => setFreeKey(e.target.value === 'auto' ? null : Number(e.target.value))}
              disabled={free.recording}
              aria-label="調号"
            >
              <option value="auto">調号 自動</option>
              {Object.keys(KEY_NAMES).map((k) => (
                <option key={k} value={k}>
                  {KEY_NAMES[k]}
                </option>
              ))}
            </select>
            <button className="mini" onClick={free.clear} disabled={free.recording || !free.piece}>
              消す
            </button>
            <button className="mini" onClick={saveXml} disabled={free.recording || !free.piece}>
              MusicXML
            </button>
          </div>
        )}

        {tab === 'practice' && session.summary && session.phase === 'done' && (
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
          {tab === 'free' ? (
            <>
              弾いた音をそのまま譜面に起こします。テンポと拍子を変えると採譜し直すので、
              リズムが合わないときは値を動かしてみてください。同じ音を続けて弾くと1つの長い音に
              なります（弓の切り返しまでは見ていません）。
            </>
          ) : (
            <>
              緑＝合格、<span className="sw-high">赤＝高い</span>、
              <span className="sw-low">青＝低い</span>、灰＝鳴っていない。
              音符の上に外れ幅（▲▼と半音／セント）が付きます。
            </>
          )}
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
          鳴らしながら録るとリズムが揃います。クリック音を拾わせたくなければイヤホンをどうぞ。
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
            {tab === 'practice' && (playing || session.phase === 'armed')
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
          <button className="mic" data-phase={micPhase} onClick={onPrimary}>
            {primaryLabel}
          </button>
          {tab === 'practice' && (
            <button className="reset" onClick={session.reset} disabled={busy}>
              戻す
            </button>
          )}
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

/* タブ */
.tabs {
  margin-top: 14px;
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--paper-2);
  border-radius: 12px;
}
.tabs button {
  flex: 1;
  padding: 9px 6px;
  border: 0;
  border-radius: 9px;
  background: none;
  color: var(--ink-60);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s, color .15s;
}
.tabs button[data-on="true"] {
  background: var(--paper);
  color: var(--accent);
  box-shadow: 0 1px 3px rgba(16,19,28,.1);
}
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
  padding: 0 28px;
  text-align: center;
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-30);
  background: var(--paper);
  border-radius: 14px;
}
.score-msg.error { color: var(--high); }

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
  flex: 1;
}
.mini {
  font-size: 12px;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
  white-space: nowrap;
}
.mini:disabled { color: var(--ink-30); cursor: default; }
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
.beat[data-on="true"] { background: var(--accent); border-color: var(--accent); transform: scale(1.35); }
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
  .tabs { margin-top: 0; padding: 3px; gap: 2px; }
  .tabs button { padding: 5px 10px; font-size: 11px; }
  .songs-select { display: block; margin-left: auto; }
  .songs-select select {
    font-size: 12px; padding: 5px 8px; border: 1px solid var(--line);
    border-radius: 8px; background: var(--paper); color: var(--ink); max-width: 34vw;
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
  .score-controls .mini { padding: 5px 8px; font-size: 11px; }
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
