const TRACK_PALETTE = [
  "#136f63",
  "#d1495b",
  "#0077b6",
  "#9c6644",
  "#4f772d",
  "#6a4c93",
  "#ef476f",
  "#3a86ff",
  "#fb5607",
  "#8338ec"
];

export function getTrackColor(index: number): string {
  return TRACK_PALETTE[index % TRACK_PALETTE.length];
}

export function getPalette(): readonly string[] {
  return TRACK_PALETTE;
}
