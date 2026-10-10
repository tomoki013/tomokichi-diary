import { useCallback, useLayoutEffect, useRef, useState } from "react";

interface SectionSave {
  dirty: boolean;
  busy: boolean;
  problem?: string;
  save: () => Promise<boolean>;
}
export type RegisterSection = (key: string, section: SectionSave | null) => void;

/** The editor's Save and Publish buttons include each section's pending edits. */
export function useEditorSections() {
  const sections = useRef(new Map<string, SectionSave>());
  const [state, setState] = useState({ dirty: false, busy: false });
  const register = useCallback<RegisterSection>((key, section) => {
    if (section) sections.current.set(key, section);
    else sections.current.delete(key);
    const all = [...sections.current.values()];
    const next = { dirty: all.some((s) => s.dirty), busy: all.some((s) => s.busy) };
    setState((current) =>
      current.dirty === next.dirty && current.busy === next.busy ? current : next,
    );
  }, []);
  const validate = () => {
    const problem = [...sections.current.values()].find((s) => s.dirty && s.problem)?.problem;
    if (problem) throw new Error(problem);
  };
  const save = async (): Promise<boolean> => {
    const pending = [...sections.current.values()].filter((s) => s.dirty);
    const problem = pending.find((s) => s.problem)?.problem;
    if (problem) throw new Error(problem);
    for (const section of pending) if (!(await section.save())) return false;
    return true;
  };
  return { ...state, register, save, validate };
}

export function useSectionSave(register: RegisterSection, key: string, section: SectionSave) {
  useLayoutEffect(() => register(key, section));
  useLayoutEffect(() => () => register(key, null), [register, key]);
}
