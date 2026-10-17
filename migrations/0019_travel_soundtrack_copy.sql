-- The series copy as approved for launch. Only replaces the placeholder that
-- 0018 inserted, so a description already edited in the admin is kept.
UPDATE collections
SET description = 'あの曲を聴くと、あの旅に戻れる。' || char(10) || char(10) ||
  '旅先で何気なく聴いていた一曲が、いつの間にか忘れられない旅の記憶になっている。' || char(10) ||
  '世界の街角、飛行機の窓から見える景色、知らない土地で迎える朝。' || char(10) ||
  '旅先で聴いた音楽と、その曲に結びついた風景や思い出を紹介するシリーズ。' || char(10) || char(10) ||
  '曲と旅先に、特別な関係がある必要はありません。' || char(10) ||
  'あのとき、あの場所で聴いていた。それだけで、私にとっては特別な一曲だから。'
WHERE slug = 'travel-soundtrack'
  AND description = '旅先で聴きたい音楽を、街並みや旅のワンシーンとともに紹介。音楽で旅の記憶をもっと特別にするシリーズ。';
