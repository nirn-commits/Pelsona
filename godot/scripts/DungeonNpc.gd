## DungeonNpc.gd
## Base class for NPC nodes in the dungeon.
## Composes CharacterData + NpcDialogueTrigger + optional animation.
class_name DungeonNpc
extends Node3D

@export var character: CharacterData = null
## Trigger radius in metres
@export var trigger_radius: float = 2.5

@onready var _trigger: NpcDialogueTrigger = $DialogueTrigger

func _ready() -> void:
	if character and _trigger:
		_trigger.character = character
	_setup_collision_radius()

	DialogueManager.dialogue_started.connect(_on_dialogue_started)
	DialogueManager.dialogue_ended.connect(_on_dialogue_ended)

func _setup_collision_radius() -> void:
	var shape_node: CollisionShape3D = _trigger.get_node_or_null("CollisionShape3D")
	if shape_node and shape_node.shape is SphereShape3D:
		(shape_node.shape as SphereShape3D).radius = trigger_radius

# Override these in subclasses for idle animations, facing, etc.
func _on_dialogue_started(_chat: DialogueChat) -> void:
	pass

func _on_dialogue_ended() -> void:
	pass

## Force-start a dialogue from code (e.g. cutscene trigger).
func speak(situation: String = "", carryover: String = "") -> void:
	if character:
		DialogueManager.start_dialogue(character, situation, carryover)
