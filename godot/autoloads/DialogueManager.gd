## DialogueManager.gd  –  Autoload
## Core LLM dialogue engine ported from Pelsona (app.js).
## Handles prompt construction, API calls, and reply parsing.
extends Node

# ── Signals ─────────────────────────────────────────────────────────────────
signal dialogue_started(chat: DialogueChat)
signal message_received(msg: Dictionary)   # {role, name, content, narration}
signal typing_started
signal typing_stopped
signal dialogue_ended
signal error_occurred(msg: String)

# ── API config (set via Project Settings or a config file) ───────────────────
enum Provider { GEMINI, ANTHROPIC, OPENAI }

var api_provider: Provider = Provider.GEMINI
var api_key: String = ""
var api_base: String = ""             # override endpoint (OpenAI-compat)
var api_model: String = "gemini-2.5-flash"
var api_temperature: float = 0.8
var api_max_tokens: int = 1024

const DEFAULT_MODELS: Dictionary = {
	Provider.GEMINI:    "gemini-2.5-flash",
	Provider.ANTHROPIC: "claude-opus-4-7",
	Provider.OPENAI:    "gpt-4o-mini",
}

const NARRATION_LABEL: String = "地の文"
const NARRATION_TAGS: Array[String] = ["地の文", "narration", "narrator", "描写", "ナレーション"]

# Response length instructions (mirrors Pelsona's LENGTH_INSTR)
const LENGTH_INSTR: Dictionary = {
	"short":     "応答は簡潔に。各キャラの台詞は1〜2文程度に抑えてください。",
	"normal":    "",
	"long":      "情景描写・心情描写を豊かにし、各キャラの台詞も複数文で描いてください。",
	"very_long": "可能な限り詳細に、情景・心情・所作を丁寧に描写し、長文で応答してください。",
}

# ── Runtime state ────────────────────────────────────────────────────────────
var current_chat: DialogueChat = null
var is_busy: bool = false
var response_length: String = "normal"

var _http: HTTPRequest = null

# ── Init ─────────────────────────────────────────────────────────────────────
func _ready() -> void:
	_http = HTTPRequest.new()
	add_child(_http)
	_http.request_completed.connect(_on_request_completed)
	_load_config()

func _load_config() -> void:
	# Read from ProjectSettings (set these in Project > Project Settings > Dialogue)
	if ProjectSettings.has_setting("dialogue/api_provider"):
		var p: int = ProjectSettings.get_setting("dialogue/api_provider")
		api_provider = p as Provider
	if ProjectSettings.has_setting("dialogue/api_key"):
		api_key = ProjectSettings.get_setting("dialogue/api_key")
	if ProjectSettings.has_setting("dialogue/api_model"):
		api_model = ProjectSettings.get_setting("dialogue/api_model")
	if ProjectSettings.has_setting("dialogue/api_base"):
		api_base = ProjectSettings.get_setting("dialogue/api_base")
	if ProjectSettings.has_setting("dialogue/temperature"):
		api_temperature = ProjectSettings.get_setting("dialogue/temperature")
	if ProjectSettings.has_setting("dialogue/max_tokens"):
		api_max_tokens = ProjectSettings.get_setting("dialogue/max_tokens")

# ── Public API ───────────────────────────────────────────────────────────────

## Start a new dialogue session with the given NPC character.
func start_dialogue(char_data: CharacterData, situation: String = "", carryover: String = "") -> void:
	if is_busy:
		return
	current_chat = DialogueChat.new(char_data, situation, carryover)
	dialogue_started.emit(current_chat)
	if char_data.greeting:
		var greeting_msg := {
			"role": "assistant", "name": char_data.character_name,
			"content": char_data.greeting, "narration": false
		}
		current_chat.history.append(greeting_msg)
		message_received.emit(greeting_msg)

## Send a player message and request an LLM response.
func send_player_message(text: String, is_narration: bool = false) -> void:
	if is_busy or not current_chat:
		return
	if not api_key:
		error_occurred.emit("API キーが未設定です。Project Settings > dialogue/api_key を確認してください。")
		return

	var user_msg := {
		"role": "user", "name": DungeonContext.player_name,
		"content": text, "narration": is_narration
	}
	current_chat.history.append(user_msg)
	message_received.emit(user_msg)

	is_busy = true
	typing_started.emit()
	_call_llm()

## End the current dialogue session.
func end_dialogue() -> void:
	current_chat = null
	is_busy = false
	dialogue_ended.emit()

# ── Prompt builder (mirrors Pelsona's buildSystemPrompt) ─────────────────────

