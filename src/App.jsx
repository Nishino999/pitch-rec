import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PitchDetector } from 'pitchy'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'

/* ============================================================
 *  pitch-rec — Step 2.5: 横画面レイアウト対応
 *  - 縦：譜面が主役の1カラム
 *  - 横（スマホ横持ち）：譜面を全幅で大きく、右にチューナーを寄せる
 *    向きが変わったら zoom を変えて再描画し、先の小節まで見えるようにする
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

function freqToMidiFloat(freq, a4) {
  return 69 + 12 * Math.log2(freq / a4)
}

/* ---------- デモ曲（すべてパブリックドメイン） ----------
 * n = 音名, d = 4分音符を1とした長さ
 * time = 拍子, fifths = 調号(#の数), pickup = 弱起の拍数
 */
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
 *  MusicXML 生成
 *  4分音符 = divisions(4)。拍子ごとに小節へ詰めていく。
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
  const barLength = beats * (4 / beatType) // 4分音符換算の1小節
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

const COLOR_DEFAULT = '#10131c'
const COLOR_WRONG = '#d5342b'

/* 縦横で譜面の拡大率を変える。横は小さめにして先の小節まで入れる */
const ZOOM = { portrait: 0.72, landscape: 0.58 }

function median(arr) {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/* ============================================================
 *  画面の向き（スマホ横持ちだけを landscape とみなす）
 *  CSS 側の @media (orientation: landscape) and (max-height: 560px) と対で使う
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
 *  ピッチ検出フック
 * ============================================================ */
function usePitch(a4) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const [reading, setReading] = useState(null)
  const [level, setLevel] = useState(0)

  const ctxRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef = useRef(null)
  const bufRef = useRef([])
  const lastOkRef = useRef(0)
  const a4Ref = useRef(a4)
  a4Ref.current = a4

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    ctxRef.current?.close()
    ctxRef.current = null
    streamRef.current = null
    bufRef.current = []
    setReading(null)
    setLevel(0)
    setRunning(false)
  }, [])

  const start = useCallback(async () => {
    setError(null)
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

      const tick = () => {
        rafRef.current = requestAnimationFrame(tick)
        analyser.getFloatTimeDomainData(input)

        let sum = 0
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
        const rms = Math.sqrt(sum / input.length)
        setLevel(Math.min(1, rms * 12))

        if (rms < RMS_MIN) {
          if (performance.now() - lastOkRef.current > HOLD_MS) {
            bufRef.current = []
            setReading(null)
          }
          return
        }

        const [freq, clarity] = detector.findPitch(input, ctx.sampleRate)
        if (!freq || clarity < CLARITY_MIN || freq < MIN_HZ || freq > MAX_HZ) {
          if (performance.now() - lastOkRef.current > HOLD_MS) {
            bufRef.current = []
            setReading(null)
          }
          return
        }

        bufRef.current.push(freq)
        if (bufRef.current.length > 5) bufRef.current.shift()
        const f = median(bufRef.current)

        const midiFloat = freqToMidiFloat(f, a4Ref.current)
        const midi = Math.round(midiFloat)
        const cents = Math.round((midiFloat - midi) * 100)
        const { name, octave } = midiToName(midi)

        lastOkRef.current = performance.now()
        setReading({ freq: f, midi, cents, name, octave, clarity })
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

  useEffect(() => () => stop(), [stop])

  return { running, error, reading, level, start, stop }
}

/* ============================================================
 *  楽譜（OpenSheetMusicDisplay）
 * ============================================================ */
function useScore(song, mode) {
  const hostRef = useRef(null)
  const osmdRef = useRef(null)
  const notesRef = useRef([])
  const indexRef = useRef(0)
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [index, setIndex] = useState(0)
  const [total, setTotal] = useState(0)
  const [wrong, setWrong] = useState(() => new Set())
  const modeRef = useRef(mode)
  modeRef.current = mode

  /* カーソルを i 番目の音符へ置く */
  const placeCursor = useCallback((i) => {
    const osmd = osmdRef.current
    if (!osmd?.cursor) return
    try {
      osmd.cursor.reset()
      for (let k = 0; k < i; k++) osmd.cursor.next()
      osmd.cursor.show()
    } catch {
      /* 再描画中は無視 */
    }
  }, [])

  /* 読み込み（曲が変わったときだけ） */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false

    setStatus('loading')
    setIndex(0)
    indexRef.current = 0
    setWrong(new Set())
    host.innerHTML = ''

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
      cursorsOptions: [{ type: 0, color: '#25327a', alpha: 0.2, follow: true }],
    })
    osmdRef.current = osmd

    osmd
      .load(buildMusicXML(song))
      .then(() => {
        if (cancelled) return
        osmd.zoom = ZOOM[modeRef.current]
        osmd.render()
        notesRef.current = flattenNotes(osmd)
        setTotal(notesRef.current.length)
        osmd.cursor.show()
        setStatus('ready')
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
    }
  }, [song])

  /* 向きが変わったら拡大率を変えて描き直す */
  useEffect(() => {
    const osmd = osmdRef.current
    if (!osmd || status !== 'ready') return
    const id = requestAnimationFrame(() => {
      try {
        osmd.zoom = ZOOM[mode]
        osmd.render()
        placeCursor(indexRef.current)
      } catch (e) {
        console.error('[osmd resize]', e)
      }
    })
    return () => cancelAnimationFrame(id)
  }, [mode, status, placeCursor])

  /* OSMD の自動リサイズ後にカーソルが消えるので置き直す */
  useEffect(() => {
    let timer
    const onResize = () => {
      clearTimeout(timer)
      timer = setTimeout(() => placeCursor(indexRef.current), 300)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      clearTimeout(timer)
    }
  }, [placeCursor])

  const move = useCallback(
    (delta) => {
      const max = Math.max(0, notesRef.current.length - 1)
      const next = Math.min(max, Math.max(0, indexRef.current + delta))
      indexRef.current = next
      placeCursor(next)
      setIndex(next)
    },
    [placeCursor]
  )

  /* 間違い印（赤）の付け外し。色を変えたら再描画が必要 */
  const toggleWrong = useCallback(() => {
    const osmd = osmdRef.current
    if (!osmd) return
    const at = indexRef.current
    const next = new Set(wrong)
    if (next.has(at)) next.delete(at)
    else next.add(at)

    notesRef.current.forEach((note, i) => {
      const color = next.has(i) ? COLOR_WRONG : COLOR_DEFAULT
      note.NoteheadColor = color
      note.StemColorXml = color
    })
    osmd.render()
    placeCursor(at)
    setWrong(next)
  }, [wrong, placeCursor])

  return { hostRef, status, index, total, wrong, move, toggleWrong }
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
 *  アプリ本体
 * ============================================================ */
