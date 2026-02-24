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

  if (track.format === "csv") {
    return "csv";
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

  if (format === "csv") {
    return "text/csv";
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

function toCsvDateParts(time: string | undefined): {
  utcDate: string;
  utcTime: string;
  localDate: string;
  localTime: string;
  ms: string;
} {
  if (!time) {
    return {
      utcDate: "",
      utcTime: "",
      localDate: "",
      localTime: "",
      ms: "0"
    };
  }

  const date = new Date(time);
  if (Number.isNaN(date.getTime())) {
    return {
      utcDate: "",
      utcTime: "",
      localDate: "",
      localTime: "",
      ms: "0"
    };
  }

  const formatDate = (year: number, month: number, day: number): string => `${year}/${month}/${day}`;
  const formatTime = (hour: number, minute: number, second: number): string =>
    `${hour}:${minute}:${second}`;

  return {
    utcDate: formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()),
    utcTime: formatTime(date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()),
    localDate: formatDate(date.getFullYear(), date.getMonth() + 1, date.getDate()),
    localTime: formatTime(date.getHours(), date.getMinutes(), date.getSeconds()),
    ms: String(date.getUTCMilliseconds())
  };
}

function serializeCsv(track: Track): string {
  const header = [
    "INDEX",
    "TRACK ID",
    "VALID",
    "UTC DATE",
    "UTC TIME",
    "LOCAL DATE",
    "LOCAL TIME",
    "MS",
    "LATITUDE",
    "N/S",
    "LONGITUDE",
    "E/W",
    "ALTITUDE",
    "SPEED",
    "HEADING",
    "G-X",
    "G-Y",
    "G-Z"
  ];

  const rows = track.points.map((point, index) => {
    const latHemisphere = point.lat < 0 ? "S" : "N";
    const lngHemisphere = point.lng < 0 ? "W" : "E";
    const { utcDate, utcTime, localDate, localTime, ms } = toCsvDateParts(point.time);
    const altitude = typeof point.ele === "number" ? point.ele.toFixed(6) : "0.000000";

    return [
      String(index + 1),
      "1",
      "FIXED",
      utcDate,
      utcTime,
      localDate,
      localTime,
      ms,
      Math.abs(point.lat).toFixed(6),
      latHemisphere,
      Math.abs(point.lng).toFixed(6),
      lngHemisphere,
      altitude,
      "0.000000",
      "0.000000",
      "0.000000",
      "0.000000",
      "0.000000"
    ];
  });

  return [header, ...rows].map((row) => row.join(",")).join("\n") + "\n";
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

  if (track.format === "csv") {
    return {
      fileName,
      mimeType: mimeTypeForFormat(track.format),
      content: serializeCsv(track)
    };
  }

  return {
    fileName,
    mimeType: mimeTypeForFormat(track.format),
    content: serializeGeoJson(track)
  };
}
