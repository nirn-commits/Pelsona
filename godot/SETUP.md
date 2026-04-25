# Dungeon Dialogue System – Godot 4 Setup Guide

Pelsona の LLM キャラチャットフレームワークを Godot 4 の 3D RPG に統合するシステムです。

## ファイル構成

```
godot/
  autoloads/
    DialogueManager.gd   コア: LLM呼び出し・プロンプト構築・返答パース
    DungeonContext.gd    グローバルダンジョン状態 (フロア・部屋・クエスト)
  resources/
    CharacterData.gd     NPC キャラ定義リソース
    DialogueChat.gd      会話セッション状態 (履歴・シチュエーション)
  scripts/
    DialogueUI.gd        会話 UI (CanvasLayer) コントローラー
    NpcDialogueTrigger.gd  Area3D: プレイヤー接近→対話開始
    DungeonNpc.gd        NPC 基底クラス
  scenes/
    DialogueUI.tscn      会話 UI シーン
    DungeonNpc.tscn      NPC 基底シーン
```

## 1. Autoload 登録

Project > Project Settings > Autoload に以下を追加:

| Path                              | Name             |
|-----------------------------------|------------------|
| `res://autoloads/DungeonContext.gd`  | `DungeonContext`  |
| `res://autoloads/DialogueManager.gd` | `DialogueManager` |

順序は DungeonContext → DialogueManager の順にすること。

## 2. API キー設定

Project Settings > General タブ下部の検索欄で `dialogue` を検索し、
Advanced Settings を ON にして以下を追加:

| Setting                    | 型      | 例                      |
|----------------------------|---------|-------------------------|
| `dialogue/api_key`         | String  | `AIzaSy...`             |
| `dialogue/api_provider`    | int     | `0`=Gemini `1`=Anthropic `2`=OpenAI |
| `dialogue/api_model`       | String  | `gemini-2.5-flash`      |
| `dialogue/temperature`     | float   | `0.8`                   |
| `dialogue/max_tokens`      | int     | `1024`                  |
| `dialogue/api_base`        | String  | (OpenAI互換時のみ)       |

## 3. DialogueUI シーンの配置

1. `scenes/DialogueUI.tscn` をメインシーン (またはインゲームHUD) の子として追加
2. シーン名は `DialogueUI`、ルートノードを AutoLoad として `/root/DialogueUI` で参照

## 4. NPC の作成

### キャラデータ作成

1. FileSystem で右クリック > New Resource > `CharacterData`
2. `character_name`, `persona`, `tone`, `greeting` を入力
3. `portrait` にキャラ画像を設定

### NPC シーン

1. `scenes/DungeonNpc.tscn` をベースにシーンを作成
2. DungeonNpc ノードの `Character` プロパティに上記リソースを割り当て
3. `Trigger Radius` で会話開始距離を調整
4. `DialogueTrigger` の `Situation Override` にこの NPC 固有のシチュエーションを書く

```
例: 宝箱番の精霊
situation_override = """
地下3階の宝物庫前。精霊は長年この宝箱を守り続けている。
プレイヤーが近づくと警戒するが、敵意はない。
"""
```

## 5. ダンジョン状態の更新

ダンジョン遷移スクリプトから DungeonContext を更新:

```gdscript
# ダンジョン開始
DungeonContext.set_dungeon("呪われた地下迷宮", 1)
DungeonContext.world_name = "剣と魔法の異世界"
DungeonContext.player_name = "アレン"
DungeonContext.active_quest = "魔王復活の核となる「暗黒の宝珠」を破壊せよ"

# 部屋遷移時
DungeonContext.set_room("宝部屋", "古ぼけた石棚に宝箱が並んでいる。奥から微かに光が漏れている。")

# 次のフロアへ
DungeonContext.advance_floor()
```

## 6. 会話の開始 (コードから)

```gdscript
# NPC に DungeonNpc.gd がついていれば
$SomeNpc.speak("プレイヤーが扉の前で立ち往生している。")

# 直接 DialogueManager を呼ぶ場合
var char_data: CharacterData = preload("res://characters/sage_elder.tres")
DialogueManager.start_dialogue(char_data, "洞窟の最深部。老賢者は瀕死の状態で横たわっている。")
```

## 7. 応答文量の変更

```gdscript
DialogueManager.response_length = "long"  # short / normal / long / very_long
```

## Pelsona → Godot 対応表

| Pelsona 機能           | Godot 実装                                      |
|------------------------|-------------------------------------------------|
| キャラスロット          | `CharacterData` リソース                         |
| 世界観設定             | `DungeonContext.world_name / world_description`  |
| シチュエーション        | `DialogueManager.start_dialogue(char, situation)` |
| 引き継ぎメモ           | `start_dialogue(char, situation, carryover)`      |
| [地の文] 地の文モード   | `send_player_message(text, is_narration=true)`    |
| 再生成                 | (履歴末尾を削除して `send_player_message` を再呼出し) |
| 複数チャット            | `DialogueChat` を別インスタンスで生成            |
| Gemini/Anthropic/OpenAI | `DialogueManager.api_provider` で切替           |
