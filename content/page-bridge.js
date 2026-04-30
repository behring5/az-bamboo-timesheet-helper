// Runs in the MAIN world — has access to page globals like window.Employee
// Writes values into the DOM so the isolated content scripts can read them.
(function () {
  const meta = document.createElement('meta');
  meta.name = 'bhr-helper-bridge';
  meta.dataset.employeeId = window.Employee?.id ?? '';
  meta.dataset.csrfToken  = window.CSRF_TOKEN   ?? '';
  document.head.appendChild(meta);
})();
