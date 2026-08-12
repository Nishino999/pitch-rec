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
 *  pitch-rec — Step 6
 *  タブは3つ
 *   ・練習       … デモ曲を弾いて判定してもらう
 *   ・フリー演奏  … 弾いた音を録って譜面に起こす
 *   ・チューニング … アナログ針の調弦メーター（バイオリン／発声）
 * ============================================================ */

/* ---------- 音名ユーティリティ ---------- */
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/* 固定ド（ドは常に C）の日本語表記。黒鍵は ♯ / ♭ の両方を持つ */
const JP_NAMES = [
  { sharp: 'ド', flat: null },
  { sharp: 'ド♯', flat: 'レ♭' },
  { sharp: 'レ', flat: null },
  { sharp: 'レ♯', flat: 'ミ♭' },
  { sharp: 'ミ', flat: null },
  { sharp: 'ファ', flat: null },
  { sharp: 'ファ♯', flat: 'ソ♭' },
  { sharp: 'ソ', flat: null },
  { sharp: 'ソ♯', flat: 'ラ♭' },
  { sharp: 'ラ', flat: null },
  { sharp: 'ラ♯', flat: 'シ♭' },
  { sharp: 'シ', flat: null },
]

/* 1オクターブぶんの鍵盤の並び。x は白鍵の幅を 1 とした位置 */
const WHITE_PC = [0, 2, 4, 5, 7, 9, 11]
const BLACK_PC = [
  { pc: 1, after: 0 },
  { pc: 3, after: 1 },
  { pc: 6, after: 3 },
  { pc: 8, after: 4 },
  { pc: 10, after: 5 },
]

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

function midiToLabelIn(midi, fifths) {
  const n = Math.round(midi)
  const pc = ((n % 12) + 12) % 12
  const octave = Math.floor(n / 12) - 1
  return `${(fifths < 0 ? FLAT_NAMES : SHARP_NAMES)[pc]}${octave}`
}

function freqToMidiFloat(freq, a4) {
  return 69 + 12 * Math.log2(freq / a4)
}

function midiToFreq(midi, a4) {
  return a4 * Math.pow(2, (midi - 69) / 12)
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

/* ---------- バイオリンの開放弦 ---------- */
const STRINGS = [
  { id: 'E', label: 'E', num: '1弦', ja: 'ミ', note: 'E5' },
  { id: 'A', label: 'A', num: '2弦', ja: 'ラ', note: 'A4' },
  { id: 'D', label: 'D', num: '3弦', ja: 'レ', note: 'D4' },
  { id: 'G', label: 'G', num: '4弦', ja: 'ソ', note: 'G3' },
].map((s) => ({ ...s, midi: noteToMidi(s.note) }))

/* ---------- 第1ポジションの指板 ----------
 * 開放弦から半音いくつ上か（0＝開放）。1指と2指と3指はそれぞれ低い／高い の2か所を取る。
 */
const FRETS = [
  { offset: 0, finger: 0 },
  { offset: 1, finger: 1 },
  { offset: 2, finger: 1 },
  { offset: 3, finger: 2 },
  { offset: 4, finger: 2 },
  { offset: 5, finger: 3 },
  { offset: 6, finger: 3 },
  { offset: 7, finger: 4 },
]

/* ある音を第1ポジションのどこで取るか。
 * 高い弦から順に見て、最初に届いた場所を選ぶ（＝いちばん低い指使い） */
function fretFor(midi) {
  for (let row = 0; row < STRINGS.length; row++) {
    const off = midi - STRINGS[row].midi
    if (off >= 0 && off <= 7) return { row, col: off, midi }
  }
  return null
}

const FINGERS = [
  { id: 0, mark: '⓪', name: '押さえない', short: '開放' },
  { id: 1, mark: '①', name: '人差し指', short: '人差指' },
  { id: 2, mark: '②', name: '中指', short: '中指' },
  { id: 3, mark: '③', name: '薬指', short: '薬指' },
  { id: 4, mark: '④', name: '小指', short: '小指' },
]

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

  /* ---------- 追加のデモ曲（いずれもパブリックドメイン） ---------- */
  {
    id: 'lightlyrow',
    title: 'ちょうちょう',
    subtitle: 'ドイツ民謡 / Lightly Row',
    keyName: 'イ長調',
    fifths: 3,
    time: { beats: 4, beatType: 4 },
    pickup: 0,
    bpm: 92,
    level: '入門',
    note: '同じ形が繰り返される。A線とE線だけで弾ける。',
    notes: [
      { n: 'E5', d: 1 }, { n: 'C#5', d: 1 }, { n: 'C#5', d: 2 },
      { n: 'D5', d: 1 }, { n: 'B4', d: 1 }, { n: 'B4', d: 2 },
      { n: 'A4', d: 1 }, { n: 'B4', d: 1 }, { n: 'C#5', d: 1 }, { n: 'D5', d: 1 },
      { n: 'E5', d: 1 }, { n: 'E5', d: 1 }, { n: 'E5', d: 2 },
      { n: 'E5', d: 1 }, { n: 'C#5', d: 1 }, { n: 'C#5', d: 2 },
      { n: 'D5', d: 1 }, { n: 'B4', d: 1 }, { n: 'B4', d: 2 },
      { n: 'A4', d: 1 }, { n: 'C#5', d: 1 }, { n: 'E5', d: 1 }, { n: 'E5', d: 1 },
      { n: 'C#5', d: 1 }, { n: 'A4', d: 1 }, { n: 'A4', d: 2 },
    ],
  },
  {
    id: 'mary',
    title: 'メリーさんのひつじ',
    subtitle: 'アメリカ童謡',
    keyName: 'ニ長調',
    fifths: 2,
    time: { beats: 4, beatType: 4 },
    pickup: 0,
    bpm: 96,
    level: '入門',
    note: 'D線だけでほぼ弾ける。指の並びを覚えるのに最適。',
    notes: [
      { n: 'F#4', d: 1 }, { n: 'E4', d: 1 }, { n: 'D4', d: 1 }, { n: 'E4', d: 1 },
      { n: 'F#4', d: 1 }, { n: 'F#4', d: 1 }, { n: 'F#4', d: 2 },
      { n: 'E4', d: 1 }, { n: 'E4', d: 1 }, { n: 'E4', d: 2 },
      { n: 'F#4', d: 1 }, { n: 'A4', d: 1 }, { n: 'A4', d: 2 },
      { n: 'F#4', d: 1 }, { n: 'E4', d: 1 }, { n: 'D4', d: 1 }, { n: 'E4', d: 1 },
      { n: 'F#4', d: 1 }, { n: 'F#4', d: 1 }, { n: 'F#4', d: 1 }, { n: 'F#4', d: 1 },
      { n: 'E4', d: 1 }, { n: 'E4', d: 1 }, { n: 'F#4', d: 1 }, { n: 'E4', d: 1 },
      { n: 'D4', d: 4 },
    ],
  },
  {
    id: 'frog',
    title: 'かえるの合唱',
    subtitle: 'ドイツ民謡',
    keyName: 'ト長調',
    fifths: 1,
    time: { beats: 4, beatType: 4 },
    pickup: 0,
    bpm: 104,
    level: '入門',
    note: '順に上がって下りるだけ。八分音符の練習にもなる。',
    notes: [
      { n: 'G4', d: 1 }, { n: 'A4', d: 1 }, { n: 'B4', d: 1 }, { n: 'C5', d: 1 },
      { n: 'B4', d: 1 }, { n: 'A4', d: 1 }, { n: 'G4', d: 2 },
      { n: 'B4', d: 1 }, { n: 'C5', d: 1 }, { n: 'D5', d: 1 }, { n: 'E5', d: 1 },
      { n: 'D5', d: 1 }, { n: 'C5', d: 1 }, { n: 'B4', d: 2 },
      { n: 'G4', d: 2 }, { n: 'G4', d: 2 },
      { n: 'G4', d: 0.5 }, { n: 'G4', d: 0.5 }, { n: 'A4', d: 0.5 }, { n: 'A4', d: 0.5 },
      { n: 'B4', d: 0.5 }, { n: 'B4', d: 0.5 }, { n: 'C5', d: 0.5 }, { n: 'C5', d: 0.5 },
      { n: 'B4', d: 1 }, { n: 'A4', d: 1 }, { n: 'G4', d: 2 },
    ],
  },
  {
    id: 'londonbridge',
    title: 'ロンドン橋',
    subtitle: 'イギリス童謡',
    keyName: 'ニ長調',
    fifths: 2,
    time: { beats: 4, beatType: 4 },
    pickup: 0,
    bpm: 100,
    level: '入門',
    note: '隣り合う音の行き来が多く、指の移動が小さい。',
    notes: [
      { n: 'A4', d: 1 }, { n: 'B4', d: 1 }, { n: 'A4', d: 1 }, { n: 'G4', d: 1 },
      { n: 'F#4', d: 1 }, { n: 'G4', d: 1 }, { n: 'A4', d: 2 },
      { n: 'E4', d: 1 }, { n: 'F#4', d: 1 }, { n: 'G4', d: 2 },
      { n: 'F#4', d: 1 }, { n: 'G4', d: 1 }, { n: 'A4', d: 2 },
      { n: 'A4', d: 1 }, { n: 'B4', d: 1 }, { n: 'A4', d: 1 }, { n: 'G4', d: 1 },
      { n: 'F#4', d: 1 }, { n: 'G4', d: 1 }, { n: 'A4', d: 2 },
      { n: 'E4', d: 2 }, { n: 'A4', d: 1 }, { n: 'F#4', d: 1 },
      { n: 'D4', d: 4 },
    ],
  },
  {
    id: 'longlongago',
    title: 'ロング・ロング・アゴー',
    subtitle: 'T.H.ベイリー / 1833年',
    keyName: 'ニ長調',
    fifths: 2,
    time: { beats: 4, beatType: 4 },
    pickup: 0,
    bpm: 84,
    level: '初級',
    note: '鈴木教本でおなじみ。息の長い旋律で弓の配分を覚える。',
    notes: [
      { n: 'A4', d: 1 }, { n: 'F#4', d: 1 }, { n: 'G4', d: 1 }, { n: 'A4', d: 1 },
      { n: 'D5', d: 2 }, { n: 'D5', d: 1 }, { n: 'C#5', d: 1 },
      { n: 'B4', d: 1 }, { n: 'A4', d: 1 }, { n: 'B4', d: 1 }, { n: 'C#5', d: 1 },
      { n: 'D5', d: 4 },
      { n: 'A4', d: 1 }, { n: 'F#4', d: 1 }, { n: 'G4', d: 1 }, { n: 'A4', d: 1 },
      { n: 'D5', d: 2 }, { n: 'D5', d: 1 }, { n: 'C#5', d: 1 },
      { n: 'B4', d: 1 }, { n: 'A4', d: 1 }, { n: 'G4', d: 1 }, { n: 'F#4', d: 1 },
      { n: 'E4', d: 4 },
    ],
  },
  {
    id: 'saints',
    title: '聖者の行進',
    subtitle: 'アメリカ黒人霊歌',
    keyName: 'ニ長調',
    fifths: 2,
    time: { beats: 4, beatType: 4 },
    pickup: 3,
    bpm: 108,
    level: '初級',
    note: '3拍の弱起から始まる。拍の頭を意識する練習に。',
    notes: [
      { n: 'D4', d: 1 }, { n: 'F#4', d: 1 }, { n: 'G4', d: 1 },
      { n: 'A4', d: 4 },
      { n: 'D4', d: 1 }, { n: 'F#4', d: 1 }, { n: 'G4', d: 1 }, { n: 'A4', d: 1 },
      { n: 'A4', d: 2 }, { n: 'F#4', d: 1 }, { n: 'D4', d: 1 },
      { n: 'F#4', d: 2 }, { n: 'E4', d: 2 },
      { n: 'D4', d: 1 }, { n: 'F#4', d: 1 }, { n: 'F#4', d: 1 }, { n: 'E4', d: 1 },
      { n: 'D4', d: 2 }, { n: 'D4', d: 1 }, { n: 'F#4', d: 1 },
      { n: 'A4', d: 2 }, { n: 'G4', d: 2 },
      { n: 'F#4', d: 2 }, { n: 'D4', d: 1 }, { n: 'E4', d: 1 },
      { n: 'D4', d: 4 },
    ],
  },
  {
    id: 'jingle',
    title: 'ジングルベル',
    subtitle: 'J.ピアポント / 1857年',
    keyName: 'ニ長調',
    fifths: 2,
    time: { beats: 4, beatType: 4 },
    pickup: 0,
    bpm: 116,
    level: '初級',
    note: '同じ音の連打が多い。弓を細かく返す練習になる。',
    notes: [
      { n: 'F#4', d: 1 }, { n: 'F#4', d: 1 }, { n: 'F#4', d: 2 },
      { n: 'F#4', d: 1 }, { n: 'F#4', d: 1 }, { n: 'F#4', d: 2 },
      { n: 'F#4', d: 1 }, { n: 'A4', d: 1 }, { n: 'D4', d: 1 }, { n: 'E4', d: 1 },
      { n: 'F#4', d: 4 },
      { n: 'G4', d: 1 }, { n: 'G4', d: 1 }, { n: 'G4', d: 1 }, { n: 'G4', d: 1 },
      { n: 'G4', d: 1 }, { n: 'F#4', d: 1 }, { n: 'F#4', d: 1 },
      { n: 'F#4', d: 0.5 }, { n: 'F#4', d: 0.5 },
      { n: 'F#4', d: 1 }, { n: 'E4', d: 1 }, { n: 'E4', d: 1 }, { n: 'F#4', d: 1 },
      { n: 'E4', d: 2 }, { n: 'A4', d: 2 },
    ],
  },
  {
    id: 'auldlang',
    title: '蛍の光',
    subtitle: 'スコットランド民謡 / Auld Lang Syne',
    keyName: 'ト長調',
    fifths: 1,
    time: { beats: 4, beatType: 4 },
    pickup: 1,
    bpm: 76,
    level: '初級',
    note: '付点のリズムが要。弱起で始まる。',
    notes: [
      { n: 'D4', d: 1 },
      { n: 'G4', d: 1.5 }, { n: 'F#4', d: 0.5 }, { n: 'G4', d: 1 }, { n: 'B4', d: 1 },
      { n: 'A4', d: 3 }, { n: 'A4', d: 1 },
      { n: 'B4', d: 1.5 }, { n: 'A4', d: 0.5 }, { n: 'G4', d: 1 }, { n: 'B4', d: 1 },
      { n: 'D5', d: 3 }, { n: 'E5', d: 1 },
      { n: 'E5', d: 1.5 }, { n: 'D5', d: 0.5 }, { n: 'B4', d: 1 }, { n: 'G4', d: 1 },
      { n: 'A4', d: 3 }, { n: 'G4', d: 1 },
      { n: 'A4', d: 1.5 }, { n: 'B4', d: 0.5 }, { n: 'G4', d: 1 }, { n: 'E4', d: 1 },
      { n: 'D4', d: 2 }, { n: 'G4', d: 2 },
    ],
  },
  {
    id: 'largo',
    title: '家路',
    subtitle: 'ドヴォルザーク 交響曲第9番「新世界より」',
    keyName: 'ト長調',
    fifths: 1,
    time: { beats: 4, beatType: 4 },
    pickup: 0,
    bpm: 60,
    level: '初中級',
    note: '遅い曲。伸ばす音が長く、音程の粗が出やすい。',
    notes: [
      { n: 'B4', d: 1.5 }, { n: 'D5', d: 0.5 }, { n: 'D5', d: 2 },
      { n: 'B4', d: 1 }, { n: 'A4', d: 1 }, { n: 'G4', d: 2 },
      { n: 'A4', d: 1 }, { n: 'B4', d: 1 }, { n: 'D5', d: 1 }, { n: 'B4', d: 1 },
      { n: 'A4', d: 4 },
      { n: 'B4', d: 1.5 }, { n: 'D5', d: 0.5 }, { n: 'D5', d: 2 },
      { n: 'B4', d: 1 }, { n: 'A4', d: 1 }, { n: 'G4', d: 2 },
      { n: 'A4', d: 1 }, { n: 'B4', d: 1 }, { n: 'A4', d: 1 }, { n: 'G4', d: 1 },
      { n: 'G4', d: 4 },
    ],
  },
  {
    id: 'greensleeves',
    title: 'グリーンスリーブス',
    subtitle: 'イングランド民謡 / 16世紀',
    keyName: 'イ短調',
    fifths: 0,
    time: { beats: 3, beatType: 4 },
    pickup: 1,
    bpm: 92,
    level: '中級',
    note: '短調で臨時記号あり。3拍子と弱起の両方が入る。',
    notes: [
      { n: 'A4', d: 1 },
      { n: 'C5', d: 2 }, { n: 'D5', d: 1 },
      { n: 'E5', d: 1.5 }, { n: 'F5', d: 0.5 }, { n: 'E5', d: 1 },
      { n: 'D5', d: 2 }, { n: 'B4', d: 1 },
      { n: 'G4', d: 1.5 }, { n: 'A4', d: 0.5 }, { n: 'B4', d: 1 },
      { n: 'C5', d: 2 }, { n: 'A4', d: 1 },
      { n: 'A4', d: 1.5 }, { n: 'G#4', d: 0.5 }, { n: 'A4', d: 1 },
      { n: 'B4', d: 2 }, { n: 'G#4', d: 1 },
      { n: 'E4', d: 3 },
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

const A4_OPTIONS = [440, 441, 442]

const sigId = (t) => `${t.beats}/${t.beatType}`

/* ============================================================
 *  MusicXML 生成
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

/* ---------- 検出パラメータ ----------
 * 用途ごとに探す音域と信頼度のしきい値を変える。
 * 狭く取るほど誤検出（オクターブ違いなど）が減る。
 */
const DETECT = {
  play: { min: 170, max: 3200, clarity: 0.88 }, // 練習・フリー演奏
  violin: { min: 150, max: 1500, clarity: 0.9 }, // 調弦：開放弦まわりだけ見る
  voice: { min: 160, max: 1200, clarity: 0.8 }, // 発声：声は倍音が多いのでしきい値を緩める
}

const RMS_MIN = 0.008
const HOLD_MS = 350
const IN_TUNE_CENTS = 8 // 練習モードのチューナー
const TUNE_OK_CENTS = 5 // チューニングタブの合格幅

/* ---------- 判定パラメータ ---------- */
const ATTACK_SKIP = 0.12
const RELEASE_SKIP = 0.06
const MIN_SAMPLES = 3
const NAME_HIT_RATIO = 0.5
const GOOD_CENTS = 15

/* ---------- 採譜パラメータ ---------- */
const SEG_CONFIRM = 3
const SEG_MIN_SEC = 0.1
const SEG_GAP = 0.07
const SEG_BRIDGE = 0.09
const REST_MIN_UNITS = 2
const REC_MAX_SEC = 180

/* ---------- クリック音の回り込み対策 ----------
 * クリックは検出上限より高い音にしてあるので、音程としては拾われない。
 * 残る立ち上がりの衝撃だけ、ごく短く検出を止める。
 */
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
 *  横並びリストをマウスでも動かせるようにする
 *  - 掴んで左右にドラッグ
 *  - ホイールの縦回転を横スクロールに変換
 *  - 端に着いたかどうかを返す（左右ボタンの出し分けに使う）
 *  タッチはブラウザ本来のスクロールに任せるので何もしない
 * ============================================================ */
function useDragScroll() {
  const ref = useRef(null)
  const [edges, setEdges] = useState({ start: true, end: true })

  const readEdges = useCallback(() => {
    const el = ref.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setEdges({ start: el.scrollLeft <= 1, end: el.scrollLeft >= max - 1 })
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let dragging = false
    let moved = false
    let startX = 0
    let startLeft = 0

    const onPointerDown = (e) => {
      if (e.pointerType === 'touch' || e.button !== 0) return
      dragging = true
      moved = false
      startX = e.clientX
      startLeft = el.scrollLeft
    }

    const onPointerMove = (e) => {
      if (!dragging) return
      const dx = e.clientX - startX
      if (!moved && Math.abs(dx) > 4) {
        moved = true
        el.dataset.dragging = 'on'
        try {
          el.setPointerCapture(e.pointerId)
        } catch {
          /* 取れなくても動作に支障はない */
        }
      }
      if (moved) {
        e.preventDefault()
        el.scrollLeft = startLeft - dx
      }
    }

    const endDrag = (e) => {
      if (!dragging) return
      dragging = false
      delete el.dataset.dragging
      try {
        el.releasePointerCapture?.(e.pointerId)
      } catch {
        /* すでに解放済みなら何もしない */
      }
      if (moved) {
        // ドラッグ直後のクリックでカードが選ばれてしまうのを防ぐ
        const swallow = (ev) => {
          ev.stopPropagation()
          ev.preventDefault()
        }
        el.addEventListener('click', swallow, { capture: true, once: true })
        setTimeout(() => el.removeEventListener('click', swallow, true), 120)
      }
    }

    const onWheel = (e) => {
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (!dx) return
      const max = el.scrollWidth - el.clientWidth
      if (max <= 0) return
      // 端まで来たらページ側のスクロールに譲る
      if ((dx < 0 && el.scrollLeft <= 0) || (dx > 0 && el.scrollLeft >= max)) return
      e.preventDefault()
      el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + dx))
    }

    el.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('scroll', readEdges, { passive: true })
    window.addEventListener('resize', readEdges)
    readEdges()

    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('scroll', readEdges)
      window.removeEventListener('resize', readEdges)
    }
  }, [readEdges])

  const nudge = useCallback((dir) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.75, behavior: 'smooth' })
  }, [])

  /* 選んだカードが隠れていたら見える位置まで寄せる */
  const revealChild = useCallback((index) => {
    const el = ref.current
    const child = el?.children?.[index]
    if (!el || !child) return
    const left = child.offsetLeft
    const right = left + child.offsetWidth
    if (left < el.scrollLeft || right > el.scrollLeft + el.clientWidth) {
      el.scrollTo({ left: left - 12, behavior: 'smooth' })
    }
  }, [])

  return { ref, edges, nudge, revealChild }
}

