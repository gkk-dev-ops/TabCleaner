const DEBUG = true;
const DEBUG_VERBOSE = false;
const LOG_PREFIX = '[TabCleaner]';
const serviceWorkerLoadedAt = new Date().toISOString();

const diagnostics = {
  serviceWorkerLoadedAt,
  lastContextMenuSetupStatus: 'not_started',
  lastContextMenuError: null,
  lastBadgeUpdateStatus: 'not_started',
  currentDuplicateGroupCount: 0
};

function safeLog(method, args) {
  try {
    if (!DEBUG) return;
    const logger = console?.[method];
    if (typeof logger === 'function') logger(LOG_PREFIX, ...args);
  } catch (_error) {
    // Intentionally ignored so diagnostics never break extension behavior.
  }
}

function debugLog(...args) {
  safeLog('log', args);
}

function debugWarn(...args) {
  safeLog('warn', args);
}

function debugError(...args) {
  safeLog('error', args);
}

debugLog('Background service worker evaluated.', { serviceWorkerLoadedAt });

function isTabUrlEligible(url) {
  return typeof url === 'string' && url.length > 0 && !url.startsWith('chrome://');
}

function groupDuplicateTabs(tabs) {
  const groups = new Map();

  for (const tab of tabs) {
    if (!isTabUrlEligible(tab.url)) continue;
    if (!groups.has(tab.url)) groups.set(tab.url, []);
    groups.get(tab.url).push(tab);
  }

  return [...groups.values()].filter((group) => group.length > 1);
}

function choosePrimaryTab(group, preferredTabId = null) {
  if (typeof preferredTabId === 'number') {
    const preferred = group.find((tab) => tab.id === preferredTabId);
    if (preferred) return preferred;
  }

  const active = group.find((tab) => tab.active);
  if (active) return active;

  return group.reduce((oldest, current) => {
    if (typeof current.id !== 'number') return oldest;
    if (typeof oldest.id !== 'number') return current;
    return current.id < oldest.id ? current : oldest;
  }, group[0]);
}

function toGroupSummary(group, preferredTabId = null) {
  const primary = choosePrimaryTab(group, preferredTabId);
  const duplicates = group.filter((tab) => tab.id !== primary.id);

  return {
    url: group[0].url,
    title: group.find((tab) => tab.title)?.title || group[0].url,
    totalTabs: group.length,
    primaryTabId: primary.id,
    duplicateTabIds: duplicates.map((tab) => tab.id),
    windowId: primary.windowId,
    tabIds: group.map((tab) => tab.id)
  };
}

async function getDuplicateGroups() {
  const tabs = await chrome.tabs.query({});
  const eligibleTabs = tabs.filter((tab) => isTabUrlEligible(tab.url));
  const groups = groupDuplicateTabs(tabs).map((group) => toGroupSummary(group));
  diagnostics.currentDuplicateGroupCount = groups.length;

  const duplicateCount = groups.reduce((count, group) => count + group.duplicateTabIds.length, 0);
  debugLog('Duplicate scan complete.', {
    totalTabsScanned: tabs.length,
    eligibleTabs: eligibleTabs.length,
    duplicateGroupsFound: groups.length,
    duplicateCountForBadge: duplicateCount
  });
  if (DEBUG_VERBOSE) {
    debugLog('Duplicate group URLs.', groups.map((group) => group.url));
  }

  return groups;
}

async function getDuplicateGroupForTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!isTabUrlEligible(tab.url)) return null;

  const tabs = await chrome.tabs.query({});
  const group = tabs.filter((item) => item.url === tab.url);
  if (group.length < 2) return null;

  return toGroupSummary(group, tab.id);
}

async function updateBadge() {
  const groups = await getDuplicateGroups();
  const duplicateCount = groups.reduce((count, group) => count + group.duplicateTabIds.length, 0);
  await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  await chrome.action.setBadgeText({ text: duplicateCount > 0 ? String(duplicateCount) : '' });
  diagnostics.lastBadgeUpdateStatus = `ok:${duplicateCount}`;
  debugLog('Badge updated.', { duplicateCount });
}

async function closeDuplicates(groupUrls = null) {
  const groups = await getDuplicateGroups();
  const targetGroups = Array.isArray(groupUrls) && groupUrls.length > 0
    ? groups.filter((group) => groupUrls.includes(group.url))
    : groups;

  const tabIdsToClose = targetGroups.flatMap((group) => group.duplicateTabIds);
  if (tabIdsToClose.length > 0) await chrome.tabs.remove(tabIdsToClose);

  await updateBadge();
  return { closedCount: tabIdsToClose.length, groupCount: targetGroups.length };
}

async function closeDuplicatesForTab(tabId) {
  const group = await getDuplicateGroupForTab(tabId);
  if (!group) return { closedCount: 0, groupFound: false };

  if (group.duplicateTabIds.length > 0) {
    await chrome.tabs.remove(group.duplicateTabIds);
  }

  await updateBadge();
  return { closedCount: group.duplicateTabIds.length, groupFound: true };
}

async function highlightTabsByIds(tabIds) {
  debugLog('Highlight requested.', { tabIds });
  if (!Array.isArray(tabIds) || tabIds.length === 0) return { highlighted: false };

  const tabs = await chrome.tabs.query({});
  const selected = tabs.filter((tab) => tabIds.includes(tab.id));
  debugLog('Highlight selection resolved.', { tabsFound: selected.length });
  if (!selected.length) return { highlighted: false };

  const byWindow = new Map();
  for (const tab of selected) {
    if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, []);
    byWindow.get(tab.windowId).push(tab.index);
  }
  debugLog('Highlight window grouping.', { windowIds: [...byWindow.keys()] });

  for (const [windowId, indexes] of byWindow.entries()) {
    debugLog('Calling chrome.tabs.highlight.', { windowId, indexes });
    await chrome.tabs.highlight({ windowId, tabs: indexes });
  }

  debugLog('Highlight successful.', { tabCount: selected.length });
  return { highlighted: true, tabCount: selected.length };
}

