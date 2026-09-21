/**
 * True when a global keyboard shortcut should be ignored because the user is
 * typing into a field. Defaults to the currently focused element, which is what
 * window-level keydown handlers want.
 */
export function isTypingTarget(el: EventTarget | null = document.activeElement): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
}
