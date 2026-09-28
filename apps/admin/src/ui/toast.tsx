import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { describeError } from "../lib/api";

interface ToastMessage {
  id: number;
  tone: "info" | "error";
  text: string;
}

interface Toaster {
  info(text: string): void;
  error(error: unknown): void;
}

const ToastContext = createContext<Toaster | null>(null);

/** One toast at a time: the newest replaces the last, so they never stack up. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const counter = useRef(0);

  const show = useCallback((tone: ToastMessage["tone"], text: string) => {
    counter.current += 1;
    setMessage({ id: counter.current, tone, text });
    clearTimeout(timer.current);
    // Errors stay long enough to read and copy.
    timer.current = setTimeout(() => setMessage(null), tone === "error" ? 8000 : 2500);
  }, []);

  const toaster = useMemo<Toaster>(
    () => ({
      info: (text) => show("info", text),
      error: (error) => show("error", describeError(error)),
    }),
    [show],
  );

  return (
    <ToastContext value={toaster}>
      {children}
      <div className="toast-region" aria-live="polite">
        {message && (
          <output key={message.id} className={`toast toast--${message.tone}`}>
            {message.text}
            <button
              type="button"
              className="toast__close"
              aria-label="閉じる"
              onClick={() => setMessage(null)}
            >
              ×
            </button>
          </output>
        )}
      </div>
    </ToastContext>
  );
}

export function useToast(): Toaster {
  const toaster = useContext(ToastContext);
  if (!toaster) throw new Error("useToast outside ToastProvider");
  return toaster;
}
