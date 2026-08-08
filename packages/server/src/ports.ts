import { createServer } from "node:net";

export const DEFAULT_PORT_SCAN_ATTEMPTS = 20;

export function isAddressInUse(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "EADDRINUSE";
}

/** Resolve true when nothing else holds `port` on `host`. */
export function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen({ port, host, exclusive: true });
  });
}

/**
 * Return `startPort` when it is free, otherwise the next free port above it.
 * Port 0 is passed through because the OS already picks a free port for it.
 */
export async function findAvailablePort(
  startPort: number,
  host: string,
  attempts = DEFAULT_PORT_SCAN_ATTEMPTS
): Promise<number> {
  if (startPort === 0) return 0;
  for (let offset = 0; offset < attempts; offset += 1) {
    const candidate = startPort + offset;
    if (await isPortAvailable(candidate, host)) return candidate;
  }
  throw new Error(
    `No free port between ${startPort} and ${startPort + attempts - 1} on ${host}. Free one, or pass an explicit port.`
  );
}
