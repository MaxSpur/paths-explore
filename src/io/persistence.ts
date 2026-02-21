import type { Track } from "../model/types";

const DB_NAME = "path-segments";
const DB_VERSION = 1;
const STORE_NAME = "app-state";
const TRACKS_KEY = "tracks-v1";

interface TrackPersistence {
  loadTracks: () => Promise<Track[]>;
  saveTracks: (tracks: Track[]) => Promise<void>;
}

function hasIndexedDb(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

function isTrack(value: unknown): value is Track {
  if (!value || typeof value !== "object") {
    return false;
  }

  const track = value as Partial<Track>;

  return (
    typeof track.id === "string" &&
    typeof track.name === "string" &&
    typeof track.sourceFile === "string" &&
    (track.format === "gpx" || track.format === "kml" || track.format === "geojson") &&
    typeof track.color === "string" &&
    typeof track.visible === "boolean" &&
    typeof track.showPoints === "boolean" &&
    Array.isArray(track.points)
  );
}

async function openDatabase(): Promise<IDBDatabase> {
  const request = window.indexedDB.open(DB_NAME, DB_VERSION);

  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME);
    }
  };

  return requestToPromise(request);
}

export function createTrackPersistence(): TrackPersistence {
  const loadTracks = async (): Promise<Track[]> => {
    if (!hasIndexedDb()) {
      return [];
    }

    try {
      const db = await openDatabase();
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const raw = await requestToPromise(store.get(TRACKS_KEY));
      await transactionDone(transaction);
      db.close();

      if (!Array.isArray(raw)) {
        return [];
      }

      return raw.filter(isTrack);
    } catch {
      return [];
    }
  };

  const saveTracks = async (tracks: Track[]): Promise<void> => {
    if (!hasIndexedDb()) {
      return;
    }

    try {
      const db = await openDatabase();
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.put(tracks, TRACKS_KEY);
      await transactionDone(transaction);
      db.close();
    } catch {
      // Best-effort persistence; app remains usable if storage fails.
    }
  };

  return {
    loadTracks,
    saveTracks
  };
}
