const groupsList = document.getElementById('groupsList');
const closeAllButton = document.getElementById('closeAllButton');
const scanButton = document.getElementById('scanButton');
const feedback = document.getElementById('feedback');
const diagnostics = document.getElementById('diagnostics');
const diagnosticsButton = document.getElementById('diagnosticsButton');

function setFeedback(message, isError = false) {
  feedback.textContent = message;
  feedback.classList.toggle('error', isError);
}

function setDiagnostics(message, isError = false) {
  diagnostics.textContent = message;
  diagnostics.classList.toggle('error', isError);
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || 'Unknown extension error.'));
        return;
      }

      resolve(response);
    });
  });
}

function truncate(value, max = 60) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

function createGroupItem(group) {
  const item = document.createElement('li');
  item.className = 'group';

  const title = document.createElement('h2');
  title.className = 'group-title';
  title.title = group.url;
  title.textContent = truncate(group.title || group.url);

  const count = document.createElement('div');
  count.className = 'group-count';
  count.textContent = `${group.totalTabs} tabs (${group.duplicateTabIds.length} duplicates)`;

  const actions = document.createElement('div');
  actions.className = 'group-actions';

  const closeButton = document.createElement('button');
  closeButton.className = 'secondary';
  closeButton.textContent = 'Close duplicates';
  closeButton.addEventListener('click', async () => {
    try {
      const response = await sendMessage({ type: 'CLOSE_DUPLICATES', groupUrls: [group.url] });
      setFeedback(`Closed ${response.closedCount} duplicate tab(s).`);
      renderGroups(response.groups);
    } catch (error) {
      setFeedback(error.message, true);
    }
  });

  const reviewButton = document.createElement('button');
  reviewButton.className = 'secondary';
  reviewButton.textContent = 'Review tabs';
  reviewButton.addEventListener('click', async () => {
    try {
      const response = await sendMessage({ type: 'HIGHLIGHT_GROUP', url: group.url });
      if (response.highlighted) {
        setFeedback(`Highlighted ${response.tabCount} tab(s).`);
      } else {
        setFeedback('No tabs to highlight.', true);
      }
    } catch (error) {
      setFeedback(error.message, true);
    }
  });

  actions.append(closeButton, reviewButton);
  item.append(title, count, actions);
  return item;
}

function renderGroups(groups) {
  groupsList.innerHTML = '';

  if (!groups.length) {
    const empty = document.createElement('li');
    empty.className = 'group';
    empty.textContent = 'No duplicate tabs found.';
    groupsList.append(empty);
    return;
  }

  for (const group of groups) {
    groupsList.append(createGroupItem(group));
  }
}

async function scan() {
  try {
    const response = await sendMessage({ type: 'SCAN_DUPLICATES' });
    renderGroups(response.groups);
    const totalDupes = response.groups.reduce((count, group) => count + group.duplicateTabIds.length, 0);
    setFeedback(totalDupes > 0 ? `${totalDupes} duplicate tab(s) found.` : 'All clean.');
  } catch (error) {
    setFeedback(error.message, true);
  }
}

async function loadDiagnostics() {
  try {
    const response = await sendMessage({ type: 'GET_DIAGNOSTICS' });
    const state = response.diagnostics;
    setDiagnostics(
      [
        `SW loaded: ${state.serviceWorkerLoadedAt}`,
        `Menus: ${state.lastContextMenuSetupStatus}`,
        `Menu error: ${state.lastContextMenuError || 'none'}`,
        `Badge: ${state.lastBadgeUpdateStatus}`,
        `Duplicate groups: ${state.currentDuplicateGroupCount}`
      ].join(' | ')
    );
  } catch (error) {
    setDiagnostics(`Diagnostics unavailable: ${error.message}`, true);
  }
}

closeAllButton.addEventListener('click', async () => {
  try {
    const response = await sendMessage({ type: 'CLOSE_DUPLICATES' });
    renderGroups(response.groups);
    setFeedback(`Closed ${response.closedCount} duplicate tab(s).`);
  } catch (error) {
    setFeedback(error.message, true);
  }
});

scanButton.addEventListener('click', scan);
diagnosticsButton.addEventListener('click', loadDiagnostics);

scan();
loadDiagnostics();
