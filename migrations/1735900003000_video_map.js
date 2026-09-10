/**
 * Adds storage for the Video Map layer (scenes/entities/interactions/
 * references — see src/domain/video-map.ts) to the existing `videos` table.
 * One jsonb column, not four: these four collections are always written
 * and read together as a single unit (see PostgresVideoStore), so there's
 * no benefit to separate columns the way transcript/visual_observations
 * already are (those come from independent pipeline stages).
 */
exports.up = (pgm) => {
  pgm.addColumn('videos', {
    video_map: { type: 'jsonb' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('videos', 'video_map');
};
