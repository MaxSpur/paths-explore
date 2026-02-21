import type { ImportIssue, ImportSummary, Track } from "../model/types";
import { parseFile } from "./parsers";

interface FileImporterOptions {
  onTracks: (tracks: Track[]) => void;
  onSummary: (summary: ImportSummary) => void;
}

interface FileImporter {
  importFiles: (files: File[] | FileList) => Promise<void>;
  bindInput: (input: HTMLInputElement) => void;
  bindDropZone: (dropZone: HTMLElement) => void;
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
      options.onSummary({ importedTrackCount: 0, issues: [] });
      return;
    }

    const importedTracks: Track[] = [];
    const issues: ImportIssue[] = [];

    for (const file of fileArray) {
      try {
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

    options.onSummary({
      importedTrackCount: importedTracks.length,
      issues
    });
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
    dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropZone.classList.add("is-drag-over");
    });

    dropZone.addEventListener("dragleave", () => {
      dropZone.classList.remove("is-drag-over");
    });

    dropZone.addEventListener("drop", async (event) => {
      event.preventDefault();
      dropZone.classList.remove("is-drag-over");

      const files = event.dataTransfer?.files;
      if (!files) {
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