async function highlightGroup(url) {
  const groups = await getDuplicateGroups();
  const group = groups.find((item) => item.url === url);
  if (!group) return { highlighted: false };
  return highlightTabsByIds(group.tabIds);
}

async function createContextMenus() {
  diagnostics.lastContextMenuSetupStatus = 'in_progress';
  diagnostics.lastContextMenuError = null;
  debugLog('Removing existing context menus.');
  await chrome.contextMenus.removeAll();
  debugLog('Existing context menus removed.');

  const parent = await createContextMenuItem({
    id: 'tabcleaner-parent',
    title: 'TabCleaner',
    contexts: ['tab']
  });

  const preview = await createContextMenuItem({
    id: 'tabcleaner-preview-duplicates',
    parentId: 'tabcleaner-parent',
    title: 'Preview duplicate tabs',
    contexts: ['tab']
  });

  const close = await createContextMenuItem({
    id: 'tabcleaner-close-duplicates',
    parentId: 'tabcleaner-parent',
    title: 'Close duplicate tabs',
    contexts: ['tab']
  });

  diagnostics.lastContextMenuSetupStatus = 'ok';
  debugLog('Context menu creation complete.', { ids: [parent, preview, close] });
}

function createContextMenuItem(item) {
  return new Promise((resolve, reject) => {
    debugLog('Creating context menu item.', { id: item.id, title: item.title, parentId: item.parentId || null });
    chrome.contextMenus.create(item, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        const error = new Error(`Context menu "${item.id}" failed: ${lastError.message}`);
        diagnostics.lastContextMenuSetupStatus = 'error';
        diagnostics.lastContextMenuError = error.message;
        debugError('Context menu creation failed.', { id: item.id, error: lastError.message });
        reject(error);
        return;
      }
      debugLog('Context menu item created.', { id: item.id });
      resolve(item.id);
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  debugLog('runtime.onInstalled fired.');
  createContextMenus().catch((error) => debugError('Failed to create context menus on install.', error));
  updateBadge().catch((error) => {
    diagnostics.lastBadgeUpdateStatus = `error:${error?.message || String(error)}`;
    debugError('Failed to update badge on install.', error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  debugLog('runtime.onStartup fired.');
  createContextMenus().catch((error) => debugError('Failed to create context menus on startup.', error));
  updateBadge().catch((error) => {
    diagnostics.lastBadgeUpdateStatus = `error:${error?.message || String(error)}`;
    debugError('Failed to update badge on startup.', error);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  (async () => {
    if (!tab?.id) return;

    if (info.menuItemId === 'tabcleaner-preview-duplicates') {
      const group = await getDuplicateGroupForTab(tab.id);
      if (!group) return;
      await highlightTabsByIds(group.tabIds);
      return;
    }

    if (info.menuItemId === 'tabcleaner-close-duplicates') {
      await closeDuplicatesForTab(tab.id);
    }
  })().catch((error) => debugError('Context menu click handler failed.', error));
});

chrome.tabs.onCreated.addListener(() => updateBadge().catch((error) => {
  diagnostics.lastBadgeUpdateStatus = `error:${error?.message || String(error)}`;
  debugError('Failed to update badge after tab creation.', error);
}));
chrome.tabs.onUpdated.addListener(() => updateBadge().catch((error) => {
  diagnostics.lastBadgeUpdateStatus = `error:${error?.message || String(error)}`;
  debugError('Failed to update badge after tab update.', error);
}));
chrome.tabs.onRemoved.addListener(() => updateBadge().catch((error) => {
  diagnostics.lastBadgeUpdateStatus = `error:${error?.message || String(error)}`;
  debugError('Failed to update badge after tab removal.', error);
}));

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  debugLog('Message received.', { type: message?.type || 'UNKNOWN' });
  (async () => {
    switch (message?.type) {
      case 'SCAN_DUPLICATES': {
        const groups = await getDuplicateGroups();
        await updateBadge();
        debugLog('Message success response.', { type: 'SCAN_DUPLICATES' });
        sendResponse({ ok: true, groups });
        break;
      }
      case 'CLOSE_DUPLICATES': {
        const result = await closeDuplicates(message.groupUrls);
        const groups = await getDuplicateGroups();
        debugLog('Message success response.', { type: 'CLOSE_DUPLICATES' });
        sendResponse({ ok: true, ...result, groups });
        break;
      }
      case 'HIGHLIGHT_GROUP': {
        const result = await highlightGroup(message.url);
        debugLog('Message success response.', { type: 'HIGHLIGHT_GROUP' });
        sendResponse({ ok: true, ...result });
        break;
      }
      case 'GET_DIAGNOSTICS': {
        debugLog('Message success response.', { type: 'GET_DIAGNOSTICS' });
        sendResponse({ ok: true, diagnostics });
        break;
      }
      default:
        debugWarn('Unknown message type.', { type: message?.type });
        sendResponse({ ok: false, error: 'Unknown message type.' });
    }
  })().catch((error) => {
    const errorMessage = error?.stack || error?.message || String(error);
    debugError('Message handling failed.', { type: message?.type || 'UNKNOWN', error: errorMessage });
    sendResponse({ ok: false, error: error?.message || String(error) });
  });

  return true;
});
