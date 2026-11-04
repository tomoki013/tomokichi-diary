import { ArticleEditor } from "./ArticleEditor";

/** Diary notes have their own admin route and list, while sharing the editor logic. */
export function DiaryNoteEditor({ id }: { id: string }) {
  return <ArticleEditor id={id} mode="note" />;
}
