import { env } from "../env";

const OPENAI_TRANSCRIPT_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const SUPPORTED_MODELS = new Set([
  "gpt-4o-mini-transcribe",
  "gpt-4o-transcribe",
  "gpt-4o-transcribe-diarize",
  "whisper-1",
]);
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export type TranscribeAudioInput = {
  readonly audioFile: File;
  readonly model?: string;
};

export type TranscribeAudioResult = {
  readonly text: string;
  readonly model: string;
};

function normalizeModel(model: string | undefined): string {
  const trimmed = (model ?? "").trim();
  if (!trimmed) return DEFAULT_TRANSCRIPTION_MODEL;
  if (!SUPPORTED_MODELS.has(trimmed)) {
    throw new Error("Unsupported transcription model");
  }
  return trimmed;
}

export async function transcribeAudioToText(
  input: TranscribeAudioInput,
): Promise<TranscribeAudioResult> {
  const file = input.audioFile;
  if (!(file instanceof File)) {
    throw new Error("Audio file is required");
  }
  if (file.size <= 0) {
    throw new Error("Audio file is empty");
  }
  if (file.size > MAX_AUDIO_BYTES) {
    throw new Error("Audio file exceeds 25 MB limit");
  }

  const model = normalizeModel(input.model);
  const form = new FormData();
  form.set("file", file, file.name || "audio.webm");
  form.set("model", model);
  form.set("response_format", "json");

  const res = await fetch(OPENAI_TRANSCRIPT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: form,
  });

  const raw = await res.text();
  let parsed: unknown = null;
  try {
    parsed = raw.length > 0 ? (JSON.parse(raw) as unknown) : null;
  } catch {
    parsed = raw;
  }

  if (!res.ok) {
    const message =
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof (parsed as { error?: unknown }).error === "object" &&
      (parsed as { error?: { message?: unknown } }).error &&
      typeof (parsed as { error: { message?: unknown } }).error.message ===
        "string"
        ? (parsed as { error: { message: string } }).error.message
        : `Transcription failed (${res.status})`;
    throw new Error(message);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Unexpected transcription response");
  }
  const text = (parsed as { text?: unknown }).text;
  if (typeof text !== "string") {
    throw new Error("Unexpected transcription response");
  }

  return { text, model };
}
