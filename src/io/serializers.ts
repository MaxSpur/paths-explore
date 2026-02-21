import type { SupportedFormat, Track } from "../model/types";

interface SerializedTrack {
  fileName: string;
  mimeType: string;
  content: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatCoordinate(value: number): string {
  return Number(value.toFixed(7)).toString();
}

function extensionForTrack(track: Track): string {
  const sourceLower = track.sourceFile.toLowerCase();

  if (track.format === "gpx") {
    return "gpx";
  }

  if (track.format === "kml") {
    return "kml";
  }

  if (sourceLower.endsWith(".json")) {
    return "json";
  }

  return "geojson";
}

function mimeTypeForFormat(format: SupportedFormat): string {
  if (format === "gpx") {
    return "application/gpx+xml";
  }

  if (format === "kml") {
    return "application/vnd.google-earth.kml+xml";
  }

  return "application/geo+json";
}

function safeBaseName(track: Track): string {
  const base = track.name.trim() || "track";
  return base.replace(/[^a-zA-Z0-9._ -]/g, "_");
}

function serializeGpx(track: Track): string {
  const pointsXml = track.points
    .map((point) => {
      const elevation = typeof point.ele === "number" ? `<ele>${point.ele}</ele>` : "";
      const time = point.time ? `<time>${escapeXml(point.time)}</time>` : "";

      return `      <trkpt lat="${formatCoordinate(point.lat)}" lon="${formatCoordinate(
        point.lng
      )}">${elevation}${time}</trkpt>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Path Segments" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escapeXml(track.name)}</name>
    <trkseg>
${pointsXml}
    </trkseg>
  </trk>
</gpx>
`;
}

function serializeKml(track: Track): string {
  const coordinates = track.points
    .map((point) => {
      const ele = typeof point.ele === "number" ? point.ele : 0;
      return `${formatCoordinate(point.lng)},${formatCoordinate(point.lat)},${ele}`;
    })
    .join(" ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>${escapeXml(track.name)}</name>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${coordinates}</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>
`;
}

function serializeGeoJson(track: Track): string {
  const coordinates = track.points.map((point) =>
    typeof point.ele === "number"
      ? [point.lng, point.lat, point.ele]
      : [point.lng, point.lat]
  );

  const coordTimes = track.points
    .map((point) => point.time)
    .filter((value): value is string => typeof value === "string");

  const feature = {
    type: "Feature",
    properties: {
      name: track.name,
      ...(coordTimes.length === track.points.length ? { coordTimes } : {})
    },
    geometry: {
      type: "LineString",
      coordinates
    }
  };

  return `${JSON.stringify(
    {
      type: "FeatureCollection",
      features: [feature]
    },
    null,
    2
  )}\n`;
}

export function serializeTrack(track: Track): SerializedTrack {
  const extension = extensionForTrack(track);
  const fileName = `${safeBaseName(track)}.${extension}`;

  if (track.format === "gpx") {
    return {
      fileName,
      mimeType: mimeTypeForFormat(track.format),
      content: serializeGpx(track)
    };
  }

  if (track.format === "kml") {
    return {
      fileName,
      mimeType: mimeTypeForFormat(track.format),
      content: serializeKml(track)
    };
  }

  return {
    fileName,
    mimeType: mimeTypeForFormat(track.format),
    content: serializeGeoJson(track)
  };
}
