import { applyCachedTheme, loadSavedTheme, saveTheme } from "./theme.js";

const darkModeToggle = document.getElementById("darkModeToggle");
const importRulesBtn = document.getElementById("importRulesBtn");
const exportRulesBtn = document.getElementById("exportRulesBtn");
const resetExtensionBtn = document.getElementById("resetExtensionBtn");

applyCachedTheme();

const getStoredRules = async () => {
  const { rules = [] } = await chrome?.storage?.local?.get?.(["rules"]);
  return Array.isArray(rules) ? rules : [];
};

const updateExportButtonState = async () => {
  if (!exportRulesBtn) return;
  const rules = await getStoredRules();
  exportRulesBtn.disabled = rules.length === 0;
};

const init = async () => {
  const theme = await loadSavedTheme();
  if (darkModeToggle) {
    darkModeToggle.checked = theme === "dark";
  }
  await updateExportButtonState();
};

if (darkModeToggle) {
  darkModeToggle.addEventListener("change", async (event) => {
    const next = event.target.checked ? "dark" : "light";
    await saveTheme(next);
  });
}

if (exportRulesBtn) {
  exportRulesBtn.addEventListener("click", async () => {
    try {
      const rules = await getStoredRules();
      if (rules.length === 0) {
        await updateExportButtonState();
        return;
      }
      const exportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        rules,
      };
      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      link.href = downloadUrl;
      link.download = `code-injector-rules-${timestamp}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error("Failed to export rules:", error);
      alert("Failed to export rules. Please try again.");
    }
  });
}

if (importRulesBtn) {
  importRulesBtn.addEventListener("click", async () => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json,application/json";
    fileInput.style.display = "none";

    fileInput.addEventListener("change", async (event) => {
      const selectedFile = event.target.files?.[0];
      if (!selectedFile) {
        fileInput.remove();
        return;
      }
      try {
        const rawContent = await selectedFile.text();
        const parsed = JSON.parse(rawContent);
        const importedRules = parsed?.rules;
        if (!Array.isArray(importedRules)) {
          throw new Error("Invalid backup format.");
        }
        await chrome?.storage?.local?.set?.({ rules: importedRules });
        await updateExportButtonState();
        alert(`Imported ${importedRules.length} rule(s) successfully.`);
      } catch (error) {
        console.error("Failed to import rules:", error);
        alert("Failed to import rules. Please use a valid backup JSON file.");
      } finally {
        fileInput.remove();
      }
    });

    document.body.append(fileInput);
    fileInput.click();
  });
}

if (resetExtensionBtn) {
  resetExtensionBtn.addEventListener("click", async () => {
    const confirmed = confirm("Delete ALL rules? This cannot be undone.");
    if (!confirmed) return;
    try {
      await chrome?.storage?.local?.set?.({ rules: [] });
      await updateExportButtonState();
      alert("All rules have been deleted.");
    } catch (error) {
      console.error("Failed to delete all rules:", error);
      alert("Failed to delete rules. Please try again.");
    }
  });
}

document.addEventListener("DOMContentLoaded", init);


