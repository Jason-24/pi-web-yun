export const CLIPBOARD_FAILURE_EVENT = "pi-web:clipboard-failure";

/** Resolve only when the browser confirms the copy, without exposing text in the failure event. */
export async function copyText(text: string): Promise<void> {
  let ta: HTMLTextAreaElement | null = null;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    if (!document.execCommand("copy")) throw new Error("Clipboard copy failed");
  } catch (error) {
    window.dispatchEvent(new Event(CLIPBOARD_FAILURE_EVENT));
    throw error;
  } finally {
    ta?.remove();
  }
}
