ALTER TABLE win_reviews DROP CONSTRAINT win_reviews_review_fields;

ALTER TABLE win_reviews ADD CONSTRAINT win_reviews_review_fields CHECK (
  (status = 'DRAFT' AND reviewed_by_user_id IS NULL AND review_reason IS NULL AND reviewed_at IS NULL)
  OR (status IN ('REVIEWED', 'REJECTED') AND reviewed_by_user_id IS NOT NULL
    AND review_reason IS NOT NULL AND char_length(btrim(review_reason)) > 0 AND reviewed_at IS NOT NULL
    AND generation_failed_at IS NULL AND char_length(btrim(summary)) > 0 AND jsonb_array_length(evidence) > 0)
);
