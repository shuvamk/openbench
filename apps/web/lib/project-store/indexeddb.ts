import type { Project } from "@openbench/ir-schema";
import { resolveProjectId } from "./alias";
import type { ProjectBundle, ProjectStore } from "./types";

const DB_NAME = "openbench";
const DB_VERSION = 1;
/** Lightweight Project docs for the dashboard list — no schematic payload. */
const PROJECTS_STORE = "projects";
/** Full ProjectBundle per project, keyed by the project id. */
const BUNDLES_STORE = "bundles";

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function awaitTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/**
 * IndexedDB-backed ProjectStore (ADR-0008: Phase 1 persistence is
 * client-side). Database "openbench" with two object stores:
 * "projects" (Project docs, for cheap listing) and "bundles"
 * (full ProjectBundle per project). Both are keyed by the project id.
 */
export class IndexedDbProjectStore implements ProjectStore {
  private readonly factory: IDBFactory;
  private dbPromise: Promise<IDBDatabase> | undefined;

  constructor(factory?: IDBFactory) {
    const resolved = factory ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined);
    if (resolved === undefined) {
      throw new Error("IndexedDbProjectStore requires an IndexedDB implementation");
    }
    this.factory = resolved;
  }

  private open(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const request = this.factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
          db.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(BUNDLES_STORE)) {
          db.createObjectStore(BUNDLES_STORE, { keyPath: "project.id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("failed to open IndexedDB"));
    });
    return this.dbPromise;
  }

  async list(): Promise<Project[]> {
    const db = await this.open();
    const tx = db.transaction(PROJECTS_STORE, "readonly");
    return promisify(tx.objectStore(PROJECTS_STORE).getAll() as IDBRequest<Project[]>);
  }

  async load(projectId: string): Promise<ProjectBundle | undefined> {
    const db = await this.open();
    const tx = db.transaction(BUNDLES_STORE, "readonly");
    const bundle = await promisify(
      tx.objectStore(BUNDLES_STORE).get(resolveProjectId(projectId)) as IDBRequest<
        ProjectBundle | undefined
      >,
    );
    return bundle ?? undefined;
  }

  async save(bundle: ProjectBundle): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([PROJECTS_STORE, BUNDLES_STORE], "readwrite");
    tx.objectStore(PROJECTS_STORE).put(bundle.project);
    tx.objectStore(BUNDLES_STORE).put(bundle);
    await awaitTransaction(tx);
  }

  async remove(projectId: string): Promise<void> {
    const id = resolveProjectId(projectId);
    const db = await this.open();
    const tx = db.transaction([PROJECTS_STORE, BUNDLES_STORE], "readwrite");
    tx.objectStore(PROJECTS_STORE).delete(id);
    tx.objectStore(BUNDLES_STORE).delete(id);
    await awaitTransaction(tx);
  }
}
