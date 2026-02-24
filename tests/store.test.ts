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

  it("undoes and redoes point moves", () => {
    const store = new TrackStore();
    store.addTracks([buildTrack("track-1", "editable")]);

    store.movePoint("track-1", "track-1-b", 40, -100);
    let point = store.getState().tracks[0].points[1];
    expect(point.lat).toBe(40);
    expect(point.lng).toBe(-100);
    expect(store.canUndoEdits()).toBe(true);

    store.undoEdits();
    point = store.getState().tracks[0].points[1];
    expect(point.lat).toBe(37.1);
    expect(point.lng).toBe(-122.1);
    expect(store.canRedoEdits()).toBe(true);

    store.redoEdits();
    point = store.getState().tracks[0].points[1];
    expect(point.lat).toBe(40);
    expect(point.lng).toBe(-100);
  });

  it("undoes deletions and clears redo when new edits are made", () => {
    const store = new TrackStore();
    store.addTracks([buildTrack("track-1", "editable")]);

    store.setSelectedPoints("track-1", ["track-1-a", "track-1-b"]);
    store.deleteSelectedPoints();
    expect(store.getState().tracks[0].points).toHaveLength(1);

    store.undoEdits();
    expect(store.getState().tracks[0].points).toHaveLength(3);

    store.movePoint("track-1", "track-1-c", 41, -101);
    expect(store.canRedoEdits()).toBe(false);
  });

  it("undoes visibility toggles and track reordering", () => {
    const store = new TrackStore();
    store.addTracks([buildTrack("track-1", "one"), buildTrack("track-2", "two")]);

    store.setTrackVisibility("track-1", false);
    store.moveTrack("track-2", "up");

    expect(store.getState().tracks[0].id).toBe("track-2");
    expect(store.getState().tracks.find((track) => track.id === "track-1")?.visible).toBe(false);

    store.undoEdits();
    expect(store.getState().tracks.map((track) => track.id)).toEqual(["track-1", "track-2"]);
    expect(store.getState().tracks.find((track) => track.id === "track-1")?.visible).toBe(false);

    store.undoEdits();
    expect(store.getState().tracks.find((track) => track.id === "track-1")?.visible).toBe(true);
  });

  it("restores external settings snapshots in the same undo stack", () => {
    let externalState = { metric: "velocity", max: 60 };
    const store = new TrackStore({
      captureExternalState: () => ({ ...externalState }),
      restoreExternalState: (value) => {
        externalState = { ...(value as { metric: string; max: number }) };
      }
    });

    store.addTracks([buildTrack("track-1", "editable")]);
    store.recordHistoryCheckpoint();
    externalState = { metric: "acceleration", max: 20 };

    store.undoEdits();
    expect(externalState).toEqual({ metric: "velocity", max: 60 });

    store.redoEdits();
    expect(externalState).toEqual({ metric: "acceleration", max: 20 });
  });
});
