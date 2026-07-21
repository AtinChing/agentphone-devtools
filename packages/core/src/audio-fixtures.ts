/**
 * A path that is relative to the fixture root and contains no traversal
 * components.  Use `toSafeRelativeAssetPath` to create one from external data.
 */
declare const safeRelativeAssetPath: unique symbol;
export type SafeRelativeAssetPath = string & {
  readonly [safeRelativeAssetPath]: "SafeRelativeAssetPath";
};

export type AudioNoiseProfile =
  | "clean"
  | "white_noise"
  | "pink_noise"
  | "room_tone"
  | "cafe"
  | "crowd"
  | "traffic"
  | "custom";

export interface AudioNoiseMetadata {
  profile: AudioNoiseProfile;
  /** A normalized value from 0 (none) to 1 (maximal). */
  intensity: number;
}

/**
 * Describes an audio file already present in a local fixture directory.  This
 * module deliberately records properties only; it never changes audio bytes.
 */
export interface AudioFixtureMetadata {
  assetPath: SafeRelativeAssetPath;
  transcriptSidecarPath: SafeRelativeAssetPath;
  /** Optional caller-supplied integrity identifier, for example sha256:... */
  contentHash?: string;
  noise: AudioNoiseMetadata;
  gainDb: number;
  clipped: boolean;
  bandwidthHz: number;
  speakingRateWpm: number;
}

/** The untrusted/string-path form accepted by fixture construction helpers. */
export interface AudioFixtureMetadataInput {
  assetPath: string;
  transcriptSidecarPath: string;
  contentHash?: string;
  noise: AudioNoiseMetadata;
  gainDb: number;
  clipped: boolean;
  bandwidthHz: number;
  speakingRateWpm: number;
}

export interface AudioFixtureValidationResult {
  valid: boolean;
  errors: readonly string[];
}

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;

/**
 * Returns whether a path is safe to join beneath a fixture root. Paths use
 * forward slashes deliberately so they behave the same on every host OS.
 */
