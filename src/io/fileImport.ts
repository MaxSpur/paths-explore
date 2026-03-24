import type { ImportIssue, ImportSummary, Track } from "../model/types";
import type { TrajectoryBundle } from "../model/bundles";
import { isBundleFileName, parseBundleFile } from "./bundleFormat";
import { parseFile, parseZipFile } from "./parsers";
import { isZipFileName } from "./zip";

interface FileImporterOptions {
  onTracks: (tracks: Track[]) => void;
  onBundles: (bundles: TrajectoryBundle[]) => void;
  onSummary: (summary: ImportSummary) => void;
  onImportStatusChange?: (message: string | undefined) => void;
}

interface FileImporter {
  importFiles: (files: File[] | FileList) => Promise<void>;
  bindInput: (input: HTMLInputElement) => void;
  bindDropZone: (dropZone: HTMLElement) => void;
}

function hasFilePayload(event: DragEvent): boolean {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) {
    return false;
  }

  if (dataTransfer.files.length > 0) {
    return true;
  }

  if (dataTransfer.items.length > 0) {
    return Array.from(dataTransfer.items).some((item) => item.kind === "file");
  }

  return Array.from(dataTransfer.types).some((type) => type.toLowerCase().includes("file"));
}

function getDroppedFiles(dataTransfer: DataTransfer | null | undefined): File[] {
  if (!dataTransfer) {
    return [];
  }

  if (dataTransfer.files.length > 0) {
    return Array.from(dataTransfer.files);
  }

  if (dataTransfer.items.length === 0) {
    return [];
  }

  return Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file instanceof File);
}

function toFileArray(files: File[] | FileList): File[] {
  if (Array.isArray(files)) {
    return files;
  }

  return Array.from(files);
}

export function createFileImporter(options: FileImporterOptions): FileImporter {
  const importFiles = async (files: File[] | FileList): Promise<void> => {
    const fileArray = toFileArray(files);

    if (fileArray.length === 0) {
      options.onImportStatusChange?.(undefined);
      options.onSummary({ importedTrackCount: 0, importedBundleCount: 0, issues: [] });
      return;
    }

    const importedTracks: Track[] = [];
    const importedBundles: TrajectoryBundle[] = [];
    const issues: ImportIssue[] = [];

    try {
      options.onImportStatusChange?.(
        `Importing ${fileArray.length} file${fileArray.length === 1 ? "" : "s"}...`
      );
      await new Promise((resolve) => window.setTimeout(resolve, 0));

      for (const [index, file] of fileArray.entries()) {
        options.onImportStatusChange?.(
          `Importing ${file.name} (${index + 1}/${fileArray.length})...`
        );
        await new Promise((resolve) => window.setTimeout(resolve, 0));

        try {
          if (isBundleFileName(file.name)) {
            importedBundles.push(
              await parseBundleFile(file, {
                onProgress: (message) =>
                  options.onImportStatusChange?.(
                    `Importing ${file.name} (${index + 1}/${fileArray.length})... ${message}`
                  )
              })
            );
            continue;
          }

          if (isZipFileName(file.name)) {
            const zipResult = await parseZipFile(file);
            importedTracks.push(...zipResult.tracks);
            issues.push(...zipResult.issues);
            continue;
          }

          const tracks = await parseFile(file);
          importedTracks.push(...tracks);
        } catch (error) {
          issues.push({
            fileName: file.name,
            level: "error",
            message: error instanceof Error ? error.message : "Unknown parsing error."
          });
        }
      }

      if (importedTracks.length > 0) {
        options.onTracks(importedTracks);
      }

      if (importedBundles.length > 0) {
        options.onBundles(importedBundles);
      }

      options.onSummary({
        importedTrackCount: importedTracks.length,
        importedBundleCount: importedBundles.length,
        issues
      });
    } finally {
      options.onImportStatusChange?.(undefined);
    }
  };

  const bindInput = (input: HTMLInputElement): void => {
    input.addEventListener("change", async () => {
      if (!input.files) {
        return;
      }

      await importFiles(input.files);
      input.value = "";
    });
  };

  const bindDropZone = (dropZone: HTMLElement): void => {
    let dragDepth = 0;
    const dragTarget: Window | HTMLElement = window;

    dragTarget.addEventListener("dragenter", (event) => {
      if (!hasFilePayload(event)) {
        return;
      }

      dragDepth += 1;
      dropZone.classList.add("is-drag-over");
      event.preventDefault();
    });

    dragTarget.addEventListener("dragover", (event) => {
      if (!hasFilePayload(event)) {
        return;
      }

      event.preventDefault();
      dropZone.classList.add("is-drag-over");
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    });

    dragTarget.addEventListener("dragleave", (event) => {
      if (!hasFilePayload(event)) {
        return;
      }

      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        dropZone.classList.remove("is-drag-over");
      }
    });

    dragTarget.addEventListener("drop", async (event) => {
      if (!hasFilePayload(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      dropZone.classList.remove("is-drag-over");
      dragDepth = 0;

      const files = getDroppedFiles(event.dataTransfer);
      if (files.length === 0) {
        return;
      }

      await importFiles(files);
    });
  };

  return {
    importFiles,
    bindInput,
    bindDropZone
  };
}
