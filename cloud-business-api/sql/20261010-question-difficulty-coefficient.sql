ALTER TABLE business.questions ADD COLUMN IF NOT EXISTS difficulty_coefficient numeric;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='business.questions'::regclass AND conname='question_difficulty_coefficient_range') THEN
    ALTER TABLE business.questions ADD CONSTRAINT question_difficulty_coefficient_range
      CHECK (difficulty_coefficient IS NULL OR (difficulty_coefficient >= 0 AND difficulty_coefficient <= 1 AND difficulty_coefficient <> 'NaN'::numeric));
  END IF;
END $$;
