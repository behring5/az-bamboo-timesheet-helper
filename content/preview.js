// ---------------------------------------------------------------------------
// Preview overlay — injected into the BambooHR page before submission
// ---------------------------------------------------------------------------

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Show the preview modal.
 * @param {object[]} newEntries   - entries ready to submit
 * @param {Set}      existingDates - dates already filled (shown as skipped)
 * @param {Set}      holidayDates  - dates detected as holiday/vacation
 * @returns {Promise<object[]|null>} - resolves with final entries to submit, or null if cancelled
 */
function showPreview(newEntries, existingDates, holidayDates) {
	return new Promise((resolve) => {
		injectStyles();

		// Build a combined row list for display
		const allDates = [...new Set([...[...existingDates], ...[...holidayDates], ...newEntries.map((e) => e.date)])].sort();

		const backdrop = document.createElement('div');
		backdrop.id = 'bhr-helper-backdrop';
		backdrop.innerHTML = buildModalHTML(newEntries, existingDates, holidayDates, allDates);
		document.body.appendChild(backdrop);

		const modal = backdrop.querySelector('#bhr-helper-modal');
		const submitBtn = modal.querySelector('#bhr-submit');
		const cancelBtn = modal.querySelector('#bhr-cancel');
		const closeBtn = modal.querySelector('.bhr-modal-close');
		const progressEl = modal.querySelector('.bhr-progress');

		function close(result) {
			backdrop.remove();
			resolve(result);
		}

		cancelBtn.addEventListener('click', () => close(null));
		closeBtn.addEventListener('click', () => close(null));
		backdrop.addEventListener('click', (e) => {
			if (e.target === backdrop) close(null);
		});

		submitBtn.addEventListener('click', async () => {
			const entries = collectEditedEntries(modal, newEntries);
			if (!entries.length) {
				close(null);
				return;
			}

			submitBtn.disabled = true;
			cancelBtn.disabled = true;
			closeBtn.disabled = true;

			await runSubmission(entries, modal, progressEl);
			cancelBtn.textContent = 'Close';
			cancelBtn.disabled = false;
			cancelBtn.addEventListener('click', () => close(null), { once: true });
		});
	});
}

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

