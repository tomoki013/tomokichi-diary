/**
 * Copies text, falling back to a hidden selection where the async clipboard
 * is refused (embedded browsers, some permission settings).
 */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall through to the selection-based copy.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  try {
    // Deprecated but still the only fallback that works without permission.
    if (!document.execCommand("copy")) throw new Error("クリップボードにコピーできませんでした");
  } finally {
    area.remove();
  }
}
