import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";

// Voice input: browser MediaRecorder audio → local transcription.
// Primary: whisper-cli (brew install whisper-cpp) with a local GGUF model.
const execFileAsync = promisify(execFile);
const WHISPER_CLI = "/opt/homebrew/bin/whisper-cli";
const WHISPER_MODEL = path.join(os.homedir(), "models", "whisper", "ggml-large-v3-turbo-q5_0.bin");
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request) {
  if (!fs.existsSync(WHISPER_CLI) || !fs.existsSync(WHISPER_MODEL)) {
    return NextResponse.json({ error: "whisper not installed" }, { status: 503 });
  }
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) return NextResponse.json({ error: "empty audio" }, { status: 400 });
  if (buf.length > MAX_AUDIO_BYTES) return NextResponse.json({ error: "audio too large" }, { status: 413 });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-transcribe-"));
  const input = path.join(dir, "input.webm");
  const wav = path.join(dir, "input.wav");
  try {
    fs.writeFileSync(input, buf);
    // Browser records webm/opus; whisper-cli wants 16kHz mono WAV.
    await execFileAsync("/opt/homebrew/bin/ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-ac", "1", "-ar", "16000", wav], { timeout: 30_000 });
    const { stdout } = await execFileAsync(WHISPER_CLI, ["-m", WHISPER_MODEL, "-l", "zh", "--no-prints", "-nt", wav], {
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    // Lines look like "[00:00:00.000 --> 00:00:02.880]  text" — strip timestamps.
    const text = stdout
      .split("\n")
      .map((line) => line.replace(/^\[[\d:.]+\s*-->\s*[\d:.]+\]\s*/, "").trim())
      .filter(Boolean)
      .join(" ");
    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
