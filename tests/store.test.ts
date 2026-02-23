import { describe, expect, it } from "vitest";
import { getTrackColor } from "../src/model/colors";
import { TrackStore } from "../src/model/store";
import type { Track } from "../src/model/types";

function buildTrack(id: string, name: string): Track {
  return {
    id,
    name,
    sourceFile: `${name}.gpx`,
    format: "gpx",
    color: "",
    visible: true,
    showSegments: true,
    showPoints: false,
    points: [
      { id: `${id}-a`, lat: 37, lng: -122 },
      { id: `${id}-b`, lat: 37.1, lng: -122.1 },
      { id: `${id}-c`, lat: 37.2, lng: -122.2 }
    ]
  };
}

describe("track store", () => {
  it("assigns deterministic colors by insertion order", () => {
    const store = new TrackStore();
    store.addTracks([
      buildTrack("track-1", "one"),
      buildTrack("track-2", "two"),
      buildTrack("track-3", "three")
    ]);

    const tracks = store.getState().tracks;

    expect(tracks[0].color).toBe(getTrackColor(0));
    expect(tracks[1].color).toBe(getTrackColor(1));
    expect(tracks[2].color).toBe(getTrackColor(2));
    expect(new Set(tracks.map((track) => track.color)).size).toBe(3);
  });

  it("moves and deletes selected points", () => {
    const store = new TrackStore();
    store.addTracks([buildTrack("track-1", "editable")]);

    store.movePoint("track-1", "track-1-b", 40, -100);

    let track = store.getState().tracks[0];
    expect(track.points[1].lat).toBe(40);
    expect(track.points[1].lng).toBe(-100);

    store.setSelectedPoints("track-1", ["track-1-a", "track-1-b"]);
    store.deleteSelectedPoints();

    track = store.getState().tracks[0];
    expect(track.points).toHaveLength(1);
    expect(track.points.find((point) => point.id === "track-1-a")).toBeUndefined();
    expect(track.points.find((point) => point.id === "track-1-b")).toBeUndefined();
  });

  it("toggles multi-selection with additive mode", () => {
    const store = new TrackStore();
    store.addTracks([buildTrack("track-1", "editable")]);

    store.togglePointSelection("track-1", "track-1-a", false);
    store.togglePointSelection("track-1", "track-1-b", true);

    expect(store.getState().selectedPointIds).toEqual(["track-1-a", "track-1-b"]);

    store.togglePointSelection("track-1", "track-1-a", true);
    expect(store.getState().selectedPointIds).toEqual(["track-1-b"]);
  });

  it("adds marquee selection without clearing existing selection", () => {
    const store = new TrackStore();
    store.addTracks([buildTrack("track-1", "editable")]);

    store.setSelectedPoints("track-1", ["track-1-a"]);
    store.selectPoints("track-1", ["track-1-b", "track-1-c"], true);

    expect(store.getState().selectedPointIds).toEqual(["track-1-a", "track-1-b", "track-1-c"]);
  });

  it("keeps at least one of points/segments enabled", () => {
    const store = new TrackStore();
    store.addTracks([buildTrack("track-1", "editable")]);

    store.setTrackSegmentsVisible("track-1", false);
    let track = store.getState().tracks[0];
    expect(track.showSegments).toBe(false);
    expect(track.showPoints).toBe(true);

    store.setTrackPointsVisible("track-1", false);
    track = store.getState().tracks[0];
    expect(track.showSegments).toBe(true);
    expect(track.showPoints).toBe(false);
  });

  it("reorders tracks up and down with boundary guards", () => {
    const store = new TrackStore();
    store.addTracks([
      buildTrack("track-1", "one"),
      buildTrack("track-2", "two"),
      buildTrack("track-3", "three")
    ]);

    store.moveTrack("track-1", "up");
    expect(store.getState().tracks.map((track) => track.id)).toEqual([
      "track-1",
      "track-2",
      "track-3"
    ]);

    store.moveTrack("track-1", "down");
    expect(store.getState().tracks.map((track) => track.id)).toEqual([
      "track-2",
      "track-1",
      "track-3"
    ]);

    store.moveTrack("track-1", "down");
    expect(store.getState().tracks.map((track) => track.id)).toEqual([
      "track-2",
      "track-3",
      "track-1"
    ]);

    store.moveTrack("track-1", "down");
    expect(store.getState().tracks.map((track) => track.id)).toEqual([
      "track-2",
      "track-3",
      "track-1"
    ]);
  });
});
