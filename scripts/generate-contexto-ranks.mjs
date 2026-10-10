#!/usr/bin/env node
import { isString } from "@llmgames/game-catalog";

/**
 * Generate compact, server-side embeddings for Contexto.
 *
 * Qdrant's Contexto solver filters its 9,999-word list through the
 * word2vec-google-news-300 vocabulary. The resulting 9,780 words and vectors
 * are downloaded here and quantized so a room can rank any vocabulary word
 * once at match start without loading an embedding model.
 */

import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const OUTPUT = path.join(ROOT, "apps/workers/src/lib/contextoRanks.json");

const ALIASES = path.join(ROOT, "apps/workers/src/lib/contextoAliases.json");

const TARGETS = path.join(ROOT, "apps/workers/src/lib/contextoTargets.json");

const SOURCE = "https://github.com/qdrant/contexto";

const WORDS_URL =
  "https://raw.githubusercontent.com/qdrant/contexto/e183ad8c059089dbb18415a27dd221ea8e78714a/data/words_filtered.txt";

const EMBEDDINGS_URL =
  "https://raw.githubusercontent.com/qdrant/contexto/e183ad8c059089dbb18415a27dd221ea8e78714a/data/words_embeddings.npy";

const EXPECTED_ROWS = 9_780;

const EXPECTED_SOURCE_UNIQUE_WORDS = 9_735;

const MIN_TARGET_WORD_COUNT = 2_500;

const MAX_TARGET_WORD_COUNT = 3_000;

const MODEL = "word2vec-google-news-300";

const QUANTIZATION_SCALE = 127;

// Word2vec can rank these tokens, but their similarity reflects sentence
// structure or a specific person more than a useful concept. Keep them out of
// both guesses and targets. Rejected guesses do not consume the player's limit.
const EXCLUDED_WORDS = new Set(
  `
a about above after again against all am an and any are as at be because been before being below between
both but by can could did do does doing down during each either else ever every few for from further had
has have having he her here hers herself him himself his how i if in into is it its itself just least less
let like may me might mine more most much must my myself neither no nor not now of off often on once only
or other our ours ourselves out over own rather really same shall she should since so some still such than
that the their theirs them themselves then there these they this those through to too under until up us very
was we well were what whatever when whenever where wherever whether which whichever while who whoever whom
whose why will with within without would yes yet you your yours yourself yourselves
anybody anyone anything anywhere everybody everyone everything nobody nothing nowhere somebody someone
something someplace somewhere hello goodbye bye okay nope alright please thank anyhow anyway
actually already apparently basically certainly clearly definitely especially exactly hardly honestly indeed
literally mainly maybe mostly nearly obviously perhaps possibly practically probably quite really seriously
simply sorry supposedly sure surely totally truly usually
alex alice amy andrew anna anthony ben bob brian carl charles chris christopher dan daniel david edward
elizabeth emily emma eric frank george greg harry helen henry jack james jane jason jennifer john joseph
joshua kate kevin laura linda lisa mark mary matt matthew michael mike nancy nick nicole paul peter rachel
richard robert ryan sally sam sarah scott steve steven susan thomas tim tom william amber bailey earl eve
hector jesus ray sonny thee
zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen
eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion
damn fucking fuck shit bullshit bitch bastard asshole dick cock cunt pussy slut whore faggot nigger
`
    .trim()
    .split(/\s+/),
);

function selectTargetWords(words, targetData) {
  if (!Number.isSafeInteger(targetData.version) || !Array.isArray(targetData.targets)) {
    throw new Error("Invalid curated semantic target file");
  }

  if (
    targetData.targets.length < MIN_TARGET_WORD_COUNT ||
    targetData.targets.length > MAX_TARGET_WORD_COUNT
  ) {
    throw new Error(
      `Expected ${MIN_TARGET_WORD_COUNT}-${MAX_TARGET_WORD_COUNT} curated targets, found ${targetData.targets.length}`,
    );
  }

  const vocabulary = new Set(words);
  const seen = new Set();

  return targetData.targets.map((entry, index) => {
    const word = entry?.word;

    if (!isString(word) || !/^[a-z]{3,14}$/.test(word)) {
      throw new Error(`Invalid curated target at index ${index}: ${String(word)}`);
    }

    if (
      !Number.isFinite(entry.guessability) ||
      entry.guessability < 0 ||
      entry.guessability > 4 ||
      !Number.isFinite(entry.rejectionRisk) ||
      entry.rejectionRisk < 0 ||
      entry.rejectionRisk > 1
    ) {
      throw new Error(`Invalid audit values for curated target: ${word}`);
    }

    if (!vocabulary.has(word))
      throw new Error(`Curated target is absent from the vocabulary: ${word}`);

    if (seen.has(word)) throw new Error(`Duplicate curated target: ${word}`);
    seen.add(word);

    return word;
  });
}

async function download(url) {
  const response = await fetch(url);

  if (!response.ok) throw new Error(`Could not download ${url}: ${response.status}`);

  return Buffer.from(await response.arrayBuffer());
}

