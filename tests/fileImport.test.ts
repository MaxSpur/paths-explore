// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createFileImporter } from "../src/io/fileImport";
import type { ImportSummary } from "../src/model/types";

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

function buildStoredZip(entries: Array<{ name: string; content: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const fileNameBytes = encoder.encode(entry.name);
    const contentBytes = encoder.encode(entry.content);

    const localHeader = new Uint8Array(30 + fileNameBytes.length);
    writeUInt32LE(localHeader, 0, 0x04034b50);
    writeUInt16LE(localHeader, 4, 20);
    writeUInt16LE(localHeader, 6, 0);
    writeUInt16LE(localHeader, 8, 0);
    writeUInt16LE(localHeader, 10, 0);
    writeUInt16LE(localHeader, 12, 0);
    writeUInt32LE(localHeader, 14, 0);
    writeUInt32LE(localHeader, 18, contentBytes.length);
    writeUInt32LE(localHeader, 22, contentBytes.length);
    writeUInt16LE(localHeader, 26, fileNameBytes.length);
    writeUInt16LE(localHeader, 28, 0);
    localHeader.set(fileNameBytes, 30);
    localChunks.push(localHeader, contentBytes);

    const centralHeader = new Uint8Array(46 + fileNameBytes.length);
    writeUInt32LE(centralHeader, 0, 0x02014b50);
    writeUInt16LE(centralHeader, 4, 20);
    writeUInt16LE(centralHeader, 6, 20);
    writeUInt16LE(centralHeader, 8, 0);
    writeUInt16LE(centralHeader, 10, 0);
    writeUInt16LE(centralHeader, 12, 0);
    writeUInt16LE(centralHeader, 14, 0);
    writeUInt32LE(centralHeader, 16, 0);
    writeUInt32LE(centralHeader, 20, contentBytes.length);
    writeUInt32LE(centralHeader, 24, contentBytes.length);
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

function buildBundleFile(): File {
  const bundleBytes = buildStoredZip([
    {
      name: "manifest.json",
      content: JSON.stringify({
        version: 1,
        id: "bundle-alpha",
        name: "Alpha Bundle",
        counts: { trajectoryCount: 1, overlayLayerCount: 0, overlayFeatureCount: 0 },
        trajectories: [{ id: "traj-1", name: "Trajectory 1", pointCount: 2, simplifiedPointCount: 2 }],
        overlays: [],
        renderFile: "render-trajectories.json",
        extractionFile: "extraction-trajectories.json"
      })
    },
    {
      name: "render-trajectories.json",
      content: JSON.stringify({
        trajectories: [{ id: "traj-1", path: [[37, -122], [37.1, -122.1]] }]
      })
    },
    {
      name: "extraction-trajectories.json",
      content: JSON.stringify({
        trajectories: [
          {
            id: "traj-1",
            points: [{ lat: 37, lng: -122 }, { lat: 37.1, lng: -122.1 }]
          }
        ]
      })
    }
  ]);

  return new File([bundleBytes], "alpha.psbundle.zip", { type: "application/zip" });
}

function createDropEvent(file: File): Event {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    configurable: true,
    value: {
      files: [],
      items: [
        {
          kind: "file",
          getAsFile: () => file
        }
      ],
      types: ["public.file-url"]
    }
  });
  return event;
}

async function waitForCondition(assertion: () => void, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    }
  }

  assertion();
}

describe("file import drag and drop", () => {
  it("imports a dropped bundle when the drag payload exposes file items without a Files type", async () => {
    const onTracks = vi.fn();
    const onBundles = vi.fn();
    let summary: ImportSummary | undefined;
    const importer = createFileImporter({
      onTracks,
      onBundles,
      onSummary: (nextSummary) => {
        summary = nextSummary;
      }
    });

    const dropZone = document.createElement("div");
    document.body.appendChild(dropZone);
    importer.bindDropZone(dropZone);

    window.dispatchEvent(createDropEvent(buildBundleFile()));
    await waitForCondition(() => {
      expect(onBundles).toHaveBeenCalledTimes(1);
    });

    expect(onTracks).not.toHaveBeenCalled();
    expect(summary?.importedBundleCount).toBe(1);
    expect(summary?.issues).toHaveLength(0);
  });
});
