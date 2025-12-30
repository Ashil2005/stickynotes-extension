/* 
  popup.js:
  Responsible for handling user interactions within the popup.
  - Communicates with content.js to trigger "Add Note" mode.
  - Saves user preferences (e.g., default color) to chrome.storage.
*/

document.addEventListener('DOMContentLoaded', () => {
  const addNoteBtn = document.getElementById('add-note-btn');
  const colorCircles = document.querySelectorAll('.color-circle');
  const focusModeToggle = document.getElementById('focus-mode-toggle');
  let selectedColor = '#fff740'; // Default yellow

  // Initialize Toggle State
  chrome.storage.local.get('focusMode', (data) => {
    if (data.focusMode) {
      focusModeToggle.checked = true;
    }
  });

  // Handle Focus Mode Toggle
  focusModeToggle.addEventListener('change', async () => {
    const isEnabled = focusModeToggle.checked;

    // Save state
    await chrome.storage.local.set({ focusMode: isEnabled });

    // Send message to active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      // Ideally we should ensure content script is there, but for toggle usually it is if page is open.
      // We can wrap in try-catch to avoid errors if extension is not running on valid page.
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'TOGGLE_FOCUS_MODE',
          enabled: isEnabled
        });
      } catch (e) {
        console.log('Could not send message to tab (probably restricted or not loaded):', e);
      }
    }
  });

  // Handle color selection
  colorCircles.forEach(circle => {
    circle.addEventListener('click', () => {
      // Update UI
      colorCircles.forEach(c => c.classList.remove('active'));
      circle.classList.add('active');

      // Update state
      selectedColor = circle.getAttribute('data-color');
    });
  });

  // Handle Add Note button
  addNoteBtn.addEventListener('click', async () => {
    try {
      const selectedFont = document.getElementById('font-select').value;

      // Get the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.id) {
        console.error('No active tab found.');
        return;
      }

      // Skip restricted browser pages
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('https://chrome.google.com/webstore')) {
        console.warn('StickyNotes cannot be added to this page.');
        alert('StickyNotes cannot be added to this system or store page.');
        return;
      }

      // Ensure content script is injected before sending message
      // Critical for PDF tabs where content scripts might not auto-inject reliably on some reloads
      await ensureContentScript(tab.id);

      // Send message to content script
      chrome.tabs.sendMessage(tab.id, {
        action: 'INIT_NOTE_PLACEMENT',
        color: selectedColor,
        font: selectedFont
      });

      // Close popup to let user interact with the page
      window.close();
    } catch (error) {
      console.error('Failed to initialize note placement:', error);
    }
  });

  /**
   * Helper to ensure content.js is running in the tab.
   * Pings the tab first; if it fails, injects the script manually.
   */
  async function ensureContentScript(tabId) {
    try {
      // Ping the content script to see if it's already there
      await chrome.tabs.sendMessage(tabId, { action: 'PING' });
    } catch (e) {
      // If ping fails, the content script is likely not injected.
      console.log('Content script not found (or unresponsive). Injecting...', e);

      // Inject CSS first to ensure no specific FOUC
      await chrome.scripting.insertCSS({
        target: { tabId: tabId },
        files: ['styles.css']
      });

      // Inject content script
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });
    }
  }

  console.log('Popup script initialized.');
});
