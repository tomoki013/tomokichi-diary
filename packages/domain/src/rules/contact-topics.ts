/**
 * What a reader can write in about, and which lane (動線) each choice belongs
 * to. This table is the one place the contact form's choices, the lane a
 * message is filed under, the tag on the notification mail and the lane badge
 * in the admin come from.
 *
 * A lane is how a message is handled, not what the reader picked: today every
 * lane files to the same platform project and is answered from the same admin
 * screen. Splitting media enquiries off — their own form page, their own
 * platform project, their own reply templates — starts by changing a lane
 * here and where the API maps lanes to projects (`apps/api/src/inquiry.ts`).
 */
export const CONTACT_LANES = ["general", "media"] as const;
export type ContactLane = (typeof CONTACT_LANES)[number];

export const CONTACT_LANE_LABELS: Readonly<Record<ContactLane, string>> = {
  general: "一般",
  media: "メディア・お仕事",
};

export interface ContactTopic {
  /** Stable handle the form posts. Never changes. */
  readonly key: string;
  /**
   * What the reader sees, and the subject the message is filed with. Tickets
   * keep it, so renaming one moves the old wording to `aliases`.
   */
  readonly label: string;
  readonly lane: ContactLane;
  /** Earlier labels, still recognised on tickets filed under them. */
  readonly aliases?: readonly string[];
}

/** In the order the form lists them. */
export const CONTACT_TOPICS: readonly ContactTopic[] = [
  { key: "article", label: "記事について", lane: "general" },
  { key: "request", label: "旅先・記事のリクエスト", lane: "general" },
  { key: "work", label: "お仕事・取材の相談", lane: "media" },
  { key: "photo", label: "写真の利用について", lane: "media" },
  { key: "other", label: "その他", lane: "general" },
];

/**
 * The topic a form value or a filed subject names: its key, its label or one
 * of its earlier labels. A page cached before the form posted keys still
 * posts labels, so both are accepted.
 */
export function findContactTopic(value: string): ContactTopic | undefined {
  const needle = value.trim();
  if (needle === "") return undefined;
  return CONTACT_TOPICS.find(
    (topic) =>
      topic.key === needle || topic.label === needle || topic.aliases?.includes(needle) === true,
  );
}

export function contactTopicsIn(lane: ContactLane): readonly ContactTopic[] {
  return CONTACT_TOPICS.filter((topic) => topic.lane === lane);
}
