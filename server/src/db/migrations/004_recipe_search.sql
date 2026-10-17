-- Full-text search over recipes: title, cuisine, description and ingredient text.
-- The porter tokenizer matches word forms (onion/onions) and unicode61 folds accents (creme/crème).
-- rowid is the recipe id. Triggers keep the index in step with every change to a recipe or its ingredients.

CREATE VIRTUAL TABLE recipe_fts USING fts5(
  title,
  cuisine,
  description,
  ingredients,
  tokenize = 'porter unicode61 remove_diacritics 2'
);

-- Index the recipes that already exist.
INSERT INTO recipe_fts (rowid, title, cuisine, description, ingredients)
SELECT
  r.id,
  r.title,
  COALESCE(r.cuisine, ''),
  COALESCE(r.description, ''),
  COALESCE((SELECT group_concat(i.raw_text, ' ') FROM recipe_ingredient i WHERE i.recipe_id = r.id), '')
FROM recipe r;

CREATE TRIGGER recipe_fts_insert AFTER INSERT ON recipe BEGIN
  INSERT INTO recipe_fts (rowid, title, cuisine, description, ingredients)
  VALUES (NEW.id, NEW.title, COALESCE(NEW.cuisine, ''), COALESCE(NEW.description, ''), '');
END;

-- Only the searchable columns: changing a rating or an image does not touch the index.
CREATE TRIGGER recipe_fts_update AFTER UPDATE OF title, cuisine, description ON recipe BEGIN
  UPDATE recipe_fts
  SET title = NEW.title,
      cuisine = COALESCE(NEW.cuisine, ''),
      description = COALESCE(NEW.description, '')
  WHERE rowid = NEW.id;
END;

CREATE TRIGGER recipe_fts_delete AFTER DELETE ON recipe BEGIN
  DELETE FROM recipe_fts WHERE rowid = OLD.id;
END;

CREATE TRIGGER recipe_fts_ingredient_insert AFTER INSERT ON recipe_ingredient BEGIN
  UPDATE recipe_fts SET ingredients = ingredients || ' ' || NEW.raw_text WHERE rowid = NEW.recipe_id;
END;

CREATE TRIGGER recipe_fts_ingredient_delete AFTER DELETE ON recipe_ingredient BEGIN
  UPDATE recipe_fts
  SET ingredients = COALESCE(
    (SELECT group_concat(raw_text, ' ') FROM recipe_ingredient WHERE recipe_id = OLD.recipe_id),
    ''
  )
  WHERE rowid = OLD.recipe_id;
END;
