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
});
