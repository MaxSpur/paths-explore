import { describe, expect, it } from "vitest";
import { parseTextContent, parseZipFile } from "../src/io/parsers";

function writeUInt16LE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeUInt32LE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

function buildStoredZip(entries: Array<{ name: string; content: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const fileNameBytes = encoder.encode(entry.name);
    const contentBytes = encoder.encode(entry.content);

    const localHeader = new Uint8Array(30 + fileNameBytes.length);
    writeUInt32LE(localHeader, 0, 0x04034b50);
    writeUInt16LE(localHeader, 4, 20);
    writeUInt16LE(localHeader, 6, 0);
    writeUInt16LE(localHeader, 8, 0);
    writeUInt16LE(localHeader, 10, 0);
    writeUInt16LE(localHeader, 12, 0);
    writeUInt32LE(localHeader, 14, 0);
    writeUInt32LE(localHeader, 18, contentBytes.length);
    writeUInt32LE(localHeader, 22, contentBytes.length);
    writeUInt16LE(localHeader, 26, fileNameBytes.length);
    writeUInt16LE(localHeader, 28, 0);
    localHeader.set(fileNameBytes, 30);

    localChunks.push(localHeader, contentBytes);

    const centralHeader = new Uint8Array(46 + fileNameBytes.length);
    writeUInt32LE(centralHeader, 0, 0x02014b50);
    writeUInt16LE(centralHeader, 4, 20);
    writeUInt16LE(centralHeader, 6, 20);
    writeUInt16LE(centralHeader, 8, 0);
    writeUInt16LE(centralHeader, 10, 0);
    writeUInt16LE(centralHeader, 12, 0);
    writeUInt16LE(centralHeader, 14, 0);
    writeUInt32LE(centralHeader, 16, 0);
    writeUInt32LE(centralHeader, 20, contentBytes.length);
    writeUInt32LE(centralHeader, 24, contentBytes.length);
    writeUInt16LE(centralHeader, 28, fileNameBytes.length);
    writeUInt16LE(centralHeader, 30, 0);
    writeUInt16LE(centralHeader, 32, 0);
    writeUInt16LE(centralHeader, 34, 0);
    writeUInt16LE(centralHeader, 36, 0);
    writeUInt32LE(centralHeader, 38, 0);
    writeUInt32LE(centralHeader, 42, offset);
    centralHeader.set(fileNameBytes, 46);
    centralChunks.push(centralHeader);

    offset += localHeader.length + contentBytes.length;
  }

  const centralDirectory = concatBytes(centralChunks);
  const localData = concatBytes(localChunks);
  const eocd = new Uint8Array(22);
  writeUInt32LE(eocd, 0, 0x06054b50);
  writeUInt16LE(eocd, 4, 0);
  writeUInt16LE(eocd, 6, 0);
  writeUInt16LE(eocd, 8, entries.length);
  writeUInt16LE(eocd, 10, entries.length);
  writeUInt32LE(eocd, 12, centralDirectory.length);
  writeUInt32LE(eocd, 16, localData.length);
  writeUInt16LE(eocd, 20, 0);

  return concatBytes([localData, centralDirectory, eocd]);
}

