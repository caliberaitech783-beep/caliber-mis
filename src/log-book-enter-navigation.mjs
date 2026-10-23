export function advanceLogBookField(event) {
  if (event.key !== 'Enter' || event.isComposing || event.nativeEvent?.isComposing || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  const input = event.target;
  if (!input.matches('input, select, textarea') || input.readOnly) return;
  const combobox = input.getAttribute('role') === 'combobox';
  // Employee lookup and the final trip cell have their own Enter actions.
  if (event.defaultPrevented && !combobox) return;
  event.preventDefault();
  if (event.repeat) return;
  const form = event.currentTarget;
  requestAnimationFrame(() => {
    // Let a searchable dropdown commit its selection before moving on.
    if (combobox && input.getAttribute('aria-expanded') === 'true') return;
    const fields = [...form.querySelectorAll('input, select, textarea')].filter(field =>
      !field.matches(':disabled') && !field.readOnly && field.type !== 'hidden' && field.tabIndex >= 0 && field.getClientRects().length
    );
    const index = fields.indexOf(input);
    if (index >= 0) fields.slice(index + 1).find(field => !field.closest('[data-enter-skip="true"]'))?.focus();
  });
}
