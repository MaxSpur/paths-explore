import { describe, expect, it } from "vitest";
import { parseTextContent } from "../src/io/parsers";

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
});
