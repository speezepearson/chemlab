/**
 * Whether a key press is meant for a field the player is typing in (a text box, a text area, a dropdown, or
 * anything editable) rather than the bench. A checkbox, slider or button keeps the focus after it's clicked but
 * takes no typing, so it doesn't count: the bench's keys still work after ticking god mode.
 */
export function typingIn(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  const NOT_TYPED = ['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file'];
  return t instanceof HTMLInputElement && !NOT_TYPED.includes(t.type);
}
