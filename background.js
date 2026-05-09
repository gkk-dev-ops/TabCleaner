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
  return groupDuplicateTabs(tabs).map((group) => toGroupSummary(group));
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
  if (!Array.isArray(tabIds) || tabIds.length === 0) return { highlighted: false };

  const tabs = await chrome.tabs.query({});
  const selected = tabs.filter((tab) => tabIds.includes(tab.id));
  if (!selected.length) return { highlighted: false };

  const byWindow = new Map();
  for (const tab of selected) {
    if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, []);
    byWindow.get(tab.windowId).push(tab.index);
  }

  for (const [windowId, indexes] of byWindow.entries()) {
    await chrome.tabs.highlight({ windowId, tabs: indexes });
  }

  return { highlighted: true, tabCount: selected.length };
}

async function highlightGroup(url) {
  const groups = await getDuplicateGroups();
  const group = groups.find((item) => item.url === url);
  if (!group) return { highlighted: false };
  return highlightTabsByIds(group.tabIds);
}

async function createContextMenus() {
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: 'tabcleaner-parent',
    title: 'TabCleaner',
    contexts: ['tab']
  });

  chrome.contextMenus.create({
    id: 'tabcleaner-preview-duplicates',
    parentId: 'tabcleaner-parent',
    title: 'Preview duplicate tabs',
    contexts: ['tab']
  });

  chrome.contextMenus.create({
    id: 'tabcleaner-close-duplicates',
    parentId: 'tabcleaner-parent',
    title: 'Close duplicate tabs',
    contexts: ['tab']
  });
}

chrome.runtime.onInstalled.addListener(() => {
  createContextMenus().catch(() => {});
  updateBadge().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenus().catch(() => {});
  updateBadge().catch(() => {});
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
  })().catch(() => {});
});

chrome.tabs.onCreated.addListener(() => updateBadge().catch(() => {}));
chrome.tabs.onUpdated.addListener(() => updateBadge().catch(() => {}));
chrome.tabs.onRemoved.addListener(() => updateBadge().catch(() => {}));

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'SCAN_DUPLICATES': {
        const groups = await getDuplicateGroups();
        await updateBadge();
        sendResponse({ ok: true, groups });
        break;
      }
      case 'CLOSE_DUPLICATES': {
        const result = await closeDuplicates(message.groupUrls);
        const groups = await getDuplicateGroups();
        sendResponse({ ok: true, ...result, groups });
        break;
      }
      case 'HIGHLIGHT_GROUP': {
        const result = await highlightGroup(message.url);
        sendResponse({ ok: true, ...result });
        break;
      }
      default:
        sendResponse({ ok: false, error: 'Unknown message type.' });
    }
  })().catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));

  return true;
});