/* ============================================================
 *  演奏の講評
 *  点数だけ出しても伸びないので、「何が起きていたか」を1〜2点に絞って言う。
 *  褒めるところは褒め、直すところは具体的な場所で示す。
 * ============================================================ */
const RANKS = [
  { min: 100, badge: 'S', headline: 'エクセレント！', tone: 'ok' },
  { min: 92, badge: 'A', headline: '見事です', tone: 'ok' },
  { min: 80, badge: 'B', headline: 'その調子、良い感じ', tone: 'ok' },
  { min: 65, badge: 'C', headline: 'あと少し', tone: 'warn' },
  { min: 45, badge: 'D', headline: '形は見えています', tone: 'warn' },
  { min: 0, badge: 'E', headline: 'ゆっくりから、もう一度', tone: 'warn' },
]

/* 合格した音の割合を軸にする。惜しい音には部分点を少しだけ。
 * 「8割の音が合格 ≒ 80点台」になるよう配点している。 */
function scoreOf(v) {
  if (!v || v.verdict === 'missed') return 0
  if (v.verdict === 'ok') return 1
  if (v.semis) return 0.05 // 別の音を弾いている
  return Math.abs(v.cents) <= 30 ? 0.45 : 0.2 // 音名は合っているが甘い
}

function buildReview(verdicts, song) {
  const done = verdicts.filter(Boolean)
  if (!done.length) return null

  const total = done.length
  const okCount = done.filter((v) => v.verdict === 'ok').length
  const missed = done.filter((v) => v.verdict === 'missed').length
  const wrong = done.filter((v) => v.semis).length
  const score = Math.round((done.reduce((a, v) => a + scoreOf(v), 0) / total) * 100)
  const rank = RANKS.find((r) => score >= r.min)

  const tuned = done.filter((v) => v.verdict !== 'missed' && !v.semis && v.cents != null)
  const avg = tuned.length ? Math.round(tuned.reduce((a, v) => a + v.cents, 0) / tuned.length) : null
  const spread = tuned.length
    ? Math.round(Math.sqrt(tuned.reduce((a, v) => a + (v.cents - avg) ** 2, 0) / tuned.length))
    : null

  /* どの音で外しているかを数える */
  const byName = new Map()
  done.forEach((v, i) => {
    if (v.verdict === 'ok' || v.verdict === 'missed') return
    const name = song.notes[i]?.n
    if (!name) return
    byName.set(name, (byName.get(name) ?? 0) + 1)
  })
  const worst = [...byName.entries()].sort((a, b) => b[1] - a[1])[0]

  const missCount = total - okCount
  const points = []

  if (okCount === total) {
    points.push('全部の音が合格。音程も安定しています。')
  } else {
    if (missCount <= 2 && !missed && !wrong) {
      points.push(`惜しかったのは ${missCount} 音だけ。あと少しで全部そろいます。`)
    }
    if (avg != null && Math.abs(avg) > 12) {
      points.push(
        `全体に${avg > 0 ? '高め' : '低め'}（平均 ${avg > 0 ? '+' : ''}${avg} cent）。指の位置を${
          avg > 0 ? '少し手前に' : '少し先に'
        }。`
      )
    } else if (spread != null && spread > 20) {
      points.push(`平均は合っていますが、音ごとのばらつきが大きめ（±${spread} cent）。`)
    }
    // 外している音が一部に偏っているときだけ、その音を名指しする
    if (worst && worst[1] >= 2 && missCount <= total * 0.6) {
      const f = fretFor(noteToMidi(worst[0]))
      const place = f
        ? `${STRINGS[f.row].label}線の${FINGERS[FRETS[f.col].finger].mark}${FINGERS[FRETS[f.col].finger].name}`
        : ''
      points.push(`${worst[0]} が ${worst[1]} 回外れています${place ? `（${place}）` : ''}。`)
    }
    if (wrong > 0) points.push(`別の音を弾いた箇所が ${wrong} か所。運指を確認しましょう。`)
    if (missed > 0)
      points.push(`音が拾えなかった箇所が ${missed} か所。もう少し強く弾くか、テンポを落として。`)
  }

  if (!points.length) points.push('大きな崩れはありません。このテンポで通せています。')

  return {
    score,
    rank,
    total,
    okCount,
    missed,
    wrong,
    avg,
    points: points.slice(0, 3),
  }
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
 *  detect（音域と信頼度）はタブによって切り替わるので、
 *  ループの中では ref 経由で最新のものを読む
 * ============================================================ */
function usePitch(a4, audio, blankRef, detect) {
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
  const detectRef = useRef(detect)
  detectRef.current = detect

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

        const d = detectRef.current
        const [freq, clarity] = detector.findPitch(input, ctx.sampleRate)
        if (!freq || clarity < d.clarity || freq < d.min || freq > d.max) {
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
        const next = { freq: f, midiFloat, midi, cents, name, octave, clarity, at: audioNow }
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

  /* 音域を切り替えたら、前の音域で貯めた値は捨てる */
  useEffect(() => {
    bufRef.current = []
    readingRef.current = null
    setReading(null)
  }, [detect])

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
      // 検出レンジより上の音にする。こうするとクリックが音程として拾われない
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
 *  バイオリンの音（弓弦の物理モデル）
 *
 *  波形を合成するのではなく、弦そのものを計算する。
 *  弦を「駒側」「ナット側」2本の遅延線で表し、その間に弓を置く。
 *  弓の摩擦は「食いつく → 滑る」という非線形なやり取りで、
 *  ここからヘルムホルツ運動（＝あののこぎり状の波）が自然に立ち上がる。
 *  オシレータを重ねただけの音と違い、立ち上がりも倍音も勝手に本物に寄る。
 * ============================================================ */
function bowParams(freq) {
  return {
    bowPos: 0.18, // 駒からの弓の位置（弦長比）
    filterPole: 0.12, // 駒での反射で高音が丸まる度合い
    // 高い音ほど弓を軽く。重いままだと擦れて音程が定まらない
    slope: 1.6 * (1 + freq / 800),
    maxVel: 0.22 * (1 - 0.3 * Math.min(1, freq / 1000)),
  }
}

function renderBowedString(freq, sampleRate, seconds) {
  const { bowPos, filterPole, slope, maxVel } = bowParams(freq)
  const reflect = 0.95
  const attack = 0.06
  const vibRate = 5.3
  const vibDepth = 0.0018
  const vibDelay = 0.28

  const N = Math.floor(sampleRate * seconds)
  const maxPeriod = Math.ceil(sampleRate / (freq * 0.98)) + 8
  const bridgeBuf = new Float32Array(maxPeriod)
  const neckBuf = new Float32Array(maxPeriod)
  const out = new Float32Array(N)
  let bw = 0
  let nw = 0
  let lp = 0

  // 反射フィルタの位相遅れ。差し引かないと音程がぶら下がる
  const w0 = (2 * Math.PI * freq) / sampleRate
  const loopComp = Math.atan2(filterPole * Math.sin(w0), 1 - filterPole * Math.cos(w0)) / w0

  const read = (buf, w, delay) => {
    let rp = w - delay
    while (rp < 0) rp += maxPeriod
    const i0 = Math.floor(rp)
    const frac = rp - i0
    const i1 = i0 + 1 >= maxPeriod ? 0 : i0 + 1
    return buf[i0] * (1 - frac) + buf[i1] * frac
  }

  for (let n = 0; n < N; n++) {
    const t = n / sampleRate
    const vib =
      t < vibDelay
        ? 1
        : 1 +
          vibDepth *
            Math.min(1, (t - vibDelay) / 0.6) *
            Math.sin(2 * Math.PI * vibRate * (t - vibDelay))
    const total = sampleRate / (freq * vib) - loopComp
    const dBridge = Math.max(1.2, total * bowPos)
    const dNeck = Math.max(1.2, total * (1 - bowPos))

    const bridgeOut = read(bridgeBuf, bw, dBridge)
    const neckOut = read(neckBuf, nw, dNeck)

    lp += (1 - filterPole) * (bridgeOut - lp)
    const bridgeRefl = -lp * reflect
    const nutRefl = -neckOut

    const env = Math.min(1, t / attack)
    const deltaV = maxVel * env - (bridgeRefl + nutRefl)

    // 弓の摩擦テーブル（食いつくと 1、滑ると 0 へ）
    let f = Math.abs(deltaV * slope) + 0.75
    f = 1 / (f * f * f * f)
    if (f > 1) f = 1
    const newVel = deltaV * f

    neckBuf[nw] = bridgeRefl + newVel
    bridgeBuf[bw] = nutRefl + newVel
    nw = nw + 1 >= maxPeriod ? 0 : nw + 1
    bw = bw + 1 >= maxPeriod ? 0 : bw + 1

    out[n] = bridgeOut
  }
  return out
}

/* 胴の共鳴。弦の音を箱に通して体積を与える */
const BODY_RESONANCE = [
  [275, 3.0, 0.5], // 空気の共鳴
  [460, 4.0, 0.34], // 表板
  [720, 5.0, 0.2],
  [2600, 1.6, 0.26], // ブリッジ・ヒル
]

const TONE_SECONDS = 2.6
const TONE_LOOP_FROM = 1.2

function useViolinSynth(audio) {
  const voiceRef = useRef(null)
  const cacheRef = useRef({ ctx: null, map: new Map() })
  const scheduledRef = useRef([])

  const bufferFor = useCallback((ctx, freq, key) => {
    if (cacheRef.current.ctx !== ctx) cacheRef.current = { ctx, map: new Map() }
    const hit = cacheRef.current.map.get(key)
    if (hit) return hit
    const sr = ctx.sampleRate
    const data = renderBowedString(freq, sr, TONE_SECONDS)
    const buf = ctx.createBuffer(1, data.length, sr)
    if (buf.copyToChannel) buf.copyToChannel(data, 0)
    else buf.getChannelData(0).set(data)
    cacheRef.current.map.set(key, buf)
    return buf
  }, [])

  /* 弦の音 → 胴の共鳴 → 出力、という経路を1本組む */
  const buildChain = useCallback((ctx) => {
    const env = ctx.createGain()
    const out = ctx.createGain()
    out.gain.value = 0.5
    const dry = ctx.createGain()
    dry.gain.value = 0.6
    env.connect(dry).connect(out)
    BODY_RESONANCE.forEach(([f, q, g]) => {
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = f
      bp.Q.value = q
      const bg = ctx.createGain()
      bg.gain.value = g
      env.connect(bp).connect(bg).connect(out)
    })
    out.connect(ctx.destination)
    return env
  }, [])

  /* 押し続けている間の長さに耐えるよう、安定区間を周期の整数倍でつなぐ */
  const makeSource = useCallback(
    (ctx, buf, freq) => {
      const src = ctx.createBufferSource()
      src.buffer = buf
      const period = ctx.sampleRate / freq
      const from = Math.floor(ctx.sampleRate * TONE_LOOP_FROM)
      const room = buf.length - from - 8
      const cycles = Math.max(1, Math.floor(room / period))
      src.loop = true
      src.loopStart = from / ctx.sampleRate
      src.loopEnd = (from + Math.round(cycles * period)) / ctx.sampleRate
      return src
    },
    []
  )

  const release = useCallback(() => {
    const v = voiceRef.current
    if (!v) return
    voiceRef.current = null
    const { ctx, env, src } = v
    if (ctx.state === 'closed') return
    const now = ctx.currentTime
    try {
      env.gain.cancelScheduledValues(now)
      env.gain.setValueAtTime(Math.max(env.gain.value, 0.0001), now)
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.2)
      src.stop(now + 0.26)
    } catch {
      /* すでに止まっていれば何もしない */
    }
  }, [])

  const play = useCallback(
    async (freq, key) => {
      const ctx = await audio.ensure()
      release()
      const now = ctx.currentTime
      const buf = bufferFor(ctx, freq, key ?? Math.round(freq * 10))
      const src = makeSource(ctx, buf, freq)
      const env = buildChain(ctx)
      src.connect(env)
      env.gain.setValueAtTime(0.0001, now)
      env.gain.exponentialRampToValueAtTime(0.9, now + 0.012)
      src.start(now)
      voiceRef.current = { ctx, env, src }
    },
    [audio, buildChain, bufferFor, makeSource, release]
  )

  /* お手本再生用。鳴らす時刻をあらかじめ予約するので、
   * 画面の描画がつまづいてもリズムはずれない */
  const playAt = useCallback(
    (ctx, freq, key, when, dur) => {
      const buf = bufferFor(ctx, freq, key)
      const src = makeSource(ctx, buf, freq)
      const env = buildChain(ctx)
      src.connect(env)
      const rel = Math.min(0.14, dur * 0.35)
      env.gain.setValueAtTime(0.0001, when)
      env.gain.exponentialRampToValueAtTime(0.9, when + 0.012)
      env.gain.setValueAtTime(0.9, when + Math.max(0.02, dur - rel))
      env.gain.exponentialRampToValueAtTime(0.0001, when + dur)
      src.start(when)
      src.stop(when + dur + 0.05)
      scheduledRef.current.push({ src, env })
      return src
    },
    [buildChain, bufferFor, makeSource]
  )

  const stopScheduled = useCallback(() => {
    const list = scheduledRef.current
    scheduledRef.current = []
    list.forEach(({ src, env }) => {
      try {
        const ctx = env.context
        const now = ctx.currentTime
        env.gain.cancelScheduledValues(now)
        env.gain.setValueAtTime(Math.max(env.gain.value, 0.0001), now)
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.08)
        src.stop(now + 0.12)
      } catch {
        /* すでに終わっていれば何もしない */
      }
    })
  }, [])

  /* 使う音を先に作っておく。1音 20ms ほどかかるので少しずつ進める */
  const prepare = useCallback(
    async (ctx, list) => {
      for (const { freq, key } of list) {
        bufferFor(ctx, freq, key)
        await new Promise((r) => setTimeout(r, 0))
      }
    },
    [bufferFor]
  )

  useEffect(
    () => () => {
      release()
      stopScheduled()
    },
    [release, stopScheduled]
  )

  return { play, release, playAt, stopScheduled, prepare }
}

/* ============================================================
 *  お手本再生（音ゲー式）
 *  曲の音を順に鳴らしながら、押さえる場所を光らせる。
 *  音は AudioContext の時計に予約済みなので、光る方だけを毎フレーム追う。
 * ============================================================ */
function useFingerDemo({ audio, synth, a4, sound }) {
  const [songId, setSongId] = useState(null)
  const [status, setStatus] = useState('idle') // idle | loading | playing
  const [pos, setPos] = useState({ index: -1, current: null, next: null })

  const planRef = useRef([])
  const startAtRef = useRef(0)
  const rafRef = useRef(null)
  const idxRef = useRef(-1)

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    synth.stopScheduled()
    idxRef.current = -1
    setPos({ index: -1, current: null, next: null })
    setStatus('idle')
    setSongId(null)
  }, [synth])

  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop)
    const ctx = audio.ctxRef.current
    if (!ctx || ctx.state === 'closed') {
      stop()
      return
    }
    const plan = planRef.current
    const t = ctx.currentTime - startAtRef.current

    let i = -1
    for (let k = 0; k < plan.length; k++) {
      if (t >= plan[k].at) i = k
      else break
    }
    if (i !== idxRef.current) {
      idxRef.current = i
      setPos({
        index: i,
        current: i >= 0 ? plan[i].fret : null,
        next: plan[i + 1] ? plan[i + 1].fret : null,
      })
    }
    const last = plan[plan.length - 1]
    if (last && t > last.at + last.dur + 0.3) stop()
  }, [audio.ctxRef, stop])

  const start = useCallback(
    async (song) => {
      stop()
      setSongId(song.id)
      setStatus('loading')

      const ctx = await audio.ensure()
      const spb = 60 / song.bpm

      const plan = []
      let at = 0
      for (const n of song.notes) {
        const midi = noteToMidi(n.n)
        const fret = fretFor(midi)
        const dur = n.d * spb
        if (fret) plan.push({ midi, fret, at, dur: dur * 0.95, freq: midiToFreq(midi, a4) })
        at += dur
      }
      planRef.current = plan

      // 使う音を先に用意する
      const uniq = new Map()
      plan.forEach((p) => uniq.set(`${p.midi}:${a4}`, p.freq))
      await synth.prepare(
        ctx,
        [...uniq].map(([key, freq]) => ({ key, freq }))
      )

      const lead = 0.35
      const t0 = ctx.currentTime + lead
      startAtRef.current = t0
      if (sound) {
        plan.forEach((p) => synth.playAt(ctx, p.freq, `${p.midi}:${a4}`, t0 + p.at, p.dur))
      }

      idxRef.current = -1
      setPos({ index: -1, current: null, next: plan[0]?.fret ?? null })
      setStatus('playing')
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(loop)
    },
    [a4, audio, loop, sound, stop, synth]
  )

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  return { songId, status, pos, start, stop }
}

