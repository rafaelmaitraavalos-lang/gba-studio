export type ObjectType = "chest" | "door" | "npc" | "enemy" | "sign";

export interface ObjectTypeDef {
  type: ObjectType;
  label: string;
  color: string;
  icon: string;
}

export const OBJECT_TYPES: ObjectTypeDef[] = [
  { type: "chest", label: "Chest", color: "#DAA520", icon: "C" },
  { type: "door", label: "Door", color: "#8B4513", icon: "D" },
  { type: "npc", label: "NPC", color: "#4169E1", icon: "N" },
  { type: "enemy", label: "Enemy", color: "#DC143C", icon: "E" },
  { type: "sign", label: "Sign", color: "#808080", icon: "S" },
];

export interface DoorProperties {
  targetRoomId: string;
}

export interface ChestProperties {
  item: string;
}

export interface NpcProperties {
  dialogue: string;
}

export interface EnemyProperties {
  hp: number;
  damage: number;
}

export interface SignProperties {
  text: string;
}

export function getDefaultProperties(type: ObjectType): Record<string, unknown> {
  switch (type) {
    case "door":
      return { targetRoomId: "" } satisfies DoorProperties;
    case "chest":
      return { item: "Potion" } satisfies ChestProperties;
    case "npc":
      return { dialogue: "Hello, adventurer!" } satisfies NpcProperties;
    case "enemy":
      return { hp: 10, damage: 2 } satisfies EnemyProperties;
    case "sign":
      return { text: "Welcome!" } satisfies SignProperties;
  }
}

export function getObjectTypeDef(type: string): ObjectTypeDef | undefined {
  return OBJECT_TYPES.find((o) => o.type === type);
}
