/**
 * Scans the BambooHR timesheet DOM for days that have a clockPush indicator
 * (public holidays, vacation, sick days, etc.) and returns them as a Set
 * of "YYYY-MM-DD" strings to skip.
 *
 * The slat shows "Mar 30" without a year, so we infer the year from the
 * target month we're processing.
 */
function getSkippableDatesFromDOM(targetYear, targetMonth) {
  const skip = new Set();
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  document.querySelectorAll('.TimesheetSlat__extraInfoItem--clockPush').forEach(el => {
    const slat = el.closest('.TimesheetSlat');
    if (!slat) return;

    const dayDateEl = slat.querySelector('.TimesheetSlat__dayDate');
    if (!dayDateEl) return;

    // Text is like "Mar 30" or "Apr 1"
    const [monStr, dayStr] = dayDateEl.textContent.trim().split(' ');
    const monthIndex = MONTHS.indexOf(monStr); // 0-based
    if (monthIndex === -1 || !dayStr) return;

    // The timesheet may show days from adjacent months — only keep the target month
    if (monthIndex !== targetMonth - 1) return;

    const date = new Date(targetYear, monthIndex, Number(dayStr));
    skip.add(formatDate(date));
  });

  return skip;
}

/**
 * Waits until the "Pay Period Begins" span is present in the DOM.
 * Resolves immediately if already there, otherwise uses MutationObserver.
 * Rejects after 10 seconds.
 */
function waitForPayPeriod() {
  return new Promise((resolve, reject) => {
    const check = () => Array.from(document.querySelectorAll('span'))
      .find(s => s.textContent.trim() === 'Pay Period Begins');

    if (check()) { resolve(); return; }

    const observer = new MutationObserver(() => {
      if (check()) { observer.disconnect(); resolve(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => { observer.disconnect(); reject(new Error('Timed out waiting for pay period')); }, 10000);
  });
}

/**
 * Reads the pay period start and end dates from the BambooHR timesheet DOM.
 * Returns { start: Date, end: Date } or null if not found.
 */
function getPayPeriodFromDOM() {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function extractDate(labelText) {
    const span = Array.from(document.querySelectorAll('span'))
      .find(s => s.textContent.trim() === labelText);
    if (!span) return null;

    const slat = span.closest('.TimesheetSlat');
    const dayDateEl = slat?.querySelector('.TimesheetSlat__dayDate');
    if (!dayDateEl) return null;

    const [monStr, dayStr] = dayDateEl.textContent.trim().split(' ');
    const monthIndex = MONTHS.indexOf(monStr);
    if (monthIndex === -1) return null;

    const year = new Date().getFullYear();
    return new Date(year, monthIndex, Number(dayStr));
  }

  const start = extractDate('Pay Period Begins');
  const end   = extractDate('Pay Period Ends');
  if (!start || !end) return null;
  // "Pay Period Ends" is the first day of the next period — exclude it
  end.setDate(end.getDate() - 1);
  return { start, end };
}

/**
 * Returns every working day (Mon–Fri) within the current pay period
 * as an array of "YYYY-MM-DD" strings.
 * Falls back to last calendar month if the pay period markers are not found.
 */
function getLastMonthWorkingDays() {
  const period = getPayPeriodFromDOM();

  let from, to;
  if (period) {
    from = period.start;
    to   = period.end;
  } else {
    // Fallback: previous calendar month
    const now   = new Date();
    const year  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const month = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-based
    from = new Date(year, month - 1, 1);
    to   = new Date(year, month, 0);
  }

  const days = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) days.push(formatDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Builds the entries array from working days + the user's schedule template.
 * schedule: [{ day: 'Monday', active: bool, start: 'HH:MM', end: 'HH:MM' }, ...]
 */
function buildEntries(workingDays, schedule, employeeId, trackingId) {
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const entries = [];

  for (const dateStr of workingDays) {
    const dow = new Date(dateStr + 'T12:00:00').getDay();
    const rule = schedule.find(s => s.day === DAY_NAMES[dow]);
    if (!rule || !rule.active) continue;

    // Support both old { start, end } and new { blocks: [...] } formats
    const blocks = rule.blocks
      ? rule.blocks.filter(b => b.start && b.end && b.start !== '00:00' && b.end !== '00:00')
      : [{ start: rule.start, end: rule.end }];

    for (const block of blocks) {
      entries.push({
        id: null,
        trackingId,
        employeeId,
        date: dateStr,
        start: block.start,
        end: block.end,
        note: '',
        projectId: null,
        taskId: null,
        breakId: null,
      });
    }
  }

  return entries;
}
