import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PitchDetector } from 'pitchy'

/* ============================================================
 *  Violin Practice — Step 1: リアルタイム・チューナー + 全体UI
 *  - マイク入力 → pitchy で基本周波数 → 音名 / セント誤差を表示
 *  - 楽譜（OpenSheetMusicDisplay）と判定は Step 2 以降で差し込む
 *  - 保存は一切なし。すべてブラウザ内で完結。
 * ============================================================ */

/* ---------- 音名ユーティリティ ---------- */
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function noteToMidi(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name)
  if (!m) return null
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]]
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
  return (Number(m[3]) + 1) * 12 + base + acc
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
 * Step 2 でこの配列から MusicXML を生成して OSMD に流し込む。
 */
const SONGS = [
  {
    id: 'twinkle',
    title: 'きらきら星',
    subtitle: 'フランス民謡 / Suzuki Vol.1',
    key: 'A major',
    bpm: 88,
    level: '入門',
    note: '全音符が単音・テンポも遅い。判定の動作確認に最適。',
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
    key: 'D major',
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
    key: 'D major',
    bpm: 72,
    level: '初級',
    note: '伸ばす音が多い＝音程の安定を見せる曲。',
    notes: [
      { n: 'A3', d: 1 },
      { n: 'D4', d: 2 }, { n: 'F#4', d: 0.5 }, { n: 'D4', d: 0.5 }, { n: 'F#4', d: 2 },
      { n: 'E4', d: 1 }, { n: 'D4', d: 2 }, { n: 'B3', d: 1 }, { n: 'A3', d: 3 },
      { n: 'A3', d: 1 }, { n: 'D4', d: 2 }, { n: 'F#4', d: 0.5 }, { n: 'D4', d: 0.5 },
      { n: 'F#4', d: 2 }, { n: 'E4', d: 1 }, { n: 'A4', d: 3 },
    ],
  },
  {
    id: 'minuet',
    title: 'メヌエット ト長調',
    subtitle: 'ペツォールト（旧 J.S.バッハ作とされた曲）',
    key: 'G major',
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

/* ---------- 検出パラメータ ---------- */
const MIN_HZ = 170        // G3(196Hz) の少し下まで
const MAX_HZ = 3200       // E7 あたりまで
const CLARITY_MIN = 0.88  // pitchy の信頼度しきい値
const RMS_MIN = 0.008     // 無音ゲート
const HOLD_MS = 350       // 音が切れても表示を保持する時間
const IN_TUNE_CENTS = 8   // ±これ以内なら「合っている」

/* ---------- 中央値フィルタ ---------- */
function median(arr) {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/* ============================================================
 *  ピッチ検出フック
 * ============================================================ */
function usePitch(a4) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const [reading, setReading] = useState(null) // { freq, midi, cents, name, octave, clarity, level }
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
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
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

function NoteStrip({ song }) {
  return (
    <div className="strip" aria-label="この曲の音の並び">
      {song.notes.map((nt, i) => (
        <span key={i} className="strip-note" style={{ flexGrow: nt.d }}>
          {nt.n.replace(/(\d)$/, '')}
          <em>{nt.n.slice(-1)}</em>
        </span>
      ))}
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
  const { running, error, reading, level, start, stop } = usePitch(a4)

  const active = running && !!reading
  const inTune = active && Math.abs(reading.cents) <= IN_TUNE_CENTS

  return (
    <div className="app" data-state={!active ? 'idle' : inTune ? 'ok' : 'off'}>
      <style>{CSS}</style>

      <header className="head">
        <h1>
          <span className="clef">𝄞</span> Violin Practice
        </h1>
        <p className="head-sub">単音・リアルタイム音程チェック</p>
      </header>

      {/* 上：曲を選ぶ */}
      <section className="block">
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
                {s.key} · ♩= {s.bpm}
              </span>
            </button>
          ))}
        </div>
        <p className="hint">{song.note}</p>
      </section>

      {/* 真ん中：楽譜 */}
      <section className="block score-block">
        <h2 className="label">
          楽譜
          <span className="tag">Step 2 で表示</span>
        </h2>
        <div className="score" id="osmd-container">
          <div className="score-empty">
            <p className="score-empty-title">{song.title}</p>
            <p className="score-empty-body">
              ここに五線譜が入ります。いまは音の並びだけ先に表示しています。
            </p>
            <NoteStrip song={song} />
          </div>
        </div>
      </section>

      {/* 下：マイクと音名 */}
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
            {active ? `${reading.freq.toFixed(1)} Hz` : running ? '音を待っています' : 'マイクは停止中'}
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
            基準 A
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

/* header */
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

/* section label */
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
.tag {
  font-weight: 500;
  letter-spacing: 0;
  font-size: 10px;
  color: var(--accent);
  background: #eef0f9;
  border-radius: 999px;
  padding: 2px 8px;
}

/* song cards */
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
.card[data-on="true"] {
  border-color: var(--accent);
  background: #f7f8fd;
}
.card-level {
  font-size: 10px;
  color: var(--accent);
  letter-spacing: .08em;
}
.card-title {
  font-family: Iowan Old Style, "Times New Roman", serif;
  font-size: 16px;
  font-weight: 600;
}
.card-sub { font-size: 11px; color: var(--ink-60); }
.card-meta { font-size: 11px; color: var(--ink-30); margin-top: 2px; }
.hint { margin: 10px 2px 0; font-size: 12px; color: var(--ink-60); line-height: 1.6; }

/* score */
.score {
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--paper);
  min-height: 200px;
  padding: 18px 14px;
  display: flex;
  align-items: center;
}
.score-empty { width: 100%; }
.score-empty-title {
  margin: 0 0 4px;
  font-family: Iowan Old Style, "Times New Roman", serif;
  font-size: 18px;
}
.score-empty-body { margin: 0 0 16px; font-size: 12px; color: var(--ink-60); line-height: 1.6; }
.strip { display: flex; gap: 3px; align-items: flex-end; }
.strip-note {
  min-width: 0;
  padding: 8px 0 6px;
  text-align: center;
  font-family: Iowan Old Style, "Times New Roman", serif;
  font-size: 12px;
  border-top: 2px solid var(--line);
  color: var(--ink-60);
}
.strip-note em { font-style: normal; font-size: 9px; color: var(--ink-30); }

/* readout */
.readout-block {
  border-top: 1px solid var(--line);
  padding-top: 22px;
}
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
.freq {
  margin-top: 6px;
  font-size: 12px;
  color: var(--ink-60);
  font-variant-numeric: tabular-nums;
}

/* meter */
.meter { margin-top: 22px; }
.meter-scale {
  position: relative;
  height: 44px;
  border-bottom: 1px solid var(--line);
}
.tick {
  position: absolute;
  bottom: 0;
  width: 1px;
  height: 8px;
  background: var(--ink-30);
  transform: translateX(-50%);
}
.tick[data-center="true"] { height: 44px; background: var(--line); }
.meter-zone {
  position: absolute;
  bottom: 0;
  left: 42%;
  width: 16%;
  height: 44px;
  background: rgba(15,138,69,.07);
}
.needle {
  position: absolute;
  bottom: 0;
  width: 2px;
  height: 44px;
  background: var(--ink-30);
  transform: translateX(-50%);
  transition: left .07s linear, background .12s;
  border-radius: 1px;
}
.meter[data-state="ok"] .needle { background: var(--ok); }
.meter[data-state="off"] .needle { background: var(--off); }
.meter-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 7px;
  font-size: 11px;
  color: var(--ink-30);
}
.cents { color: var(--ink-60); font-variant-numeric: tabular-nums; }

/* input level */
.level {
  margin-top: 16px;
  height: 3px;
  background: var(--paper-2);
  border-radius: 2px;
  overflow: hidden;
}
.level-bar { height: 100%; background: var(--accent); opacity: .35; transition: width .08s linear; }

/* controls */
.controls {
  margin-top: 18px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.mic {
  flex: 1;
  padding: 15px;
  border: 0;
  border-radius: 12px;
  background: var(--accent);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
.mic[data-on="true"] { background: var(--ink); }
.a4 {
  font-size: 11px;
  color: var(--ink-60);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.a4 select {
  font-size: 13px;
  padding: 6px 4px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink);
}
.error {
  margin: 14px 0 0;
  font-size: 12px;
  color: var(--off);
  line-height: 1.6;
}
.foot { font-size: 11px; color: var(--ink-30); text-align: center; }

button:focus-visible, select:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}
`
