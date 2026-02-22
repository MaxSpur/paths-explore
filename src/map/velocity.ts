import type { Track, VelocityViewSettings } from "../model/types";

const EARTH_RADIUS_M = 6371000;

interface SegmentComputation {
  startIndex: number;
  endIndex: number;
  metersPerSecond: number;
}

export interface VelocityScaleInfo {
  maxMetersPerSecond: number;
  maxKmh: number;
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

export function computeTrackSegmentVelocities(track: Track): SegmentComputation[] {
  const segments: SegmentComputation[] = [];

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
      metersPerSecond
    });
  }

  return segments;
}

function getAutoMaxVelocityMetersPerSecond(tracks: Track[]): number {
  let maxVelocity = 0;

  for (const track of tracks) {
    const segments = computeTrackSegmentVelocities(track);
    for (const segment of segments) {
      if (segment.metersPerSecond > maxVelocity) {
        maxVelocity = segment.metersPerSecond;
      }
    }
  }

  return maxVelocity;
}

export function computeVelocityScaleInfo(
  tracks: Track[],
  settings: VelocityViewSettings
): VelocityScaleInfo {
  const autoMaxMps = getAutoMaxVelocityMetersPerSecond(tracks);
  const fixedMaxMps = kmhToMetersPerSecond(settings.fixedMaxKmh);

  const maxMetersPerSecond =
    settings.scaleMode === "fixed" && fixedMaxMps > 0 ? fixedMaxMps : autoMaxMps;

  return {
    maxMetersPerSecond,
    maxKmh: metersPerSecondToKmh(maxMetersPerSecond)
  };
}

export function normalizeVelocity(
  metersPerSecond: number,
  scaleInfo: VelocityScaleInfo
): number {
  if (scaleInfo.maxMetersPerSecond <= 0 || !Number.isFinite(metersPerSecond)) {
    return 0;
  }

  return Math.min(1, Math.max(0, metersPerSecond / scaleInfo.maxMetersPerSecond));
}

export function metersPerSecondToKilometersPerHour(value: number): number {
  return metersPerSecondToKmh(value);
}
