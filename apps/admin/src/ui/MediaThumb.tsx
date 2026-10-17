import { useState } from "react";

/**
 * A list-sized photo. Uses the 340px build derivative and falls back to the
 * original only when that has not been built yet (a photo uploaded since the
 * last publication), so a grid of sixty never pulls sixty camera originals.
 */
export function MediaThumb({
  url,
  thumbnailUrl,
  width,
  height,
}: {
  url: string;
  thumbnailUrl?: string | null;
  width?: number | null;
  height?: number | null;
}) {
  const [failed, setFailed] = useState(false);
  const src = !failed && thumbnailUrl ? thumbnailUrl : url;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      width={width ?? undefined}
      height={height ?? undefined}
      onError={() => setFailed(true)}
    />
  );
}
