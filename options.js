document.addEventListener("DOMContentLoaded", () => {
  const googleAPIKeyInput = document.getElementById("googleAPIKey");
  const googleSearchEngineIdInput = document.getElementById("googleSearchEngineId");
  const enableAPICallsInput = document.getElementById("enableAPICalls");
  const status = document.getElementById("status");

  chrome.storage.sync.get(
    { 
      googleAPIKey: '',
      googleSearchEngineId: '',
      enableAPICalls: true
    },
    (settings) => {
      googleAPIKeyInput.value = settings.googleAPIKey || '';
      googleSearchEngineIdInput.value = settings.googleSearchEngineId || '';
      enableAPICallsInput.checked = settings.enableAPICalls !== false;
    }
  );

  document.getElementById("save").addEventListener("click", () => {
    const googleAPIKey = googleAPIKeyInput.value.trim();
    const googleSearchEngineId = googleSearchEngineIdInput.value.trim();
    const enableAPICalls = enableAPICallsInput.checked;

    chrome.storage.sync.set({ 
      googleAPIKey,
      googleSearchEngineId,
      enableAPICalls
    }, () => {
      status.textContent = "Settings saved.";
      status.style.color = "#4caf50";
      setTimeout(() => {
        status.textContent = "";
        status.style.color = "";
      }, 2000);
    });
  });
});
