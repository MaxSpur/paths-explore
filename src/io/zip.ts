import { inflateSync } from "fflate";

export interface ZipCentralDirectoryEntry {
  fileName: string;
  compressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
  encrypted: boolean;
}

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_MAX_EOCD_SEARCH = 65557;

export function isZipFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".zip");
}

function decodeZipFileName(bytes: Uint8Array, utf8: boolean): string {
  try {
    return new TextDecoder(utf8 ? "utf-8" : "windows-1252", { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

function findZipEndOfCentralDirectoryOffset(bytes: Uint8Array): number {
  const searchStart = Math.max(0, bytes.length - ZIP_MAX_EOCD_SEARCH);

  for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      return offset;
    }
  }

  return -1;
}

export function parseZipCentralDirectory(buffer: ArrayBuffer): ZipCentralDirectoryEntry[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const eocdOffset = findZipEndOfCentralDirectoryOffset(bytes);
  if (eocdOffset < 0) {
    throw new Error("Invalid ZIP: end-of-central-directory record not found.");
  }

  const eocdSignature = view.getUint32(eocdOffset, true);
  if (eocdSignature !== ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
    throw new Error("Invalid ZIP: malformed end-of-central-directory record.");
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

  if (centralDirectoryEnd > bytes.length) {
    throw new Error("Invalid ZIP: central directory exceeds file bounds.");
  }

  const entries: ZipCentralDirectoryEntry[] = [];
  let offset = centralDirectoryOffset;
  while (offset < centralDirectoryEnd && entries.length < totalEntries) {
    const signature = view.getUint32(offset, true);
    if (signature !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("Invalid ZIP: bad central directory entry.");
    }

    const generalPurposeFlag = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraFieldLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    if (fileNameEnd > bytes.length) {
      throw new Error("Invalid ZIP: file name exceeds file bounds.");
    }

    const fileName = decodeZipFileName(
      bytes.subarray(fileNameStart, fileNameEnd),
      (generalPurposeFlag & 0x0800) !== 0
    );

    entries.push({
      fileName,
      compressedSize,
      compressionMethod,
      localHeaderOffset,
      encrypted: (generalPurposeFlag & 0x0001) !== 0
    });

    offset = fileNameEnd + extraFieldLength + commentLength;
  }

  return entries;
}

function getZipEntryCompressedData(buffer: ArrayBuffer, entry: ZipCentralDirectoryEntry): Uint8Array {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const localOffset = entry.localHeaderOffset;
  if (localOffset + 30 > bytes.length) {
    throw new Error("Local ZIP header exceeds file bounds.");
  }

  const localSignature = view.getUint32(localOffset, true);
  if (localSignature !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error("Local ZIP header signature mismatch.");
  }

  const localFileNameLength = view.getUint16(localOffset + 26, true);
  const localExtraFieldLength = view.getUint16(localOffset + 28, true);
  const dataOffset = localOffset + 30 + localFileNameLength + localExtraFieldLength;
  const dataEnd = dataOffset + entry.compressedSize;

  if (dataEnd > bytes.length) {
    throw new Error("ZIP entry data exceeds file bounds.");
  }

  return bytes.subarray(dataOffset, dataEnd);
}

async function inflateRawDeflate(data: Uint8Array): Promise<Uint8Array> {
  return inflateSync(data);
}

export async function decodeZipEntryText(
  buffer: ArrayBuffer,
  entry: ZipCentralDirectoryEntry
): Promise<string> {
  if (entry.encrypted) {
    throw new Error("Encrypted ZIP entries are not supported.");
  }

  const compressedData = getZipEntryCompressedData(buffer, entry);

  if (entry.compressionMethod === 0) {
    return new TextDecoder("utf-8", { fatal: false }).decode(compressedData);
  }

  if (entry.compressionMethod === 8) {
    const inflated = await inflateRawDeflate(compressedData);
    return new TextDecoder("utf-8", { fatal: false }).decode(inflated);
  }

  throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod}.`);
}

export async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  const candidate = file as File & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof candidate.arrayBuffer === "function") {
    return candidate.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) {
        resolve(result);
        return;
      }

      reject(new Error("Unable to read file as ArrayBuffer."));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Unable to read file."));
    };
    reader.readAsArrayBuffer(file);
  });
}