func _build_system_prompt() -> String:
	var chat := current_chat
	var char_data := chat.character
	var parts: Array[String] = []

	# Dungeon / world context block
	var ctx := DungeonContext.build_context_block()
	if ctx:
		parts.append(ctx)

	# Per-session situation
	if chat.situation:
		parts.append("# 今回のシチュエーション\n" + chat.situation)

	# Carried-over story memo
	if chat.carryover:
		parts.append("# 前回までの流れ\n" + chat.carryover)

	# Character definition
	parts.append("# 演じるキャラクター")
	parts.append("名前: " + char_data.character_name)
	if char_data.persona:
		parts.append("人格・背景:\n" + char_data.persona)
	if char_data.tone:
		parts.append("口調:\n" + char_data.tone)
	if DungeonContext.player_name:
		parts.append("ユーザー (対話相手) の名前は「%s」。" % DungeonContext.player_name)

	# Output format (strict)
	parts.append("""# 出力フォーマット (厳守)
- 出力はブロックの集合とする。各ブロックは "[ラベル] 本文" の形式で先頭に [ラベル] を置く。
- 使えるラベルは以下の2種類のみ:
  [{char}] … このキャラの発言・所作
  [{narr}] … 場面描写・情景・状況変化など台詞以外
- 1ブロックに1ラベル。複数キャラの台詞や台詞と地の文を同一ブロックに混在させない。
- ブロック間は改行で区切る。
- メタ発言 (作者視点のコメント) は書かない。""".format({"char": char_data.character_name, "narr": NARRATION_LABEL}))

	if response_length != "normal" and LENGTH_INSTR.has(response_length):
		parts.append("# 文量\n" + LENGTH_INSTR[response_length])

	return "\n\n".join(parts)

func _build_history_for_api() -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	for m in current_chat.history:
		if m.role != "user" and m.role != "assistant":
			continue
		if m.get("typing", false):
			continue
		if m.role == "user":
			var content: String = m.content
			if m.get("narration", false):
				content = "[%s] %s" % [NARRATION_LABEL, content]
			result.append({"role": "user", "content": content})
		else:
			var prefix := ""
			if m.get("narration", false):
				prefix = "[%s] " % NARRATION_LABEL
			elif m.get("name", ""):
				prefix = "[%s] " % m.name
			result.append({"role": "assistant", "content": prefix + m.content})
	return result

# ── LLM dispatch ─────────────────────────────────────────────────────────────

var _pending_callback: Callable

func _call_llm() -> void:
	var system := _build_system_prompt()
	var messages := _build_history_for_api()

	match api_provider:
		Provider.GEMINI:    _request_gemini(system, messages)
		Provider.ANTHROPIC: _request_anthropic(system, messages)
		Provider.OPENAI:    _request_openai(system, messages)

