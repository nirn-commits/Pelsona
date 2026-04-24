# Pelsona

LLM の API を使って、自由に設定したキャラクターとチャットできる単体 Web アプリです。ビルド不要、静的ファイル (`index.html` / `styles.css` / `app.js`) のみで動きます。

## 特徴

- 画面下部に **4 つの正方形スロット** を配置
  - 左端 (スロット 0) は **自分 (YOU)**
  - 残り 3 枠に任意のキャラを設定可能
- 各スロットには **画像を自由に登録** できる (PNG/JPEG 等、ローカル読込)
- 自分以外のキャラをクリックすると **選択 → チャットモード**
  - 複数キャラを同時に選ぶとグループ会話になる (LLM が各キャラを演じ分ける)
- キャラごとに **設定 (人格・背景)** と **口調 (話し方の特徴)** を登録可能
- API キー・キャラ設定・会話履歴はすべて **ブラウザの localStorage** に保存
- **Google Gemini** / **Anthropic (Claude)** / **OpenAI 互換 API** に対応

## 使い方

1. `index.html` をブラウザで開く (`file://` でも動作します)。
2. 右上の「⚙ API」から LLM の API を設定
   - **Google Gemini**: [Google AI Studio](https://aistudio.google.com/apikey) で取得した API キーを入力。モデル名は `gemini-2.5-flash` / `gemini-2.5-pro` / `gemini-2.0-flash` など。
   - **Anthropic (Claude)**: API キーを入力、モデル名は例えば `claude-opus-4-7`
   - **OpenAI 互換**: API キー、エンドポイント (`https://api.openai.com/v1` や LM Studio の `http://localhost:1234/v1` 等)、モデル名
3. 下部の空きスロットをクリックし、名前 / 画像 / キャラ設定 / 口調 / 最初の一言 を入力
4. 会話したいキャラをクリックして選択 (枠が青く光る)。複数選択で同時会話。
5. 下のテキストエリアにメッセージを書いて送信

### 複数キャラ会話について

複数キャラを選択すると、LLM には次の形式で返答するよう指示します:

```
[キャラA] セリフ…
[キャラB] セリフ…
```

アプリ側でこれをパースし、それぞれのキャラのメッセージとして吹き出しに分けて表示します。

## ファイル構成

```
.
├── index.html   画面構造
├── styles.css   ダークテーマのスタイル
├── app.js       状態管理・LLM 呼び出し・チャット処理
└── README.md
```

## セキュリティ上の注意

- API キーはブラウザの `localStorage` に平文で保存されます。共有端末での利用は避けてください。
- Gemini / Anthropic / OpenAI いずれもブラウザから直接 API を叩きます (Anthropic は `anthropic-dangerous-direct-browser-access: true` を付与)。本番用途 (不特定多数が使うサイト) では、API キーを隠蔽するためのバックエンドプロキシを挟むことを推奨します。
- 画像はデータ URL として localStorage に保存されるため、大きすぎる画像を多数登録するとブラウザのストレージ上限に達する可能性があります。アプリ側で長辺 512px に縮小保存しています。

## カスタマイズのヒント

- スロット数を変えたい場合: `app.js` の `SLOT_COUNT` と `index.html` 側の `.slot-bar` (`grid-template-columns: repeat(4, 1fr)`) を同時に変更。
- プロンプトを調整したい場合: `buildSystemPrompt()` を編集。
- ストリーミング応答に対応したい場合: `callGemini` / `callAnthropic` / `callOpenAI` を SSE 対応に置き換え、`parseAssistantReply` を逐次呼び出す設計に変更。
