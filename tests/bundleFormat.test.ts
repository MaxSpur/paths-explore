import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { parseBundleFile } from "../src/io/bundleFormat";
import {
  BundleStore,
  extractBundleTrajectoryAsTrack,
  getOdEdgeMetricValue
} from "../src/model/bundles";
import { TrackStore } from "../src/model/store";
import type { TrajectoryBundle } from "../src/model/bundles";
import type { Track } from "../src/model/types";

function writeUInt16LE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeUInt32LE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

function buildZip(
  entries: Array<{ name: string; content: string }>,
  compressionMethod: 0 | 8
): Uint8Array {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const fileNameBytes = encoder.encode(entry.name);
    const rawContentBytes = encoder.encode(entry.content);
    const contentBytes =
      compressionMethod === 8 ? new Uint8Array(deflateRawSync(rawContentBytes)) : rawContentBytes;

    const localHeader = new Uint8Array(30 + fileNameBytes.length);
    writeUInt32LE(localHeader, 0, 0x04034b50);
    writeUInt16LE(localHeader, 4, 20);
    writeUInt16LE(localHeader, 6, 0);
    writeUInt16LE(localHeader, 8, compressionMethod);
    writeUInt16LE(localHeader, 10, 0);
    writeUInt16LE(localHeader, 12, 0);
    writeUInt32LE(localHeader, 14, 0);
    writeUInt32LE(localHeader, 18, contentBytes.length);
    writeUInt32LE(localHeader, 22, rawContentBytes.length);
    writeUInt16LE(localHeader, 26, fileNameBytes.length);
    writeUInt16LE(localHeader, 28, 0);
    localHeader.set(fileNameBytes, 30);

    localChunks.push(localHeader, contentBytes);

    const centralHeader = new Uint8Array(46 + fileNameBytes.length);
    writeUInt32LE(centralHeader, 0, 0x02014b50);
    writeUInt16LE(centralHeader, 4, 20);
    writeUInt16LE(centralHeader, 6, 20);
    writeUInt16LE(centralHeader, 8, 0);
    writeUInt16LE(centralHeader, 10, compressionMethod);
    writeUInt16LE(centralHeader, 12, 0);
    writeUInt16LE(centralHeader, 14, 0);
    writeUInt32LE(centralHeader, 16, 0);
    writeUInt32LE(centralHeader, 20, contentBytes.length);
    writeUInt32LE(centralHeader, 24, rawContentBytes.length);
    writeUInt16LE(centralHeader, 28, fileNameBytes.length);
    writeUInt16LE(centralHeader, 30, 0);
    writeUInt16LE(centralHeader, 32, 0);
    writeUInt16LE(centralHeader, 34, 0);
    writeUInt16LE(centralHeader, 36, 0);
    writeUInt32LE(centralHeader, 38, 0);
    writeUInt32LE(centralHeader, 42, offset);
    centralHeader.set(fileNameBytes, 46);
    centralChunks.push(centralHeader);

    offset += localHeader.length + contentBytes.length;
  }

  const centralDirectory = concatBytes(centralChunks);
  const localData = concatBytes(localChunks);
  const eocd = new Uint8Array(22);
  writeUInt32LE(eocd, 0, 0x06054b50);
  writeUInt16LE(eocd, 4, 0);
  writeUInt16LE(eocd, 6, 0);
  writeUInt16LE(eocd, 8, entries.length);
  writeUInt16LE(eocd, 10, entries.length);
  writeUInt32LE(eocd, 12, centralDirectory.length);
  writeUInt32LE(eocd, 16, localData.length);
  writeUInt16LE(eocd, 20, 0);

  return concatBytes([localData, centralDirectory, eocd]);
}

function buildStoredZip(entries: Array<{ name: string; content: string }>): Uint8Array {
  return buildZip(entries, 0);
}

function buildDeflatedZip(entries: Array<{ name: string; content: string }>): Uint8Array {
  return buildZip(entries, 8);
}

