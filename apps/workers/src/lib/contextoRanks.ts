import rankData from "./contextoRanks.json";
import aliasData from "./contextoAliases.json";

const wordIndex = new Map(rankData.vocabulary.map((word, index) => [word, index]));

const decodedRanks = new Map<string, Uint16Array>();

let decodedEmbeddings: Int8Array | null = null;

let decodedNorms: Float32Array | null = null;

const aliasToCanonical = new Map<string, string>();

for (const [canonical, aliases] of Object.entries(aliasData.families)) {
  for (const alias of aliases) aliasToCanonical.set(alias, canonical);
}

function decodeRanks(encoded: string): Uint16Array {
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ranks = new Uint16Array(bytes.byteLength / 2);

  for (let index = 0; index < ranks.length; index++) {
    ranks[index] = view.getUint16(index * 2, true);
  }

  return ranks;
}

export const CONTEXTO_VOCABULARY_SIZE = rankData.vocabulary.length;

export const CONTEXTO_TARGET_COUNT = rankData.targets.length;

function decodeBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);

  return bytes;
}

function embeddingData() {
  if (!decodedEmbeddings) {
    const bytes = decodeBase64(rankData.embeddings);
    decodedEmbeddings = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  if (!decodedNorms) {
    const bytes = decodeBase64(rankData.embeddingNorms);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    decodedNorms = new Float32Array(rankData.vocabulary.length);

    for (let index = 0; index < decodedNorms.length; index++) {
      decodedNorms[index] = view.getFloat32(index * 4, true);
    }
  }

  return { embeddings: decodedEmbeddings, norms: decodedNorms };
}

export function contextoWord(index: number): string | null {
  return rankData.vocabulary[index] ?? null;
}

export function contextoTarget(index: number): string | null {
  return rankData.targets[index] ?? null;
}

/** Builds one compact lookup table for any target in the full vocabulary. */
export function createContextoRanking(secret: string): string | null {
  const targetIndex = wordIndex.get(secret);

  if (targetIndex === undefined) return null;
  const { embeddings, norms } = embeddingData();
  const dimensions = rankData.dimensions;
  const targetOffset = targetIndex * dimensions;
  const targetNorm = norms[targetIndex]!;
  const similarities = new Float64Array(rankData.vocabulary.length);
  const order = Array.from({ length: rankData.vocabulary.length }, (_, index) => index);

  for (let index = 0; index < order.length; index++) {
    if (index === targetIndex) {
      similarities[index] = Number.POSITIVE_INFINITY;
      continue;
    }

    const offset = index * dimensions;
    let dot = 0;

    for (let column = 0; column < dimensions; column++) {
      dot += embeddings[targetOffset + column]! * embeddings[offset + column]!;
    }

    similarities[index] = dot / (targetNorm * norms[index]!);
  }

  order.sort((left, right) => similarities[right]! - similarities[left]! || left - right);
  const ranks = new Uint16Array(order.length);
  order.forEach((index, position) => {
    ranks[index] = position + 1;
  });
  const bytes = new Uint8Array(ranks.length * 2);
  const view = new DataView(bytes.buffer);

  for (let index = 0; index < ranks.length; index++) view.setUint16(index * 2, ranks[index]!, true);
  let binary = "";

  for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]!);

  return btoa(binary);
}

export function normalizeContextoWord(raw: string): string | null {
  const word = raw.trim().toLowerCase();

  return /^[a-z]{2,18}$/.test(word) ? word : null;
}

/** Resolves only aliases explicitly reviewed in contextoAliases.json. */
export function contextoGuessFamily(word: string): string {
  return aliasToCanonical.get(word) ?? word;
}

export function contextoRank(ranking: string, word: string): number | null {
  const index = wordIndex.get(contextoGuessFamily(word));

  if (index === undefined || !ranking) return null;
  let ranks = decodedRanks.get(ranking);

  if (!ranks) {
    ranks = decodeRanks(ranking);

    if (decodedRanks.size >= 32) decodedRanks.delete(decodedRanks.keys().next().value!);
    decodedRanks.set(ranking, ranks);
  }

  return ranks[index] ?? null;
}
