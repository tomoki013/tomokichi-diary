import type { ReactNode } from "react";
import { describeError } from "../lib/api";

/** Placeholder rows shaped like what is coming, instead of a spinner. */
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skeleton-list" aria-busy="true" aria-label="読み込み中">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton skeleton--row" />
      ))}
    </div>
  );
}

export function SkeletonBlock({ height = "8rem" }: { height?: string }) {
  return <div className="skeleton" style={{ height }} aria-busy="true" aria-label="読み込み中" />;
}

export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        <h1>{title}</h1>
        {meta && <div className="page-header__meta">{meta}</div>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel${className ? ` ${className}` : ""}`}>
      {(title || actions) && (
        <div className="panel__head">
          {title && <h2>{title}</h2>}
          {actions && <div className="panel__actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="state state--error" role="alert">
      <p>{describeError(error)}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          再読み込み
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="state">{children}</p>;
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "accent" | "ok" | "warn" | "danger";
  children: ReactNode;
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
