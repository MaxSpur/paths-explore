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

export function parseTextContent(fileName: string, text: string): Track[] {
  const format = detectFormat(fileName);

  if (!format) {
    throw new Error("Unsupported file extension. Use .gpx, .kml, .geojson, or .json.");
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
