import { useId, type ReactNode } from "react";
import { describeError } from "../data/client";
import type { Tone } from "../lib/article-state";

/** The small set of pieces every screen is built from. */

export function Page({
  title,
  back,
  actions,
  children,
}: {
  title: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="page">
      <header className="page__head">
        {back && (
          <a className="page__back" href={back.href}>
            ← {back.label}
          </a>
        )}
        <div className="page__title">
          <h1>{title}</h1>
          {actions && <div className="page__actions">{actions}</div>}
        </div>
      </header>
      {children}
    </section>
  );
}

/** A titled block. `collapsible` folds it on first view: most edits never open it. */
export function Panel({
  title,
  hint,
  actions,
  collapsible,
  open,
  onOpen,
  id,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onOpen?: () => void;
  id?: string;
  children: ReactNode;
}) {
  const head = (
    <>
      <h2>{title}</h2>
      {hint && <span className="panel__hint">{hint}</span>}
      {actions && <span className="panel__actions">{actions}</span>}
    </>
  );
  if (collapsible)
    return (
      <details
        className="panel"
        id={id}
        open={open}
        onToggle={(event) => {
          if (event.currentTarget.open) onOpen?.();
        }}
      >
        <summary className="panel__head">{head}</summary>
        <div className="panel__body">{children}</div>
      </details>
    );
  return (
    <section className="panel" id={id}>
      <div className="panel__head">{head}</div>
      <div className="panel__body">{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  kind = "secondary",
  busy,
  disabled,
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "primary" | "secondary" | "quiet" | "danger";
  busy?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  return (
    <button
      type={type}
      className={`button button--${kind}`}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      title={title}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  kind = "secondary",
}: {
  href: string;
  children: ReactNode;
  kind?: "primary" | "secondary" | "quiet";
}) {
  return (
    <a className={`button button--${kind}`} href={href}>
      {children}
    </a>
  );
}

export function Field({
  label,
  hint,
  children,
  count,
  max,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
  count?: number;
  max?: number;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
        {count !== undefined && (
          <span className={`field__count${max !== undefined && count > max ? " is-over" : ""}`}>
            {count}
            {max !== undefined ? ` / ${max}` : ""}
          </span>
        )}
      </label>
      {children(id)}
      {hint && <p className="field__hint">{hint}</p>}
    </div>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  hint,
  max,
  placeholder,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  max?: number;
  placeholder?: string;
  type?: "text" | "url" | "date" | "datetime-local" | "number" | "search" | "password";
  required?: boolean;
}) {
  return (
    <Field label={label} hint={hint} count={max ? value.length : undefined} max={max}>
      {(id) => (
        <input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  hint,
  max,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  max?: number;
  rows?: number;
}) {
  return (
    <Field label={label} hint={hint} count={max ? value.length : undefined} max={max}>
      {(id) => (
        <textarea
          id={id}
          rows={rows}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Field label={label}>
      {(id) => (
        <select id={id} value={value} onChange={(event) => onChange(event.target.value as T)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function Check({
  label,
  checked,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

/** Many-of choices as tappable chips, wrapped to the width. */
export function Chips({
  options,
  selected,
  onToggle,
}: {
  options: readonly { value: string; label: string }[];
  selected: readonly string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="chips">
      {options.map((option) => {
        const on = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            className={`chip${on ? " is-on" : ""}`}
            aria-pressed={on}
            onClick={() => onToggle(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

/** A row in a list: the main line, a quiet second line, and what sits on the right. */
export function Row({
  href,
  title,
  meta,
  aside,
  onClick,
}: {
  href?: string;
  title: ReactNode;
  meta?: ReactNode;
  aside?: ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="row__main">
        <span className="row__title">{title}</span>
        {meta && <span className="row__meta">{meta}</span>}
      </span>
      {aside && <span className="row__aside">{aside}</span>}
    </>
  );
  if (href)
    return (
      <li>
        <a className="row" href={href}>
          {body}
        </a>
      </li>
    );
  if (onClick)
    return (
      <li>
        <button type="button" className="row" onClick={onClick}>
          {body}
        </button>
      </li>
    );
  return (
    <li>
      <div className="row">{body}</div>
    </li>
  );
}

export function Rows({ children }: { children: ReactNode }) {
  return <ul className="rows">{children}</ul>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <p>{describeError(error)}</p>
      {onRetry && <Button onClick={onRetry}>再読み込み</Button>}
    </div>
  );
}

export function Skeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="読み込み中">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="skeleton__line" />
      ))}
    </div>
  );
}

/** Loading, failure and data, in that order, for one read. */
export function Loaded<T>({
  resource,
  lines,
  children,
}: {
  resource: { data: T | undefined; error: unknown; reload: () => Promise<void> };
  lines?: number;
  children: (data: T) => ReactNode;
}) {
  if (resource.data !== undefined) return <>{children(resource.data)}</>;
  if (resource.error)
    return <ErrorBox error={resource.error} onRetry={() => void resource.reload()} />;
  return <Skeleton lines={lines} />;
}

/** Tabs that are just buttons: the content beneath belongs to the caller. */
export function Tabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={`tab${option.value === value ? " is-on" : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && <span className="tab__count">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Asks before something hard to take back. A native dialog: works the same on a phone. */
export function confirmed(message: string): boolean {
  return globalThis.confirm?.(message) ?? false;
}
