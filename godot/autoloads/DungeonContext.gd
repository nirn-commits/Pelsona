## DungeonContext.gd  –  Autoload
## Tracks global dungeon / world state injected into every dialogue prompt.
## Call update_* methods as the player moves through the dungeon.
extends Node

## World / title (equivalent to Pelsona's "World" tab)
var world_name: String = ""
var world_description: String = ""

## Player info
var player_name: String = "勇者"
var player_class: String = ""

## Current dungeon location
var dungeon_name: String = ""
var floor_number: int = 1
var room_type: String = ""   # e.g. "通路", "宝部屋", "ボス部屋"
var room_description: String = ""

## Active quest / story hook (shown in every prompt)
var active_quest: String = ""

## Build the location block inserted into the system prompt
func build_context_block() -> String:
	var parts: Array[String] = []

	if world_name or world_description:
		parts.append("# 世界観")
		if world_name:
			parts.append("タイトル: %s" % world_name)
		if world_description:
			parts.append(world_description)

	var loc_lines: Array[String] = []
	if dungeon_name:
		loc_lines.append("ダンジョン: %s" % dungeon_name)
	if floor_number > 0:
		loc_lines.append("現在フロア: %d 階" % floor_number)
	if room_type:
		loc_lines.append("部屋の種類: %s" % room_type)
	if room_description:
		loc_lines.append(room_description)
	if loc_lines.size():
		parts.append("# 現在地\n" + "\n".join(loc_lines))

	if active_quest:
		parts.append("# 進行中のクエスト\n" + active_quest)

	return "\n\n".join(parts)

func set_dungeon(name: String, floor: int = 1) -> void:
	dungeon_name = name
	floor_number = floor

func set_room(type: String, description: String = "") -> void:
	room_type = type
	room_description = description

func advance_floor() -> void:
	floor_number += 1
