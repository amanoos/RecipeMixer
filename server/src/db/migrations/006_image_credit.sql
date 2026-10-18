-- Who made a recipe's photo, for photos found by the image search. Most open licences require this credit to be
-- shown. Both columns are NULL for photos the user uploaded or imported themselves, and are cleared whenever the
-- photo is replaced or removed.

ALTER TABLE recipe ADD COLUMN image_credit TEXT;
ALTER TABLE recipe ADD COLUMN image_credit_url TEXT;
