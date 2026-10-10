import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

const manifest = z
  .array(
    z.object({
      path: z
        .string()
        .regex(/^(gen1|gen1-back|full-back|gen5ani|gen5ani-back)\/[a-z0-9-]+\.(png|gif)$/),
      url: z.url(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  )
  .parse(JSON.parse(await readFile(new URL("./assets.json", import.meta.url), "utf8")));

console.log(
  "Downloading optional third-party Pokémon artwork. See THIRD_PARTY_NOTICES.md for its separate rights.",
);

const root = new URL("../../apps/web/public/pokemon/", import.meta.url);

for (const asset of manifest) {
  if (new URL(asset.url).origin !== "https://play.pokemonshowdown.com") {
    throw new Error("Unexpected asset origin");
  }

  const response = await fetch(asset.url, { signal: AbortSignal.timeout(30_000) });

  if (!response.ok) throw new Error(`Asset download failed: ${response.status} ${asset.path}`);

  const bytes = Buffer.from(await response.arrayBuffer());

  if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
    throw new Error(
      `Asset changed upstream: ${asset.path}. Review its source before updating the manifest.`,
    );
  }

  const target = new URL(asset.path, root);
  await mkdir(new URL(".", target), { recursive: true });
  await writeFile(target, bytes);
}

console.log(`Downloaded ${manifest.length} artwork files. Git ignores these files.`);
