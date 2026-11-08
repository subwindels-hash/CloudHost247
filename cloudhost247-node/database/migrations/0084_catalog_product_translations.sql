-- Localized product copy is independent of the authoritative product and checkout data.
-- Source snapshots make published translations ineligible when the original copy changes.
CREATE TABLE IF NOT EXISTS catalog_product_translations (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  locale varchar(5) NOT NULL CHECK (locale IN ('fr','de','es','pt','it','nl','pl','ru','ar','zh','ja','ko')),
  name varchar(255) NOT NULL CHECK (length(trim(name)) > 0),
  description text,
  source_name varchar(255) NOT NULL,
  source_description text,
  status varchar(16) NOT NULL CHECK (status IN ('draft','published')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, locale)
);
