import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";

// Voice input: browser MediaRecorder audio → local whisper-cli transcription.
const execFileAsync = promisify(execFile);
const WHISPER_MODEL = path.join(os.homedir(), "models", "whisper", "ggml-large-v3-turbo-q5_0.bin");
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

// Resolve a binary by env override → PATH → common brew prefixes (the desktop
// app spawns this server without a shell PATH).
function findBin(name: string, envVar: string): string | null {
  const override = process.env[envVar];
  if (override && fs.existsSync(override)) return override;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  for (const dir of ["/opt/homebrew/bin", "/usr/local/bin"]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export async function POST(req: Request) {
  const whisper = findBin("whisper-cli", "WHISPER_CLI_PATH");
  const ffmpeg = findBin("ffmpeg", "FFMPEG_PATH");
  if (!whisper || !ffmpeg || !fs.existsSync(WHISPER_MODEL)) {
    return NextResponse.json({ error: "whisper not installed (whisper-cli/ffmpeg/model missing)" }, { status: 503 });
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
    await execFileAsync(ffmpeg, ["-y", "-loglevel", "error", "-i", input, "-ac", "1", "-ar", "16000", wav], { timeout: 30_000 });
    // No -l flag: whisper auto-detects the spoken language.
    const { stdout } = await execFileAsync(whisper, ["-m", WHISPER_MODEL, "--no-prints", "-nt", wav], {
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