function buildBundleArchive(compressionMethod: 0 | 8 = 0): File {
  const manifest = {
    version: 1,
    id: "bundle-alpha",
    name: "Alpha Bundle",
    sourceFiles: ["synthetic.parquet"],
    trajectoryKind: "path",
    bounds: {
      minLat: 37,
      minLng: -122.2,
      maxLat: 37.2,
      maxLng: -122
    },
    counts: {
      trajectoryCount: 1,
      overlayLayerCount: 1,
      overlayFeatureCount: 1
    },
    simplification: {
      algorithm: "rdp",
      toleranceMeters: 25
    },
    trajectories: [
      {
        id: "traj-1",
        name: "Trajectory 1",
        pointCount: 3,
        simplifiedPointCount: 2,
        properties: {
          weight: 42.5,
          tripCount: 7,
          originCode: "91339",
          destinationCode: "91363"
        },
        bounds: {
          minLat: 37,
          minLng: -122.2,
          maxLat: 37.2,
          maxLng: -122
        }
      }
    ],
    overlays: [
      {
        id: "overlay-points",
        name: "Overlay Points",
        geometryType: "point",
        featureCount: 1,
        bounds: {
          minLat: 37.05,
          minLng: -122.05,
          maxLat: 37.05,
          maxLng: -122.05
        }
      }
    ],
    renderFile: "render-trajectories.json",
    extractionFile: "extraction-trajectories.json",
    overlayFile: "overlays.json"
  };

  const renderPayload = {
    trajectories: [
      {
        id: "traj-1",
        path: [
          [37, -122],
          [37.2, -122.2]
        ]
      }
    ]
  };

  const extractionPayload = {
    trajectories: [
      {
        id: "traj-1",
        name: "Trajectory 1",
        points: [
          { lat: 37, lng: -122, time: "2024-01-01T00:00:00.000Z" },
          { lat: 37.1, lng: -122.1, time: "2024-01-01T00:01:00.000Z" },
          { lat: 37.2, lng: -122.2, time: "2024-01-01T00:02:00.000Z" }
        ]
      }
    ]
  };

  const overlayPayload = {
    layers: [
      {
        id: "overlay-points",
        name: "Overlay Points",
        geometryType: "point",
        featureCount: 1,
        features: [
          {
            id: "point-1",
            coordinates: [37.05, -122.05]
          }
        ]
      }
    ]
  };

  const zipBuilder = compressionMethod === 8 ? buildDeflatedZip : buildStoredZip;
  const bundleBytes = zipBuilder([
    { name: "manifest.json", content: JSON.stringify(manifest) },
    { name: "render-trajectories.json", content: JSON.stringify(renderPayload) },
    { name: "extraction-trajectories.json", content: JSON.stringify(extractionPayload) },
    { name: "overlays.json", content: JSON.stringify(overlayPayload) }
  ]);

  return new File([bundleBytes], "alpha.psbundle.zip", { type: "application/zip" });
}

function buildLegacyOdBundleArchive(compressionMethod: 0 | 8 = 0): File {
  const manifest = {
    version: 1,
    id: "bundle-od-legacy",
    name: "Legacy OD Bundle",
    sourceFiles: ["synthetic.parquet"],
    counts: {
      trajectoryCount: 1,
      overlayLayerCount: 0,
      overlayFeatureCount: 0
    },
    trajectories: [
      {
        id: "od-1",
        name: "Linas -> Marcoussis",
        pointCount: 2,
        simplifiedPointCount: 2,
        properties: {
          weight: 42.5,
          tripCount: 7,
          originCode: "91339",
          originName: "LINAS",
          destinationCode: "91363",
          destinationName: "MARCOUSSIS"
        }
      }
    ],
    overlays: [],
    renderFile: "render-trajectories.json",
    extractionFile: "extraction-trajectories.json"
  };

  const renderPayload = {
    trajectories: [
      {
        id: "od-1",
        path: [
          [48.626192714, 2.251820631],
          [48.646351528, 2.206111538]
        ]
      }
    ]
  };

  const extractionPayload = {
    trajectories: [
      {
        id: "od-1",
        name: "Linas -> Marcoussis",
        properties: {
          weight: 42.5,
          tripCount: 7,
          originCode: "91339",
          originName: "LINAS",
          destinationCode: "91363",
          destinationName: "MARCOUSSIS"
        },
        points: [
          { lat: 48.626192714, lng: 2.251820631 },
          { lat: 48.646351528, lng: 2.206111538 }
        ]
      }
    ]
  };

  const zipBuilder = compressionMethod === 8 ? buildDeflatedZip : buildStoredZip;
  const bundleBytes = zipBuilder([
    { name: "manifest.json", content: JSON.stringify(manifest) },
    { name: "render-trajectories.json", content: JSON.stringify(renderPayload) },
    { name: "extraction-trajectories.json", content: JSON.stringify(extractionPayload) }
  ]);

  return new File([bundleBytes], "legacy-od.psbundle.zip", { type: "application/zip" });
}

