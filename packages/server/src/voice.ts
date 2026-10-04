import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Voice input for the step debugger — a DEVELOPER INPUT CONVENIENCE.
 *
 * This is explicitly NOT a simulation of AgentPhone's speech-to-text
 * pipeline. It exists so a developer can speak a caller turn instead of
 * typing it; the transcript lands in the normal editable caller-text input
 * and goes through exactly the same code path as typed text. Nothing about
 * timing, confidence, streaming, or telephony audio is modeled.
 *
 * Everything runs locally: capture via ffmpeg (macOS avfoundation),
 * transcription via a whisper.cpp binary and a local ggml model file. No
 * network is touched during transcription. When any piece is missing, the
 * feature reports itself unavailable and typed input works exactly as
 * before.
 */

export interface VoiceSupport {
  available: boolean;
  whisperBin?: string;
  modelPath?: string;
  ffmpegBin?: string;
  reason?: string;
}

const MODEL_CANDIDATES = ["ggml-tiny.en.bin", "ggml-base.en.bin", "ggml-small.en.bin"];

export function detectVoiceSupport(): VoiceSupport {
  const whisperBin =
    fromEnvBinary("AGENTPHONE_DEVTOOLS_WHISPER_BIN") ?? which("whisper-cli") ?? which("whisper-cpp");
  if (!whisperBin) {
    return {
      available: false,
      reason: "No whisper.cpp binary found. Install one (`brew install whisper-cpp`) or set AGENTPHONE_DEVTOOLS_WHISPER_BIN."
    };
  }

  const modelPath = findModel();
  if (!modelPath) {
    return {
      available: false,
      whisperBin,
      reason:
        "No whisper model found. Download one into .agentphone-devtools/models/ (e.g. ggml-tiny.en.bin) or set AGENTPHONE_DEVTOOLS_WHISPER_MODEL."
    };
  }

  const ffmpegBin = which("ffmpeg");
  if (!ffmpegBin) {
    return {
      available: false,
      whisperBin,
      modelPath,
      reason: "ffmpeg not found (needed to capture and convert audio). Install it with `brew install ffmpeg`."
    };
  }

  return { available: true, whisperBin, modelPath, ffmpegBin };
}

/** Transcribe a 16 kHz mono WAV file. Returns trimmed text ("" when silent). */
export async function transcribeWav(wavPath: string, support: VoiceSupport): Promise<string> {
  if (!support.available || !support.whisperBin || !support.modelPath) {
    throw new Error(support.reason ?? "Voice input is not available");
  }
  const output = await run(support.whisperBin, [
    "-m",
    support.modelPath,
    "-f",
    wavPath,
    "--no-timestamps",
    "--no-prints",
    "--language",
    "en"
  ]);
  return output.replace(/\s+/g, " ").trim();
}

/**
 * Transcribe an arbitrary audio buffer (e.g. browser MediaRecorder webm):
 * convert to 16 kHz mono WAV with ffmpeg, then run whisper on it.
 */
export async function transcribeAudioBuffer(audio: Buffer, support: VoiceSupport): Promise<string> {
  if (!support.available || !support.ffmpegBin) {
    throw new Error(support.reason ?? "Voice input is not available");
  }
  const workDir = mkdtempSync(join(tmpdir(), "agentphone-voice-"));
  const inputPath = join(workDir, "input.audio");
  const wavPath = join(workDir, "input.wav");
  try {
    writeFileSync(inputPath, audio);
    await run(support.ffmpegBin, ["-hide_banner", "-loglevel", "error", "-i", inputPath, "-ar", "16000", "-ac", "1", "-y", wavPath]);
    return await transcribeWav(wavPath, support);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export interface PushToTalkRecording {
  /** Stop recording; resolves to the finished WAV path. */
  stop: () => Promise<string>;
}

/**
 * Start recording the default macOS input device until stop() is called.
 * ffmpeg finalizes the WAV on SIGINT. First use triggers the OS microphone
 * permission prompt for the terminal app.
 */
export function startPushToTalk(support: VoiceSupport): PushToTalkRecording {
  if (!support.available || !support.ffmpegBin) {
    throw new Error(support.reason ?? "Voice input is not available");
  }
  const workDir = mkdtempSync(join(tmpdir(), "agentphone-voice-"));
  const wavPath = join(workDir, "capture.wav");
  const child = spawn(
    support.ffmpegBin,
    ["-hide_banner", "-loglevel", "error", "-f", "avfoundation", "-i", ":0", "-ar", "16000", "-ac", "1", "-y", wavPath],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));

  return {
    stop: async () => {
      child.kill("SIGINT");
      await exited;
      if (!existsSync(wavPath) || readFileSync(wavPath).length < 128) {
        throw new Error(
          `Recording produced no audio.${stderr.includes("Operation not permitted") || stderr.includes("denied") ? " Grant microphone access to your terminal in System Settings → Privacy & Security → Microphone." : stderr ? ` (${stderr.trim().slice(0, 160)})` : ""}`
        );
      }
      return wavPath;
    }
  };
}

function which(binary: string): string | undefined {
  const result = spawnSync("which", [binary], { encoding: "utf8" });
  const path = result.status === 0 ? result.stdout.trim() : "";
  return path || undefined;
}

function fromEnvBinary(name: string): string | undefined {
  const value = process.env[name];
  return value && existsSync(value) ? value : undefined;
}

function findModel(): string | undefined {
  const fromEnv = process.env.AGENTPHONE_DEVTOOLS_WHISPER_MODEL;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  for (const directory of [join(process.cwd(), ".agentphone-devtools", "models"), join(homedir(), ".agentphone-devtools", "models")]) {
    for (const candidate of MODEL_CANDIDATES) {
      const path = join(directory, candidate);
      if (existsSync(path)) return path;
    }
  }
  return undefined;
}

function run(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${binary} exited ${code}: ${stderr.trim().slice(0, 200)}`));
    });
  });
}
