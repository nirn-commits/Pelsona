## CharacterData.gd
## Godot Resource that holds NPC/character definition.
## Mirrors Pelsona's character slot (persona, tone, greeting).
class_name CharacterData
extends Resource

@export var character_name: String = ""
@export var portrait: Texture2D = null
@export_multiline var persona: String = ""
@export_multiline var tone: String = ""
@export var greeting: String = ""
## Extra name aliases the LLM may use (e.g. "Hero" -> "勇者")
@export var name_aliases: Array[String] = []
