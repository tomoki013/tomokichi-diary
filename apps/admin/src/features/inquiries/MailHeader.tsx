import { useId, useState, type ReactNode } from "react";

/** A bare address, as the platform takes it. */
export const isAddress = (text: string) => /^[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]+$/.test(text);

/** Splits what was typed or pasted ("a@x, b@y" or "名前 <a@x>") into addresses. */
export function addressesIn(text: string): string[] {
  return text
    .split(/[,;\s]+/)
    .map((part) => part.replace(/^.*<|>$/g, "").trim())
    .filter(Boolean);
}

/** One header line of a mail: a label on the left, the value on the right. */
export function HeaderRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="mail-header__row">
      {htmlFor ? (
        <label className="mail-header__label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="mail-header__label">{label}</span>
      )}
      <div className="mail-header__value">{children}</div>
    </div>
  );
}

/**
 * Addresses as removable chips with a box to add more, like a mail client's
 * To and Cc lines. Enter, a comma or leaving the box adds what was typed.
 */
export function AddressField({
  label,
  value,
  onChange,
  max,
  readOnly,
  placeholder = "アドレスを追加",
}: {
  label: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
  max: number;
  readOnly?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const add = (text: string) => {
    const found = addressesIn(text);
    if (found.length === 0) return;
    const bad = found.filter((address) => !isAddress(address));
    const next = [...value];
    for (const address of found.filter(isAddress))
      if (!next.some((known) => known.toLowerCase() === address.toLowerCase())) next.push(address);
    if (next.length > max) {
      setProblem(`${label}は${max}件までです`);
      return;
    }
    onChange(next);
    setDraft(bad.join(", "));
    setProblem(bad.length > 0 ? `アドレスの形ではありません: ${bad.join(", ")}` : null);
  };

  return (
    <HeaderRow label={label} htmlFor={readOnly ? undefined : id}>
      <div className="mail-header__addresses">
        {value.map((address) => (
          <span key={address} className="address-chip">
            {address}
            {!readOnly && (
              <button
                type="button"
                aria-label={`${address} を${label}から外す`}
                onClick={() => onChange(value.filter((item) => item !== address))}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {readOnly && value.length === 0 && <span className="muted">なし</span>}
        {!readOnly && (
          <input
            id={id}
            type="email"
            inputMode="email"
            autoComplete="off"
            value={draft}
            placeholder={placeholder}
            onChange={(event) => {
              const text = event.target.value;
              if (/[,;]\s*$/.test(text)) add(text);
              else setDraft(text);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add(draft);
              } else if (event.key === "Backspace" && !draft && value.length > 0) {
                onChange(value.slice(0, -1));
              }
            }}
            onBlur={() => add(draft)}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text");
              if (!/[,;\s<]/.test(text.trim())) return;
              event.preventDefault();
              add(`${draft} ${text}`);
            }}
          />
        )}
      </div>
      {problem && (
        <p className="field__hint" role="alert">
          {problem}
        </p>
      )}
    </HeaderRow>
  );
}

/** Two lists hold the same addresses in the same order, ignoring case. */
export const sameAddresses = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((address, i) => address.toLowerCase() === b[i]!.toLowerCase());
