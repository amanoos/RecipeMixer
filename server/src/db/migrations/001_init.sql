-- Base schema. Ingredient normalisation and full-text search arrive in later phases.

CREATE TABLE recipe (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  cuisine     TEXT,
  description TEXT,
  source_url  TEXT,
  image_path  TEXT,
  rating      INTEGER CHECK (rating BETWEEN 1 AND 5),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE recipe_ingredient (
  id              INTEGER PRIMARY KEY,
  recipe_id       INTEGER NOT NULL REFERENCES recipe (id) ON DELETE CASCADE,
  position        INTEGER NOT NULL,
  raw_text        TEXT NOT NULL,
  name_normalized TEXT,
  quantity        REAL,
  unit            TEXT
);

CREATE INDEX idx_recipe_ingredient_recipe ON recipe_ingredient (recipe_id);
CREATE INDEX idx_recipe_ingredient_name ON recipe_ingredient (name_normalized);

CREATE TABLE recipe_step (
  id        INTEGER PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipe (id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  text      TEXT NOT NULL
);

CREATE INDEX idx_recipe_step_recipe ON recipe_step (recipe_id);