function buildRichOdBundleArchive(compressionMethod: 0 | 8 = 0): File {
  const manifest = {
    version: 1,
    id: "bundle-od-rich",
    name: "Rich OD Bundle",
    sourceFiles: ["synthetic.parquet"],
    trajectoryKind: "od-edge",
    counts: {
      trajectoryCount: 1,
      overlayLayerCount: 0,
      overlayFeatureCount: 0
    },
    odMetrics: {
      metrics: [
        {
          key: "weight",
          label: "Weight",
          family: "numeric",
          sourceKey: "weight",
          sourceLabel: "Weight",
          unitLabel: "weight",
          order: 0
        },
        {
          key: "tripCount",
          label: "Trip Count",
          family: "numeric",
          sourceKey: "tripCount",
          sourceLabel: "Trip Count",
          unitLabel: "trips",
          order: 1
        },
        {
          key: "durationMean",
          label: "Mean Duration",
          family: "numeric",
          sourceKey: "durationMean",
          sourceLabel: "Mean Duration",
          unitLabel: "min",
          order: 2
        },
        {
          key: "category|mode_principal|subtotal|METRO",
          label: "Mode: METRO (Subtotal)",
          family: "category",
          sourceKey: "mode_principal",
          sourceLabel: "Mode",
          variant: "subtotal",
          valueKey: "METRO",
          valueLabel: "METRO",
          unitLabel: "weight",
          order: 10
        },
        {
          key: "category|mode_principal|share|METRO",
          label: "Mode: METRO (Share)",
          family: "category",
          sourceKey: "mode_principal",
          sourceLabel: "Mode",
          variant: "share",
          valueKey: "METRO",
          valueLabel: "METRO",
          unitLabel: "%",
          order: 11
        }
      ]
    },
    trajectories: [
      {
        id: "od-1",
        name: "Linas -> Marcoussis",
        pointCount: 2,
        simplifiedPointCount: 2,
        properties: {
          weight: 42.5,
          tripCount: 7,
          durationMean: 18.2,
          originCode: "91339",
          originName: "LINAS",
          destinationCode: "91363",
          destinationName: "MARCOUSSIS"
        },
        metricValues: {
          weight: 42.5,
          tripCount: 7,
          durationMean: 18.2,
          "category|mode_principal|subtotal|METRO": 21.25,
          "category|mode_principal|share|METRO": 0.5
        }
      }
    ],
    overlays: [],
    renderFile: "render-trajectories.json",
    extractionFile: "extraction-trajectories.json"
  };

  const renderPayload = {
    trajectories: [
      {
        id: "od-1",
        path: [
          [48.626192714, 2.251820631],
          [48.646351528, 2.206111538]
        ]
      }
    ]
  };

  const extractionPayload = {
    trajectories: [
      {
        id: "od-1",
        name: "Linas -> Marcoussis",
        properties: manifest.trajectories[0].properties,
        points: [
          { lat: 48.626192714, lng: 2.251820631 },
          { lat: 48.646351528, lng: 2.206111538 }
        ]
      }
    ]
  };

  const zipBuilder = compressionMethod === 8 ? buildDeflatedZip : buildStoredZip;
  const bundleBytes = zipBuilder([
    { name: "manifest.json", content: JSON.stringify(manifest) },
    { name: "render-trajectories.json", content: JSON.stringify(renderPayload) },
    { name: "extraction-trajectories.json", content: JSON.stringify(extractionPayload) }
  ]);

  return new File([bundleBytes], "rich-od.psbundle.zip", { type: "application/zip" });
}

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
      { id: `${id}-b`, lat: 37.1, lng: -122.1 }
    ]
  };
}