func _request_gemini(system: String, messages: Array[Dictionary]) -> void:
	var base := (api_base if api_base else "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
	var model_enc := api_model.uri_encode()
	var url := "%s/models/%s:generateContent" % [base, model_enc]

	# Gemini requires first message to be 'user'
	var trimmed := messages.duplicate()
	while trimmed.size() and trimmed[0].role != "user":
		trimmed.remove_at(0)

	var contents := []
	for m in trimmed:
		contents.append({
			"role": "model" if m.role == "assistant" else "user",
			"parts": [{"text": m.content}]
		})

	var body := JSON.stringify({
		"systemInstruction": {"parts": [{"text": system}]},
		"contents": contents,
		"generationConfig": {
			"temperature": api_temperature,
			"maxOutputTokens": api_max_tokens,
		}
	})
	var headers := PackedStringArray([
		"Content-Type: application/json",
		"x-goog-api-key: " + api_key,
	])
	_pending_callback = _parse_gemini_response
	_http.request(url, headers, HTTPClient.METHOD_POST, body)

func _request_anthropic(system: String, messages: Array[Dictionary]) -> void:
	var url := "https://api.anthropic.com/v1/messages"
	var msg_list := []
	for m in messages:
		msg_list.append({"role": m.role, "content": [{"type": "text", "text": m.content}]})

	var body := JSON.stringify({
		"model": api_model,
		"max_tokens": api_max_tokens,
		"temperature": api_temperature,
		"system": system,
		"messages": msg_list,
	})
	var headers := PackedStringArray([
		"Content-Type: application/json",
		"x-api-key: " + api_key,
		"anthropic-version: 2023-06-01",
	])
	_pending_callback = _parse_anthropic_response
	_http.request(url, headers, HTTPClient.METHOD_POST, body)

func _request_openai(system: String, messages: Array[Dictionary]) -> void:
	var base := (api_base if api_base else "https://api.openai.com/v1").rstrip("/")
	var url := base + "/chat/completions"
	var msg_list := [{"role": "system", "content": system}]
	for m in messages:
		msg_list.append({"role": m.role, "content": m.content})

	var body := JSON.stringify({
		"model": api_model,
		"temperature": api_temperature,
		"max_tokens": api_max_tokens,
		"messages": msg_list,
	})
	var headers := PackedStringArray([
		"Content-Type: application/json",
		"Authorization: Bearer " + api_key,
	])
	_pending_callback = _parse_openai_response
	_http.request(url, headers, HTTPClient.METHOD_POST, body)

# ── Response handlers ────────────────────────────────────────────────────────

func _on_request_completed(result: int, response_code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	is_busy = false
	typing_stopped.emit()

	if result != HTTPRequest.RESULT_SUCCESS or response_code < 200 or response_code >= 300:
		error_occurred.emit("API エラー: HTTP %d" % response_code)
		return

	var json := JSON.new()
	var err := json.parse(body.get_string_from_utf8())
	if err != OK:
		error_occurred.emit("JSON パースエラー")
		return

	if _pending_callback.is_valid():
		_pending_callback.call(json.data)

func _parse_gemini_response(data: Dictionary) -> void:
	var cand: Dictionary = (data.get("candidates", []) as Array).front() if data.has("candidates") else {}
	var parts_arr: Array = cand.get("content", {}).get("parts", []) if cand else []
	var text := ""
	for p in parts_arr:
		text += str(p.get("text", ""))
	text = text.strip_edges()
	if not text:
		var reason: String = cand.get("finishReason", "UNKNOWN") if cand else "UNKNOWN"
		error_occurred.emit("Gemini 応答が空です (finishReason: %s)" % reason)
		return
	_dispatch_reply(text)

func _parse_anthropic_response(data: Dictionary) -> void:
	var content_arr: Array = data.get("content", [])
	var text := ""
	for block in content_arr:
		if block.get("type") == "text":
			text += str(block.get("text", ""))
	_dispatch_reply(text.strip_edges())

func _parse_openai_response(data: Dictionary) -> void:
	var choices: Array = data.get("choices", [])
	var text: String = choices[0].get("message", {}).get("content", "").strip_edges() if choices.size() else ""
	_dispatch_reply(text)

# ── Reply parser (mirrors Pelsona's parseReply) ───────────────────────────────

func _dispatch_reply(text: String) -> void:
	if not text:
		text = "(無言)"
	var messages := _parse_reply(text)
	for msg in messages:
		current_chat.history.append(msg)
		message_received.emit(msg)

func _parse_reply(text: String) -> Array[Dictionary]:
	var char_name := current_chat.character.character_name
	var known: Array[String] = [char_name] + current_chat.character.name_aliases

	# Find all [Label] markers
	var re := RegEx.new()
	re.compile("\\[([^\\[\\]\\n]{1,40})\\]\\s*[:：]?\\s*")
	var matches := re.search_all(text)

	if matches.is_empty():
		return [_make_msg(char_name, text.strip_edges())]

	var results: Array[Dictionary] = []
	var prev_end := 0

	# Text before first marker -> default speaker
	if matches[0].get_start() > 0:
		var prefix := text.substr(0, matches[0].get_start()).strip_edges()
		if prefix:
			results.append(_make_msg(char_name, prefix))

	for i in range(matches.size()):
		var m := matches[i]
		var label: String = m.get_string(1).strip_edges()
		var content_end: int = matches[i + 1].get_start() if i + 1 < matches.size() else text.length()
		var content: String = text.substr(m.get_end(), content_end - m.get_end()).strip_edges()
		if not content:
			continue
		if label.to_lower() in NARRATION_TAGS or label == NARRATION_LABEL:
			results.append({
				"role": "assistant", "name": NARRATION_LABEL,
				"content": content, "narration": true
			})
		else:
			results.append(_make_msg(_resolve_name(label, known), content))

	if results.is_empty():
		return [_make_msg(char_name, text.strip_edges())]
	return results

func _make_msg(speaker: String, content: String) -> Dictionary:
	return {"role": "assistant", "name": speaker, "content": content, "narration": false}

func _resolve_name(name: String, known: Array[String]) -> String:
	if name in known:
		return name
	for k in known:
		if k and (name.contains(k) or k.contains(name)):
			return k
	return name
