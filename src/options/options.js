// Settings page. Deliberately small: Spread requires no configuration to work.

const DEFAULT_API_BASE = 'https://spread-api.workers.dev';

document.addEventListener('DOMContentLoaded', async () => {
  if (new URLSearchParams(location.search).has('welcome')) {
    document.getElementById('welcome').hidden = false;
  }

  const apiBaseInput = document.getElementById('api-base');
  const { apiBase } = await chrome.storage.local.get('apiBase');
  if (apiBase && apiBase !== DEFAULT_API_BASE) apiBaseInput.value = apiBase;

  document.getElementById('save').addEventListener('click', async () => {
    const value = apiBaseInput.value.trim();
    const status = document.getElementById('save-status');

    if (value && !isValidHttpsUrl(value)) {
      show(status, 'Enter a valid https:// URL, or leave it blank.', false);
      return;
    }

    await chrome.storage.local.set({ apiBase: value || DEFAULT_API_BASE });
    show(status, 'Saved.', true);
  });

  document.getElementById('clear-stats').addEventListener('click', async () => {
    await chrome.storage.local.remove('stats');
    show(document.getElementById('stats-status'), 'Stats cleared.', true);
  });
});

function isValidHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function show(node, message, ok) {
  node.textContent = message;
  node.className = `status ${ok ? 'is-ok' : 'is-error'}`;
  setTimeout(() => {
    node.textContent = '';
    node.className = 'status';
  }, 2600);
}
