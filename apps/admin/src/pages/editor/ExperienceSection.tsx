import { useSectionSave, type RegisterSection } from "./section-save";
import { useState } from "react";
import type { ArticleDetailDto } from "@tomokichi/contracts";
import { api } from "../../lib/api";
import { experienceLabels } from "../../lib/labels";
import { Panel } from "../../ui/parts";
import { useToast } from "../../ui/toast";

/** How a reader chooses a story: a small closed vocabulary, saved on its own. */
export function ExperienceSection({
  article,
  onSaved,
  register,
  onSaveAll,
}: {
  article: ArticleDetailDto;
  onSaved: () => Promise<void>;
  register: RegisterSection;
  onSaveAll: () => Promise<boolean>;
}) {
  const toast = useToast();
  const [chosen, setChosen] = useState<string[]>(() => [...article.experienceTags]);
  const [baseline, setBaseline] = useState(() => [...article.experienceTags].toSorted().join());
  const [busy, setBusy] = useState(false);
  const dirty = chosen.toSorted().join() !== baseline;

  async function save(): Promise<boolean> {
    setBusy(true);
    try {
      const saved = await api.saveExperienceTags(article.id, chosen);
      setChosen(saved.experienceTags);
      setBaseline(saved.experienceTags.toSorted().join());
      toast.info("体験タグを保存しました");
      await onSaved();
      return true;
    } catch (error) {
      toast.error(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  useSectionSave(register, "experiences", { dirty, busy, save });

  return (
    <Panel title="体験タグ">
      <fieldset className="chips">
        <legend className="sr-only">体験タグ</legend>
        {Object.entries(experienceLabels).map(([tag, label]) => (
          <button
            key={tag}
            type="button"
            className="chip"
            aria-pressed={chosen.includes(tag)}
            onClick={() =>
              setChosen((current) =>
                current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
              )
            }
          >
            {label}
          </button>
        ))}
      </fieldset>
      <div className="panel__foot">
        <button
          type="button"
          className="primary"
          disabled={busy || !dirty}
          onClick={() => void onSaveAll()}
        >
          体験タグを保存
        </button>
      </div>
    </Panel>
  );
}
