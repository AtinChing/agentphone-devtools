import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Tiny local JSON collection with the same safety profile as run history:
 * atomic temp-file + rename writes, owner-only permissions, tolerant loads.
 */
export class JsonFileStore<T extends { id: string }> {
  private readonly items = new Map<string, T>();
  readonly loadWarning?: string;

  constructor(private readonly filePath: string) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { version?: number; items?: unknown };
      if (parsed.version !== 1 || !Array.isArray(parsed.items)) throw new Error("unsupported store format");
      for (const item of parsed.items) {
        if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
          this.items.set((item as T).id, item as T);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.loadWarning = `Could not load ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }

  list(): T[] {
    return [...this.items.values()].map((item) => structuredClone(item));
  }

  get(id: string): T | undefined {
    const item = this.items.get(id);
    return item ? structuredClone(item) : undefined;
  }

  size(): number {
    return this.items.size;
  }

  upsert(item: T): T {
    this.items.set(item.id, structuredClone(item));
    this.flush();
    return structuredClone(item);
  }

  delete(id: string): boolean {
    const deleted = this.items.delete(id);
    if (deleted) this.flush();
    return deleted;
  }

  private flush(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    try {
      writeFileSync(tempPath, `${JSON.stringify({ version: 1, items: this.list() }, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600
      });
      renameSync(tempPath, this.filePath);
    } finally {
      rmSync(tempPath, { force: true });
    }
  }
}
