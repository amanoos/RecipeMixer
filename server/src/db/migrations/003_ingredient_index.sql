-- Ingredient search index: which rule version normalised each ingredient line, and the words of each
-- normalised name (so a user's ingredients can be looked up quickly). raw_text is never modified.

ALTER TABLE recipe_ingredient ADD COLUMN normalizer_version INTEGER NOT NULL DEFAULT 0;
-- Every canonical name of the line, joined by "|" (names contain only letters, spaces and hyphens).
-- name_normalized keeps just the first one, for suggestions.
ALTER TABLE recipe_ingredient ADD COLUMN normalized_names TEXT;

CREATE TABLE recipe_ingredient_word (
  ingredient_id INTEGER NOT NULL REFERENCES recipe_ingredient (id) ON DELETE CASCADE,
  word          TEXT NOT NULL,
  PRIMARY KEY (ingredient_id, word)
) WITHOUT ROWID;

CREATE INDEX idx_ingredient_word_word ON recipe_ingredient_word (word);