function parseNpy(buffer) {
  if (buffer.subarray(0, 6).toString("binary") !== "\x93NUMPY") {
    throw new Error("Embedding download is not a NumPy file");
  }

  const major = buffer[6];
  const headerLength = major === 1 ? buffer.readUInt16LE(8) : buffer.readUInt32LE(8);
  const headerStart = major === 1 ? 10 : 12;
  const header = buffer.subarray(headerStart, headerStart + headerLength).toString("ascii");

  if (!header.includes("'<f4'") || !header.includes("'fortran_order': False")) {
    throw new Error(`Unsupported NumPy layout: ${header.trim()}`);
  }

  const silhouette = header.match(/'shape':\s*\((\d+),\s*(\d+)\)/);

  if (!silhouette) throw new Error(`Could not read NumPy shape: ${header.trim()}`);
  const rows = Number(silhouette[1]);
  const columns = Number(silhouette[2]);
  const dataStart = headerStart + headerLength;

  if (buffer.length - dataStart !== rows * columns * 4) {
    throw new Error("NumPy dimensions do not match its data length");
  }

  return { rows, columns, dataStart };
}

function vectorNorm(buffer, offset, columns) {
  let squared = 0;

  for (let column = 0; column < columns; column++) {
    const value = buffer.readFloatLE(offset + column * 4);
    squared += value * value;
  }

  return Math.sqrt(squared);
}

async function main() {
  const [wordsBuffer, embeddings, aliasBuffer, targetBuffer] = await Promise.all([
    download(WORDS_URL),
    download(EMBEDDINGS_URL),
    readFile(ALIASES),
    readFile(TARGETS),
  ]);

  const aliasData = JSON.parse(aliasBuffer.toString("utf8"));
  const targetData = JSON.parse(targetBuffer.toString("utf8"));
  const aliasToCanonical = new Map();

  for (const [canonical, aliases] of Object.entries(aliasData.families)) {
    if (!Array.isArray(aliases)) throw new Error(`Aliases for ${canonical} must be an array`);

    for (const alias of aliases) {
      if (!isString(alias) || aliasToCanonical.has(alias)) {
        throw new Error(`Invalid or duplicate semantic alias: ${String(alias)}`);
      }

      aliasToCanonical.set(alias, canonical);
    }
  }

  const sourceWords = wordsBuffer
    .toString("utf8")
    .trim()
    .split(/\r?\n/)
    .map((word) => word.trim().toLowerCase());

  const { rows, columns, dataStart } = parseNpy(embeddings);

  if (sourceWords.length !== EXPECTED_ROWS || rows !== EXPECTED_ROWS) {
    throw new Error(
      `Expected ${EXPECTED_ROWS} words and vectors, found ${sourceWords.length} and ${rows}`,
    );
  }

  const seen = new Set();
  const sourceIndices = [];

  const words = sourceWords.filter((word, sourceIndex) => {
    if (!/^[a-z]{2,18}$/.test(word)) return false;

    if (seen.has(word)) return false;
    seen.add(word);

    if (EXCLUDED_WORDS.has(word)) return false;

    if (aliasToCanonical.has(word)) return false;
    sourceIndices.push(sourceIndex);

    return true;
  });

  if (seen.size !== EXPECTED_SOURCE_UNIQUE_WORDS) {
    throw new Error(`Expected ${EXPECTED_SOURCE_UNIQUE_WORDS} source words, found ${seen.size}`);
  }

  const vocabulary = new Set(words);

  for (const canonical of aliasToCanonical.values()) {
    if (!vocabulary.has(canonical))
      throw new Error(`Semantic alias canonical word is absent: ${canonical}`);
  }

  const targets = selectTargetWords(words, targetData);
  const rowBytes = columns * 4;

  const norms = sourceIndices.map((sourceIndex) =>
    vectorNorm(embeddings, dataStart + sourceIndex * rowBytes, columns),
  );

  const quantized = Buffer.alloc(words.length * columns);
  const quantizedNorms = Buffer.alloc(words.length * 4);

  for (let index = 0; index < words.length; index++) {
    const sourceOffset = dataStart + sourceIndices[index] * rowBytes;
    let squared = 0;

    for (let column = 0; column < columns; column++) {
      const normalized = embeddings.readFloatLE(sourceOffset + column * 4) / norms[index];
      const value = Math.max(-127, Math.min(127, Math.round(normalized * QUANTIZATION_SCALE)));
      quantized.writeInt8(value, index * columns + column);
      squared += value * value;
    }

    quantizedNorms.writeFloatLE(Math.sqrt(squared), index * 4);
  }

  const payload = {
    version: 5,
    model: MODEL,
    source: SOURCE,
    aliasVersion: aliasData.version,
    targetVersion: targetData.version,
    vocabulary: words,
    targets,
    dimensions: columns,
    quantizationScale: QUANTIZATION_SCALE,
    embeddings: quantized.toString("base64"),
    embeddingNorms: quantizedNorms.toString("base64"),
  };

  await writeFile(OUTPUT, `${JSON.stringify(payload)}\n`, "utf8");
  console.log(
    `Wrote ${path.relative(ROOT, OUTPUT)} with ${words.length} guesses and ${targets.length} targets`,
  );
}

await main();
