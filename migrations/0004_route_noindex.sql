-- Some pages exist for readers but should stay out of the index (thin location
-- hubs, disclosure pages). Indexability is a property of the URL, so it lives
-- with the route rather than being hard-coded in a template.
ALTER TABLE routes ADD COLUMN noindex INTEGER NOT NULL DEFAULT 0;
