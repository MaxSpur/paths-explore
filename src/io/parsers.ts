import { gpx as toGeoJsonGpx, kml as toGeoJsonKml } from "@tmcw/togeojson";
import type { SupportedFormat, Track, TrackPoint } from "../model/types";

interface GeoJsonGeometry {
  type?: string;
  coordinates?: unknown;
}

interface GeoJsonFeature {
  type?: string;
  properties?: Record<string, unknown>;
  geometry?: GeoJsonGeometry | null;
}

interface GeoJsonFeatureCollection {
  type?: string;
  features?: GeoJsonFeature[];
}

function stripExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index > 0 ? fileName.slice(0, index) : fileName;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toTrackPoint(value: unknown, time?: string): TrackPoint | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const lng = asNumber(value[0]);
  const lat = asNumber(value[1]);
  const ele = value.length > 2 ? asNumber(value[2]) : null;

  if (lat === null || lng === null) {
    return null;
  }

  return {
    id: "",
    lat,
    lng,
    ...(ele === null ? {} : { ele }),
    ...(typeof time === "string" ? { time } : {})
  };
}

function parseXml(xml: string): Document {
  const documentNode = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = documentNode.querySelector("parsererror");

  if (parserError) {
    throw new Error("Malformed XML file.");
  }

  return documentNode;
}

function detectFormat(fileName: string): SupportedFormat | null {
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".gpx")) {
    return "gpx";
  }

  if (lower.endsWith(".kml")) {
    return "kml";
  }

  if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
    return "geojson";
  }

  if (lower.endsWith(".csv")) {
    return "csv";
  }

  return null;
}

function getLineTimes(
  properties: Record<string, unknown> | undefined,
  lineIndex?: number
): string[] | undefined {
  if (!properties) {
    return undefined;
  }

  const coordinateProperties = properties.coordinateProperties;

  if (
    coordinateProperties &&
    typeof coordinateProperties === "object" &&
    "times" in coordinateProperties
  ) {
    const times = (coordinateProperties as { times?: unknown }).times;

    if (Array.isArray(times)) {
      if (lineIndex === undefined && times.every((item) => typeof item === "string")) {
        return times as string[];
      }

      if (lineIndex !== undefined && Array.isArray(times[lineIndex])) {
        const nested = times[lineIndex];
        if (nested.every((item) => typeof item === "string")) {
          return nested as string[];
        }
      }
    }
  }

  const coordTimes = properties.coordTimes;

  if (Array.isArray(coordTimes)) {
    if (lineIndex === undefined && coordTimes.every((item) => typeof item === "string")) {
      return coordTimes as string[];
    }

    if (lineIndex !== undefined && Array.isArray(coordTimes[lineIndex])) {
      const nested = coordTimes[lineIndex];
      if (nested.every((item) => typeof item === "string")) {
        return nested as string[];
      }
    }
  }

  return undefined;
}

