export type SupportedFormat = "gpx" | "kml" | "geojson";
export type EditInteractionMode = "move" | "marquee";

export interface TrackPoint {
  id: string;
  lat: number;
  lng: number;
  ele?: number;
  time?: string;
}

export interface Track {
  id: string;
  name: string;
  sourceFile: string;
  format: SupportedFormat;
  color: string;
  visible: boolean;
  showPoints: boolean;
  points: TrackPoint[];
}

export interface AppState {
  tracks: Track[];
  selectedTrackId?: string;
  editingTrackId?: string;
  selectedPointId?: string;
  selectedPointIds: string[];
}

export interface PointCoordinateUpdate {
  pointId: string;
  lat: number;
  lng: number;
}

export interface ImportIssue {
  fileName: string;
  message: string;
  level: "warning" | "error";
}

export interface ImportSummary {
  importedTrackCount: number;
  issues: ImportIssue[];
}