/* ============================================================
 *  没入モード
 *  iPhone の Safari は Fullscreen API に対応していないので、
 *  CSS で画面いっぱいに広げるのが本体。使える環境ではそれに加えて
 *  ブラウザの枠も畳み、画面が消灯しないようにする。
 * ============================================================ */
function useImmersive(active) {
  const [deviceLandscape, setDeviceLandscape] = useState(false)
  const wakeRef = useRef(null)

  /* 端末が今どちらを向いているか。縦で固定するのに使う */
  useEffect(() => {
    const mql = window.matchMedia('(orientation: landscape)')
    const sync = (e) => setDeviceLandscape(e.matches)
    sync(mql)
    mql.addEventListener('change', sync)
    return () => mql.removeEventListener('change', sync)
  }, [])

  const requestWakeLock = useCallback(async () => {
    try {
      if (navigator.wakeLock && !wakeRef.current) {
        wakeRef.current = await navigator.wakeLock.request('screen')
        wakeRef.current.addEventListener?.('release', () => {
          wakeRef.current = null
        })
      }
    } catch {
      /* 対応していない、または拒否された。表示自体には影響しない */
    }
  }, [])

  const releaseWakeLock = useCallback(() => {
    wakeRef.current?.release?.().catch(() => {})
    wakeRef.current = null
  }, [])

  /* 画面を広く使う・消灯を防ぐ・向きを固定する、はすべて
   * 運指タブにいる間だけの副作用。画面を覆うモーダルにはしないので、
   * 抜けるための操作（✕）は要らない。別のタブを押せばそれで戻る。 */
  useEffect(() => {
    let cancelled = false
    if (active) {
      const el = document.documentElement
      ;(async () => {
        try {
          if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' })
          else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen()
        } catch {
          /* 使えない環境では CSS だけで広げる */
        }
        if (cancelled) return
        try {
          await screen.orientation?.lock?.('portrait')
        } catch {
          /* 断られても CSS 側で打ち消すので問題ない */
        }
        requestWakeLock()
      })()
    } else {
      try {
        screen.orientation?.unlock?.()
      } catch {
        /* 無視してよい */
      }
      try {
        if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen()
        else if (document.webkitFullscreenElement && document.webkitExitFullscreen)
          document.webkitExitFullscreen()
      } catch {
        /* 無視してよい */
      }
      releaseWakeLock()
    }
    return () => {
      cancelled = true
    }
  }, [active, releaseWakeLock, requestWakeLock])

  /* 画面を離れて戻ったら、消灯防止を取り直す */
  useEffect(() => {
    if (!active) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') requestWakeLock()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [active, requestWakeLock])

  useEffect(() => releaseWakeLock, [releaseWakeLock])

  return { on: active, counterRotate: active && deviceLandscape }
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

  const review = useMemo(() => buildReview(verdicts, song), [verdicts, song])

  return { phase, index, verdicts, countBeat, review, begin, reset, stop: () => stopSession('idle') }
}

/* ============================================================
 *  フリー演奏（録音 → 採譜）
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

    if (s.blank) {
      lastBlank = s.t
      continue
    }

    if (cur) {
      const gap = s.t - cur.last
      if (gap > SEG_GAP) {
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
  const gridSec = quarterSec / 4

  const t0 = events[0].start

  const grid = []
  events.forEach((e) => {
    let gs = Math.max(0, Math.round((e.start - t0) / gridSec))
    const prev = grid[grid.length - 1]
    if (prev && gs <= prev.gs) gs = prev.gs + 1
    let ge = Math.round((e.end - t0) / gridSec)
    if (ge <= gs) ge = gs + 1
    grid.push({ gs, ge, midi: e.midi })
  })

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

/* アナログ針の文字盤。cents は ±50 に丸めて表示する */
function DialGauge({ cents, active, ok, big, sub, hz }) {
  const clamped = Math.max(-50, Math.min(50, cents ?? 0))
  const deg = (clamped / 50) * 52 // 針の振れ幅
  const rad = (deg * Math.PI) / 180
  const cx = 150
  const cy = 158
  const r = 118

  const ticks = []
  for (let c = -50; c <= 50; c += 2) {
    const major = c % 10 === 0
    const mid = c % 5 === 0
    const a = ((c / 50) * 52 * Math.PI) / 180
    const len = major ? 16 : mid ? 10 : 6
    const r1 = r
    const r2 = r - len
    ticks.push(
      <line
        key={c}
        x1={cx + r1 * Math.sin(a)}
        y1={cy - r1 * Math.cos(a)}
        x2={cx + r2 * Math.sin(a)}
        y2={cy - r2 * Math.cos(a)}
        strokeWidth={major ? 2 : 1}
        className={major ? 'dial-tick major' : 'dial-tick'}
      />
    )
  }

  const state = !active ? 'idle' : ok ? 'ok' : clamped > 0 ? 'high' : 'low'

  return (
    <div className="dial" data-state={state}>
      <svg viewBox="0 0 300 180" className="dial-svg" role="img" aria-label="チューニングメーター">
        <defs>
          <linearGradient id="dialFace" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fdfaf3" />
            <stop offset="100%" stopColor="#f2ead8" />
          </linearGradient>
        </defs>

        <rect x="4" y="4" width="292" height="172" rx="14" fill="url(#dialFace)" stroke="#ded3ba" />

        {/* 合格ゾーン（±5セント） */}
        <path
          className="dial-zone"
          d={(() => {
            const a1 = ((-TUNE_OK_CENTS / 50) * 52 * Math.PI) / 180
            const a2 = ((TUNE_OK_CENTS / 50) * 52 * Math.PI) / 180
            const ri = r - 18
            return [
              `M ${cx + r * Math.sin(a1)} ${cy - r * Math.cos(a1)}`,
              `A ${r} ${r} 0 0 1 ${cx + r * Math.sin(a2)} ${cy - r * Math.cos(a2)}`,
              `L ${cx + ri * Math.sin(a2)} ${cy - ri * Math.cos(a2)}`,
              `A ${ri} ${ri} 0 0 0 ${cx + ri * Math.sin(a1)} ${cy - ri * Math.cos(a1)}`,
              'Z',
            ].join(' ')
          })()}
        />

        {ticks}

        <text x="34" y="150" className="dial-edge">
          −50
        </text>
        <text x="150" y="66" className="dial-zero" textAnchor="middle">
          0
        </text>
        <text x="266" y="150" className="dial-edge" textAnchor="end">
          +50
        </text>
        <text x="150" y="96" className="dial-unit" textAnchor="middle">
          CENT
        </text>

        {/* 大きい表示（音名や弦名） */}
        <text x="150" y="52" className="dial-big" textAnchor="middle">
          {big}
          {sub && <tspan className="dial-sub">{sub}</tspan>}
        </text>
        {hz && (
          <text x="150" y="80" className="dial-hz" textAnchor="middle">
            {hz}
          </text>
        )}

        {/* 針 */}
        <g style={{ opacity: active ? 1 : 0.22 }}>
          <line
            className="dial-needle"
            x1={cx}
            y1={cy}
            x2={cx + (r - 4) * Math.sin(rad)}
            y2={cy - (r - 4) * Math.cos(rad)}
          />
          <circle cx={cx} cy={cy} r="7" className="dial-hub" />
        </g>
      </svg>
    </div>
  )
}

/* 発声モードの鍵盤。1オクターブぶんを大きく描き、鳴っている音の鍵を光らせる */
function VoiceKeyboard({ reading, active, state }) {
  const W = 46 // 白鍵の幅
  const H = 156 // 白鍵の高さ
  const BW = 30 // 黒鍵の幅
  const BH = 98
  const width = W * 7

  const pc = active ? ((reading.midi % 12) + 12) % 12 : -1
  const octave = active ? reading.octave : null
  const hit = pc >= 0 ? JP_NAMES[pc] : null

  const keyColor = state === 'ok' ? COLOR.ok : state === 'high' ? COLOR.high : COLOR.low

  return (
    <div className="kb" data-state={state}>
      <svg viewBox={`0 0 ${width} ${H + 4}`} className="kb-svg" role="img" aria-label="鍵盤">
        {/* 白鍵 */}
        {WHITE_PC.map((p, i) => {
          const on = p === pc
          return (
            <g key={p}>
              <rect
                x={i * W + 1}
                y={1}
                width={W - 2}
                height={H}
                rx="5"
                className="kb-white"
                style={on ? { fill: keyColor } : undefined}
              />
              <text
                x={i * W + W / 2}
                y={H - 16}
                textAnchor="middle"
                className="kb-label"
                style={on ? { fill: '#fff' } : undefined}
              >
                {JP_NAMES[p].sharp}
              </text>
              {on && octave != null && (
                <text x={i * W + W / 2} y={H - 40} textAnchor="middle" className="kb-oct-on">
                  {octave}
                </text>
              )}
            </g>
          )
        })}

        {/* 黒鍵 */}
        {BLACK_PC.map((b) => {
          const on = b.pc === pc
          const x = (b.after + 1) * W - BW / 2
          return (
            <g key={b.pc}>
              <rect
                x={x}
                y={1}
                width={BW}
                height={BH}
                rx="4"
                className="kb-black"
                style={on ? { fill: keyColor } : undefined}
              />
              <text x={x + BW / 2} y={BH - 24} textAnchor="middle" className="kb-sharp">
                {JP_NAMES[b.pc].sharp}
              </text>
              <text x={x + BW / 2} y={BH - 10} textAnchor="middle" className="kb-flat">
                {JP_NAMES[b.pc].flat}
              </text>
              {on && octave != null && (
                <text x={x + BW / 2} y={BH - 38} textAnchor="middle" className="kb-oct-on">
                  {octave}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* 鳴っている音の名前を大きく */}
      <div className="kb-now">
        {active ? (
          <>
            <span className="kb-now-name" style={{ color: keyColor }}>
              {hit.sharp}
            </span>
            {hit.flat && (
              <span className="kb-now-alt">
                （<span className="sw-high">{hit.sharp}</span> ＝{' '}
                <span className="sw-low">{hit.flat}</span>）
              </span>
            )}
            <span className="kb-now-oct">{octave}</span>
          </>
        ) : (
          <span className="kb-now-name idle">—</span>
        )}
      </div>
    </div>
  )
}

/* ============================================================
 *  指板
 *  横向き … 写真と同じ並び（左から開放弦、上から E→A→D→G）
 *  縦向き … 実際に構えて上から覗いた向き。弦が縦に走り、
 *           左から G→D→A→E、上から下へポジションが進む。
 *           縦長の画面ではこちらの方が桁違いに大きく置ける。
 * ============================================================ */
function fbLayout(vertical) {
  if (vertical) {
    const COLW = 104
    const ROWH = 100
    const GUT = 58 // 指の名前を縦書きする余白
    const boardW = COLW * STRINGS.length
    const W = boardW + GUT
    const H = ROWH * FRETS.length
    return {
      vertical: true,
      W,
      H,
      boardW,
      /* 弦は左から G→D→A→E（STRINGS は E→A→D→G なので逆順） */
      /* 左手は下から回して弦に触れるので、指の説明は反対側（左）に置く */
      x: (r) => GUT + COLW * (STRINGS.length - 1 - r) + COLW / 2,
      y: (c) => ROWH * c + ROWH / 2,
      rx: 44,
      ry: 32,
      font: 27,
      board: { x: GUT, y: ROWH, w: boardW, h: H - ROWH },
      nut: { x: GUT, y: ROWH - 6, w: boardW, h: 8 },
      stringLine: (r) => {
        const x = GUT + COLW * (STRINGS.length - 1 - r) + COLW / 2
        return { x1: x, y1: 8, x2: x, y2: H - 8 }
      },
      bracket: (from, to) => {
        const bx = GUT - 12
        const y1 = ROWH * from + 14
        const y2 = ROWH * (to + 1) - 14
        return {
          d: `M ${bx - 12} ${y1} L ${bx} ${y1} L ${bx} ${y2} L ${bx - 12} ${y2}`,
          tx: bx - 24,
          ty: (y1 + y2) / 2,
        }
      },
    }
  }
  const COL = 74
  const ROWH = 46
  const TOP = 30
  const W = COL * FRETS.length
  const boardH = TOP + ROWH * 3 + 26
  return {
    vertical: false,
    W,
    H: boardH + 62,
    boardH,
    x: (r, c) => COL * c + COL / 2,
    y: (c, r) => TOP + ROWH * r,
    rx: 24,
    ry: 16,
    font: 15,
    board: { x: COL, y: 0, w: W - COL, h: boardH },
    nut: { x: COL - 5, y: 0, w: 7, h: boardH },
    stringLine: (r) => ({ x1: 6, y1: TOP + ROWH * r, x2: W - 6, y2: TOP + ROWH * r }),
    bracket: (from, to) => {
      const x1 = COL * from + COL / 2 - 26
      const x2 = COL * to + COL / 2 + 26
      const y = boardH + 8
      return { d: `M ${x1} ${y + 10} L ${x1} ${y} L ${x2} ${y} L ${x2} ${y + 10}`, tx: (x1 + x2) / 2, ty: y + 32 }
    },
  }
}

function Fingerboard({ a4, sound, setSound, onPress, onRelease, current, next, pressed, vertical }) {
  const L = useMemo(() => fbLayout(vertical), [vertical])
  const px = (r, c) => (L.vertical ? L.x(r) : L.x(r, c))
  const py = (r, c) => (L.vertical ? L.y(c) : L.y(c, r))

  const groups = []
  FRETS.forEach((f, i) => {
    const last = groups[groups.length - 1]
    if (last && last.finger === f.finger) last.to = i
    else groups.push({ finger: f.finger, from: i, to: i })
  })

  return (
    <div className="fb" data-vertical={L.vertical}>
      <svg
        viewBox={`0 0 ${L.W} ${L.H}`}
        className="fb-svg"
        preserveAspectRatio="xMidYMid meet"
        role="application"
        aria-label="バイオリンの指板"
      >
        <rect {...{ x: L.board.x, y: L.board.y, width: L.board.w, height: L.board.h }} rx="6" className="fb-board" />
        <rect {...{ x: L.nut.x, y: L.nut.y, width: L.nut.w, height: L.nut.h }} className="fb-nut" />

        {STRINGS.map((s, r) => {
          const l = L.stringLine(r)
          return (
            <line
              key={s.id}
              {...l}
              className="fb-string"
              strokeWidth={1 + (3 - r) * 0.7}
            />
          )
        })}

        {STRINGS.map((s, r) =>
          FRETS.map((f, c) => {
            const midi = s.midi + f.offset
            const pc = ((midi % 12) + 12) % 12
            const jp = JP_NAMES[pc]
            const on = current && current.row === r && current.col === c
            const soon = !on && next && next.row === r && next.col === c
            const held = pressed && pressed.row === r && pressed.col === c
            const cx = px(r, c)
            const cy = py(r, c)
            return (
              <g
                key={`${s.id}-${c}`}
                className="fb-dot"
                data-sharp={!!jp.flat}
                data-on={on}
                data-next={soon}
                data-held={held}
                onPointerDown={(e) => {
                  e.preventDefault()
                  onPress(r, c)
                }}
                onPointerUp={onRelease}
                onPointerLeave={onRelease}
                onPointerCancel={onRelease}
              >
                <ellipse cx={cx} cy={cy} rx={L.rx} ry={L.ry} className="fb-pad" />
                <text
                  x={cx}
                  y={cy + L.font * 0.35}
                  textAnchor="middle"
                  className="fb-text"
                  style={{ fontSize: L.font }}
                >
                  {jp.sharp}
                </text>
              </g>
            )
          })
        )}

        {groups.map((g) => {
          const b = L.bracket(g.from, g.to)
          const f = FINGERS[g.finger]
          const label = L.vertical ? `${f.mark}${f.short}` : `${f.mark}${f.name}`
          return (
            <g key={g.finger}>
              <path d={b.d} className="fb-bracket" />
              {L.vertical ? (
                /* 縦向きは日本語も縦書きにする（写真と同じ） */
                <text x={b.tx} y={b.ty - ((label.length - 1) * 19) / 2} className="fb-finger" textAnchor="middle">
                  {label.split('').map((ch, i) => (
                    <tspan key={i} x={b.tx} dy={i === 0 ? 0 : 19}>
                      {ch}
                    </tspan>
                  ))}
                </text>
              ) : (
                <text x={b.tx} y={b.ty} textAnchor="middle" className="fb-finger">
                  {label}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      <div className="fb-legend">
        <span className="fb-strings">
          {STRINGS.map((s) => (
            <span key={s.id}>
              {s.label}線 {midiToFreq(s.midi, a4).toFixed(0)}Hz
            </span>
          ))}
        </span>
        <span className="fb-actions">
          <button className="mini toggle" data-on={sound} onClick={() => setSound((v) => !v)}>
            {sound ? '音あり' : '音なし'}
          </button>
        </span>
      </div>
    </div>
  )
}

/* 押さえた音の表示
 * ♯の音は別名（レ♭など）が増えて行が折り返し、指板の位置がずれていた。
 * 高さを固定し、必ず1行に収めることで弦の位置を動かさない。 */
function FingerReadout({ current, a4 }) {
  if (!current) {
    return (
      <div className="fr" data-idle="true">
        <span className="fr-jp">—</span>
        <span className="fr-msg">指板をタップすると音が鳴ります</span>
      </div>
    )
  }
  const { midi, row, col } = current
  const pc = ((midi % 12) + 12) % 12
  const jp = JP_NAMES[pc]
  const { octave } = midiToName(midi)
  const f = FINGERS[FRETS[col].finger]
  const s = STRINGS[row]

  return (
    <div className="fr" data-sharp={!!jp.flat}>
      <span className="fr-jp">
        {jp.sharp}
        <span className="fr-oct">{octave}</span>
      </span>
      <span className="fr-rest">
        {jp.flat && <span className="fr-alt">＝{jp.flat}</span>}
        <span className="fr-meta">
          {s.label}線・{f.mark}
          {f.name}
        </span>
        <span className="fr-hz">
          {midiToLabel(midi)} · {midiToFreq(midi, a4).toFixed(1)} Hz
        </span>
      </span>
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

/* ---------- チューニング ---------- */
function TuningPanel({ tuneMode, setTuneMode, reading, running, a4 }) {
  const live = running && !!reading

  /* 鳴った音にいちばん近い弦 */
  const near = useMemo(() => {
    if (!live) return null
    let best = STRINGS[0]
    let d = Infinity
    STRINGS.forEach((s) => {
      const diff = Math.abs(reading.midiFloat - s.midi)
      if (diff < d) {
        d = diff
        best = s
      }
    })
    return { string: best, cents: Math.round((reading.midiFloat - best.midi) * 100) }
  }, [live, reading])

  const cents = tuneMode === 'violin' ? (near?.cents ?? 0) : (reading?.cents ?? 0)
  const ok = live && Math.abs(cents) <= TUNE_OK_CENTS

  const big = live && near ? near.string.label : '—'
  const sub = null
  const hz = live ? `${reading.freq.toFixed(1)} Hz` : null

  return (
    <div className="tuning">
      <div className="seg" role="tablist" aria-label="チューニングの対象">
        <button
          role="tab"
          aria-selected={tuneMode === 'violin'}
          data-on={tuneMode === 'violin'}
          onClick={() => setTuneMode('violin')}
        >
          バイオリン
        </button>
        <button
          role="tab"
          aria-selected={tuneMode === 'voice'}
          data-on={tuneMode === 'voice'}
          onClick={() => setTuneMode('voice')}
        >
          発声
        </button>
      </div>

      {tuneMode === 'violin' ? (
        <>
          <DialGauge cents={cents} active={live} ok={ok} big={big} sub={sub} hz={hz} />

          <p
            className="tune-msg"
            data-state={!live ? 'idle' : ok ? 'ok' : cents > 0 ? 'high' : 'low'}
          >
            {!running
              ? 'マイクを開始してください'
              : !live
                ? '音を鳴らしてください'
                : ok
                  ? `${near.string.label}線 合っています`
                  : Math.abs(cents) > 50
                    ? `${near.string.label}線から大きく外れています（${cents > 0 ? '高い' : '低い'}）`
                    : `${Math.abs(cents)} cent ${cents > 0 ? '高い（緩める）' : '低い（締める）'}`}
          </p>

          <div className="strings">
            {STRINGS.map((s) => {
              const on = live && near.string.id === s.id
              return (
                <div key={s.id} className="string" data-on={on} data-ok={on && ok}>
                  <span className="string-name">{s.label}</span>
                  <span className="string-sub">
                    {s.num}・{s.ja}
                  </span>
                  <span className="string-hz">{midiToFreq(s.midi, a4).toFixed(1)} Hz</span>
                  {on && <span className="string-cents">{`${cents > 0 ? '+' : ''}${cents}`}</span>}
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <>
          <VoiceKeyboard
            reading={reading}
            active={live}
            state={!live ? 'idle' : ok ? 'ok' : cents > 0 ? 'high' : 'low'}
          />

          {/* 現在の Hz とセント偏差 */}
          <div className="voice-read" data-state={!live ? 'idle' : ok ? 'ok' : cents > 0 ? 'high' : 'low'}>
            {live ? (
              <>
                <span className="voice-hz">{reading.freq.toFixed(1)} Hz</span>
                <span className="voice-sep">/</span>
                <span className="voice-cents">
                  {cents > 0 ? '+' : ''}
                  {cents} cent
                </span>
              </>
            ) : (
              <span className="voice-hz idle">— Hz / — cent</span>
            )}
          </div>

          {/* セント偏差のバー */}
          <div className="voice-bar" data-state={!live ? 'idle' : ok ? 'ok' : cents > 0 ? 'high' : 'low'}>
            <span className="vb-zone" />
            <span className="vb-center" />
            <span
              className="vb-needle"
              style={{ left: `${50 + Math.max(-50, Math.min(50, cents))}%`, opacity: live ? 1 : 0.25 }}
            />
          </div>

          <p
            className="tune-msg"
            data-state={!live ? 'idle' : ok ? 'ok' : cents > 0 ? 'high' : 'low'}
          >
            {!running
              ? 'マイクを開始してください'
              : !live
                ? '音を鳴らしてください'
                : ok
                  ? '合っています'
                  : `${Math.abs(cents)} cent ${cents > 0 ? '高い' : '低い'}`}
          </p>

          <div className="voice-range">
            <span>固定ド表記（ドは常に C）・検出範囲 160〜1200 Hz</span>
          </div>
        </>
      )}

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
  const [tab, setTab] = useState('practice') // practice | free | tuning
  const [tuneMode, setTuneMode] = useState('violin') // violin | voice
  const [songId, setSongId] = useState(SONGS[0].id)
  const [a4, setA4] = useState(442)
  const [startMode, setStartMode] = useState('listen')
  const song = useMemo(() => SONGS.find((s) => s.id === songId), [songId])

  const [bpm, setBpm] = useState(song.bpm)
  const [time, setTime] = useState(song.time)
  const [freeKey, setFreeKey] = useState(null)
  const [autoStopped, setAutoStopped] = useState(false)

  const [sound, setSound] = useState(true)
  const [finger, setFinger] = useState(null) // 押さえている位置
  const [demoMode, setDemoMode] = useState('play') // play=指で止まる / along=止まらない
  const cards = useDragScroll()

  useEffect(() => {
    setBpm(song.bpm)
    setTime(song.time)
  }, [song])

  /* 曲が変わったら、そのカードが見える位置まで寄せる */
  const revealChild = cards.revealChild
  useEffect(() => {
    if (tab !== 'practice') return
    const i = SONGS.findIndex((s) => s.id === songId)
    if (i >= 0) revealChild(i)
  }, [songId, tab, revealChild])

  const mode = useLayoutMode()
  const blankRef = useRef([])
  const audio = useAudio()

  /* 探す音域はタブで切り替える */
  const detect = useMemo(
    () => (tab === 'tuning' ? DETECT[tuneMode] : DETECT.play),
    [tab, tuneMode]
  )

  const pitch = usePitch(a4, audio, blankRef, detect)
  const metro = useMetronome(audio, bpm, time, blankRef)
  const free = useFreeMode({ audio, pitch, metro, bpm, time, blankRef, keyOverride: freeKey })
  const synth = useViolinSynth(audio)
  const immersive = useImmersive(tab === 'finger')
  const demo = useFingerDemo({ audio, synth, a4, sound })

  const piece = tab === 'free' ? free.piece : song
  const score = useScore(tab === 'tuning' ? null : piece, time, mode)
  const session = useSession({ song, bpm, time, startMode, audio, pitch, score, metro })

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
  const busy = tab === 'practice' ? practiceBusy : tab === 'free' ? free.recording : false

  const switchTab = (next) => {
    if (next === tab) return
    session.stop()
    if (free.recording) free.stop()
    synth.release()
    demo.stop()
    setFinger(null)
    // 運指ではマイクを使わないので閉じておく
    if (next === 'finger' && pitch.running) pitch.stop()
    setTab(next)
  }

  const pressFret = useCallback(
    (row, col) => {
      // 連続モードではお手本を止めず、そのまま一緒に弾ける
      if (demoMode === 'play') demo.stop()
      const midi = STRINGS[row].midi + FRETS[col].offset
      setFinger({ row, col, midi })
      if (sound) synth.play(midiToFreq(midi, a4), `${midi}:${a4}`)
    },
    [a4, demo, demoMode, sound, synth]
  )

  const releaseFret = useCallback(() => {
    synth.release()
    // 連続モードでは指を離した印を残さない（お手本の光が見づらくなるため）
    if (demoMode === 'along' && demo.status === 'playing') setFinger(null)
  }, [demo.status, demoMode, synth])

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
    tab === 'tuning'
      ? pitch.running
        ? 'マイクを止める'
        : 'マイクを使って始める'
      : tab === 'free'
        ? free.recording
          ? `停止して採譜（${free.elapsed.toFixed(1)}秒）`
          : free.piece
            ? 'もう一度 録音する'
            : '録音を開始'
        : practiceLabel

  const onPrimary = () => {
    setAutoStopped(false)
    if (tab === 'tuning') {
      if (pitch.running) pitch.stop()
      else pitch.start()
    } else if (tab === 'free') {
      if (free.recording) free.stop()
      else free.start()
    } else if (practiceBusy) {
      session.stop()
    } else {
      session.begin()
    }
  }

  const shownFret = demo.status === 'playing' ? demo.pos.current ?? null : finger

  const micPhase =
    tab === 'tuning'
      ? pitch.running
        ? 'playing'
        : 'idle'
      : tab === 'free'
        ? free.recording
          ? 'playing'
          : 'idle'
        : session.phase

  const saveXml = () => {
    if (!free.piece) return
    const { xml } = buildScore(free.piece, time)
    const url = URL.createObjectURL(
      new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' })
    )
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
    <div className="app" data-state={tunerState} data-mode={mode} data-tab={tab} data-immersive={immersive.on}
      data-rotate={immersive.counterRotate}>
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
          <button
            role="tab"
            aria-selected={tab === 'tuning'}
            data-on={tab === 'tuning'}
            onClick={() => switchTab('tuning')}
          >
            チューニング
          </button>
          <button
            role="tab"
            aria-selected={tab === 'finger'}
            data-on={tab === 'finger'}
            onClick={() => switchTab('finger')}
          >
            運指
          </button>
        </div>

        <label className="songs-select">
          <select
            value={songId}
            onChange={(e) => setSongId(e.target.value)}
            disabled={busy || tab !== 'practice'}
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
          <div className="cards-wrap">
            <button
              className="cards-nav"
              data-side="prev"
              onClick={() => cards.nudge(-1)}
              disabled={cards.edges.start}
              aria-label="前の曲へスクロール"
            >
              ‹
            </button>

            <div className="cards" role="radiogroup" aria-label="デモ曲" ref={cards.ref}>
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

            <button
              className="cards-nav"
              data-side="next"
              onClick={() => cards.nudge(1)}
              disabled={cards.edges.end}
              aria-label="次の曲へスクロール"
            >
              ›
            </button>
          </div>
          <p className="hint">{song.note}</p>
        </section>
      )}

      {/* チューニング */}
      {tab === 'tuning' && (
        <section className="block tuning-area">
          <h2 className="label">チューニング</h2>
          <TuningPanel
            tuneMode={tuneMode}
            setTuneMode={setTuneMode}
            reading={reading}
            running={pitch.running}
            a4={a4}
          />
        </section>
      )}

      {/* 運指 */}
      {tab === 'finger' && (
        <section className="block finger-area">
          <h2 className="label">運指（第1ポジション）</h2>

          <div className="demo-row">
            <span className="demo-label">お手本</span>
            <span className="seg tiny" role="group" aria-label="お手本の動き方">
              <button data-on={demoMode === 'play'} onClick={() => setDemoMode('play')}>
                演奏
              </button>
              <button data-on={demoMode === 'along'} onClick={() => setDemoMode('along')}>
                連続
              </button>
            </span>
            <span className="demo-songs">
              {SONGS.map((sg) => (
                <button
                  key={sg.id}
                  className="mini"
                  data-on={demo.songId === sg.id}
                  onClick={() => (demo.songId === sg.id ? demo.stop() : demo.start(sg))}
                >
                  {sg.title}
                </button>
              ))}
            </span>
            {demo.status !== 'idle' && (
              <button className="mini stop" onClick={demo.stop}>
                {demo.status === 'loading' ? '準備中…' : '停止'}
              </button>
            )}
          </div>

          <FingerReadout current={shownFret} a4={a4} />
          <Fingerboard
            a4={a4}
            sound={sound}
            setSound={setSound}
            onPress={pressFret}
            onRelease={releaseFret}
            current={shownFret}
            next={demo.pos.next}
            pressed={demo.status === 'playing' ? finger : null}
            vertical={immersive.on}
          />

          <p className="hint rotate-hint">
            押している間だけ音が鳴ります。いちばん左の列は開放弦なので、指では押さえずに弾く音です。
            白＝そのままの音、<span className="sw-high">桃色＝♯</span>。
            お手本は<b>演奏</b>＝指板に触れると止まる、<b>連続</b>＝触れても止まらず一緒に弾ける。
          </p>
        </section>
      )}

      {/* 真ん中：楽譜 */}
      {tab !== 'tuning' && tab !== 'finger' && (
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

          {tab === 'practice' && session.review && session.phase === 'done' && (
            <div className="review" data-tone={session.review.rank.tone}>
              <div className="review-head">
                <span className="review-badge">{session.review.rank.badge}</span>
                <span className="review-main">
                  <span className="review-headline">{session.review.rank.headline}</span>
                  <span className="review-score">
                    {session.review.score}
                    <em>点</em>
                    <span className="review-count">
                      {session.review.total} 音中 {session.review.okCount} 音が合格
                    </span>
                  </span>
                </span>
              </div>
              <div className="review-bar">
                <span style={{ width: `${session.review.score}%` }} />
              </div>
              <ul className="review-points">
                {session.review.points.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
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
      )}

      {/* メトロノーム（チューニング中は隠す） */}
      {tab !== 'tuning' && (
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
            鳴らしながら録るとリズムが揃います。
          </p>
        </section>
      )}

      {/* 下（横画面では右）：マイクと音名 */}
      {tab !== 'finger' && (
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
                  ? '音を鳴らしてください'
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
            {A4_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v} Hz
              </option>
            ))}
          </select>
        </label>
      </section>
      )}

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
  --paper-2: #f7f7f5;
  --paper-3: #eeeeea;
  --line: #e5e5e0;
  --line-2: #d6d6cf;
  --accent: #25327a;
  --accent-soft: #eef0f9;
  --ok: #0f8a45;
  --ok-soft: #edf7f1;
  --high: #d5342b;
  --low: #1f5fd0;
  --brass: #8a6a2f;

  /* 角丸と影は3段階だけ。混ぜると散らかる */
  --r-sm: 10px;
  --r-md: 14px;
  --r-lg: 18px;
  --shadow: 0 1px 2px rgba(16,19,28,.05), 0 4px 12px rgba(16,19,28,.05);
  --shadow-press: 0 1px 2px rgba(16,19,28,.08);
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
  padding: 9px 4px;
  border: 0;
  border-radius: 9px;
  background: none;
  color: var(--ink-60);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background .15s, color .15s;
}
.tabs button[data-on="true"] {
  background: var(--paper);
  color: var(--accent);
  box-shadow: var(--shadow-press);
}
.songs-select { display: none; }

/* 各セクションの容れ物 */
.block { min-width: 0; }

.label {
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .14em;
  color: var(--ink-60);
  display: flex;
  align-items: center;
  gap: 10px;
}
/* 見出しの右へ細い罫線を伸ばして、区切りを目で追えるようにする */
.label::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line);
}
.label .tag { flex: 0 0 auto; order: 1; }

/* 曲カード */
.cards-wrap { position: relative; }
.cards {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.cards::-webkit-scrollbar { display: none; }
/* ドラッグ中はスナップを切る（引っかかって動かなくなるため） */
.cards[data-dragging="on"] {
  scroll-snap-type: none;
  scroll-behavior: auto;
}

/* 左右の送りボタン。マウスのある環境にだけ出す */
.cards-nav { display: none; }
@media (hover: hover) and (pointer: fine) {
  .cards { cursor: grab; }
  .cards[data-dragging="on"] { cursor: grabbing; }
  .cards[data-dragging="on"] .card { cursor: grabbing; }
  .cards-nav {
    display: flex;
    align-items: center;
    justify-content: center;
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 2;
    width: 30px;
    height: 30px;
    padding: 0 0 3px;
    border: 1px solid var(--line);
    border-radius: 50%;
    background: var(--paper);
    color: var(--accent);
    font-size: 19px;
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 1px 6px rgba(16,19,28,.14);
    transition: opacity .15s;
  }
  .cards-nav[data-side="prev"] { left: -10px; }
  .cards-nav[data-side="next"] { right: -10px; }
  .cards-nav:disabled { opacity: 0; pointer-events: none; }
}
.card {
  flex: 0 0 64%;
  scroll-snap-align: start;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 13px 14px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--paper);
  cursor: pointer;
  transition: border-color .16s, background .16s, box-shadow .16s;
}
.card[data-on="true"] {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: var(--shadow);
}
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

/* ---------- チューニング ---------- */
.tuning { display: flex; flex-direction: column; gap: 14px; }

/* 対象の切り替え（バイオリン／発声） */
.seg {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--paper-2);
  border-radius: 12px;
}
.seg button {
  flex: 1;
  padding: 10px;
  border: 0;
  border-radius: 9px;
  background: none;
  color: var(--ink-60);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s, color .15s;
}
.seg button[data-on="true"] {
  background: var(--paper);
  color: var(--accent);
  box-shadow: var(--shadow-press);
}

/* アナログ文字盤 */
.dial {
  border-radius: var(--r-md);
  overflow: hidden;
  border: 1px solid var(--line);
}
.dial-svg { display: block; width: 100%; height: auto; }
.dial-tick { stroke: #b9a887; }
.dial-tick.major { stroke: var(--brass); }
.dial-zone { fill: rgba(15,138,69,.14); }
.dial[data-state="ok"] .dial-zone { fill: rgba(15,138,69,.3); }
.dial-needle { stroke: #3a3226; stroke-width: 2.5; stroke-linecap: round; }
.dial[data-state="ok"] .dial-needle { stroke: var(--ok); }
.dial[data-state="high"] .dial-needle { stroke: var(--high); }
.dial[data-state="low"] .dial-needle { stroke: var(--low); }
.dial-hub { fill: #3a3226; }
.dial[data-state="ok"] .dial-hub { fill: var(--ok); }
.dial[data-state="high"] .dial-hub { fill: var(--high); }
.dial[data-state="low"] .dial-hub { fill: var(--low); }
.dial-big {
  font-family: Iowan Old Style, "Times New Roman", serif;
  font-size: 46px;
  font-weight: 600;
  fill: #3a3226;
}
.dial-sub { font-size: 22px; }
.dial-hz { font-size: 13px; fill: var(--brass); letter-spacing: .04em; }
.dial-zero { font-size: 13px; fill: var(--brass); font-weight: 700; }
.dial-unit { font-size: 8px; fill: #b9a887; letter-spacing: .3em; }
.dial-edge { font-size: 10px; fill: #b9a887; letter-spacing: .06em; }

/* 状態の一言。ここだけ見れば次の操作が分かるようにする */
.tune-msg {
  margin: 0;
  padding: 11px 12px;
  text-align: center;
  font-size: 14px;
  font-weight: 700;
  color: var(--ink-30);
  background: var(--paper-2);
  border-radius: var(--r-sm);
  font-variant-numeric: tabular-nums;
}
.tune-msg[data-state="ok"] { color: var(--ok); background: var(--ok-soft); }
.tune-msg[data-state="high"] { color: var(--high); background: #fdf1f0; }
.tune-msg[data-state="low"] { color: var(--low); background: #eef2fd; }

/* 4本の弦 */
.strings { display: flex; gap: 8px; }
.string {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 12px 2px 10px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--paper);
  transition: border-color .15s, background .15s, box-shadow .15s;
}
.string[data-on="true"] {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: var(--shadow);
}
.string[data-ok="true"] {
  border-color: var(--ok);
  background: var(--ok-soft);
}
.string-name {
  font-family: Iowan Old Style, "Times New Roman", serif;
  font-size: 23px;
  font-weight: 600;
  line-height: 1;
  color: var(--ink);
}
.string[data-on="true"] .string-name { color: var(--accent); }
.string[data-ok="true"] .string-name { color: var(--ok); }
.string-sub { font-size: 9.5px; color: var(--ink-60); }
.string-hz { font-size: 9.5px; color: var(--ink-30); font-variant-numeric: tabular-nums; }
.string-cents {
  position: absolute;
  top: -9px;
  right: -3px;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  box-shadow: var(--shadow-press);
  font-variant-numeric: tabular-nums;
}
.string[data-ok="true"] .string-cents { background: var(--ok); }
.voice-range { text-align: center; font-size: 11px; color: var(--ink-30); }

/* 発声モードの鍵盤 */
.kb { display: flex; flex-direction: column; gap: 10px; }
.kb-svg { display: block; width: 100%; height: auto; }
.kb-white {
  fill: var(--paper);
  stroke: var(--line-2);
  stroke-width: 1;
  transition: fill .1s;
}
.kb-black { fill: #2a2d38; transition: fill .1s; }
.kb-label {
  font-size: 13px;
  fill: var(--ink-60);
  font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
  font-weight: 600;
}
.kb-sharp {
  font-size: 9px;
  fill: #ff8b84;
  font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
  font-weight: 700;
}
.kb-flat {
  font-size: 9px;
  fill: #8fb4f2;
  font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
  font-weight: 700;
}
.kb-oct-on { font-size: 11px; fill: #fff; font-weight: 700; opacity: .85; }
.kb-now {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
  min-height: 40px;
}
.kb-now-name {
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: .02em;
}
.kb-now-name.idle { color: var(--ink-30); }
.kb-now-oct { font-size: 18px; color: var(--ink-30); font-weight: 600; }
.kb-now-alt { font-size: 11px; color: var(--ink-60); }

.voice-read {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  color: var(--ink-60);
  font-variant-numeric: tabular-nums;
}
.voice-read[data-state="ok"] .voice-cents { color: var(--ok); font-weight: 700; }
.voice-read[data-state="high"] .voice-cents { color: var(--high); font-weight: 700; }
.voice-read[data-state="low"] .voice-cents { color: var(--low); font-weight: 700; }
.voice-sep { color: var(--ink-30); }
.voice-hz { color: var(--ink); font-weight: 600; }
.voice-hz.idle { color: var(--ink-30); font-weight: 400; }

.voice-bar {
  position: relative;
  height: 24px;
  border-radius: var(--r-sm);
  background: var(--paper-2);
  overflow: hidden;
}
.vb-zone {
  position: absolute; bottom: 0; left: 45%; width: 10%; height: 100%;
  background: rgba(15,138,69,.12);
}
.vb-center {
  position: absolute; bottom: 0; left: 50%; width: 1px; height: 100%;
  background: var(--line-2); transform: translateX(-50%);
}
.vb-needle {
  position: absolute; bottom: 0; width: 3px; height: 100%; border-radius: 2px;
  background: var(--ink-30); transform: translateX(-50%);
  transition: left .07s linear, background .12s;
}
.voice-bar[data-state="ok"] .vb-needle { background: var(--ok); }
.voice-bar[data-state="high"] .vb-needle { background: var(--high); }
.voice-bar[data-state="low"] .vb-needle { background: var(--low); }

/* ---------- 譜面まわりの操作 ---------- */
.score-controls {
  margin-top: 12px;
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.score-count {
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex: 1;
}
/* 小さめのボタンとセレクトは全部この形にそろえる */
.mini {
  font-size: 12px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
  white-space: nowrap;
  transition: background .15s, border-color .15s, color .15s;
}
.mini:disabled { color: var(--ink-30); cursor: default; background: var(--paper-2); }
.mini.grow { flex: 1; }
/* 押している間だけ色が反転するトグル（音あり／クリック など） */
.toggle[data-on="true"] {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

/* ---------- 演奏の講評 ---------- */
.review {
  margin: 12px 0 0;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: 15px 14px;
  background: var(--paper-2);
}
.review[data-tone="ok"] { border-color: #bfe0cd; background: var(--ok-soft); }
.review-head { display: flex; align-items: center; gap: 13px; }
.review-badge {
  width: 44px; height: 44px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%;
  font-family: Iowan Old Style, "Times New Roman", serif;
  font-size: 22px; font-weight: 700;
  background: var(--ink-30); color: #fff;
}
.review[data-tone="ok"] .review-badge { background: var(--ok); }
.review-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.review-headline { font-size: 15px; font-weight: 700; }
.review[data-tone="ok"] .review-headline { color: var(--ok); }
.review-score {
  display: flex; align-items: baseline; gap: 6px;
  font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums;
}
.review-score em { font-style: normal; font-size: 11px; font-weight: 500; color: var(--ink-60); }
.review-count { font-size: 11px; font-weight: 500; color: var(--ink-60); }
.review-bar {
  margin-top: 12px; height: 6px; border-radius: 3px;
  background: var(--paper-3); overflow: hidden;
}
.review-bar span {
  display: block; height: 100%; border-radius: 3px;
  background: var(--ink-30); transition: width .5s ease-out;
}
.review[data-tone="ok"] .review-bar span { background: var(--ok); }
.review-points {
  margin: 11px 0 0; padding-left: 18px;
  font-size: 12px; color: var(--ink-60); line-height: 1.7;
}
.review-points li { margin-top: 2px; }

/* ---------- 楽譜 ---------- */
.score {
  position: relative;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--paper);
  min-height: 220px;
  padding: 12px 8px;
  overflow-x: hidden;
  transition: border-color .2s, box-shadow .2s;
}
/* 演奏中は枠を立てて「今動いている」ことを示す */
.score[data-playing="true"] {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
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
  border-radius: var(--r-md);
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
  padding: 1px 6px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid var(--c);
  color: var(--c);
  box-shadow: var(--shadow-press);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.5;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.mark-arrow { font-size: 8px; }

/* ---------- 運指 ---------- */
.fb { display: flex; flex-direction: column; gap: 10px; }
.fb-svg {
  display: block;
  width: 100%;
  height: auto;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.fb-board { fill: #201d1a; }
.fb-nut { fill: #ded6c4; }
.fb-string { stroke: #cfc9bd; }
.fb-dot { cursor: pointer; }
.fb-pad {
  fill: #ffffff;
  stroke: #cfcfc8;
  stroke-width: 1;
  transition: fill .08s, stroke .08s;
}
.fb-dot[data-sharp="true"] .fb-pad { fill: #f6cfe0; stroke: #e6aec7; }
.fb-dot[data-on="true"] .fb-pad { fill: var(--accent); stroke: var(--accent); }
.fb-dot[data-sharp="true"][data-on="true"] .fb-pad { fill: var(--high); stroke: var(--high); }
.fb-text {
  font-size: 15px;
  font-weight: 700;
  fill: #2a2d38;
  font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
  pointer-events: none;
}
.fb-dot[data-on="true"] .fb-text { fill: #fff; }
.fb-bracket { fill: none; stroke: var(--ink-30); stroke-width: 1.5; }
.fb-finger {
  font-size: 15px;
  font-weight: 700;
  fill: var(--ink-60);
  font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
}
.fb-legend {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.fb-strings {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: 10.5px;
  color: var(--ink-30);
  font-variant-numeric: tabular-nums;
}

/* 押さえた音の表示（高さを固定して指板を動かさない） */
.fr {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  height: 62px;
  margin-bottom: 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--paper-2);
  overflow: hidden;
}
.fr-jp {
  flex-shrink: 0;
  display: flex;
  align-items: baseline;
  font-size: 30px;
  font-weight: 700;
  line-height: 1;
  color: var(--accent);
  white-space: nowrap;
}
.fr[data-sharp="true"] .fr-jp { color: var(--high); }
.fr[data-idle="true"] .fr-jp { color: var(--ink-30); }
.fr-oct { font-size: 16px; color: var(--ink-30); margin-left: 3px; }
.fr-rest {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  overflow: hidden;
}
.fr-alt {
  font-size: 11px;
  color: var(--low);
  font-weight: 700;
  white-space: nowrap;
}
.fr-meta { font-size: 12px; color: var(--ink-60); white-space: nowrap; }
.fr-hz {
  font-size: 10.5px;
  color: var(--ink-30);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.fr-msg { font-size: 12px; color: var(--ink-30); white-space: nowrap; }
.fb-actions { display: flex; gap: 6px; flex-shrink: 0; }

/* 次に押さえる場所を薄く光らせる（音ゲー式の予告） */
.fb-dot[data-next="true"] .fb-pad {
  fill: #c9d0ee;
  stroke: var(--accent);
  stroke-width: 2;
}
.fb-dot[data-sharp="true"][data-next="true"] .fb-pad { fill: #f2c7d8; stroke: var(--high); }
.fb-dot[data-next="true"] .fb-text { fill: var(--accent); }

/* 連続モードで自分が押している場所（お手本の光と重ねて見せる） */
.fb-dot[data-held="true"] .fb-pad {
  stroke: var(--ink);
  stroke-width: 4;
}

/* お手本の選択 */
.demo-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.demo-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .1em;
  color: var(--ink-60);
  flex-shrink: 0;
}
.seg.tiny {
  flex-shrink: 0;
  padding: 3px;
  border-radius: 9px;
  gap: 2px;
}
.seg.tiny button { padding: 5px 9px; font-size: 11px; border-radius: 7px; }
.demo-songs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  flex: 1;
  min-width: 0;
}
.demo-songs::-webkit-scrollbar { display: none; }
.demo-songs .mini { flex-shrink: 0; }
.demo-songs .mini[data-on="true"] {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.demo-row .stop {
  flex-shrink: 0;
  color: var(--high);
  border-color: #f0d5d3;
  background: #fdf1f0;
  font-weight: 600;
}

/* ---------- マイクと音名 ---------- */
.readout-block {
  border-top: 1px solid var(--line);
  padding-top: 22px;
}
/* 音名・メーター・レベルをひとつの計器としてまとめる */
.readout {
  text-align: center;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--paper);
  padding: 18px 16px 14px;
}
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
.note-name { font-size: 68px; font-weight: 500; letter-spacing: -.02em; }
.note-name sup { font-size: 28px; }
.note-oct { font-size: 24px; color: var(--ink-30); }
.freq {
  margin-top: 8px;
  font-size: 12px;
  color: var(--ink-60);
  font-variant-numeric: tabular-nums;
}

/* メーター：中央が基準、緑の帯が合格の幅 */
.meter { margin-top: 18px; }
.meter-scale {
  position: relative;
  height: 46px;
  border-radius: var(--r-sm);
  background: var(--paper-2);
  overflow: hidden;
}
.tick {
  position: absolute; bottom: 0; width: 1px; height: 9px;
  background: var(--ink-30); opacity: .55; transform: translateX(-50%);
}
.tick[data-center="true"] { height: 100%; background: var(--line-2); opacity: 1; }
.meter-zone {
  position: absolute; bottom: 0; left: 42%; width: 16%; height: 100%;
  background: rgba(15,138,69,.1);
}
.needle {
  position: absolute; bottom: 0; width: 3px; height: 100%;
  background: var(--ink-30); transform: translateX(-50%);
  transition: left .07s linear, background .12s; border-radius: 2px;
}
.meter[data-state="ok"] .needle { background: var(--ok); }
.meter[data-state="high"] .needle { background: var(--high); }
.meter[data-state="low"] .needle { background: var(--low); }
.meter-labels {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 8px;
  font-size: 11px; color: var(--ink-30);
}
.lab-low { color: var(--low); }
.lab-high { color: var(--high); }
.cents {
  color: var(--ink);
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* 入力レベル */
.level {
  margin-top: 14px;
  height: 4px;
  background: var(--paper-3);
  border-radius: 2px;
  overflow: hidden;
}
.level-bar {
  height: 100%;
  background: var(--accent);
  opacity: .4;
  border-radius: 2px;
  transition: width .08s linear;
}

/* 操作。主ボタンは常に画面の同じ高さに来るようにしてある */
.controls { margin-top: 14px; display: flex; align-items: stretch; gap: 10px; }
.mic {
  flex: 1; padding: 16px 10px; border: 0; border-radius: var(--r-md);
  background: var(--accent); color: #fff; font-size: 15px; font-weight: 700;
  cursor: pointer; font-variant-numeric: tabular-nums;
  box-shadow: var(--shadow);
  transition: background .15s;
}
.mic[data-phase="armed"] { background: #6b74a8; }
.mic[data-phase="countin"] { background: var(--ink); }
.mic[data-phase="playing"] { background: var(--ok); }
.reset {
  padding: 0 18px; border: 1px solid var(--line); border-radius: var(--r-md);
  background: var(--paper); color: var(--ink-60); font-size: 13px; cursor: pointer;
}
.reset:disabled { color: var(--ink-30); cursor: default; }
.a4 {
  margin-top: 12px; font-size: 11px; color: var(--ink-60);
  display: flex; align-items: center; gap: 8px;
}
.a4 select {
  font-size: 13px; padding: 7px 10px; border: 1px solid var(--line);
  border-radius: var(--r-sm); background: var(--paper); color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.error { margin: 14px 0 0; font-size: 12px; color: var(--high); line-height: 1.6; }
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
  font-size: 11px; color: var(--high); background: var(--paper-2);
  padding: 10px 12px; border-radius: var(--r-sm);
  white-space: pre-wrap; word-break: break-word;
}
.crash button {
  margin-top: 14px; padding: 12px 18px; border: 0; border-radius: var(--r-md);
  background: var(--accent); color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;
}

button:focus-visible, select:focus-visible, input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }

/* ---------- 全画面（没入モード） ---------- */
.turn-hint {
  margin: 8px 0 0;
  text-align: center;
  font-size: 11px;
  color: var(--ink-30);
}

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
  .tabs button { padding: 5px 9px; font-size: 11px; }
  .songs-select { display: block; margin-left: auto; }
  .songs-select select {
    font-size: 12px; padding: 5px 8px; border: 1px solid var(--line);
    border-radius: 8px; background: var(--paper); color: var(--ink); max-width: 30vw;
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
  .review { margin-top: 6px; padding: 8px 10px; border-radius: var(--r-sm); }
  .review-badge { width: 30px; height: 30px; font-size: 15px; }
  .review-headline { font-size: 12px; }
  .review-score { font-size: 15px; }
  .review-points { font-size: 10px; margin-top: 6px; }

  /* チューニングは左を全部使う */
  .tuning-area {
    grid-column: 1; grid-row: 2 / span 2;
    min-height: 0; display: flex; flex-direction: column;
  }
  .tuning { gap: 8px; min-height: 0; flex: 1; }
  .seg { padding: 3px; }
  .seg button { padding: 6px; font-size: 11px; }
  .tune-msg { padding: 6px 8px; }
  .dial { flex: 1; min-height: 0; display: flex; }
  .dial-svg { height: 100%; width: auto; margin: 0 auto; }
  .tune-msg { font-size: 12px; }
  .strings { gap: 6px; }
  .string { padding: 7px 2px 6px; border-radius: var(--r-sm); gap: 1px; }
  .string-name { font-size: 16px; }
  .string-sub, .string-hz { font-size: 8.5px; }
  .voice-range { font-size: 9px; }

  .finger-area {
    grid-column: 1; grid-row: 2 / span 2;
    min-height: 0; display: flex; flex-direction: column; gap: 4px;
  }
  .fb { flex: 1; min-height: 0; gap: 5px; }
  .fb-svg { flex: 1; min-height: 0; max-height: 100%; width: auto; margin: 0 auto; }
  .fb-legend { gap: 6px; }
  .fb-strings { font-size: 9px; gap: 2px 7px; }
  .fr {
    padding: 0 10px; margin-bottom: 0; border-radius: var(--r-sm);
    height: 46px; gap: 10px;
  }
  .fr-jp { font-size: 20px; }
  .fr-oct { font-size: 12px; }
  .fr-alt, .fr-meta { font-size: 10px; }
  .fr-hz, .fr-msg { font-size: 9px; }

  .kb { gap: 5px; flex: 1; min-height: 0; }
  .kb-svg { flex: 1; min-height: 0; max-height: 100%; width: auto; margin: 0 auto; }
  .kb-now { min-height: 26px; }
  .kb-now-name { font-size: 22px; }
  .kb-now-oct { font-size: 13px; }
  .kb-now-alt { font-size: 9px; }
  .voice-read { font-size: 10px; }
  .voice-bar { height: 16px; }

  .readout-block {
    grid-column: 2; grid-row: 2; min-height: 0;
    border-top: 0; padding-top: 0;
    display: flex; flex-direction: column; justify-content: center;
  }
  .readout { padding: 10px 10px 8px; border-radius: var(--r-sm); }
  .note-name { font-size: 38px; }
  .note-name sup { font-size: 17px; }
  .note-oct { font-size: 15px; }
  .freq { margin-top: 3px; font-size: 10px; }
  .meter { margin-top: 8px; }
  .meter-scale { height: 22px; }
  .meter-labels { font-size: 9px; margin-top: 4px; }
  .cents { font-size: 10px; }
  .level { margin-top: 7px; }
  .controls { margin-top: 8px; gap: 6px; }
  .mic { padding: 11px 6px; font-size: 12px; border-radius: var(--r-sm); }
  .reset { padding: 0 10px; font-size: 11px; border-radius: var(--r-sm); }
  .a4 { margin-top: 6px; font-size: 10px; }
  .a4 select { font-size: 11px; padding: 3px 6px; }
  .error, .notice { margin-top: 6px; font-size: 10px; }

  .metronome { grid-column: 2; grid-row: 3; }
  .metro { padding: 9px 8px 8px; gap: 8px; border-radius: var(--r-sm); }
  .beats { height: 12px; gap: 7px; }
  .beat { width: 8px; height: 8px; }
  .metro-row { gap: 6px; }
  .bpm { font-size: 10px; padding: 1px; }
  .bpm button { width: 22px; height: 22px; font-size: 13px; }
  .bpm-val { padding: 0 5px; }
  .bpm-val b { font-size: 15px; }
  .metro-btn { padding: 7px; font-size: 11px; }
  .bpm-slider { display: none; }
}

/* ============================================================
 *  運指タブのレイアウト
 *  画面を覆うモーダルにはしない。タブは出したままにして、
 *  別のタブを押せばそれがそのまま「戻る」操作になる。
 *  横画面のメディアクエリより後ろに置いて上書きする。
 * ============================================================ */
.app[data-immersive="true"] {
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  gap: 10px;
  padding:
    calc(10px + env(safe-area-inset-top))
    calc(12px + env(safe-area-inset-right))
    calc(10px + env(safe-area-inset-bottom))
    calc(12px + env(safe-area-inset-left));
}
.app[data-immersive="true"] .metronome,
.app[data-immersive="true"] .foot,
.app[data-immersive="true"] .songs,
.app[data-immersive="true"] .score-area,
.app[data-immersive="true"] .tuning-area,
.app[data-immersive="true"] .readout-block,
.app[data-immersive="true"] .finger-area > .label,
.app[data-immersive="true"] .rotate-hint { display: none; }

/* 見出しは畳んで、タブだけを細く残す */
.app[data-immersive="true"] .head { flex: 0 0 auto; }
.app[data-immersive="true"] .head h1 { display: none; }
.app[data-immersive="true"] .head-sub { display: none; }
.app[data-immersive="true"] .songs-select { display: none; }
.app[data-immersive="true"] .tabs { margin-top: 0; padding: 3px; }
.app[data-immersive="true"] .tabs button { padding: 7px 4px; font-size: 12px; }

.app[data-immersive="true"] .finger-area {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.app[data-immersive="true"] .fr {
  margin-bottom: 0;
  height: 54px;
  flex: 0 0 auto;
}
.app[data-immersive="true"] .fb { flex: 1; min-height: 0; gap: 8px; }
.app[data-immersive="true"] .fb-svg { flex: 1; min-height: 0; width: 100%; height: 100%; }
.app[data-immersive="true"] .fb-legend { flex: 0 0 auto; }
.app[data-immersive="true"] .fb-strings { font-size: 10px; }
.app[data-immersive="true"] .demo-row { margin-bottom: 0; flex: 0 0 auto; gap: 6px; }
.app[data-immersive="true"] .demo-label { display: none; }
.app[data-immersive="true"] .demo-row .mini { padding: 6px 9px; font-size: 11px; }
.app[data-immersive="true"] .seg.tiny button { padding: 4px 8px; font-size: 10px; }

/* 端末が横を向いても、画面ごと回して縦のまま見せる */
.app[data-rotate="true"] {
  position: fixed;
  top: 0;
  left: 0;
  max-width: none;
  width: 100vh;
  height: 100vw;
  transform-origin: 0 0;
  transform: translateY(100vh) rotate(-90deg);
  padding: 12px;
}
`