function normalizeGeoJson(
  input: unknown,
  fileName: string,
  format: SupportedFormat
): Track[] {
  const baseName = stripExtension(fileName);
  const features: GeoJsonFeature[] = [];
  const unsupportedTypes = new Set<string>();

  if (input && typeof input === "object") {
    const root = input as GeoJsonFeatureCollection;

    if (root.type === "FeatureCollection" && Array.isArray(root.features)) {
      features.push(...root.features);
    } else if (root.type === "Feature") {
      features.push(root as GeoJsonFeature);
    } else {
      features.push({ type: "Feature", geometry: root as GeoJsonGeometry, properties: {} });
    }
  }

  const normalizedTracks: Track[] = [];

  for (const feature of features) {
    if (!feature || feature.type !== "Feature") {
      continue;
    }

    const geometry = feature.geometry;

    if (!geometry || typeof geometry !== "object") {
      continue;
    }

    if (geometry.type === "LineString" && Array.isArray(geometry.coordinates)) {
      const times = getLineTimes(feature.properties);
      const points = geometry.coordinates
        .map((coordinate, idx) => toTrackPoint(coordinate, times?.[idx]))
        .filter((point): point is TrackPoint => point !== null);

      if (points.length > 0) {
        normalizedTracks.push({
          id: "",
          name: baseName,
          sourceFile: fileName,
          format,
          color: "",
          visible: true,
          showSegments: true,
          showPoints: false,
          points
        });
      }

      continue;
    }

    if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
      geometry.coordinates.forEach((line, lineIndex) => {
        if (!Array.isArray(line)) {
          return;
        }

        const times = getLineTimes(feature.properties, lineIndex);
        const points = line
          .map((coordinate, pointIndex) => toTrackPoint(coordinate, times?.[pointIndex]))
          .filter((point): point is TrackPoint => point !== null);

        if (points.length > 0) {
          normalizedTracks.push({
            id: "",
            name: baseName,
            sourceFile: fileName,
            format,
            color: "",
            visible: true,
            showSegments: true,
            showPoints: false,
            points
          });
        }
      });

      continue;
    }

    unsupportedTypes.add(geometry.type ?? "Unknown");
  }

  if (normalizedTracks.length === 0) {
    if (unsupportedTypes.size > 0) {
      throw new Error(
        `Unsupported geometry type(s): ${Array.from(unsupportedTypes).join(", ")}. Only LineString and MultiLineString are supported.`
      );
    }

    throw new Error("No track coordinates found.");
  }

  return normalizedTracks.map((track, idx) => ({
    ...track,
    name: idx === 0 ? baseName : `${baseName} (${idx + 1})`
  }));
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (char === "\"") {
      const next = content[index + 1];
      if (inQuotes && next === "\"") {
        field += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ",") {
      currentRow.push(field.trim());
      field = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && content[index + 1] === "\n") {
        index += 1;
      }

      currentRow.push(field.trim());
      field = "";

      if (currentRow.some((value) => value.length > 0)) {
        rows.push(currentRow);
      }

      currentRow = [];
      continue;
    }

    field += char;
  }

  currentRow.push(field.trim());
  if (currentRow.some((value) => value.length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

function normalizeCsvHeader(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function csvIndexForHeader(
  indicesByHeader: Map<string, number>,
  candidates: string[]
): number {
  for (const candidate of candidates) {
    const index = indicesByHeader.get(candidate);
    if (index !== undefined) {
      return index;
    }
  }

  return -1;
}

function asFiniteNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function applyHemisphere(value: number, hemisphere: string | undefined): number {
  if (!hemisphere) {
    return value;
  }

  const normalized = hemisphere.trim().toUpperCase();
  if (normalized === "S" || normalized === "W") {
    return -Math.abs(value);
  }

  if (normalized === "N" || normalized === "E") {
    return Math.abs(value);
  }

  return value;
}

function isValidBtQPoint(validField: string | undefined): boolean {
  if (!validField) {
    return true;
  }

  const normalized = validField.trim().toUpperCase();
  if (!normalized) {
    return true;
  }

  if (["NOFIX", "INVALID", "VOID", "V", "N", "FALSE"].includes(normalized)) {
    return false;
  }

  return true;
}

function parseBtUtcIso(
  utcDateRaw: string | undefined,
  utcTimeRaw: string | undefined,
  msRaw: string | undefined
): string | undefined {
  if (!utcDateRaw || !utcTimeRaw) {
    return undefined;
  }

  const dateParts = utcDateRaw.split(/[/-]/).map((part) => Number.parseInt(part, 10));
  const timeParts = utcTimeRaw.split(":").map((part) => Number.parseInt(part, 10));
  const ms = msRaw ? Number.parseInt(msRaw, 10) : 0;

  if (
    dateParts.length < 3 ||
    timeParts.length < 3 ||
    dateParts.some((part) => !Number.isFinite(part)) ||
    timeParts.some((part) => !Number.isFinite(part))
  ) {
    return undefined;
  }

  const year = dateParts[0];
  const month = dateParts[1];
  const day = dateParts[2];
  const hour = timeParts[0];
  const minute = timeParts[1];
  const second = timeParts[2];
  const millisecond = Number.isFinite(ms) ? Math.max(0, Math.min(999, ms)) : 0;

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

function parseBtQ1000XtCsv(fileName: string, content: string): Track[] {
  const rows = parseCsvRows(content);
  if (rows.length < 2) {
    throw new Error("CSV file is empty or missing data rows.");
  }

  const header = rows[0];
  const indicesByHeader = new Map<string, number>();
  header.forEach((value, index) => {
    indicesByHeader.set(normalizeCsvHeader(value), index);
  });

  const trackIdIndex = csvIndexForHeader(indicesByHeader, ["trackid"]);
  const validIndex = csvIndexForHeader(indicesByHeader, ["valid"]);
  const utcDateIndex = csvIndexForHeader(indicesByHeader, ["utcdate"]);
  const utcTimeIndex = csvIndexForHeader(indicesByHeader, ["utctime"]);
  const msIndex = csvIndexForHeader(indicesByHeader, ["ms", "millisecond"]);
  const latIndex = csvIndexForHeader(indicesByHeader, ["latitude", "lat"]);
  const nsIndex = csvIndexForHeader(indicesByHeader, ["ns", "northsouth"]);
  const lngIndex = csvIndexForHeader(indicesByHeader, ["longitude", "lon", "lng"]);
  const ewIndex = csvIndexForHeader(indicesByHeader, ["ew", "eastwest"]);
  const altitudeIndex = csvIndexForHeader(indicesByHeader, ["altitude", "alt", "elevation", "ele"]);

  if (latIndex < 0 || lngIndex < 0) {
    throw new Error("CSV is missing latitude/longitude columns.");
  }

  const baseName = stripExtension(fileName);
  const trackPointsByTrackId = new Map<string, TrackPoint[]>();

  for (const row of rows.slice(1)) {
    const validField = validIndex >= 0 ? row[validIndex] : undefined;
    if (!isValidBtQPoint(validField)) {
      continue;
    }

    const latValue = asFiniteNumber(row[latIndex]);
    const lngValue = asFiniteNumber(row[lngIndex]);
    if (latValue === null || lngValue === null) {
      continue;
    }

    const lat = applyHemisphere(latValue, nsIndex >= 0 ? row[nsIndex] : undefined);
    const lng = applyHemisphere(lngValue, ewIndex >= 0 ? row[ewIndex] : undefined);
    const ele = altitudeIndex >= 0 ? asFiniteNumber(row[altitudeIndex]) : null;
    const time = parseBtUtcIso(
      utcDateIndex >= 0 ? row[utcDateIndex] : undefined,
      utcTimeIndex >= 0 ? row[utcTimeIndex] : undefined,
      msIndex >= 0 ? row[msIndex] : undefined
    );

    const trackIdRaw = trackIdIndex >= 0 ? (row[trackIdIndex] ?? "").trim() : "";
    const trackId = trackIdRaw || "1";
    const existing = trackPointsByTrackId.get(trackId) ?? [];
    existing.push({
      id: "",
      lat,
      lng,
      ...(ele === null ? {} : { ele }),
      ...(time ? { time } : {})
    });
    trackPointsByTrackId.set(trackId, existing);
  }

  if (trackPointsByTrackId.size === 0) {
    throw new Error("No valid track points found in CSV.");
  }

  const hasMultipleTracks = trackPointsByTrackId.size > 1;
  const tracks: Track[] = [];
  let fallbackIndex = 1;

  for (const [trackId, points] of trackPointsByTrackId.entries()) {
    if (points.length === 0) {
      continue;
    }

    const suffix = hasMultipleTracks ? ` (track ${trackId || fallbackIndex})` : "";
    tracks.push({
      id: "",
      name: `${baseName}${suffix}`,
      sourceFile: fileName,
      format: "csv",
      color: "",
      visible: true,
      showSegments: true,
      showPoints: false,
      points
    });
    fallbackIndex += 1;
  }

  if (tracks.length === 0) {
    throw new Error("No valid track points found in CSV.");
  }

  return tracks;
}

export function parseTextContent(fileName: string, text: string): Track[] {
  const format = detectFormat(fileName);

  if (!format) {
    throw new Error("Unsupported file extension. Use .gpx, .kml, .geojson, .json, or .csv.");
  }

  if (format === "csv") {
    return parseBtQ1000XtCsv(fileName, text);
  }

  if (format === "geojson") {
    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON document.");
    }

    return normalizeGeoJson(parsedJson, fileName, format);
  }

  const xmlDocument = parseXml(text);
  const asGeoJson = format === "gpx" ? toGeoJsonGpx(xmlDocument) : toGeoJsonKml(xmlDocument);
  return normalizeGeoJson(asGeoJson, fileName, format);
}

export async function parseFile(file: File): Promise<Track[]> {
  const text = await file.text();
  return parseTextContent(file.name, text);
}
