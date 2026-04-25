## NpcDialogueTrigger.gd
## Attach to an Area3D node on an NPC.
## Shows a prompt when the player enters range, starts dialogue on interact.
class_name NpcDialogueTrigger
extends Area3D

## Character definition for this NPC
@export var character: CharacterData = null
## Overrides DungeonContext's situation for this specific conversation
@export_multiline var situation_override: String = ""
## Story carryover pre-filled for this NPC (optional)
@export_multiline var carryover: String = ""
## Interaction key action name (defined in Project Settings > Input)
@export var interact_action: String = "interact"
## Node path to the DialogueUI CanvasLayer
@export var dialogue_ui_path: NodePath = NodePath("/root/DialogueUI")
## Label shown above NPC when in range (optional)
@export var prompt_label_path: NodePath = NodePath()

var _player_in_range: bool = false
var _prompt_label: Label = null

func _ready() -> void:
	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)
	DialogueManager.dialogue_ended.connect(_on_dialogue_ended)

	if prompt_label_path:
		_prompt_label = get_node_or_null(prompt_label_path)
		if _prompt_label:
			_prompt_label.hide()

func _unhandled_input(event: InputEvent) -> void:
	if _player_in_range and event.is_action_pressed(interact_action):
		if not DialogueManager.is_busy and not _dialogue_active():
			_start()
			get_viewport().set_input_as_handled()

func _on_body_entered(body: Node3D) -> void:
	if body.is_in_group("player"):
		_player_in_range = true
		if _prompt_label:
			_prompt_label.show()

func _on_body_exited(body: Node3D) -> void:
	if body.is_in_group("player"):
		_player_in_range = false
		if _prompt_label:
			_prompt_label.hide()

func _on_dialogue_ended() -> void:
	if _prompt_label and _player_in_range:
		_prompt_label.show()

func _start() -> void:
	if not character:
		push_warning("NpcDialogueTrigger: CharacterData not assigned on %s" % get_parent().name)
		return
	var situation := situation_override if situation_override else ""
	DialogueManager.start_dialogue(character, situation, carryover)

func _dialogue_active() -> bool:
	var ui := get_node_or_null(dialogue_ui_path)
	return ui != null and ui.visible
