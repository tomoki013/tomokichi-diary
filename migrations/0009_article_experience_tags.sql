-- What a trip felt like ("exciting", "moving", ...), from the closed
-- vocabulary in packages/domain/src/entities/experience.ts. A JSON array of
-- identifiers rather than a join table: the vocabulary is small and fixed, the
-- set is always read with the article, and nothing queries it the other way
-- round in SQL. Additive with a default, so existing rows read as "none yet".
ALTER TABLE articles ADD COLUMN experience_tags TEXT NOT NULL DEFAULT '[]';