function buildModalHTML(newEntries, existingDates, holidayDates, allDates) {
	const newCount = newEntries.length;
	const skipCount = existingDates.size;
	const holidayCount = holidayDates.size;

	const rows = allDates
		.map((date) => {
			const isHoliday = holidayDates.has(date);
			const isExisting = existingDates.has(date);
			const dayEntries = newEntries.filter((e) => e.date === date);

			const dow = new Date(date + 'T12:00:00').getDay();
			const dayName = DAY_NAMES[dow];
			const [, month, day] = date.split('-');
			const label = `${dayName} ${parseInt(day)} ${monthName(parseInt(month))}`;

			if (isHoliday) {
				return `<tr class="bhr-row--holiday" data-date="${date}" data-skip="true">
        <td><span class="bhr-status-dot bhr-status-dot--holiday" title="Holiday/Vacation"></span></td>
        <td>${label}</td>
        <td colspan="3" style="color:#c0392b;font-size:11px;">Holiday / Vacation — skipped</td>
      </tr>`;
			}

			if (isExisting) {
				return `<tr class="bhr-row--skip" data-date="${date}" data-skip="true">
        <td><span class="bhr-status-dot bhr-status-dot--skip" title="Already filled"></span></td>
        <td>${label}</td>
        <td colspan="3" style="font-size:11px;">Already filled — skipped</td>
      </tr>`;
			}

			// One row per block; date label only on the first row
			return dayEntries
				.map((entry, blockIndex) => {
					const globalIndex = newEntries.indexOf(entry);
					const dateCell = blockIndex === 0 ? `<td rowspan="${dayEntries.length}">${label}</td>` : '';
					const checkCell = blockIndex === 0 ? `<td rowspan="${dayEntries.length}"><input type="checkbox" class="bhr-row-check" checked title="Include this day" /></td>` : '';

					return `<tr data-date="${date}" data-index="${globalIndex}" ${blockIndex > 0 ? 'data-continuation="true"' : ''}>
        ${checkCell}
        ${dateCell}
        <td><input type="text" class="bhr-start" value="${entry.start}" maxlength="5" /></td>
        <td><input type="text" class="bhr-end"   value="${entry.end}"   maxlength="5" /></td>
        <td class="bhr-row-status"></td>
      </tr>`;
				})
				.join('');
		})
		.join('');

	return `
    <div id="bhr-helper-modal">
      <div class="bhr-modal-header">
        <h1>Timesheet Preview</h1>
        <button class="bhr-modal-close" title="Cancel">&#x2715;</button>
      </div>
      <div class="bhr-summary">
        <span><span class="bhr-badge bhr-badge--new">${newCount}</span> to submit</span>
        <span><span class="bhr-badge bhr-badge--skip">${skipCount}</span> already filled</span>
        <span><span class="bhr-badge bhr-badge--holiday">${holidayCount}</span> holidays / vacation</span>
      </div>
      <div class="bhr-table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width:32px"></th>
              <th>Date</th>
              <th>Start</th>
              <th>End</th>
              <th style="width:24px"></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="bhr-modal-footer">
        <span class="bhr-progress"></span>
        <button class="bhr-btn bhr-btn--secondary" id="bhr-cancel">Cancel</button>
        <button class="bhr-btn bhr-btn--primary"   id="bhr-submit">
          Submit ${newCount} ${newCount === 1 ? 'entry' : 'entries'}
        </button>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Read edited values back from the table
// ---------------------------------------------------------------------------

function collectEditedEntries(modal, originalEntries) {
	const entries = [];
	const uncheckedDates = new Set();

	// Collect unchecked dates first (checkbox lives on first row only)
	modal.querySelectorAll('tbody tr[data-index]:not([data-continuation])').forEach((row) => {
		if (!row.querySelector('.bhr-row-check')?.checked) {
			uncheckedDates.add(row.dataset.date);
		}
	});

	modal.querySelectorAll('tbody tr[data-index]').forEach((row) => {
		if (uncheckedDates.has(row.dataset.date)) return;

		const idx = Number(row.dataset.index);
		const start = row.querySelector('.bhr-start').value;
		const end = row.querySelector('.bhr-end').value;

		entries.push({ ...originalEntries[idx], start, end });
	});
	return entries;
}

// ---------------------------------------------------------------------------
// Submission with per-row status feedback
// ---------------------------------------------------------------------------

async function runSubmission(entries, modal, progressEl) {
	let done = 0;

	for (const entry of entries) {
		const row = modal.querySelector(`tr[data-date="${entry.date}"]`);
		const statusCell = row?.querySelector('.bhr-row-status');

		if (statusCell) statusCell.innerHTML = '<span class="bhr-status-dot bhr-status-dot--pending" title="Submitting…"></span>';

		try {
			await postEntries([entry]);
			if (statusCell) statusCell.innerHTML = '<span class="bhr-status-dot bhr-status-dot--success" title="Submitted"></span>';
		} catch (err) {
			console.error('[BambooHelper] Failed:', entry.date, err.message);
			if (statusCell) statusCell.innerHTML = '<span class="bhr-status-dot bhr-status-dot--fail" title="' + err.message + '"></span>';
		}

		done++;
		progressEl.textContent = `Submitting… ${done} / ${entries.length}`;
	}

	progressEl.textContent = `Done! Reloading page…`;
	setTimeout(() => location.reload(), 1500);
}

// ---------------------------------------------------------------------------
// Inject the stylesheet once
// ---------------------------------------------------------------------------

function injectStyles() {
	if (document.getElementById('bhr-helper-styles')) return;
	const link = document.createElement('link');
	link.id = 'bhr-helper-styles';
	link.rel = 'stylesheet';
	//   link.href = chrome.runtime.getURL('content/preview.css');
	link.href = chrome.runtime.getURL('content/style.css');
	document.head.appendChild(link);
}

function monthName(m) {
	return ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m];
}
