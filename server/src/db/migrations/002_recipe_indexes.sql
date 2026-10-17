-- Indexes for the recipe list (newest first) and for counting how many recipes share an image file.

CREATE INDEX idx_recipe_created ON recipe (created_at DESC, id DESC);
CREATE INDEX idx_recipe_image_path ON recipe (image_path);
