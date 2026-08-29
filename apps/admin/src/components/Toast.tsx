export interface ToastMessage {
  tone: "info" | "error";
  text: string;
}

export function Toast({ message }: { message: ToastMessage }) {
  return (
    <output className={`toast ${message.tone === "error" ? "error" : ""}`} aria-live="polite">
      {message.text}
    </output>
  );
}
