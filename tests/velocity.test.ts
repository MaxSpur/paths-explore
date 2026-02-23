import { describe, expect, it } from "vitest";
import { parseColormapCsv, sampleColormapColor } from "../src/colormaps";
import {
  computeTrackSegmentVelocities,
  computeVelocityScaleInfo,
  normalizeVelocity
} from "../src/map/velocity";
import type { Track, VelocityViewSettings } from "../src/model/types";

function buildTimedTrack(id: string, points: Track["points"]): Track {
  return {
    id,
    name: id,
    sourceFile: `${id}.gpx`,
    format: "gpx",
    color: "#136f63",
    visible: true,
    showSegments: true,
    showPoints: false,
    points
  };
}

describe("velocity tools", () => {
  it("computes segment velocity from distance and time", () => {
    const track = buildTimedTrack("t1", [
      { id: "a", lat: 0, lng: 0, time: "2026-01-01T00:00:00.000Z" },
      { id: "b", lat: 0, lng: 0.001, time: "2026-01-01T00:00:10.000Z" }
    ]);

    const segments = computeTrackSegmentVelocities(track);

    expect(segments).toHaveLength(1);
    expect(segments[0].startIndex).toBe(0);
    expect(segments[0].endIndex).toBe(1);
    expect(segments[0].metersPerSecond).toBeGreaterThan(11);
    expect(segments[0].metersPerSecond).toBeLessThan(11.2);
  });

  it("supports auto and fixed velocity scale modes", () => {
    const tracks = [
      buildTimedTrack("slow", [
        { id: "a", lat: 0, lng: 0, time: "2026-01-01T00:00:00.000Z" },
        { id: "b", lat: 0, lng: 0.001, time: "2026-01-01T00:00:20.000Z" }
      ]),
      buildTimedTrack("fast", [
        { id: "a", lat: 0, lng: 0, time: "2026-01-01T00:00:00.000Z" },
        { id: "b", lat: 0, lng: 0.001, time: "2026-01-01T00:00:10.000Z" }
      ])
    ];

    const autoSettings: VelocityViewSettings = {
      enabled: true,
      scaleMode: "auto",
      fixedMaxKmh: 10,
      colormapId: "cet-l08"
    };

    const fixedSettings: VelocityViewSettings = {
      ...autoSettings,
      scaleMode: "fixed",
      fixedMaxKmh: 36
    };

    const autoScale = computeVelocityScaleInfo(tracks, autoSettings);
    const fixedScale = computeVelocityScaleInfo(tracks, fixedSettings);

    expect(autoScale.maxMetersPerSecond).toBeGreaterThan(11);
    expect(autoScale.maxMetersPerSecond).toBeLessThan(11.2);
    expect(fixedScale.maxMetersPerSecond).toBeCloseTo(10, 6);
    expect(normalizeVelocity(5, fixedScale)).toBeCloseTo(0.5, 6);
  });

  it("parses csv colormap rows and samples rgb output", () => {
    const colors = parseColormapCsv(`0,0,0\n1,1,1\n`);

    expect(colors).toHaveLength(2);
    expect(sampleColormapColor(colors, 0)).toBe("rgb(0, 0, 0)");
    expect(sampleColormapColor(colors, 1)).toBe("rgb(255, 255, 255)");
    expect(sampleColormapColor(colors, 0.5)).toBe("rgb(128, 128, 128)");
  });
});
