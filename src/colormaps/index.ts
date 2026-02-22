import cetL08Csv from "./cet-l08.csv?raw";

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface ColormapDefinition {
  id: string;
  name: string;
  colors: RgbColor[];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function parseRgbTriplet(line: string, lineNumber: number): RgbColor {
  const values = line.split(",").map((part) => Number.parseFloat(part.trim()));

  if (values.length < 3 || values.slice(0, 3).some((value) => !Number.isFinite(value))) {
    throw new Error(`Invalid colormap row at line ${lineNumber}. Expected "r,g,b" in 0..1 range.`);
  }

  return {
    r: clamp01(values[0]),
    g: clamp01(values[1]),
    b: clamp01(values[2])
  };
}

export function parseColormapCsv(csv: string): RgbColor[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  const colors = lines.map((line, index) => parseRgbTriplet(line, index + 1));

  if (colors.length < 2) {
    throw new Error("Colormap CSV must contain at least two rows.");
  }

  return colors;
}

function rgb01ToCss(color: RgbColor): string {
  const r = Math.round(clamp01(color.r) * 255);
  const g = Math.round(clamp01(color.g) * 255);
  const b = Math.round(clamp01(color.b) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

export function sampleColormapColor(colors: RgbColor[], normalizedValue: number): string {
  if (colors.length === 0) {
    return "rgb(0, 0, 0)";
  }

  if (colors.length === 1) {
    return rgb01ToCss(colors[0]);
  }

  const t = clamp01(normalizedValue);
  const scaled = t * (colors.length - 1);
  const lowerIndex = Math.floor(scaled);
  const upperIndex = Math.min(colors.length - 1, lowerIndex + 1);
  const fraction = scaled - lowerIndex;

  const lower = colors[lowerIndex];
  const upper = colors[upperIndex];

  return rgb01ToCss({
    r: lower.r + (upper.r - lower.r) * fraction,
    g: lower.g + (upper.g - lower.g) * fraction,
    b: lower.b + (upper.b - lower.b) * fraction
  });
}

function loadColormapColors(csv: string): RgbColor[] {
  try {
    return parseColormapCsv(csv);
  } catch {
    // Fallback keeps the app usable if a colormap asset is malformed.
    return [
      { r: 0.05, g: 0.1, b: 0.45 },
      { r: 0.95, g: 0.9, b: 0.1 }
    ];
  }
}

export const COLORMAPS: readonly ColormapDefinition[] = [
  {
    id: "cet-l08",
    name: "CET-L08 (Blue-Magenta-Yellow)",
    colors: loadColormapColors(cetL08Csv)
  }
];

export const DEFAULT_COLORMAP_ID = "cet-l08";

export function getColormapById(id: string): ColormapDefinition {
  return COLORMAPS.find((map) => map.id === id) ?? COLORMAPS[0];
}
