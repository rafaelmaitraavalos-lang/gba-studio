export interface TileType {
  id: string;
  label: string;
  color: string;
  depthColor?: string;
}

export interface CustomTile {
  id: string;
  label: string;
  image: string; // base64 data URI
  walkable: boolean;
}

export const TILE_TYPES: TileType[] = [
  { id: "grass", label: "Grass", color: "#5B8C3E" },
  { id: "dirt", label: "Dirt", color: "#C4A46C" },
  { id: "water", label: "Water", color: "#3B82C4" },
  { id: "wall", label: "Wall", color: "#6B6B7B", depthColor: "#4A4A58" },
  { id: "floor", label: "Floor", color: "#D4C4A0" },
  { id: "door", label: "Door", color: "#8B5E3C", depthColor: "#6B4226" },
];

export function isCustomTileId(id: string): boolean {
  return id.startsWith("custom_");
}
