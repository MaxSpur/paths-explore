import { getTrackColor } from "./colors";
import type { AppState, PointCoordinateUpdate, Track, TrackPoint } from "./types";

type StateListener = (state: AppState) => void;

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 11)}`;
}

function ensurePointIds(points: TrackPoint[]): TrackPoint[] {
  return points.map((point) => ({
    ...point,
    id: point.id || makeId("pt")
  }));
}

export class TrackStore {
  private state: AppState = { tracks: [], selectedPointIds: [] };
  private listeners = new Set<StateListener>();

  getState(): AppState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);

    return () => {
      this.listeners.delete(listener);
    };
  }

  addTracks(tracks: Track[]): void {
    const offset = this.state.tracks.length;
    const normalized = tracks.map((track, idx) => ({
      ...track,
      id: track.id || makeId("track"),
      color: getTrackColor(offset + idx),
      visible: track.visible ?? true,
      showPoints: track.showPoints ?? false,
      points: ensurePointIds(track.points)
    }));

    this.state = {
      ...this.state,
      tracks: [...this.state.tracks, ...normalized]
    };

    this.emit();
  }

  hydrateTracks(tracks: Track[]): void {
    const normalized = tracks.map((track, idx) => ({
      ...track,
      id: track.id || makeId("track"),
      color: track.color || getTrackColor(idx),
      visible: track.visible ?? true,
      showPoints: track.showPoints ?? false,
      points: ensurePointIds(track.points)
    }));

    this.state = {
      tracks: normalized,
      selectedPointIds: []
    };

    this.emit();
  }

  removeTrack(trackId: string): void {
    this.state = {
      ...this.state,
      tracks: this.state.tracks.filter((track) => track.id !== trackId),
      selectedTrackId: this.state.selectedTrackId === trackId ? undefined : this.state.selectedTrackId,
      editingTrackId: this.state.editingTrackId === trackId ? undefined : this.state.editingTrackId,
      selectedPointId: undefined,
      selectedPointIds: []
    };

    this.emit();
  }

  setEditingTrack(trackId?: string): void {
    this.state = {
      ...this.state,
      editingTrackId: trackId,
      selectedTrackId: trackId,
      selectedPointId: undefined,
      selectedPointIds: []
    };

    this.emit();
  }

  setSelectedPoint(trackId?: string, pointId?: string): void {
    this.setSelectedPoints(trackId, pointId ? [pointId] : []);
  }

  setSelectedPoints(trackId?: string, pointIds: string[] = []): void {
    this.state = {
      ...this.state,
      selectedTrackId: trackId,
      selectedPointId: pointIds[0],
      selectedPointIds: [...pointIds]
    };

    this.emit();
  }

  togglePointSelection(trackId: string, pointId: string, additive: boolean): void {
    if (!additive || this.state.selectedTrackId !== trackId) {
      this.setSelectedPoints(trackId, [pointId]);
      return;
    }

    const exists = this.state.selectedPointIds.includes(pointId);
    const selectedPointIds = exists
      ? this.state.selectedPointIds.filter((id) => id !== pointId)
      : [...this.state.selectedPointIds, pointId];

    this.state = {
      ...this.state,
      selectedTrackId: trackId,
      selectedPointId: selectedPointIds[0],
      selectedPointIds
    };

    this.emit();
  }

  selectPoints(trackId: string, pointIds: string[], additive: boolean): void {
    const uniqueIds = Array.from(new Set(pointIds));

    if (!additive || this.state.selectedTrackId !== trackId) {
      this.setSelectedPoints(trackId, uniqueIds);
      return;
    }

    const selectedPointIds = Array.from(new Set([...this.state.selectedPointIds, ...uniqueIds]));

    this.state = {
      ...this.state,
      selectedTrackId: trackId,
      selectedPointId: selectedPointIds[0],
      selectedPointIds
    };

    this.emit();
  }

  setTrackVisibility(trackId: string, visible: boolean): void {
    this.state = {
      ...this.state,
      tracks: this.state.tracks.map((track) =>
        track.id === trackId ? { ...track, visible } : track
      )
    };

    this.emit();
  }

  setTrackPointsVisible(trackId: string, show: boolean): void {
    this.state = {
      ...this.state,
      tracks: this.state.tracks.map((track) =>
        track.id === trackId ? { ...track, showPoints: show } : track
      )
    };

    this.emit();
  }

  updateTrackPoints(trackId: string, points: TrackPoint[]): void {
    this.state = {
      ...this.state,
      tracks: this.state.tracks.map((track) =>
        track.id === trackId
          ? {
              ...track,
              points: ensurePointIds(points)
            }
          : track
      )
    };

    this.emit();
  }

  movePoints(trackId: string, updates: PointCoordinateUpdate[]): void {
    if (updates.length === 0) {
      return;
    }

    const updatesById = new Map(updates.map((update) => [update.pointId, update]));
    this.state = {
      ...this.state,
      tracks: this.state.tracks.map((track) => {
        if (track.id !== trackId) {
          return track;
        }

        return {
          ...track,
          points: track.points.map((point) =>
            updatesById.has(point.id)
              ? {
                  ...point,
                  lat: updatesById.get(point.id)!.lat,
                  lng: updatesById.get(point.id)!.lng
                }
              : point
          )
        };
      })
    };

    this.emit();
  }

  movePoint(trackId: string, pointId: string, lat: number, lng: number): void {
    this.movePoints(trackId, [{ pointId, lat, lng }]);
  }

  deleteSelectedPoints(): void {
    const { selectedTrackId, selectedPointIds } = this.state;

    if (!selectedTrackId || selectedPointIds.length === 0) {
      return;
    }

    const selectedSet = new Set(selectedPointIds);

    this.state = {
      ...this.state,
      tracks: this.state.tracks.map((track) => {
        if (track.id !== selectedTrackId) {
          return track;
        }

        return {
          ...track,
          points: track.points.filter((point) => !selectedSet.has(point.id))
        };
      }),
      selectedPointId: undefined,
      selectedPointIds: []
    };

    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
