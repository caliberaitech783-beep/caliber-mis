const calendarField = 'input:is([type="date"], [type="datetime-local"], [type="month"], [type="week"], [type="time"])';

export function openCalendarPicker(event, input) {
  if (event.defaultPrevented || !input || input.readOnly || input.matches(':disabled') || typeof input.showPicker !== 'function') return;
  try {
    input.showPicker();
    event.preventDefault();
  } catch {
    // Let the browser handle clicks when it cannot open the picker programmatically.
  }
}

export function enableCalendarFieldClicks(root) {
  root.addEventListener('click', event => {
    if (event.target.matches?.(calendarField)) openCalendarPicker(event, event.target);
  });
}