export default function App() {
  const [songId, setSongId] = useState(SONGS[0].id)
  const [a4, setA4] = useState(440)
  const song = useMemo(() => SONGS.find((s) => s.id === songId), [songId])

  const mode = useLayoutMode()
  const { running, error, reading, level, start, stop } = usePitch(a4)
  const score = useScore(song, mode)

  const active = running && !!reading
  const inTune = active && Math.abs(reading.cents) <= IN_TUNE_CENTS
  const targetNote = song.notes[score.index]?.n ?? '—'

  return (
    <div className="app" data-state={!active ? 'idle' : inTune ? 'ok' : 'off'} data-mode={mode}>
      <style>{CSS}</style>

      <header className="head">
        <h1>
          <span className="clef">𝄞</span> pitch-rec
        </h1>
        <p className="head-sub">単音・リアルタイム音程チェック</p>
        {/* 横画面ではカードの代わりにこれを出す */}
        <label className="songs-select">
          <select value={songId} onChange={(e) => setSongId(e.target.value)} aria-label="曲を選ぶ">
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

        <div className="score">
          <div ref={score.hostRef} className="score-host" />
          {score.status === 'loading' && <p className="score-msg">楽譜を組み立てています…</p>}
          {score.status === 'error' && (
            <p className="score-msg error">
              楽譜を表示できませんでした。ページを再読み込みしてください。
            </p>
          )}
        </div>

        <div className="score-controls">
          <span className="score-count">
            {score.status === 'ready' ? `${score.index + 1} / ${score.total}` : '…'}
          </span>
          <button onClick={() => score.move(-1)} disabled={score.index === 0}>
            前の音
          </button>
          <button onClick={() => score.move(1)} disabled={score.index >= score.total - 1}>
            次の音
          </button>
          <button
            className="ghost"
            data-on={score.wrong.has(score.index)}
            onClick={score.toggleWrong}
          >
            {score.wrong.has(score.index) ? '赤を消す' : '赤くする'}
          </button>
        </div>
        <p className="hint rotate-hint">
          横向きにすると譜面が広がり、先の小節まで見えます。カーソル移動は今のところ手動です。
        </p>
      </section>

      {/* 下（横画面では右）：マイクと音名 */}
      <section className="block readout-block">
        <div className="readout">
          <div className="note">
            <span className="note-name">
              {active ? reading.name.replace('#', '') : '—'}
              {active && reading.name.includes('#') && <sup>♯</sup>}
            </span>
            <span className="note-oct">{active ? reading.octave : ''}</span>
          </div>
          <div className="freq">
            {active
              ? `${reading.freq.toFixed(1)} Hz　／　譜面 ${targetNote}`
              : running
                ? '音を待っています'
                : 'マイクは停止中'}
          </div>
        </div>

        <TunerMeter cents={reading?.cents ?? 0} active={active} />

        <div className="level" aria-hidden="true">
          <div className="level-bar" style={{ width: `${Math.round(level * 100)}%` }} />
        </div>

        {error && <p className="error">{error}</p>}

        <div className="controls">
          <button className="mic" data-on={running} onClick={running ? stop : start}>
            {running ? 'マイクを止める' : 'マイクを使って始める'}
          </button>
          <label className="a4">
            <span>基準 A</span>
            <select value={a4} onChange={(e) => setA4(Number(e.target.value))}>
              <option value={440}>440 Hz</option>
              <option value={441}>441 Hz</option>
              <option value={442}>442 Hz</option>
              <option value={443}>443 Hz</option>
            </select>
          </label>
        </div>
      </section>

      <footer className="foot">
        <span>データは端末の中だけで処理され、どこにも送信されません。</span>
      </footer>
    </div>
  )
}

