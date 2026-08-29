-- Travel dates are part of what a trip report *is*: they feed the article
-- header and the structured data that marks the content as first-hand.
ALTER TABLE articles ADD COLUMN travel_start_date TEXT;
ALTER TABLE articles ADD COLUMN travel_end_date TEXT;
