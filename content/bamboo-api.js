// ---------------------------------------------------------------------------
// BambooHR API client — runs inside the content script (user's session active)
// ---------------------------------------------------------------------------

/**
 * Extracts the company subdomain from the current page hostname.
 * e.g. "azerion.bamboohr.com" → "azerion"
 */
function getCompany() {
  return location.hostname.split('.')[0];
}

/**
 * BambooHR embeds employee context in a global JS object.
 * Try several known locations before falling back to null.
 */
function detectEmployeeId() {
  // Read from the MAIN-world bridge (page-bridge.js writes this)
  const bridge = document.querySelector('meta[name="bhr-helper-bridge"]');
  if (bridge?.dataset.employeeId) return Number(bridge.dataset.employeeId);
  return null;
}

/**
 * BambooHR uses a CSRF token sent as a request header.
 * It is typically available in a cookie named "CSRF-Token" or "BambooCSRF",
 * or embedded in a <meta name="csrf-token"> tag.
 */
function getCsrfToken() {
  // Read from the MAIN-world bridge (page-bridge.js writes this)
  const bridge = document.querySelector('meta[name="bhr-helper-bridge"]');
  if (bridge?.dataset.csrfToken) return bridge.dataset.csrfToken;
  return null;
}

/**
 * Scans the DOM for days that already have time entries recorded.
 * A filled slat contains at least one .TimeEntry element.
 * Returns a Set of "YYYY-MM-DD" strings.
 */
function getFilledDatesFromDOM(targetYear, targetMonth) {
  const filled = new Set();
  document.querySelectorAll('.TimesheetSlat').forEach(slat => {
    if (!slat.querySelector('.TimeEntry')) return;

    const dayDateEl = slat.querySelector('.TimesheetSlat__dayDate');
    if (!dayDateEl) return;

    const [monStr, dayStr] = dayDateEl.textContent.trim().split(' ');
    const monthIndex = MONTH_INDEX[monStr] ?? -1;
    if (monthIndex === -1 || monthIndex !== targetMonth - 1) return;

    filled.add(formatDate(new Date(targetYear, monthIndex, Number(dayStr))));
  });

  return filled;
}

/**
 * POST a batch of entries to BambooHR.
 * Returns the parsed JSON response.
 */
async function postEntries(entries) {
  const company = getCompany();
  const url = `https://${company}.bamboohr.com/timesheet/clock/entries`;
  const csrf = getCsrfToken();

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ entries }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST entries failed (${res.status}): ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

