const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const DEFAULT_SCHEDULE = DAYS.map(day => ({
  day,
  active: true,
  blocks: [
    { start: '09:00', end: '17:00' },
    { start: '00:00', end: '00:00' },
  ],
}));

// Migrate old single-block format { start, end } → { blocks: [...] }
function migrateSchedule(schedule) {
  return schedule.map(entry => {
    if (entry.blocks) return entry;
    return {
      day: entry.day,
      active: entry.active,
      blocks: [
        { start: entry.start || '09:00', end: entry.end || '17:00' },
        { start: '00:00', end: '00:00' },
      ],
    };
  });
}

function renderScheduleTable(schedule) {
  const tbody = document.querySelector('#schedule-table tbody');
  tbody.innerHTML = '';

  schedule.forEach((entry, i) => {
    const [b0, b1] = entry.blocks;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${entry.day}</td>
      <td>
        <input type="text" class="time-input" data-i="${i}" data-block="0" data-field="start" value="${b0.start}" placeholder="09:30" maxlength="5" />
        <input type="text" class="time-input" data-i="${i}" data-block="0" data-field="end"   value="${b0.end}"   placeholder="12:00" maxlength="5" />
      </td>
      <td class="block2-cell">
        <input type="text" class="time-input" data-i="${i}" data-block="1" data-field="start" value="${b1.start}" placeholder="13:00" maxlength="5" />
        <input type="text" class="time-input" data-i="${i}" data-block="1" data-field="end"   value="${b1.end}"   placeholder="18:00" maxlength="5" />
        <button class="clear-block2" data-i="${i}" title="Clear Block 2">&#x2715;</button>
      </td>
      <td><input type="checkbox" data-i="${i}" data-field="active" ${entry.active ? 'checked' : ''} /></td>
    `;
    tr.querySelector('.clear-block2').addEventListener('click', () => {
      tr.querySelectorAll('[data-block="1"]').forEach(input => {
        input.value = '00:00';
        input.style.borderColor = '';
      });
    });
    tbody.appendChild(tr);
  });
}

function readScheduleFromForm(schedule) {
  document.querySelectorAll('#schedule-table input[data-block]').forEach(input => {
    const i     = Number(input.dataset.i);
    const block = Number(input.dataset.block);
    const field = input.dataset.field;
    schedule[i].blocks[block][field] = input.value;
  });
  document.querySelectorAll('#schedule-table input[type="checkbox"]').forEach(input => {
    const i = Number(input.dataset.i);
    schedule[i].active = input.checked;
  });
  return schedule;
}

function setStatus(el, text, type) {
  el.textContent = text;
  el.className = `status ${type}`;
}

async function checkActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isBamboo = tab?.url?.includes('bamboohr.com');
  const btn = document.getElementById('open-preview');
  const status = document.getElementById('page-status');

  btn.disabled = !isBamboo;
  if (!isBamboo) {
    setStatus(status, 'Navigate to a BambooHR page to enable filling.', 'error');
  } else {
    setStatus(status, 'BambooHR page detected.', 'success');
  }
}

async function init() {
  const { schedule: raw = DEFAULT_SCHEDULE } = await chrome.storage.local.get('schedule');
  const schedule = migrateSchedule(raw);
  renderScheduleTable(schedule);
  await checkActiveTab();

  document.getElementById('save-schedule').addEventListener('click', async () => {
    const invalid = [...document.querySelectorAll('input.time-input')]
      .filter(i => i.value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(i.value));

    if (invalid.length) {
      invalid.forEach(i => i.style.borderColor = '#e74c3c');
      setStatus(document.getElementById('save-status'), 'Invalid time — use HH:MM (e.g. 09:30)', 'error');
      return;
    }

    document.querySelectorAll('input.time-input').forEach(i => i.style.borderColor = '');
    const updated = readScheduleFromForm(schedule.map(e => ({
      ...e,
      blocks: e.blocks.map(b => ({ ...b })),
    })));
    await chrome.storage.local.set({ schedule: updated });
    setStatus(document.getElementById('save-status'), 'Saved!', 'success');
  });

  document.getElementById('open-preview').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { type: 'OPEN_PREVIEW' });
    window.close();
  });
}

init();
