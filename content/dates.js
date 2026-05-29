/**
 * Scans the BambooHR timesheet DOM for days that have a clockPush indicator
 * (public holidays, vacation, sick days, etc.) and returns them as a Set
 * of "YYYY-MM-DD" strings to skip.
 */
function getSkippableDatesFromDOM(targetYear, targetMonth) {
  const skip = new Set();
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  document.querySelectorAll('.TimesheetSlat__extraInfoItem--clockPush').forEach(el => {
    const slat = el.closest('.TimesheetSlat');
    if (!slat) return;

    const dayDateEl = slat.querySelector('.TimesheetSlat__dayDate');
    if (!dayDateEl) return;

    const [monStr, dayStr] = dayDateEl.textContent.trim().split(' ');
    const monthIndex = MONTHS.indexOf(monStr);
    if (monthIndex === -1 || !dayStr) return;

    if (monthIndex !== targetMonth - 1) return;

    const date = new Date(targetYear, monthIndex, Number(dayStr));
    skip.add(formatDate(date));
  });

  return skip;
}

/**
 * Waits until at least one "Pay Period Begins" span is present in the DOM.
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
 * Extracts a Date from the TimesheetSlat that contains a span with the given
 * label text (e.g. "Pay Period Begins"). Returns null if not found.
 *
 * The slat shows the month as a short name ("Jan", "Feb", …) without a year,
 * so we derive the year by assuming the date is within ±6 months of today —
 * this handles year boundaries correctly (e.g. a December slat read in January).
 */
function extractSlatDate(labelText) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const span = Array.from(document.querySelectorAll('span'))
    .find(s => s.textContent.trim() === labelText);
  if (!span) return null;

  const slat = span.closest('.TimesheetSlat');
  const dayDateEl = slat?.querySelector('.TimesheetSlat__dayDate');
  if (!dayDateEl) return null;

  const [monStr, dayStr] = dayDateEl.textContent.trim().split(' ');
  const monthIndex = MONTHS.indexOf(monStr);
  if (monthIndex === -1 || !dayStr) return null;

  return inferYear(monthIndex, Number(dayStr));
}

/**
 * Collects ALL "Pay Period Begins" spans from the DOM and returns an array of
 * { start: Date, end: Date } objects sorted ascending by start date.
 *
 * BambooHR renders every pay period on the page at once — we need all of them
 * so we can pick the one that matches the period currently in view.
 */
function getAllPayPeriods() {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const periods = [];

  const allSpans = Array.from(document.querySelectorAll('span'));

  const beginsSpans = allSpans.filter(s => s.textContent.trim() === 'Pay Period Begins');
  const endsSpans   = allSpans.filter(s => s.textContent.trim() === 'Pay Period Ends');

  function dateFromSlat(span) {
    const slat = span.closest('.TimesheetSlat');
    const dayDateEl = slat?.querySelector('.TimesheetSlat__dayDate');
    if (!dayDateEl) return null;

    const [monStr, dayStr] = dayDateEl.textContent.trim().split(' ');
    const monthIndex = MONTHS.indexOf(monStr);
    if (monthIndex === -1 || !dayStr) return null;

    return inferYear(monthIndex, Number(dayStr));
  }

  // Pair each "Begins" with the nearest "Ends" that comes after it in DOM order.
  // We use the DOM position (compareDocumentPosition) to find the right partner.
  for (const beginsSpan of beginsSpans) {
    const start = dateFromSlat(beginsSpan);
    if (!start) continue;

    // Find the first "Ends" span that appears after this "Begins" span in the DOM
    const endsSpan = endsSpans.find(e =>
      beginsSpan.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING
    );

    let end = endsSpan ? dateFromSlat(endsSpan) : null;
    if (!end) continue;

    // "Pay Period Ends" slat is the first day of the NEXT period — step back one day
    end = new Date(end);
    end.setDate(end.getDate() - 1);

    periods.push({ start, end });
  }

  periods.sort((a, b) => a.start - b.start);
  return periods;
}

/**
 * Picks the best-matching pay period for the currently viewed timesheet:
 *
 *  1. A period whose range contains today → the user is mid-period.
 *  2. The most recent period that ended before today → the user is viewing a
 *     completed period (e.g. last workday of the month, or a past month).
 *
 * Returns { start: Date, end: Date } or null if no periods were found.
 */
function getPayPeriodFromDOM() {
  const periods = getAllPayPeriods();
  if (!periods.length) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1. Period that contains today
  const current = periods.find(p => p.start <= today && today <= p.end);
  if (current) return current;

  // 2. Most recent period that already ended
  const past = periods.filter(p => p.end < today);
  if (past.length) return past[past.length - 1];

  // 3. Earliest future period (shouldn't happen in practice)
  return periods[0];
}

/**
 * Returns every working day (Mon–Fri) within the best-matching pay period
 * as an array of "YYYY-MM-DD" strings.
 * Falls back to the current calendar month if no pay period markers are found.
 */
function getLastMonthWorkingDays() {
  const period = getPayPeriodFromDOM();

  let from, to;
  if (period) {
    from = period.start;
    to   = period.end;
  } else {
    // Fallback: current calendar month
    const now = new Date();
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
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

/**
 * Given a 0-based month index and a day number, returns a Date with the most
 * plausible year — whichever of (currentYear-1, currentYear, currentYear+1)
 * puts the date within 6 months of today.
 */
function inferYear(monthIndex, day) {
  const today = new Date();
  const currentYear = today.getFullYear();

  for (const year of [currentYear, currentYear - 1, currentYear + 1]) {
    const candidate = new Date(year, monthIndex, day);
    const diffMs = Math.abs(today - candidate);
    if (diffMs < 6 * 30 * 24 * 60 * 60 * 1000) return candidate; // within ~6 months
  }

  // Last resort: use current year
  return new Date(currentYear, monthIndex, day);
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
