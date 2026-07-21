import { describe, expect, it } from "vitest";
import {
  AUDIO_FIXTURE_CAPABILITIES,
  createAudioFixtureMetadata,
  getAudioFixtureCapability,
  isSafeRelativeAssetPath,
  selectReplayTranscript,
  toSafeRelativeAssetPath,
  validateAudioFixtureMetadata,
  type AudioFixtureMetadataInput,
  type WhisperTranscriptionObservation
} from "../src/audio-fixtures.js";

const fixture: AudioFixtureMetadataInput = {
  assetPath: "calls/noisy-hello.wav",
  transcriptSidecarPath: "calls/noisy-hello.txt",
  contentHash: "sha256:example",
  noise: { profile: "room_tone", intensity: 0.25 },
  gainDb: -3,
  clipped: false,
  bandwidthHz: 8_000,
  speakingRateWpm: 145
};

const observation: WhisperTranscriptionObservation = {
  engine: "whisper",
  model: "small.en",
  originalText: "please call me at noon",
  correctedText: "Please call me at noon.",
  confidence: 0.91,
  segments: [{ startSeconds: 0, endSeconds: 1.2, text: "please call me at noon", confidence: 0.91 }]
};

describe("audio fixture paths", () => {
  it("accepts portable, non-traversing relative paths", () => {
    expect(isSafeRelativeAssetPath("calls/hello.wav")).toBe(true);
    expect(toSafeRelativeAssetPath("calls/hello.wav")).toBe("calls/hello.wav");
  });

  it.each([
    "/tmp/hello.wav",
    "../hello.wav",
    "calls/../../hello.wav",
    "calls/./hello.wav",
    "C:\\fixtures\\hello.wav",
    "\\\\server\\share\\hello.wav",
    "calls\\hello.wav",
    "calls//hello.wav",
    " calls/hello.wav"
  ])("rejects unsafe or ambiguous fixture paths: %s", (path) => {
    expect(isSafeRelativeAssetPath(path)).toBe(false);
    expect(() => toSafeRelativeAssetPath(path)).toThrow("safe relative path");
  });
});

describe("audio fixture metadata", () => {
  it("creates metadata with branded safe asset and sidecar paths", () => {
    const metadata = createAudioFixtureMetadata(fixture);

    expect(metadata.assetPath).toBe("calls/noisy-hello.wav");
    expect(metadata.transcriptSidecarPath).toBe("calls/noisy-hello.txt");
    expect(metadata.noise).toEqual({ profile: "room_tone", intensity: 0.25 });
  });

  it("reports every unsupported path or acoustic value without reading audio", () => {
    const result = validateAudioFixtureMetadata({
      ...fixture,
      assetPath: "../outside.wav",
      transcriptSidecarPath: "/outside.txt",
      contentHash: " ",
      noise: { profile: "room_tone", intensity: 1.5 },
      gainDb: Number.NaN,
      clipped: "yes" as unknown as boolean,
      bandwidthHz: 0,
      speakingRateWpm: -1
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      "assetPath must be a safe relative path",
      "transcriptSidecarPath must be a safe relative path",
      "contentHash cannot be empty when provided",
      "noise.intensity must be a finite number from 0 to 1",
      "gainDb must be a finite number",
      "clipped must be a boolean",
      "bandwidthHz must be greater than 0",
      "speakingRateWpm must be greater than 0"
    ]);
    expect(() => createAudioFixtureMetadata({ ...fixture, assetPath: "../outside.wav" })).toThrow("Invalid audio fixture metadata");
  });
});

describe("provisional Whisper replay", () => {
  it("prefers the sidecar over original text by default, never silently correcting", () => {
    expect(selectReplayTranscript(observation, { sidecarText: "sidecar text" })).toEqual({
      text: "sidecar text",
      source: "sidecar"
    });
  });

  it("uses corrected text only when explicitly requested", () => {
    expect(selectReplayTranscript(observation)).toEqual({ text: observation.originalText, source: "original" });
    expect(selectReplayTranscript(observation, { useCorrectedText: false, sidecarText: "sidecar text" })).toEqual({
      text: "sidecar text",
      source: "sidecar"
    });
    expect(selectReplayTranscript(observation, { useCorrectedText: true, sidecarText: "sidecar text" })).toEqual({
      text: observation.correctedText,
      source: "corrected"
    });
  });

  it("falls back to the sidecar then original text when no corrected text exists", () => {
    const withoutCorrection = { ...observation, correctedText: undefined };
    expect(selectReplayTranscript(withoutCorrection, { useCorrectedText: true, sidecarText: "sidecar text" })).toEqual({
      text: "sidecar text",
      source: "sidecar"
    });
    expect(selectReplayTranscript(withoutCorrection, { useCorrectedText: true })).toEqual({
      text: observation.originalText,
      source: "original"
    });
  });
});

describe("audio fixture capabilities", () => {
  it("marks metadata/replay locally simulated and hardware faults native-only", () => {
    expect(getAudioFixtureCapability("noise_metadata").support).toBe("locally-simulated");
    expect(getAudioFixtureCapability("scripted_interruption").support).toBe("locally-simulated");
    expect(getAudioFixtureCapability("microphone_permission_denied").support).toBe("native-only");
    expect(AUDIO_FIXTURE_CAPABILITIES).toHaveLength(12);
  });
});
