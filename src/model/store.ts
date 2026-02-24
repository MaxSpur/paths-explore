import { getTrackColor } from "./colors";
import type { AppState, PointCoordinateUpdate, Track, TrackPoint } from "./types";

type StateListener = (state: AppState) => void;
interface EditHistorySnapshot {
  tracks: Track[];
  selectedTrackId?: string;
  editingTrackId?: string;
  selectedPointId?: string;
  selectedPointIds: string[];
}

const EDIT_HISTORY_LIMIT = 120;

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
  private editHistoryPast: EditHistorySnapshot[] = [];
  private editHistoryFuture: EditHistorySnapshot[] = [];

  private normalizeTrackGeometryVisibility(
    track: Track,
    nextShowPoints: boolean,
    nextShowSegments: boolean
  ): Pick<Track, "showPoints" | "showSegments"> {
    if (nextShowPoints || nextShowSegments) {
      return {
        showPoints: nextShowPoints,
        showSegments: nextShowSegments
      };
    }

    // At least one geometry visualization must remain on.
    if (track.showPoints && !track.showSegments) {
      return {
        showPoints: false,
        showSegments: true
      };
    }

    if (track.showSegments && !track.showPoints) {
      return {
        showPoints: true,
        showSegments: false
      };
    }

    return {
      showPoints: false,
      showSegments: true
    };
  }

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
      showSegments: track.showSegments ?? true,
      showPoints: track.showPoints ?? false,
      points: ensurePointIds(track.points)
    }));

    if (normalized.length === 0) {
      return;
    }

    this.pushEditSnapshot();

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
      showSegments: track.showSegments ?? true,
      showPoints: track.showPoints ?? false,
      points: ensurePointIds(track.points)
    }));

    this.state = {
      tracks: normalized,
      selectedPointIds: []
    };
    this.clearEditHistory();

    this.emit();
  }

  removeTrack(trackId: string): void {
    const exists = this.state.tracks.some((track) => track.id === trackId);
    if (!exists) {
      return;
    }

    this.pushEditSnapshot();

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
    const track = this.state.tracks.find((candidate) => candidate.id === trackId);
    if (!track || track.visible === visible) {
      return;
    }

    this.pushEditSnapshot();

    this.state = {
      ...this.state,
      tracks: this.state.tracks.map((track) =>
        track.id === trackId ? { ...track, visible } : track
      )
    };

    this.emit();
  }

  setTrackPointsVisible(trackId: string, show: boolean): void {
    const track = this.state.tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
      return;
    }

    const normalized = this.normalizeTrackGeometryVisibility(track, show, track.showSegments ?? true);
    if (
      normalized.showPoints === (track.showPoints ?? false) &&
      normalized.showSegments === (track.showSegments ?? true)
    ) {
      return;
    }

    this.pushEditSnapshot();

    this.state = {
      ...this.state,
      tracks: this.state.tracks.map((track) => {
        if (track.id !== trackId) {
          return track;
        }

        const normalized = this.normalizeTrackGeometryVisibility(track, show, track.showSegments ?? true);
        return {
          ...track,
          ...normalized
        };
      })
    };

    this.emit();
  }

  setTrackSegmentsVisible(trackId: string, show: boolean): void {
    const track = this.state.tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
      return;
    }

    const normalized = this.normalizeTrackGeometryVisibility(track, track.showPoints ?? false, show);
    if (
      normalized.showPoints === (track.showPoints ?? false) &&
      normalized.showSegments === (track.showSegments ?? true)
    ) {
      return;
    }

    this.pushEditSnapshot();

    this.state = {
      ...this.state,
      tracks: this.state.tracks.map((track) => {
        if (track.id !== trackId) {
          return track;
        }

        const normalized = this.normalizeTrackGeometryVisibility(track, track.showPoints ?? false, show);
        return {
          ...track,
          ...normalized
        };
      })
    };

    this.emit();
  }

  moveTrack(trackId: string, direction: "up" | "down"): void {
    const currentIndex = this.state.tracks.findIndex((track) => track.id === trackId);

    if (currentIndex < 0) {
      return;
    }

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= this.state.tracks.length) {
      return;
    }

    const tracks = [...this.state.tracks];
    const [movedTrack] = tracks.splice(currentIndex, 1);
    tracks.splice(targetIndex, 0, movedTrack);

    this.pushEditSnapshot();

    this.state = {
      ...this.state,
      tracks
    };

    this.emit();
  }

  updateTrackPoints(trackId: string, points: TrackPoint[]): void {
    const existingTrack = this.state.tracks.find((track) => track.id === trackId);
    if (!existingTrack) {
      return;
    }

    const normalizedPoints = ensurePointIds(points);
    const geometryChanged =
      existingTrack.points.length !== normalizedPoints.length ||
      existingTrack.points.some((point, index) => {
        const nextPoint = normalizedPoints[index];
        return (
          !nextPoint ||
          point.id !== nextPoint.id ||
          point.lat !== nextPoint.lat ||
          point.lng !== nextPoint.lng ||
          point.ele !== nextPoint.ele ||
          point.time !== nextPoint.time
        );
      });

    if (!geometryChanged) {
      return;
    }

    this.pushEditSnapshot();

    this.state = {
      ...this.state,
      tracks: this.state.tracks.map((track) =>
        track.id === trackId
          ? {
              ...track,
              points: normalizedPoints
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
    let movedCount = 0;
    const nextTracks = this.state.tracks.map((track) => {
      if (track.id !== trackId) {
        return track;
      }

      const nextPoints = track.points.map((point) => {
        const update = updatesById.get(point.id);
        if (!update) {
          return point;
        }

        if (point.lat === update.lat && point.lng === update.lng) {
          return point;
        }

        movedCount += 1;
        return {
          ...point,
          lat: update.lat,
          lng: update.lng
        };
      });

      return {
        ...track,
        points: nextPoints
      };
    });

    if (movedCount === 0) {
      return;
    }

    this.pushEditSnapshot();

    this.state = {
      ...this.state,
      tracks: nextTracks
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
    let removedCount = 0;
    const nextTracks = this.state.tracks.map((track) => {
      if (track.id !== selectedTrackId) {
        return track;
      }

      const nextPoints = track.points.filter((point) => !selectedSet.has(point.id));
      removedCount += track.points.length - nextPoints.length;

      return {
        ...track,
        points: nextPoints
      };
    });

    if (removedCount === 0) {
      return;
    }

    this.pushEditSnapshot();

    this.state = {
      ...this.state,
      tracks: nextTracks,
      selectedPointId: undefined,
      selectedPointIds: []
    };

    this.emit();
  }

  canUndoEdits(): boolean {
    return this.editHistoryPast.length > 0;
  }

  canRedoEdits(): boolean {
    return this.editHistoryFuture.length > 0;
  }

  peekUndoState(): AppState | undefined {
    const previousSnapshot = this.editHistoryPast[this.editHistoryPast.length - 1];
    if (!previousSnapshot) {
      return undefined;
    }

    return this.restoreEditSnapshot(previousSnapshot);
  }

  peekRedoState(): AppState | undefined {
    const nextSnapshot = this.editHistoryFuture[this.editHistoryFuture.length - 1];
    if (!nextSnapshot) {
      return undefined;
    }

    return this.restoreEditSnapshot(nextSnapshot);
  }

  undoEdits(): void {
    if (this.editHistoryPast.length === 0) {
      return;
    }

    const currentSnapshot = this.captureEditSnapshot();
    const previousSnapshot = this.editHistoryPast.pop();
    if (!previousSnapshot) {
      return;
    }

    this.editHistoryFuture.push(currentSnapshot);
    this.state = this.restoreEditSnapshot(previousSnapshot);
    this.emit();
  }

  redoEdits(): void {
    if (this.editHistoryFuture.length === 0) {
      return;
    }

    const currentSnapshot = this.captureEditSnapshot();
    const nextSnapshot = this.editHistoryFuture.pop();
    if (!nextSnapshot) {
      return;
    }

    this.editHistoryPast.push(currentSnapshot);
    this.state = this.restoreEditSnapshot(nextSnapshot);
    this.emit();
  }

  private clearEditHistory(): void {
    this.editHistoryPast = [];
    this.editHistoryFuture = [];
  }

  private pushEditSnapshot(): void {
    this.editHistoryPast.push(this.captureEditSnapshot());
    if (this.editHistoryPast.length > EDIT_HISTORY_LIMIT) {
      this.editHistoryPast.shift();
    }
    this.editHistoryFuture = [];
  }

  private captureEditSnapshot(): EditHistorySnapshot {
    return {
      tracks: this.cloneTracks(this.state.tracks),
      selectedTrackId: this.state.selectedTrackId,
      editingTrackId: this.state.editingTrackId,
      selectedPointId: this.state.selectedPointId,
      selectedPointIds: [...this.state.selectedPointIds]
    };
  }

  private restoreEditSnapshot(snapshot: EditHistorySnapshot): AppState {
    return {
      tracks: this.cloneTracks(snapshot.tracks),
      selectedTrackId: snapshot.selectedTrackId,
      editingTrackId: snapshot.editingTrackId,
      selectedPointId: snapshot.selectedPointId,
      selectedPointIds: [...snapshot.selectedPointIds]
    };
  }

  private cloneTracks(tracks: Track[]): Track[] {
    return tracks.map((track) => ({
      ...track,
      points: track.points.map((point) => ({ ...point }))
    }));
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