export function isSafeRelativeAssetPath(path: string): path is SafeRelativeAssetPath {
  if (!path || path !== path.trim() || path.includes("\0")) return false;
  if (path.startsWith("/") || path.startsWith("\\") || WINDOWS_DRIVE_PATH.test(path)) return false;
  if (path.includes("\\")) return false;

  const parts = path.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

/** Validates and brands a fixture-relative path. */
export function toSafeRelativeAssetPath(path: string): SafeRelativeAssetPath {
  if (!isSafeRelativeAssetPath(path)) {
    throw new Error(`Audio fixture asset path must be a safe relative path: ${JSON.stringify(path)}`);
  }
  return path;
}

/**
 * Checks fixture metadata without needing audio decoders, a Whisper model, or
 * a filesystem. It is suitable for validating data loaded from JSON/YAML.
 */
export function validateAudioFixtureMetadata(input: AudioFixtureMetadataInput): AudioFixtureValidationResult {
  const errors: string[] = [];

  if (!isSafeRelativeAssetPath(input.assetPath)) errors.push("assetPath must be a safe relative path");
  if (!isSafeRelativeAssetPath(input.transcriptSidecarPath)) {
    errors.push("transcriptSidecarPath must be a safe relative path");
  }
  if (input.contentHash !== undefined && input.contentHash.trim().length === 0) {
    errors.push("contentHash cannot be empty when provided");
  }
  if (!isKnownNoiseProfile(input.noise?.profile)) errors.push("noise.profile is not supported");
  if (!isFiniteNumberInRange(input.noise?.intensity, 0, 1)) {
    errors.push("noise.intensity must be a finite number from 0 to 1");
  }
  if (!isFiniteNumber(input.gainDb)) errors.push("gainDb must be a finite number");
  if (typeof input.clipped !== "boolean") errors.push("clipped must be a boolean");
  if (!isFiniteNumberGreaterThan(input.bandwidthHz, 0)) errors.push("bandwidthHz must be greater than 0");
  if (!isFiniteNumberGreaterThan(input.speakingRateWpm, 0)) errors.push("speakingRateWpm must be greater than 0");

  return { valid: errors.length === 0, errors };
}

/** Creates branded, validated fixture metadata from its serializable input form. */
export function createAudioFixtureMetadata(input: AudioFixtureMetadataInput): AudioFixtureMetadata {
  const validation = validateAudioFixtureMetadata(input);
  if (!validation.valid) throw new Error(`Invalid audio fixture metadata: ${validation.errors.join("; ")}`);

  return {
    ...input,
    assetPath: toSafeRelativeAssetPath(input.assetPath),
    transcriptSidecarPath: toSafeRelativeAssetPath(input.transcriptSidecarPath)
  };
}

const NOISE_PROFILES: readonly AudioNoiseProfile[] = [
  "clean",
  "white_noise",
  "pink_noise",
  "room_tone",
  "cafe",
  "crowd",
  "traffic",
  "custom"
];

function isKnownNoiseProfile(value: unknown): value is AudioNoiseProfile {
  return typeof value === "string" && (NOISE_PROFILES as readonly string[]).includes(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteNumberInRange(value: unknown, min: number, max: number): value is number {
  return isFiniteNumber(value) && value >= min && value <= max;
}

function isFiniteNumberGreaterThan(value: unknown, minimum: number): value is number {
  return isFiniteNumber(value) && value > minimum;
}

export interface WhisperTranscriptionSegment {
  startSeconds: number;
  endSeconds: number;
  text: string;
  /** Optional model-provided confidence-like score, normally normalized to 0–1. */
  confidence?: number;
  averageLogProbability?: number;
  noSpeechProbability?: number;
}

/**
 * An observed (not executed here) Whisper transcription. `correctedText` is
 * intentionally distinct from the model's original output for replay tests.
 */
export interface WhisperTranscriptionObservation {
  engine: "whisper";
  model: string;
  originalText: string;
  correctedText?: string;
  segments?: readonly WhisperTranscriptionSegment[];
  confidence?: number;
}

export interface ReplayTranscriptOptions {
  /** Text read from the fixture's transcript sidecar, if available. */
  sidecarText?: string;
  /** Corrected text is used only when this is exactly true. */
  useCorrectedText?: boolean;
}

export type ReplayTranscriptSource = "corrected" | "sidecar" | "original";

export interface ReplayTranscriptSelection {
  text: string;
  source: ReplayTranscriptSource;
}

/**
 * Selects replay text using a stable policy: explicitly requested corrected
 * text, then sidecar text, then the unmodified model output.
 */
export function selectReplayTranscript(
  observation: WhisperTranscriptionObservation,
  options: ReplayTranscriptOptions = {}
): ReplayTranscriptSelection {
  if (options.useCorrectedText === true && observation.correctedText !== undefined) {
    return { text: observation.correctedText, source: "corrected" };
  }
  if (options.sidecarText !== undefined) return { text: options.sidecarText, source: "sidecar" };
  return { text: observation.originalText, source: "original" };
}

export type AudioFixtureCapabilityId =
  | "fixture_metadata"
  | "transcript_replay"
  | "noise_metadata"
  | "gain_metadata"
  | "clipping_metadata"
  | "bandwidth_metadata"
  | "speaking_rate_metadata"
  | "scripted_interruption"
  | "microphone_permission_denied"
  | "input_device_unavailable"
  | "live_stream_interruption"
  | "hardware_sample_rate_mismatch";

export type AudioFixtureCapabilitySupport = "locally-simulated" | "native-only";

export interface AudioFixtureCapabilityDescriptor {
  id: AudioFixtureCapabilityId;
  support: AudioFixtureCapabilitySupport;
  description: string;
}

/**
 * Local fixtures can annotate/replay deterministic data, while device and
 * streaming failures remain native-only because they require real hardware.
 */
export const AUDIO_FIXTURE_CAPABILITIES: readonly AudioFixtureCapabilityDescriptor[] = [
  { id: "fixture_metadata", support: "locally-simulated", description: "Fixture paths and audio metadata are local data." },
  { id: "transcript_replay", support: "locally-simulated", description: "Sidecar and observed transcripts can be replayed deterministically." },
  { id: "noise_metadata", support: "locally-simulated", description: "Noise profile and intensity can be represented as metadata." },
  { id: "gain_metadata", support: "locally-simulated", description: "Gain can be represented as metadata without modifying samples." },
  { id: "clipping_metadata", support: "locally-simulated", description: "Clipping can be represented as metadata without modifying samples." },
  { id: "bandwidth_metadata", support: "locally-simulated", description: "Bandwidth can be represented as metadata without resampling." },
  { id: "speaking_rate_metadata", support: "locally-simulated", description: "Speaking rate can be represented as metadata without time-stretching." },
  { id: "scripted_interruption", support: "locally-simulated", description: "A deterministic caller interruption can be scheduled by a scenario fixture." },
  { id: "microphone_permission_denied", support: "native-only", description: "Requires an operating-system microphone permission check." },
  { id: "input_device_unavailable", support: "native-only", description: "Requires a real input device and device-selection API." },
  { id: "live_stream_interruption", support: "native-only", description: "Requires a live capture or streaming transport." },
  { id: "hardware_sample_rate_mismatch", support: "native-only", description: "Requires a real device's negotiated sample rate." }
];

export function getAudioFixtureCapability(id: AudioFixtureCapabilityId): AudioFixtureCapabilityDescriptor {
  const capability = AUDIO_FIXTURE_CAPABILITIES.find((candidate) => candidate.id === id);
  if (!capability) throw new Error(`Unknown audio fixture capability: ${id}`);
  return capability;
}
