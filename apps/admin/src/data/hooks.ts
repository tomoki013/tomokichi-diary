import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { OperationInput, OperationName, OperationOutput } from "@tomokichi/contracts";
import { op } from "./client";
import { useToast } from "../ui/toast";

/**
 * Reads stay on screen while they refresh, and every write tells the reads
 * that may have changed. A write names areas (`"article"`, `"ads"`); every
 * read whose operation starts with one of them loads again.
 */
const listeners = new Set<(areas: readonly string[]) => void>();
export function invalidate(...areas: string[]): void {
  for (const listener of listeners) listener(areas);
}

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (update: (current: T | undefined) => T | undefined) => void;
}

/** Loads once per key; an answer to a question no longer asked is dropped. */
export function useResource<T>(
  load: () => Promise<T>,
  key: string,
  areas: readonly string[] = [],
): Resource<T> {
  const [state, setState] = useState<{ key: string; data?: T; error?: unknown; loading: boolean }>({
    key,
    loading: true,
  });
  const latest = useRef(load);
  useLayoutEffect(() => {
    latest.current = load;
  });
  const generation = useRef(0);
  const run = useCallback(async () => {
    generation.current += 1;
    const mine = generation.current;
    setState((current) =>
      current.key === key
        ? { ...current, error: undefined, loading: true }
        : { key, loading: true },
    );
    try {
      const data = await latest.current();
      if (mine === generation.current) setState({ key, data, loading: false });
    } catch (error) {
      if (mine === generation.current)
        setState((current) => ({ ...current, error, loading: false }));
    }
  }, [key]);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void run();
  }, [run]);
  const areaKey = areas.join(",");
  useEffect(() => {
    if (!areaKey) return;
    const wanted = areaKey.split(",");
    const listener = (changed: readonly string[]) => {
      if (changed.some((area) => wanted.some((want) => want.startsWith(area)))) void run();
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [areaKey, run]);
  const setData = useCallback(
    (update: (current: T | undefined) => T | undefined) =>
      setState((current) => ({ ...current, data: update(current.data) })),
    [],
  );
  return {
    data: state.key === key ? state.data : undefined,
    error: state.key === key ? state.error : undefined,
    loading: state.loading,
    reload: run,
    setData,
  };
}

/** One operation as a read, refreshed whenever a write touches its area. */
export function useOp<N extends OperationName>(
  name: N,
  input?: OperationInput<N>,
): Resource<OperationOutput<N>> {
  const key = `${name}:${JSON.stringify(input ?? {})}`;
  return useResource(
    () => (op as (n: N, i?: OperationInput<N>) => Promise<OperationOutput<N>>)(name, input),
    key,
    [name],
  );
}

/**
 * A write: busy while it runs, a toast either way, and the reads it touched
 * refreshed. Resolves to the result, or undefined when it failed.
 */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T>(
      label: string,
      action: () => Promise<T>,
      options: { done?: string; touches?: string[] } = {},
    ): Promise<T | undefined> => {
      setBusy(label);
      try {
        const result = await action();
        if (options.done) toast.info(options.done);
        if (options.touches?.length) invalidate(...options.touches);
        return result;
      } catch (error) {
        toast.error(error);
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { busy, run };
}

/** Warns before leaving with unsaved edits. */
export function useUnsavedWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    globalThis.addEventListener("beforeunload", warn);
    return () => globalThis.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

export function useTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} | Diary Admin` : "Diary Admin";
  }, [title]);
}
