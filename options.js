document.addEventListener("DOMContentLoaded", () => {
  const taxRateInput = document.getElementById("taxRate");
  const defaultShippingInput = document.getElementById("defaultShipping");
  const taxOnShipping = document.getElementById("taxOnShipping");
  const status = document.getElementById("status");

  chrome.storage.sync.get(
    { taxRate: 0.08875, defaultShipping: 0, taxOnShipping: true },
    (settings) => {
      taxRateInput.value = settings.taxRate;
      defaultShippingInput.value = settings.defaultShipping;
      taxOnShipping.checked = settings.taxOnShipping;
    }
  );

  document.getElementById("save").addEventListener("click", () => {
    const taxRate = parseFloat(taxRateInput.value) || 0;
    const defaultShipping = parseFloat(defaultShippingInput.value) || 0;
    const taxOnShip = taxOnShipping.checked;

    chrome.storage.sync.set({ taxRate, defaultShipping, taxOnShipping: taxOnShip }, () => {
      status.textContent = "Saved.";
      setTimeout(() => (status.textContent = ""), 1500);
    });
  });
});
