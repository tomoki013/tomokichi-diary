import { useSectionSave, type RegisterSection } from "./section-save";
import { useEffect, useRef, useState } from "react";
import type { ArticleDetailDto } from "@tomokichi/contracts";
import { api } from "../../lib/api";
import { experienceLabels } from "../../lib/labels";
import { addMissing, removeAdded } from "../../lib/relation-defaults";
import { Panel } from "../../ui/parts";
import type { ExperienceDefaultsChange } from "./RelationsSection";
import { useToast } from "../../ui/toast";

/**
 * How a reader chooses a story: a small closed vocabulary, saved on its own.
 * Joining a series in the relations adds that series' default tags here.
 */
export function ExperienceSection({
  article,
  onSaved,
  register,
  onSaveAll,
  defaults,
}: {
  article: ArticleDetailDto;
  onSaved: () => Promise<void>;
  register: RegisterSection;
  onSaveAll: () => Promise<boolean>;
  defaults?: ExperienceDefaultsChange | null;
}) {
  const toast = useToast();
  const [chosen, setChosen] = useState<string[]>(() => [...article.experienceTags]);
  const [baseline, setBaseline] = useState(() => [...article.experienceTags].toSorted().join());
  const [busy, setBusy] = useState(false);
  const dirty = chosen.toSorted().join() !== baseline;
  // What each series added in this session, so leaving it removes only that.
  // The updaters below record it; they are pure in `current`, so a repeated
  // call (React's strict mode) records the same thing.
  const added = useRef(new Map<string, readonly string[]>());
  const applied = useRef(0);
  useEffect(() => {
    if (!defaults || defaults.key === applied.current) return;
    applied.current = defaults.key;
    if (defaults.remove) {
      const before = added.current.get(defaults.source) ?? [];
      added.current.delete(defaults.source);
      // oxlint-disable-next-line react/set-state-in-effect
      setChosen((current) => removeAdded(current, before, defaults.keep));
    } else {
      setChosen((current) => {
        const result = addMissing(current, defaults.add);
        added.current.set(defaults.source, result.added);
        return result.next;
      });
    }
  }, [defaults]);

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