describe("parsers", () => {
  it("parses a GPX file into a single track", () => {
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
      <gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
        <trk>
          <name>Example</name>
          <trkseg>
            <trkpt lat="37.0" lon="-122.0"><ele>12</ele></trkpt>
            <trkpt lat="37.1" lon="-122.1"><ele>14</ele></trkpt>
          </trkseg>
        </trk>
      </gpx>`;

    const tracks = parseTextContent("route.gpx", gpx);

    expect(tracks).toHaveLength(1);
    expect(tracks[0].format).toBe("gpx");
    expect(tracks[0].points).toHaveLength(2);
    expect(tracks[0].points[0].lat).toBeCloseTo(37.0);
  });

  it("parses a KML LineString file", () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
      <kml xmlns="http://www.opengis.net/kml/2.2">
        <Document>
          <Placemark>
            <LineString>
              <coordinates>
                -122.0,37.0,0 -122.1,37.1,0
              </coordinates>
            </LineString>
          </Placemark>
        </Document>
      </kml>`;

    const tracks = parseTextContent("route.kml", kml);

    expect(tracks).toHaveLength(1);
    expect(tracks[0].format).toBe("kml");
    expect(tracks[0].points).toHaveLength(2);
  });

  it("splits MultiLineString GeoJSON into multiple tracks", () => {
    const geoJson = JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "MultiLineString",
            coordinates: [
              [
                [-122.0, 37.0],
                [-122.1, 37.1]
              ],
              [
                [-122.2, 37.2],
                [-122.3, 37.3]
              ]
            ]
          },
          properties: {}
        }
      ]
    });

    const tracks = parseTextContent("segments.geojson", geoJson);

    expect(tracks).toHaveLength(2);
    expect(tracks[0].name).toBe("segments");
    expect(tracks[1].name).toBe("segments (2)");
  });

  it("throws clear error for unsupported geometry", () => {
    const geoJson = JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [-122, 37]
          },
          properties: {}
        }
      ]
    });

    expect(() => parseTextContent("point.geojson", geoJson)).toThrow(
      /Unsupported geometry type\(s\): Point/
    );
  });

  it("parses BT-Q1000XT CSV including UTC timestamps and hemispheres", () => {
    const csv = `INDEX,TRACK ID,VALID,UTC DATE,UTC TIME,LOCAL DATE,LOCAL TIME,MS,LATITUDE,N/S,LONGITUDE,E/W,ALTITUDE,SPEED,HEADING,G-X,G-Y,G-Z
1,1,FIXED,2015/9/11,7:26:7,2015/9/11,9:26:7,100,25.068816,N,121.591208,E,113.811127,0.2,251,0,0,0
2,1,FIXED,2015/9/11,7:26:8,2015/9/11,9:26:8,200,25.068900,S,121.591300,W,114.100000,0.2,251,0,0,0`;

    const tracks = parseTextContent("bt.csv", csv);

    expect(tracks).toHaveLength(1);
    expect(tracks[0].format).toBe("csv");
    expect(tracks[0].points).toHaveLength(2);
    expect(tracks[0].points[0].lat).toBeCloseTo(25.068816);
    expect(tracks[0].points[0].lng).toBeCloseTo(121.591208);
    expect(tracks[0].points[1].lat).toBeCloseTo(-25.0689);
    expect(tracks[0].points[1].lng).toBeCloseTo(-121.5913);
    expect(tracks[0].points[0].time).toBe("2015-09-11T07:26:07.100Z");
  });

  it("splits BT-Q1000XT CSV by TRACK ID", () => {
    const csv = `INDEX,TRACK ID,VALID,UTC DATE,UTC TIME,LOCAL DATE,LOCAL TIME,MS,LATITUDE,N/S,LONGITUDE,E/W,ALTITUDE,SPEED,HEADING,G-X,G-Y,G-Z
1,1,FIXED,2015/9/11,7:26:7,2015/9/11,9:26:7,100,25.068816,N,121.591208,E,113.8,0.2,251,0,0,0
2,2,FIXED,2015/9/11,7:26:8,2015/9/11,9:26:8,100,25.068900,N,121.591300,E,113.9,0.2,251,0,0,0`;

    const tracks = parseTextContent("bt-multi.csv", csv);

    expect(tracks).toHaveLength(2);
    expect(tracks[0].name).toContain("(track 1)");
    expect(tracks[1].name).toContain("(track 2)");
  });

  it("parses supported files inside ZIP and reports invalid entries", async () => {
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
      <gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
        <trk><trkseg>
          <trkpt lat="37.0" lon="-122.0"></trkpt>
          <trkpt lat="37.1" lon="-122.1"></trkpt>
        </trkseg></trk>
      </gpx>`;
    const invalidGeoJson = JSON.stringify({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: {} }]
    });
    const zipBytes = buildStoredZip([
      { name: "folder/route.gpx", content: gpx },
      { name: "bad.geojson", content: invalidGeoJson },
      { name: "notes.txt", content: "ignored" }
    ]);
    const zipFile = new File([zipBytes], "bundle.zip", { type: "application/zip" });

    const result = await parseZipFile(zipFile);

    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].format).toBe("gpx");
    expect(result.tracks[0].sourceFile).toBe("folder/route.gpx");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].fileName).toContain("bundle.zip");
    expect(result.issues[0].fileName).toContain("bad.geojson");
  });
});
