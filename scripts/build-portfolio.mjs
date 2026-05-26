import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const sourcePath = join(rootDir, "portfolio", "works-source.json");
const manifestPath = join(rootDir, "portfolio", "works.json");
const browserDataPath = join(rootDir, "portfolio", "works-data.js");

export const DEFAULT_IMAGE = "assets/images/stevie-6.webp";
export const DEFAULT_WEBSITE = "https://www.steviejsutanto.com";

const positionSlots = [
  [71, 27], [61, 39], [76, 50], [40, 43], [27, 35], [31, 65],
  [45, 72], [55, 57], [20, 49], [54, 83], [68, 67], [83, 33],
  [84, 44], [52, 23], [37, 24], [19, 69], [65, 78], [87, 62],
  [14, 33], [43, 88], [58, 13], [31, 53], [72, 15], [79, 78]
];

export function buildPortfolio({ quiet = false } = {}) {
  assertFile(sourcePath, "portfolio source data");
  const sourceWorks = JSON.parse(readFileSync(sourcePath, "utf8"));
  if (!Array.isArray(sourceWorks) || sourceWorks.length === 0) {
    throw new Error("portfolio/works-source.json must contain at least one work.");
  }

  const seenTitles = new Set();
  const seenIds = new Set();
  const works = sourceWorks.map((work, index) => normalizeWork(work, index, seenTitles, seenIds));

  assignPositions(works);
  calculateSimilarities(works);
  writeFileSync(manifestPath, `${JSON.stringify(works, null, 2)}\n`);
  writeFileSync(browserDataPath, `window.PORTFOLIO_WORKS = ${JSON.stringify(works, null, 2)};\n`);

  if (!quiet) {
    process.stdout.write(`Built ${works.length} portfolio works from portfolio/works-source.json.\n`);
    process.stdout.write("Updated portfolio/works.json and portfolio/works-data.js.\n");
  }
  return works;
}

function normalizeWork(work, index, seenTitles, seenIds) {
  if (!work || typeof work !== "object" || Array.isArray(work)) {
    throw new Error(`Work ${index + 1} must be an object.`);
  }

  const title = requiredText(work.title, `Work ${index + 1} title`);
  const id = work.id ? requiredText(work.id, `${title} id`) : slugify(title);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`${title} id must be lowercase kebab-case: ${id}`);
  }
  if (seenTitles.has(key(title)) || seenIds.has(id)) {
    throw new Error(`Duplicate portfolio work title or id: ${title}`);
  }
  seenTitles.add(key(title));
  seenIds.add(id);

  const year = Number(work.year);
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new Error(`${title} must have a four-digit year.`);
  }

  const excerptSrc = validateAssetPath(work.excerptSrc, `${title} excerpt`, ".mp3");
  const imageSrc = validateAssetPath(work.imageSrc || DEFAULT_IMAGE, `${title} image`, ".webp");
  const tags = normalizeTags(work.tags, title);

  return {
    id,
    title,
    year,
    instrumentation: requiredText(work.instrumentation, `${title} instrumentation`),
    category: optionalText(work.category) || "Creative work",
    description: optionalText(work.description) || `${title}, ${year}.`,
    tags,
    excerptSrc,
    imageSrc,
    primaryLink: normalizeLink(work.primaryLink, `${title} primaryLink`),
    externalLinks: normalizeExternalLinks(work.externalLinks, title),
    position: normalizePosition(work.position, title),
    audioRadius: normalizeNumber(work.audioRadius, 32, `${title} audioRadius`),
    audioCoreRadius: normalizeNumber(work.audioCoreRadius, 9, `${title} audioCoreRadius`),
    similarity: []
  };
}

function normalizeTags(tags, title) {
  if (!Array.isArray(tags)) {
    throw new Error(`${title} tags must be an array of text values.`);
  }
  return [...new Set(tags.map((tag) => requiredText(tag, `${title} tag`)))];
}

function normalizeExternalLinks(links, title) {
  if (links === undefined) {
    return { website: DEFAULT_WEBSITE };
  }
  if (!links || typeof links !== "object" || Array.isArray(links)) {
    throw new Error(`${title} externalLinks must be an object.`);
  }
  return Object.fromEntries(
    Object.entries(links).map(([label, link]) => [
      requiredText(label, `${title} external link label`),
      normalizeLink(link, `${title} external link ${label}`)
    ])
  );
}

