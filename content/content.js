// Entry point — dates.js, bamboo-api.js and preview.js are loaded before this file

const DEFAULT_TRACKING_ID = 1;

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'OPEN_PREVIEW') handleOpenPreview();
});

async function handleOpenPreview() {
  const employeeId = detectEmployeeId();
  if (!employeeId) {
    alert('[BambooHelper] Could not detect your employee ID.\nPlease open a BambooHR timesheet page first.');
    return;
  }

  const { schedule, trackingId = DEFAULT_TRACKING_ID } =
    await chrome.storage.local.get(['schedule', 'trackingId']);

  if (!schedule) {
    alert('[BambooHelper] No schedule saved yet. Open the extension popup and save your weekly schedule first.');
    return;
  }

  try {
    await waitForPayPeriod();
  } catch (e) {
    alert('[BambooHelper] Timed out waiting for the timesheet to load.\nPlease make sure the timesheet page is fully loaded and try again.');
    return;
  }

  const workingDays = getLastMonthWorkingDays();

  if (!workingDays.length) {
    alert('[BambooHelper] Could not determine the pay period dates.\nMake sure the timesheet for the correct month is visible on the page.');
    return;
  }

  const [targetYear, targetMonth] = workingDays[0].split('-').map(Number);

  const holidayDates = getSkippableDatesFromDOM(targetYear, targetMonth);
  if (holidayDates.size) {
    console.log('[BambooHelper] Skipping holidays/vacation:', [...holidayDates]);
  }

  const allEntries = buildEntries(workingDays, schedule, employeeId, trackingId);

  const existingDates = getFilledDatesFromDOM(targetYear, targetMonth);

  const newEntries = allEntries.filter(e =>
    !existingDates.has(e.date) && !holidayDates.has(e.date)
  );

  await showPreview(newEntries, existingDates, holidayDates);
}

console.log('[BambooHelper] content script loaded on', location.hostname);
