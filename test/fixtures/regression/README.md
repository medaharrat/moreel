# Transcription regression fixtures

Each `*.json` file here simulates the **raw output a transcription provider
would return** for one representative scenario (clear speech, accents, fast
speech, background music, multiple speakers, silence, noise, short/long
clips, non-English and mixed-language audio) — i.e. the input to
`normalizeTranscript`, not real audio.

Why not real audio? Shipping real `.wav`/`.mp3` fixtures would require
binary assets in the repo and a real (paid, non-deterministic) transcription
backend to regenerate them, which the project spec explicitly asks CI to
avoid ("do not make regression tests depend on a paid external API unless
explicitly configured", "use deterministic fixtures for CI"). Instead, these
fixtures pin down the exact provider output for each scenario, so the test
suite deterministically exercises the part of "transcription quality" that
is actually our code: segment normalization, timestamp validation,
hallucination/repeat collapsing, low-confidence detection, and WER against
a known-good expected transcript.

Each fixture has the shape:

```jsonc
{
  "id": "clear-english-speech",
  "description": "...",
  "durationSeconds": 12.0,
  "language": "en",
  "rawSegments": [ /* RawSegment[] as a real provider would emit */ ],
  "expectedText": "the ground-truth transcript",
  "maxWer": 0.05,          // regression threshold: fail if WER exceeds this
  "expectLowConfidence": false,
  "expectEmpty": false
}
```

To regenerate against a *real* provider (optional, not run in CI), set
`OPENAI_API_KEY` and run `npm run benchmark:transcription -- --live` against
real short audio clips of your own and compare its WER report to these
thresholds.
