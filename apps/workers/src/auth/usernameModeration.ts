import { englishDataset, englishRecommendedTransformers, RegExpMatcher } from "obscenity";

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

/** English profanity and slurs, including common spelling evasions. */
export function isAbusiveUsername(username: string): boolean {
  // Underscores can separate words or disguise individual letters.
  return (
    matcher.hasMatch(username.replace(/_/g, " ")) || matcher.hasMatch(username.replace(/_/g, ""))
  );
}
