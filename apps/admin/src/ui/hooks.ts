import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { parseRoute, type Route } from "../lib/route";

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  /** Fetches again, keeping the current data on screen until it arrives. */
  reload: () => Promise<void>;
  /** Local edits after a successful write, without a round trip. */
  setData: (update: (current: T | undefined) => T | undefined) => void;
}

/**
 * Loads once per `key` and ignores answers to a question no longer being
 * asked, so switching quickly between two tickets never shows the first one
 * under the second one's heading.
 */
export function useResource<T>(load: () => Promise<T>, key: string): Resource<T> {
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
    // A reload keeps what is on screen; a new key starts empty.
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
    // Fetching from the API is the "synchronise with an external system" case
    // effects exist for; the state it sets follows the response.
    // oxlint-disable-next-line react/set-state-in-effect
    void run();
  }, [run]);

  const setData = useCallback(
    (update: (current: T | undefined) => T | undefined) =>
      setState((current) => ({ ...current, data: update(current.data) })),
    [],
  );

  // Data from a previous key is never shown under the new one.
  const fresh = state.key === key;
  return {
    data: fresh ? state.data : undefined,
    error: fresh ? state.error : undefined,
    loading: !fresh || state.loading,
    reload: run,
    setData,
  };
}

export function useHashRoute(): Route {
  const [hash, setHash] = useState(() => globalThis.location.hash);
  useEffect(() => {
    const onChange = (): void => setHash(globalThis.location.hash);
    globalThis.addEventListener("hashchange", onChange);
    return () => globalThis.removeEventListener("hashchange", onChange);
  }, []);
  return parseRoute(hash);
}

/** Warns before leaving the page while there is unsaved work. */
export function useUnsavedWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => event.preventDefault();
    globalThis.addEventListener("beforeunload", onBeforeUnload);
    return () => globalThis.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}

/** Sets the tab title, so a row of admin tabs can be told apart. */
export function useTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} | Tomokichi Diary Admin`;
  }, [title]);
}

/** A fresh key per composed message, reused across retries of the same one. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
