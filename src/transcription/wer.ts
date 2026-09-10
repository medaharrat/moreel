/**
 * Word Error Rate: the standard ASR quality metric, computed as
 * (substitutions + deletions + insertions) / max(1, reference word count)
 * via a Levenshtein-style word-level edit distance. Lower is better; 0 is
 * a perfect match. Shared by the regression suite and the benchmark tool
 * so "quality" means the same thing in both places.
 */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const refWords = tokenize(reference);
  const hypWords = tokenize(hypothesis);

  if (refWords.length === 0) {
    return hypWords.length === 0 ? 0 : 1;
  }

  const distance = levenshteinDistance(refWords, hypWords);
  return distance / refWords.length;
}

/** Character Error Rate: same idea, at the character level. */
export function characterErrorRate(reference: string, hypothesis: string): number {
  const refChars = [...reference.trim().toLowerCase()];
  const hypChars = [...hypothesis.trim().toLowerCase()];
  if (refChars.length === 0) {
    return hypChars.length === 0 ? 0 : 1;
  }
  return levenshteinDistance(refChars, hypChars) / refChars.length;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, '')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function levenshteinDistance<T>(a: T[], b: T[]): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i++) matrix[i]![0] = i;
  for (let j = 0; j < cols; j++) matrix[0]![j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1, // deletion
        matrix[i]![j - 1]! + 1, // insertion
        matrix[i - 1]![j - 1]! + cost, // substitution
      );
    }
  }

  return matrix[rows - 1]![cols - 1]!;
}
