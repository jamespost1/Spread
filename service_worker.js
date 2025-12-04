// service_worker.js
// Handles messages from content scripts. In future it will call AI/optimizer APIs.

chrome.runtime.onInstalled.addListener(() => {
  console.log("SuperShopper extension installed.");
});

// Simple message handler pattern we'll use later
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OPTIMIZE_DISCOUNTS") {
    // In the future: call remote optimizer API and return result.
    // For now return empty discounts.
    sendResponse({ discounts: [], bestTotal: null });
  }
  // Returning true allows async response later if needed
  return true;
});
