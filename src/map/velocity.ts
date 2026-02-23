import type { SegmentColorMetric, Track, VelocityViewSettings } from "../model/types";

const EARTH_RADIUS_M = 6371000;

interface SegmentVelocityComputation {
  startIndex: number;
  endIndex: number;
  metersPerSecond: number;
  deltaSeconds: number;
}

interface SegmentAccelerationComputation {
  startIndex: number;
  endIndex: number;
  metersPerSecondSquared: number;
}

export interface SegmentColorScaleInfo {
  metric: SegmentColorMetric;
  maxBaseValue: number;
  maxDisplayValue: number;
  unitLabel: string;
  metricLabel: string;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function haversineDistanceMeters(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): number {
  const dLat = toRadians(endLat - startLat);
  const dLng = toRadians(endLng - startLng);
  const lat1 = toRadians(startLat);
  const lat2 = toRadians(endLat);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);

  const a = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

function parseTimestampMs(value?: string): number | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function kmhToMetersPerSecond(kmh: number): number {
  return kmh / 3.6;
}

function metersPerSecondToKmh(mps: number): number {
  return mps * 3.6;
}

export function computeTrackSegmentVelocities(track: Track): SegmentVelocityComputation[] {
  const segments: SegmentVelocityComputation[] = [];

  for (let idx = 0; idx < track.points.length - 1; idx += 1) {
    const start = track.points[idx];
    const end = track.points[idx + 1];

    const startMs = parseTimestampMs(start.time);
    const endMs = parseTimestampMs(end.time);

    if (startMs === null || endMs === null || endMs <= startMs) {
      continue;
    }

    const distanceMeters = haversineDistanceMeters(start.lat, start.lng, end.lat, end.lng);
    const deltaSeconds = (endMs - startMs) / 1000;

    if (deltaSeconds <= 0) {
      continue;
    }

    const metersPerSecond = distanceMeters / deltaSeconds;
    if (!Number.isFinite(metersPerSecond)) {
      continue;
    }

    segments.push({
      startIndex: idx,
      endIndex: idx + 1,
      metersPerSecond,
      deltaSeconds
    });
  }

  return segments;
}

export function computeTrackSegmentAccelerations(track: Track): SegmentAccelerationComputation[] {
  const velocities = computeTrackSegmentVelocities(track);
  const accelerations: SegmentAccelerationComputation[] = [];

  for (let idx = 1; idx < velocities.length; idx += 1) {
    const previous = velocities[idx - 1];
    const current = velocities[idx];

    // Only compare adjacent timed segments that share a point.
    if (previous.endIndex !== current.startIndex) {
      continue;
    }

    if (current.deltaSeconds <= 0) {
      continue;
    }

    const metersPerSecondSquared = Math.abs(
      (current.metersPerSecond - previous.metersPerSecond) / current.deltaSeconds
    );

    if (!Number.isFinite(metersPerSecondSquared)) {
      continue;
    }

    accelerations.push({
      startIndex: current.startIndex,
      endIndex: current.endIndex,
      metersPerSecondSquared
    });
  }

  return accelerations;
}

function getAutoMaxVelocityMetersPerSecond(tracks: Track[]): number {
  let maxValue = 0;

  for (const track of tracks) {
    for (const segment of computeTrackSegmentVelocities(track)) {
      if (segment.metersPerSecond > maxValue) {
        maxValue = segment.metersPerSecond;
      }
    }
  }

  return maxValue;
}

function getAutoMaxAccelerationMetersPerSecondSquared(tracks: Track[]): number {
  let maxValue = 0;

  for (const track of tracks) {
    for (const segment of computeTrackSegmentAccelerations(track)) {
      if (segment.metersPerSecondSquared > maxValue) {
        maxValue = segment.metersPerSecondSquared;
      }
    }
  }

  return maxValue;
}

export function computeVelocityScaleInfo(
  tracks: Track[],
  settings: VelocityViewSettings
): SegmentColorScaleInfo {
  if (settings.metric === "acceleration") {
    const autoMax = getAutoMaxAccelerationMetersPerSecondSquared(tracks);
    const fixedMax = Math.max(0, settings.fixedMax);
    const maxBaseValue = settings.scaleMode === "fixed" ? fixedMax : autoMax;

    return {
      metric: "acceleration",
      maxBaseValue,
      maxDisplayValue: maxBaseValue,
      unitLabel: "m/s²",
      metricLabel: "Acceleration"
    };
  }

  const autoMax = getAutoMaxVelocityMetersPerSecond(tracks);
  const fixedMax = kmhToMetersPerSecond(Math.max(0, settings.fixedMax));
  const maxBaseValue = settings.scaleMode === "fixed" ? fixedMax : autoMax;

  return {
    metric: "velocity",
    maxBaseValue,
    maxDisplayValue: metersPerSecondToKmh(maxBaseValue),
    unitLabel: "km/h",
    metricLabel: "Velocity"
  };
}

export function normalizeVelocity(value: number, scaleInfo: SegmentColorScaleInfo): number {
  if (scaleInfo.maxBaseValue <= 0 || !Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value / scaleInfo.maxBaseValue));
}

export function metersPerSecondToKilometersPerHour(value: number): number {
  return metersPerSecondToKmh(value);
}
