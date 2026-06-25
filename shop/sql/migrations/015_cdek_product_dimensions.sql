ALTER TABLE products
  ADD COLUMN weight_grams   INTEGER
    CONSTRAINT products_weight_positive   CHECK (weight_grams IS NULL OR weight_grams > 0),
  ADD COLUMN box_length_cm  SMALLINT
    CONSTRAINT products_box_length_positive CHECK (box_length_cm IS NULL OR box_length_cm > 0),
  ADD COLUMN box_width_cm   SMALLINT
    CONSTRAINT products_box_width_positive  CHECK (box_width_cm IS NULL OR box_width_cm > 0),
  ADD COLUMN box_height_cm  SMALLINT
    CONSTRAINT products_box_height_positive CHECK (box_height_cm IS NULL OR box_height_cm > 0);
