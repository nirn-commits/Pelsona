## DialogueChat.gd
## Holds runtime state for one dialogue session (history + context).
## Equivalent to Pelsona's chat object.
class_name DialogueChat
extends RefCounted

var session_id: String = ""
var character: CharacterData = null
var history: Array[Dictionary] = []   # [{role, name, content, narration}]
var situation: String = ""            # Scene-specific context injected into prompt
var carryover: String = ""            # Inherited story memo from a prior session

func _init(char_data: CharacterData, situation_text: String = "", carryover_text: String = "") -> void:
	session_id = "%d-%s" % [Time.get_ticks_msec(), char_data.character_name]
	character = char_data
	situation = situation_text
	carryover = carryover_text

func push(role: String, content: String, speaker_name: String = "", is_narration: bool = false) -> void:
	history.append({
		"role": role,
		"name": speaker_name,
		"content": content,
		"narration": is_narration,
	})

func last_messages(count: int) -> Array[Dictionary]:
	return history.slice(max(0, history.size() - count))

func clear_history() -> void:
	history.clear()
