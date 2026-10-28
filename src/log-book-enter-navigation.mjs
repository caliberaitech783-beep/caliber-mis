// An untouched row is an entry placeholder, not a trip to submit or count.
export const isEmptyTripPlaceholder = row => !String(row.equipmentName ?? '').trim() &&
  !row.loadingTime && !row.unloadingTime && Number(row.tripCount) === 1;

export function focusNextLogBookField(input, form) {
  if (!form) return;
  const fields = [...form.querySelectorAll('input, select, textarea, button[data-enter-action]')].filter(field =>
    !field.matches(':disabled') && !field.readOnly && field.type !== 'hidden' && field.tabIndex >= 0 &&
    field.getClientRects().length && !field.closest('[data-enter-skip="true"]')
  ).sort((a,b)=>Number(a.closest('[data-enter-order]')?.dataset?.enterOrder??999)-Number(b.closest('[data-enter-order]')?.dataset?.enterOrder??999));
  const index = fields.indexOf(input);
  if (index >= 0) fields[index + 1]?.focus();
}

export function advanceLogBookField(event) {
  // Keep arrow selection in the focused native dropdown, so Enter can reliably
  // commit and advance instead of being swallowed by a platform popup.
  if (['ArrowDown', 'ArrowUp'].includes(event.key) && event.target.tagName === 'SELECT' &&
      !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    const input = event.target;
    const options = [...input.options];
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    let next = input.selectedIndex + direction;
    while (next >= 0 && next < options.length && (options[next].disabled || options[next].parentElement?.disabled)) next += direction;
    event.preventDefault();
    if (next >= 0 && next < options.length) {
      input.selectedIndex = next;
      input.dispatchEvent(new input.ownerDocument.defaultView.Event('change', {bubbles: true}));
    }
    return;
  }
  if (event.key !== 'Enter' || event.isComposing || event.nativeEvent?.isComposing || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  const input = event.target;
  if (!input.matches('input, select, textarea') || input.readOnly) return;
  const combobox = input.getAttribute('role') === 'combobox';
  // Employee lookup and the final trip cell perform their own Enter actions.
  if (event.defaultPrevented && !combobox) return;
  event.preventDefault();
  if (event.repeat) return;
  const form = event.currentTarget;
  if (input.dataset.enterEmptyTrip === 'true') {
    form.querySelector('[data-enter-action="save"]')?.focus();
    return;
  }
  if (combobox && input.getAttribute('aria-expanded') === 'true') {
    const list = form.ownerDocument.getElementById(input.getAttribute('aria-controls'));
    const choices = [...(list?.querySelectorAll('[role="option"]') || [])];
    const selected = choices.find(option => option.getAttribute('aria-selected') === 'true');
    const label = selected?.querySelector('strong')?.textContent || selected?.textContent;
    const active = input.getAttribute('aria-activedescendant');
    // A highlighted/unique choice is committed by the dropdown's own handler.
    // Without one, keep focus when the user still needs to choose an option.
    if (!active && choices.length !== 1 && input.value.trim() !== label?.trim()) return;
  }
  requestAnimationFrame(() => {
    if (input.isConnected === false) return;
    if (!input.checkValidity()) { input.reportValidity(); return; }
    focusNextLogBookField(input, form);
  });
}

export function advanceEquipmentLogBookField(event) {
  if (event.key !== 'Enter' || event.isComposing || event.nativeEvent?.isComposing || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  const input = event.target;
  if (!input.matches('input, select, textarea') || input.readOnly) return;
  const combobox = input.getAttribute('role') === 'combobox';
  // Employee lookup and the final trip cell have their own Enter actions.
  if (event.defaultPrevented && !combobox) return;
  if (input.tagName === 'SELECT' && ['shiftHours', 'shiftId'].includes(input.name)) {
    if (typeof input.showPicker === 'function') {
      event.preventDefault();
      if (!event.repeat) input.showPicker();
    }
    // Keep native keyboard selection when showPicker is unavailable.
    return;
  }
  event.preventDefault();
  if (event.repeat) return;
  const form = event.currentTarget;
  requestAnimationFrame(() => {
    // Let dropdowns commit an active selection, then advance even if left empty.
    focusNextLogBookField(input, form);
  });
}
