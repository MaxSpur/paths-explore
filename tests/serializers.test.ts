import { describe, expect, it } from "vitest";
import { serializeTrack } from "../src/io/serializers";
import type { Track } from "../src/model/types";

function buildTrack(format: Track["format"]): Track {
  return {
    id: "track-1",
    name: "Sample Track",
    sourceFile: `sample.${format === "geojson" ? "geojson" : format}`,
    format,
    color: "#136f63",
    visible: true,
    showSegments: true,
    showPoints: false,
    points: [
      { id: "p1", lat: 37.1, lng: -122.1, ele: 10, time: "2026-01-01T00:00:00Z" },
      { id: "p2", lat: 37.2, lng: -122.2, ele: 12, time: "2026-01-01T00:01:00Z" }
    ]
  };
}

describe("track serializers", () => {
  it("serializes gpx with gpx extension", () => {
    const output = serializeTrack(buildTrack("gpx"));

    expect(output.fileName.endsWith(".gpx")).toBe(true);
    expect(output.content).toContain("<gpx");
    expect(output.content).toContain("<trkpt");
  });

  it("serializes kml with kml extension", () => {
    const output = serializeTrack(buildTrack("kml"));

    expect(output.fileName.endsWith(".kml")).toBe(true);
    expect(output.content).toContain("<kml");
    expect(output.content).toContain("<LineString>");
  });

  it("serializes geojson with geojson extension", () => {
    const output = serializeTrack(buildTrack("geojson"));

    expect(output.fileName.endsWith(".geojson")).toBe(true);
    expect(output.content).toContain('"FeatureCollection"');
    expect(output.content).toContain('"LineString"');
  });
});