describe("bundle format", () => {
  it("parses a generated bundle archive", async () => {
    const bundle = await parseBundleFile(buildBundleArchive());

    expect(bundle.id).toBe("bundle-alpha");
    expect(bundle.manifest.trajectoryKind).toBe("path");
    expect(bundle.manifest.trajectories).toHaveLength(1);
    expect(bundle.renderTrajectories).toHaveLength(1);
    expect(bundle.extractionTrajectories).toHaveLength(1);
    expect(bundle.overlays).toHaveLength(1);
    expect(bundle.renderTrajectoryById.get("traj-1")?.path).toHaveLength(2);
    expect(bundle.extractionTrajectoryById.get("traj-1")?.points).toHaveLength(3);
    expect(bundle.trajectoryRefById.get("traj-1")?.properties?.weight).toBe(42.5);
  });

  it("parses a deflated bundle archive", async () => {
    const bundle = await parseBundleFile(buildBundleArchive(8));

    expect(bundle.id).toBe("bundle-alpha");
    expect(bundle.overlays).toHaveLength(1);
    expect(bundle.extractionTrajectoryById.get("traj-1")?.points).toHaveLength(3);
  });

  it("reports bundle parse progress across major stages", async () => {
    const messages: string[] = [];

    await parseBundleFile(buildBundleArchive(), {
      onProgress: (message) => {
        messages.push(message);
      }
    });

    expect(messages.some((message) => message.includes("Reading alpha.psbundle.zip"))).toBe(true);
    expect(messages.some((message) => message.includes("Scanning bundle archive"))).toBe(true);
    expect(messages.some((message) => message.includes("Parsing manifest JSON"))).toBe(true);
    expect(messages.some((message) => message.includes("Parsing render payload JSON"))).toBe(true);
    expect(messages.some((message) => message.includes("Parsing extraction payload JSON"))).toBe(true);
  });

  it("extracts a bundle trajectory into a normal track", async () => {
    const parsedBundle = await parseBundleFile(buildBundleArchive());
    const bundleStore = new BundleStore();
    bundleStore.addBundles([parsedBundle]);
    const loadedBundle = bundleStore.getState().bundles[0];

    const extractedTrack = extractBundleTrajectoryAsTrack(loadedBundle, "traj-1");

    expect(extractedTrack).not.toBeNull();
    expect(extractedTrack?.format).toBe("geojson");
    expect(extractedTrack?.sourceFile).toBe("bundle:Alpha Bundle#traj-1");
    expect(extractedTrack?.points).toHaveLength(3);
  });

  it("infers legacy weighted OD bundles and disables click extraction by default", async () => {
    const parsedBundle = await parseBundleFile(buildLegacyOdBundleArchive(8));
    const bundleStore = new BundleStore();

    bundleStore.addBundles([parsedBundle]);
    const loadedBundle = bundleStore.getState().bundles[0];

    expect(parsedBundle.manifest.trajectoryKind).toBe("od-edge");
    expect(parsedBundle.manifest.odMetrics?.metrics.map((metric) => metric.key)).toEqual([
      "weight",
      "tripCount"
    ]);
    expect(loadedBundle.extractionEnabled).toBe(false);
  });

  it("preserves rich OD metric catalogs and per-edge metric values", async () => {
    const parsedBundle = await parseBundleFile(buildRichOdBundleArchive(8));

    expect(parsedBundle.manifest.trajectoryKind).toBe("od-edge");
    expect(parsedBundle.manifest.odMetrics?.metrics.some((metric) => metric.key === "durationMean")).toBe(
      true
    );
    expect(parsedBundle.trajectoryRefById.get("od-1")?.metricValues?.durationMean).toBe(18.2);
    expect(
      getOdEdgeMetricValue(parsedBundle, "od-1", "category|mode_principal|share|METRO")
    ).toBe(0.5);
  });

  it("keeps bundle state separate from the editable track store", async () => {
    const parsedBundle: TrajectoryBundle = await parseBundleFile(buildBundleArchive());
    const trackStore = new TrackStore();
    const bundleStore = new BundleStore();

    trackStore.addTracks([buildTrack("track-1", "Editable Track")]);
    bundleStore.addBundles([parsedBundle]);

    expect(trackStore.getState().tracks).toHaveLength(1);
    expect(bundleStore.getState().bundles).toHaveLength(1);
    expect(trackStore.getState().tracks[0].name).toBe("Editable Track");
    expect(bundleStore.getState().bundles[0].name).toBe("Alpha Bundle");
  });
});
