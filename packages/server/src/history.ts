import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { InspectorSession } from "./index.js";

interface HistoryFile {
  version: 1;
  sessions: InspectorSession[];
}

export class SessionHistoryStore {
  readonly loadWarning?: string;
  private readonly sessions = new Map<string, InspectorSession>();

  constructor(
    private readonly filePath: string,
    private readonly limit: number
  ) {
    try {
      const file = JSON.parse(readFileSync(filePath, "utf8")) as Partial<HistoryFile>;
      if (file.version !== 1 || !Array.isArray(file.sessions)) throw new Error("unsupported history format");
      for (const session of file.sessions) {
        if (isInspectorSession(session)) this.sessions.set(session.id, session);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.loadWarning = `Could not load run history: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }

  list(): InspectorSession[] {
    return [...this.sessions.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((session) => structuredClone(session));
  }

  get(id: string): InspectorSession | undefined {
    const session = this.sessions.get(id);
    return session ? structuredClone(session) : undefined;
  }

  upsert(session: InspectorSession): void {
    this.sessions.set(session.id, structuredClone(session));
    this.prune();
    this.flush();
  }

  delete(id: string): boolean {
    const deleted = this.sessions.delete(id);
    if (deleted) this.flush();
    return deleted;
  }

  private prune(): void {
    const ordered = [...this.sessions.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    for (const session of ordered.slice(this.limit)) this.sessions.delete(session.id);
  }

  private flush(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    const file: HistoryFile = { version: 1, sessions: this.list() };
    try {
      writeFileSync(tempPath, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      renameSync(tempPath, this.filePath);
    } finally {
      rmSync(tempPath, { force: true });
    }
  }
}

function isInspectorSession(value: unknown): value is InspectorSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<InspectorSession>;
  return (
    typeof session.id === "string" &&
    typeof session.startedAt === "string" &&
    typeof session.targetUrl === "string" &&
    Array.isArray(session.transcript) &&
    Array.isArray(session.deliveries) &&
    Array.isArray(session.warnings)
  );
}
