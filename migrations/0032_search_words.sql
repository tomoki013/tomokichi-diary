-- Private. Other ways a reader types a word the articles already use:
-- "CHAGEE" also as "チャジー" and "霸王茶姬", "Mirador del Valle" also as
-- "ミラドール・デル・バジェ". Never shown on the site; the build adds them to
-- the search text of every article that mentions the word, in its title,
-- summary, tags or body. `also` is a JSON array of strings.
CREATE TABLE search_words (
  word TEXT PRIMARY KEY,
  also TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(also)),
  updated_at TEXT
);