function normalizePosition(position, title) {
  if (position === undefined || position === null) {
    return null;
  }
  if (!position || typeof position !== "object") {
    throw new Error(`${title} position must be an object or null.`);
  }
  return {
    x: normalizeNumber(position.x, null, `${title} position.x`),
    y: normalizeNumber(position.y, null, `${title} position.y`),
    z: normalizeNumber(position.z, 0.68, `${title} position.z`)
  };
}

function validateAssetPath(path, label, extension) {
  const assetPath = requiredText(path, label);
  if (assetPath.startsWith("/") || assetPath.includes("..") || !assetPath.endsWith(extension)) {
    throw new Error(`${label} must be a project-relative ${extension} path: ${assetPath}`);
  }
  assertFile(join(rootDir, assetPath), label);
  return assetPath;
}

function normalizeLink(value, label) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const link = requiredText(value, label);
  try {
    new URL(link);
  } catch {
    throw new Error(`${label} must be an absolute URL or null: ${link}`);
  }
  return link;
}

function requiredText(value, label) {
  const text = optionalText(value);
  if (!text) {
    throw new Error(`${label} is required.`);
  }
  return text;
}

function optionalText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNumber(value, fallback, label) {
  if (value === undefined || value === null || value === "") {
    if (fallback === null) {
      throw new Error(`${label} is required.`);
    }
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be numeric.`);
  }
  return number;
}

function assignPositions(works) {
  const placed = works.filter((work) => work.position);
  const unplaced = works.filter((work) => !work.position);

  for (const work of unplaced) {
    const bestSlot = positionSlots
      .filter(([x, y]) => !placed.some((item) => distance(item.position, { x, y }) < 11))
      .map(([x, y]) => ({
        position: { x, y, z: 0.68 },
        score: positionScore(work, { x, y }, placed)
      }))
      .sort((a, b) => a.score - b.score)[0];

    work.position = bestSlot?.position || fallbackPosition(placed.length);
    placed.push(work);
  }
}

function positionScore(work, position, placed) {
  if (!placed.length) {
    return distance(position, { x: 50, y: 50 });
  }
  const related = placed
    .map((candidate) => ({ candidate, score: similarityScore(work, candidate) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const relationCost = related.reduce((sum, item) => sum + distance(position, item.candidate.position), 0);
  const collisionCost = placed.reduce((sum, item) => {
    const separation = distance(position, item.position);
    return sum + (separation < 16 ? (16 - separation) * 18 : 0);
  }, 0);
  return relationCost + collisionCost;
}

function fallbackPosition(index) {
  const angle = index * 2.399963229728653;
  return {
    x: clamp(50 + Math.cos(angle) * 34, 12, 88),
    y: clamp(50 + Math.sin(angle) * 34, 14, 86),
    z: 0.66
  };
}

function calculateSimilarities(works) {
  for (const work of works) {
    work.similarity = works
      .filter((candidate) => candidate.id !== work.id)
      .map((candidate) => ({ id: candidate.id, score: similarityScore(work, candidate) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, 3)
      .map((candidate) => candidate.id);
  }
}

function similarityScore(a, b) {
  const aTags = new Set((a.tags || []).map(key));
  const bTags = new Set((b.tags || []).map(key));
  const sharedTags = [...aTags].filter((tag) => bTags.has(tag)).length;
  const aInstrument = key(a.instrumentation);
  const bInstrument = key(b.instrumentation);
  let score = sharedTags * 3;

  if (key(a.category) === key(b.category)) {
    score += 4;
  }
  if (aInstrument === bInstrument) {
    score += 3;
  }
  if (aInstrument.includes("laptop") && bInstrument.includes("laptop")) {
    score += 2;
  }
  if (aInstrument.includes("string") && bInstrument.includes("string")) {
    score += 2;
  }
  if (isSpeakerWork(aInstrument) && isSpeakerWork(bInstrument)) {
    score += 2;
  }
  score += Math.max(0, 3 - Math.abs(a.year - b.year) / 2);
  return score;
}

function isSpeakerWork(text) {
  return text.includes("speaker") || text.includes("multichannel") || text.includes("8-ch");
}

export function slugify(value) {
  return key(value)
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

function key(value) {
  return String(value || "")
    .replaceAll(/\s+/g, " ")
    .replaceAll(/[’‘]/g, "'")
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function assertFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    buildPortfolio();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
