(function () {
    "use strict";

    const Utils = window.OptionsAssistantUtils;
    const Selectors = window.OptionsSiteSelectors;

    const refs = {
        settingsForm: document.getElementById("settingsForm"),
        siteAdapterList: document.getElementById("siteAdapterList"),
        resetDefaultsBtn: document.getElementById("resetDefaultsBtn"),
        saveStatus: document.getElementById("saveStatus")
    };

    init().catch(renderError);

    function init() {
        bindEvents();
        renderSiteAdapters();
        return loadSettingsIntoForm();
    }

    function bindEvents() {
        refs.settingsForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                const state = await Utils.loadState();
                state.settings = Utils.mergeSettings(readSettingsFromForm());
                await Utils.saveState(state);
                await sendAction(Utils.ACTIONS.SETTINGS_UPDATED, { settings: state.settings });
                refs.saveStatus.textContent = `Saved at ${Utils.formatDateTime(new Date().toISOString())}.`;
            } catch (error) {
                renderError(error);
            }
        });

        refs.resetDefaultsBtn.addEventListener("click", () => {
            populateForm(Utils.DEFAULT_SETTINGS);
            refs.saveStatus.textContent = "Defaults restored in the form. Save to apply them.";
        });
    }

    async function loadSettingsIntoForm() {
        const state = await Utils.loadState();
        populateForm(state.settings);
    }

    function populateForm(settings) {
        Object.keys(Utils.DEFAULT_SETTINGS).forEach((key) => {
            const element = document.getElementById(key);
            if (!element) {
                return;
            }
            if (element.type === "checkbox") {
                element.checked = Boolean(settings[key]);
                return;
            }
            element.value = settings[key];
        });

        const enabled = Array.isArray(settings.enabledSiteAdapters) ? settings.enabledSiteAdapters : Utils.DEFAULT_SETTINGS.enabledSiteAdapters;
        document.querySelectorAll("[data-adapter-id]").forEach((checkbox) => {
            checkbox.checked = enabled.includes(checkbox.getAttribute("data-adapter-id"));
        });
    }

    function readSettingsFromForm() {
        const next = {};
        Object.keys(Utils.DEFAULT_SETTINGS).forEach((key) => {
            const element = document.getElementById(key);
            if (!element) {
                return;
            }
            next[key] = element.type === "checkbox"
                ? element.checked
                : Number(element.value);
        });

        next.enabledSiteAdapters = Array.from(document.querySelectorAll("[data-adapter-id]"))
            .filter((checkbox) => checkbox.checked)
            .map((checkbox) => checkbox.getAttribute("data-adapter-id"));
        return next;
    }

    function renderSiteAdapters() {
        refs.siteAdapterList.innerHTML = Selectors.SITE_ADAPTERS.map((adapter) => `
            <label class="summary-item">
                <input type="checkbox" data-adapter-id="${escapeHtml(adapter.id)}">
                ${escapeHtml(adapter.name)}
            </label>
        `).join("");
    }

    function sendAction(action, payload) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(Object.assign({ action: action }, payload || {}), (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!response || !response.ok) {
                    reject(new Error(response && response.error ? response.error : "Unknown background error"));
                    return;
                }
                resolve(response.payload);
            });
        });
    }

    function renderError(error) {
        refs.saveStatus.textContent = error instanceof Error ? error.message : String(error);
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
})();