/* ============================================================
 *  スタイル（白基調＋インクブルー1色 / 正解=緑・不正解=赤）
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
}
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
.score-controls button {
  flex: 1;
  padding: 10px 4px;
  font-size: 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
}
.score-controls button:disabled { color: var(--ink-30); cursor: default; }
.score-controls .ghost { color: var(--off); border-color: #f0d5d3; }
.score-controls .ghost[data-on="true"] { background: var(--off); border-color: var(--off); color: #fff; }

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

.controls { margin-top: 18px; display: flex; align-items: center; gap: 12px; }
.mic {
  flex: 1; padding: 15px; border: 0; border-radius: 12px;
  background: var(--accent); color: #fff; font-size: 15px; font-weight: 600; cursor: pointer;
}
.mic[data-on="true"] { background: var(--ink); }
.a4 { font-size: 11px; color: var(--ink-60); display: flex; flex-direction: column; gap: 3px; }
.a4 select {
  font-size: 13px; padding: 6px 4px; border: 1px solid var(--line);
  border-radius: 8px; background: var(--paper); color: var(--ink);
}
.error { margin: 14px 0 0; font-size: 12px; color: var(--off); line-height: 1.6; }
.foot { font-size: 11px; color: var(--ink-30); text-align: center; }

button:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }

/* ============================================================
 *  横画面（スマホ横持ち）
 *  譜面を左いっぱいに広げ、チューナーは右の細い柱にまとめる
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
    grid-template-columns: minmax(0, 1fr) 180px;
    grid-template-rows: auto minmax(0, 1fr);
    column-gap: 14px;
    row-gap: 6px;
    overflow: hidden;
  }

  /* ヘッダーは1行に圧縮。曲選択はここのセレクトへ */
  .head {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .head h1 { font-size: 15px; }
  .head .clef { font-size: 18px; }
  .head-sub { display: none; }
  .songs-select { display: block; margin-left: auto; }
  .songs-select select {
    font-size: 12px;
    padding: 5px 8px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--paper);
    color: var(--ink);
    max-width: 46vw;
  }

  /* 縦向き専用の要素は畳む */
  .songs, .foot, .rotate-hint, .label { display: none; }

  /* 譜面 */
  .score-area {
    grid-column: 1;
    grid-row: 2;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .score {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    border-radius: 10px;
    padding: 6px 4px;
  }
  .score-controls { margin-top: 6px; gap: 6px; }
  .score-controls button { padding: 7px 2px; font-size: 11px; }
  .score-count { font-size: 11px; padding: 0 8px; }

  /* 右の柱 */
  .readout-block {
    grid-column: 2;
    grid-row: 2;
    min-height: 0;
    border-top: 0;
    padding-top: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .note-name { font-size: 46px; }
  .note-name sup { font-size: 20px; }
  .note-oct { font-size: 18px; }
  .freq { margin-top: 2px; font-size: 10px; }
  .meter { margin-top: 12px; }
  .meter-scale { height: 26px; }
  .meter-labels { font-size: 9px; margin-top: 4px; }
  .level { margin-top: 8px; }
  .controls {
    margin-top: 12px;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .mic { padding: 11px; font-size: 13px; border-radius: 10px; }
  .a4 { flex-direction: row; align-items: center; justify-content: space-between; }
  .error { margin-top: 8px; font-size: 10px; }
}
`
