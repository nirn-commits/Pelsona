## DialogueUI.gd
## Attaches to a CanvasLayer scene with the dungeon dialogue HUD.
##
## Expected scene structure:
##   CanvasLayer (DialogueUI)
##     Panel (dialogue_box)
##       HBoxContainer
##         TextureRect   (portrait)
##         VBoxContainer
##           Label         (speaker_label)
##           RichTextLabel (dialogue_text)
##       HBoxContainer (input_row)
##         LineEdit      (player_input)
##         Button        (send_btn)
##         Button        (mode_btn)   -- 💬/📖 toggle
##     Label             (typing_indicator)
class_name DialogueUI
extends CanvasLayer

@onready var dialogue_box: Panel         = $DialogueBox
@onready var portrait: TextureRect       = $DialogueBox/HBox/Portrait
@onready var speaker_label: Label        = $DialogueBox/HBox/VBox/SpeakerLabel
@onready var dialogue_text: RichTextLabel = $DialogueBox/HBox/VBox/DialogueText
@onready var player_input: LineEdit      = $DialogueBox/InputRow/PlayerInput
@onready var send_btn: Button            = $DialogueBox/InputRow/SendBtn
@onready var mode_btn: Button            = $DialogueBox/InputRow/ModeBtn
@onready var typing_indicator: Label     = $TypingIndicator

# Text scroll speed (characters per second); 0 = instant
@export var scroll_speed: float = 40.0

var _narration_mode: bool = false
var _scroll_tween: Tween = null
var _full_text: String = ""
var _revealed_chars: int = 0

func _ready() -> void:
	hide()
	send_btn.pressed.connect(_on_send_pressed)
	mode_btn.pressed.connect(_on_mode_toggled)
	player_input.text_submitted.connect(func(_t): _on_send_pressed())
	_update_mode_ui()

	DialogueManager.dialogue_started.connect(_on_dialogue_started)
	DialogueManager.message_received.connect(_on_message_received)
	DialogueManager.typing_started.connect(_on_typing_started)
	DialogueManager.typing_stopped.connect(_on_typing_stopped)
	DialogueManager.dialogue_ended.connect(_on_dialogue_ended)
	DialogueManager.error_occurred.connect(_on_error)

# ── Visibility ───────────────────────────────────────────────────────────────

func _on_dialogue_started(chat: DialogueChat) -> void:
	dialogue_text.text = ""
	speaker_label.text = ""
	if chat.character.portrait:
		portrait.texture = chat.character.portrait
	else:
		portrait.texture = null
	show()
	player_input.grab_focus()

func _on_dialogue_ended() -> void:
	hide()

# ── Message display ──────────────────────────────────────────────────────────

func _on_message_received(msg: Dictionary) -> void:
	if msg.role == "user":
		_append_line("[color=cyan]%s:[/color] %s" % [DungeonContext.player_name, msg.content])
		return

	if msg.get("narration", false):
		_append_line("[i][color=gray]%s[/color][/i]" % msg.content)
		speaker_label.text = ""
		return

	speaker_label.text = msg.get("name", "")
	_animate_text(msg.content)

func _append_line(bbcode: String) -> void:
	if dialogue_text.text:
		dialogue_text.append_text("\n")
	dialogue_text.append_text(bbcode)
	await get_tree().process_frame
	_scroll_to_bottom()

func _animate_text(content: String) -> void:
	if _scroll_tween:
		_scroll_tween.kill()

	if scroll_speed <= 0.0:
		_append_line(content)
		return

	var start_index := dialogue_text.text.length()
	dialogue_text.append_text("\n" + content)
	_scroll_tween = create_tween()
	# Reveal characters over time using visible_characters
	dialogue_text.visible_characters = start_index
	var target := dialogue_text.text.length()
	var duration := float(content.length()) / scroll_speed
	_scroll_tween.tween_property(dialogue_text, "visible_characters", target, duration)
	_scroll_tween.finished.connect(_scroll_to_bottom)

func _scroll_to_bottom() -> void:
	dialogue_text.scroll_to_line(dialogue_text.get_line_count() - 1)

# ── Typing indicator ─────────────────────────────────────────────────────────

func _on_typing_started() -> void:
	typing_indicator.text = "考え中…"
	send_btn.disabled = true
	player_input.editable = false

func _on_typing_stopped() -> void:
	typing_indicator.text = ""
	send_btn.disabled = false
	player_input.editable = true
	player_input.grab_focus()

# ── Player input ─────────────────────────────────────────────────────────────

func _on_send_pressed() -> void:
	var text := player_input.text.strip_edges()
	if not text or DialogueManager.is_busy:
		return
	player_input.clear()
	DialogueManager.send_player_message(text, _narration_mode)

func _on_mode_toggled() -> void:
	_narration_mode = not _narration_mode
	_update_mode_ui()
	player_input.grab_focus()

func _update_mode_ui() -> void:
	if _narration_mode:
		mode_btn.text = "📖"
		player_input.placeholder_text = "地の文を入力 (場面や状況を書きます)"
	else:
		mode_btn.text = "💬"
		player_input.placeholder_text = "メッセージを入力…"

# ── Error ────────────────────────────────────────────────────────────────────

func _on_error(msg: String) -> void:
	_on_typing_stopped()
	_append_line("[color=red]⚠ %s[/color]" % msg)

# ── Close with Escape ────────────────────────────────────────────────────────

func _unhandled_input(event: InputEvent) -> void:
	if visible and event.is_action_pressed("ui_cancel"):
		DialogueManager.end_dialogue()
		get_viewport().set_input_as_handled()
