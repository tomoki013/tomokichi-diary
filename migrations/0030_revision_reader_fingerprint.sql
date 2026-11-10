-- What a reader of each revision sees, as a short fingerprint (readerFingerprint
-- in the domain). The admin lists date "content last changed" from these
-- instead of reading every revision body on each request. Filled on save; older
-- revisions are filled in a few at a time as the lists are read.
ALTER TABLE article_revisions ADD COLUMN reader_fingerprint TEXT;
