# pitch-rec

マイクで拾ったバイオリンの音をリアルタイムに解析し、楽譜と照らして音程を判定する練習アプリ。
単音のみ対応（重音は対象外）。

## 現在の状態 — Step 1: チューナー

- マイク入力から基本周波数を検出し、音名・オクターブ・Hz・セント誤差を表示
- 針式メーター（±50セント）。±8セント以内で緑、外れると赤
- デモ曲4曲の選択UI（きらきら星 / 歓喜の歌 / アメイジング・グレイス / メヌエット ト長調）
- 楽譜エリアはプレースホルダ（Step 2 で OpenSheetMusicDisplay を描画）

データはすべてブラウザ内で処理され、サーバーには何も送信しません。

## 動かす

Node.js 20.19 以上（または 22.12 以上）が必要です。

```bash
npm install
npm run dev
```

http://localhost:5173 を開き、「マイクを使って始める」を押してマイクを許可してください。

> マイク（getUserMedia）は **https か localhost でのみ**動作します。
> `npm run dev -- --host` でLAN内のIPから開くとマイクが拒否されるため、
> 実機確認は Vercel にデプロイしてから行うのが確実です。

## デプロイ（Vercel）

GitHub リポジトリを Vercel に接続すれば設定なしで動きます（フレームワーク: Vite、ビルド: `npm run build`、出力: `dist`）。

## 構成

```
pitch-rec/
├── index.html
├── package.json
├── vite.config.js
├── public/
│   └── clef.svg
└── src/
    ├── main.jsx
    └── App.jsx      ← アプリ本体（UI・ピッチ検出・曲データを1ファイルに集約）
```

## 使っているもの

| 用途 | ライブラリ |
| --- | --- |
| 音程検出 | [pitchy](https://github.com/ianprime0509/pitchy)（McLeod Pitch Method） |
| 楽譜表示 | [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/)（Step 2 で使用） |
| ビルド | Vite + React |

## 検出パラメータ

`src/App.jsx` 冒頭の定数で調整できます。

| 定数 | 既定値 | 意味 |
| --- | --- | --- |
| `CLARITY_MIN` | 0.88 | pitchy の信頼度しきい値。下げると拾いやすく、誤検出も増える |
| `RMS_MIN` | 0.008 | 無音ゲート |
| `MIN_HZ` / `MAX_HZ` | 170 / 3200 | バイオリンの音域外を除外 |
| `HOLD_MS` | 350 | 音が切れてから表示を消すまでの時間 |
| `IN_TUNE_CENTS` | 8 | 「合っている」とみなす許容セント |

マイクは `echoCancellation` / `noiseSuppression` / `autoGainControl` をすべて無効にしています。
有効だと楽器の音が加工され、音程が正しく取れません。

## この先の予定

1. **Step 2** — 曲データ（音名配列）から MusicXML を生成し、OSMD で五線譜を描画
2. **Step 3** — 弾いている位置の追従と、正誤判定・赤色表示
3. **Step 4** — 小節ごとの講評（音声）
4. 練習記録の保存（本番段階で Upstash / Redis を導入予定。現時点では未使用）

## ライセンス

収録しているデモ曲はいずれもパブリックドメインです。
