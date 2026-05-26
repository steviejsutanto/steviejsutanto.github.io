import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { buildPortfolio, DEFAULT_IMAGE, DEFAULT_WEBSITE, slugify } from "./build-portfolio.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const sourcePath = join(rootDir, "portfolio", "works-source.json");
const audioDir = join(rootDir, "assets", "audio");
const imageDir = join(rootDir, "assets", "images");
const archiveRoot = process.env.PORTFOLIO_ARCHIVE_DIR
  ? resolveInputPath(process.env.PORTFOLIO_ARCHIVE_DIR)
  : resolve(rootDir, "..", `${basename(rootDir)}-source-assets`);

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

async function main() {
  requireCommand("ffmpeg");
  requireCommand("ffprobe");
  requireCommand("cwebp");

  const works = JSON.parse(readFileSync(sourcePath, "utf8"));
  const values = await collectInputs();

  const slug = slugify(values.title);
  if (!slug) {
    throw new Error("Title does not produce a valid URL slug.");
  }
  if (works.some((work) => work.id === slug || slugify(work.title) === slug)) {
    throw new Error(`A portfolio work with this title or slug already exists: ${slug}`);
  }

  const sourceAudio = requireReadableFile(values.audioPath, "audio source");
  validateAudio(sourceAudio);
  const sourceImage = values.imagePath ? requireReadableFile(values.imagePath, "image source") : null;
  const imageInfo = sourceImage ? validateImage(sourceImage) : null;
  const excerptSrc = `assets/audio/${slug}-excerpt.mp3`;
  const imageSrc = sourceImage ? `assets/images/${slug}.webp` : DEFAULT_IMAGE;
  const outputAudio = join(rootDir, excerptSrc);
  const outputImage = sourceImage ? join(rootDir, imageSrc) : null;
  const archiveDir = join(archiveRoot, "works", slug);

  [outputAudio, outputImage, archiveDir].filter(Boolean).forEach((target) => {
    if (existsSync(target)) {
      throw new Error(`Refusing to overwrite existing path: ${target}`);
    }
  });

  const tempDir = mkdtempSync(join(tmpdir(), "portfolio-import-"));
  try {
    const tempAudio = join(tempDir, `${slug}-excerpt.mp3`);
    run("ffmpeg", [
      "-v", "error", "-y", "-i", sourceAudio, "-map_metadata", "-1", "-vn",
      "-codec:a", "libmp3lame", "-ac", "2", "-b:a", "128k", tempAudio
    ]);
    assertBitrate(tempAudio);

    let tempImage = null;
    if (sourceImage) {
      tempImage = join(tempDir, `${slug}.webp`);
      const resize = imageInfo.longEdge > 1920
        ? imageInfo.width >= imageInfo.height ? ["-resize", "1920", "0"] : ["-resize", "0", "1920"]
        : [];
      run("cwebp", ["-quiet", "-q", "80", ...resize, sourceImage, "-o", tempImage]);
    }

    mkdirSync(archiveDir, { recursive: true });
    mkdirSync(audioDir, { recursive: true });
    mkdirSync(imageDir, { recursive: true });
    copyFileSync(sourceAudio, join(archiveDir, `source-audio${extname(sourceAudio).toLowerCase() || ".audio"}`));
    if (sourceImage) {
      copyFileSync(sourceImage, join(archiveDir, `source-image${extname(sourceImage).toLowerCase() || ".image"}`));
    }
    copyFileSync(tempAudio, outputAudio);
    if (tempImage) {
      copyFileSync(tempImage, outputImage);
    }

    const work = {
      id: slug,
      title: values.title,
      year: values.year,
      instrumentation: values.instrumentation,
      category: values.category,
      description: values.description,
      tags: values.tags,
      excerptSrc,
      imageSrc,
      primaryLink: values.primaryLink,
      externalLinks: { website: DEFAULT_WEBSITE },
      position: null,
      audioRadius: 32,
      audioCoreRadius: 9
    };
    writeFileSync(sourcePath, `${JSON.stringify([...works, work], null, 2)}\n`);
    buildPortfolio({ quiet: true });

    process.stdout.write(`\nAdded ${values.title}.\n`);
    process.stdout.write(`Public audio: ${excerptSrc} (128 kbps MP3)\n`);
    process.stdout.write(`Public image: ${imageSrc}\n`);
    process.stdout.write(`Archived sources: ${archiveDir}\n`);
    process.stdout.write("Refine tags, position, links, image choice, or audio radius in portfolio/works-source.json, then run npm run portfolio:build.\n");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function collectInputs() {
  let answers;
  if (process.stdin.isTTY) {
    const input = createInterface({ input: process.stdin, output: process.stdout });
    try {
      answers = [
        await input.question("Title: "),
        await input.question("Year: "),
        await input.question("Instrumentation: "),
        await input.question("Category: "),
        await input.question("Description: "),
        await input.question("Tags (comma separated): "),
        await input.question("Primary link (leave blank for none): "),
        await input.question("Source audio path: "),
        await input.question("Source image path (leave blank for default): ")
      ];
    } finally {
      input.close();
    }
  } else {
    answers = readFileSync(0, "utf8").split(/\r?\n/);
  }

  const [titleInput, yearInput, instrumentationInput, categoryInput, descriptionInput,
    tagsInput, linkInput = "", audioInput, imageInput = ""] = answers;
  const title = required(titleInput, "Title");
  const yearText = required(yearInput, "Year");
  const year = Number(yearText);
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new Error("Year must be a four-digit number.");
  }
  const instrumentation = required(instrumentationInput, "Instrumentation");
  const category = required(categoryInput, "Category");
  const description = required(descriptionInput, "Description");
  const tags = required(tagsInput, "Tags")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (!tags.length) {
    throw new Error("Provide at least one tag.");
  }
  const linkText = String(linkInput).trim();
  const primaryLink = linkText ? validateUrl(linkText) : null;
  const audioPath = required(audioInput, "Source audio path");
  const imagePath = String(imageInput).trim();
  return { title, year, instrumentation, category, description, tags, primaryLink, audioPath, imagePath };
}

function required(value, label) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${label} is required.`);
  }
  return text;
}

function validateUrl(value) {
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`Primary link must be an absolute URL: ${value}`);
  }
}

function resolveInputPath(value) {
  const input = String(value).trim();
  return input === "~" || input.startsWith("~/")
    ? resolve(homedir(), input.slice(2))
    : resolve(input);
}

function requireReadableFile(value, label) {
  const path = resolveInputPath(value);
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`);
  }
  return path;
}

function validateAudio(path) {
  const result = run("ffprobe", [
    "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type",
    "-of", "default=noprint_wrappers=1:nokey=1", path
  ]);
  if (result.stdout.trim() !== "audio") {
    throw new Error(`Source does not contain a readable audio stream: ${path}`);
  }
}

function validateImage(path) {
  const result = run("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
    "-of", "csv=p=0", path
  ]);
  const [width, height] = result.stdout.trim().split(",").map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`Source is not a readable image: ${path}`);
  }
  return { width, height, longEdge: Math.max(width, height) };
}

function assertBitrate(path) {
  const result = run("ffprobe", [
    "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=bit_rate",
    "-of", "default=noprint_wrappers=1:nokey=1", path
  ]);
  if (Number(result.stdout.trim()) !== 128000) {
    throw new Error(`Generated audio is not 128 kbps: ${path}`);
  }
}

function requireCommand(command) {
  const result = spawnSync(command, ["-version"], { encoding: "utf8" });
  if (result.error?.code === "ENOENT") {
    throw new Error(`Required command is not installed: ${command}`);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    throw new Error(`${command} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed:\n${result.stderr.trim()}`);
  }
  return result;
}
