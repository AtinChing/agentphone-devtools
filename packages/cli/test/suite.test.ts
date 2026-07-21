import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverScenarioDirectory, resolveScenarioInputs } from "../src/suite.js";

const cleanup: Array<() => void> = [];

afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
});

describe("scenario suite discovery", () => {
  it("discovers supported files recursively in deterministic order", async () => {
    const directory = temporaryDirectory();
    write(directory, "z-last.yml");
    write(directory, "a-first.yaml");
    write(directory, "nested/middle.json");
    write(directory, "nested/notes.txt");
    write(directory, "node_modules/ignored.json");
    write(directory, ".hidden/ignored.yaml");

    const scenarios = await discoverScenarioDirectory(directory);

    expect(scenarios).toEqual([
      join(directory, "a-first.yaml"),
      join(directory, "nested/middle.json"),
      join(directory, "z-last.yml")
    ]);
  });

  it("keeps explicit order, appends directories, and removes duplicates", async () => {
    const directory = temporaryDirectory();
    write(directory, "suite/a.yaml");
    write(directory, "suite/b.json");
    write(directory, "standalone.yml");

    const scenarios = await resolveScenarioInputs(
      {
        files: ["standalone.yml", "suite/b.json"],
        directories: ["suite"]
      },
      directory
    );

    expect(scenarios).toEqual([
      join(directory, "standalone.yml"),
      join(directory, "suite/b.json"),
      join(directory, "suite/a.yaml")
    ]);
  });

  it("rejects empty directories and unsupported explicit files", async () => {
    const directory = temporaryDirectory();
    mkdirSync(join(directory, "empty"));
    write(directory, "scenario.txt");

    await expect(resolveScenarioInputs({ files: [], directories: ["empty"] }, directory)).rejects.toThrow(
      "Scenario directory contains no"
    );
    await expect(resolveScenarioInputs({ files: ["scenario.txt"], directories: [] }, directory)).rejects.toThrow(
      "Scenario file must use"
    );
  });

  it("skips conversation graphs during directory discovery and rejects them as --scenario", async () => {
    const directory = temporaryDirectory();
    write(directory, "flat.yaml", "name: Flat\nturns:\n  - caller: hi\n");
    write(
      directory,
      "family.yaml",
      "version: 1\nnodes:\n  first:\n    caller: hi\n    review:\n      status: approved\npaths:\n  only:\n    route: [first]\n"
    );

    expect(await discoverScenarioDirectory(directory)).toEqual([join(directory, "flat.yaml")]);
    await expect(resolveScenarioInputs({ files: ["family.yaml"], directories: [] }, directory)).rejects.toThrow(
      /require --graph/
    );
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agentphone-suite-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function write(directory: string, path: string, contents = "{}"): void {
  const destination = join(directory, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents, "utf8");
}
