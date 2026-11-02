export const CLIPBOARD_FAILURE_EVENT = "pi-web:clipboard-failure";

/** Resolve only when the browser confirms the copy, without exposing text in the failure event. */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    try {
      ta.select();
      if (!document.execCommand("copy")) throw new Error("Clipboard copy failed");
    } finally {
      ta.remove();
    }
  } catch (error) {
    window.dispatchEvent(new Event(CLIPBOARD_FAILURE_EVENT));
    throw error;
  }
}
