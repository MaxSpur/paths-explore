export type SupportedFormat = "gpx" | "kml" | "geojson" | "csv";
export type EditInteractionMode = "move" | "marquee" | "lasso" | "info";
export type VelocityScaleMode = "auto" | "fixed";
export type SegmentColorMetric = "velocity" | "acceleration";
export type AnalysisMode = "off" | SegmentColorMetric | "od";
export type OdMetric = "weight" | "tripCount";
export type OdMetricKey = string;
export type MapBaseStyle =
  | "osm-standard"
  | "carto-light"
  | "carto-dark"
  | "carto-voyager"
  | "carto-positron"
  | "carto-positron-nolabels";

export interface VelocityViewSettings {
  enabled: boolean;
  metric: SegmentColorMetric;
  scaleMode: VelocityScaleMode;
  fixedMax: number;
  colormapId: string;
}

export interface AnalysisSettings {
  mode: AnalysisMode;
  colormapId: string;
  velocityScaleMode: VelocityScaleMode;
  velocityFixedMax: number;
  odColorMetricKey: OdMetricKey;
  odDrawOrderMetricKey: OdMetricKey;
  odLinkMetricSelections: boolean;
  odLinkVariantValueSelections: boolean;
}

export interface MapViewSettings {
  baseStyle: MapBaseStyle;
  darkenPercent: number;
  desaturatePercent: number;
}

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
  showSegments: boolean;
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
  importedBundleCount: number;
  issues: ImportIssue[];
}
