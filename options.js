document.addEventListener("DOMContentLoaded", () => {
  const taxRateInput = document.getElementById("taxRate");
  const defaultShippingInput = document.getElementById("defaultShipping");
  const taxOnShipping = document.getElementById("taxOnShipping");
  const googleAPIKeyInput = document.getElementById("googleAPIKey");
  const googleSearchEngineIdInput = document.getElementById("googleSearchEngineId");
  const enableAPICallsInput = document.getElementById("enableAPICalls");
  const status = document.getElementById("status");

  chrome.storage.sync.get(
    { 
      taxRate: 0.08875, 
      defaultShipping: 0, 
      taxOnShipping: true,
      googleAPIKey: '',
      googleSearchEngineId: '',
      enableAPICalls: true
    },
    (settings) => {
      taxRateInput.value = settings.taxRate;
      defaultShippingInput.value = settings.defaultShipping;
      taxOnShipping.checked = settings.taxOnShipping;
      googleAPIKeyInput.value = settings.googleAPIKey || '';
      googleSearchEngineIdInput.value = settings.googleSearchEngineId || '';
      enableAPICallsInput.checked = settings.enableAPICalls !== false;
    }
  );

  document.getElementById("save").addEventListener("click", () => {
    const taxRate = parseFloat(taxRateInput.value) || 0;
    const defaultShipping = parseFloat(defaultShippingInput.value) || 0;
    const taxOnShip = taxOnShipping.checked;
    const googleAPIKey = googleAPIKeyInput.value.trim();
    const googleSearchEngineId = googleSearchEngineIdInput.value.trim();
    const enableAPICalls = enableAPICallsInput.checked;

    chrome.storage.sync.set({ 
      taxRate, 
      defaultShipping, 
      taxOnShipping: taxOnShip,
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
