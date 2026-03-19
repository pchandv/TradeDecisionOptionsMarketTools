(function marketPulsePwa() {
    function getInstallButton() {
        return document.getElementById("installAppBtn");
    }

    function isStandaloneDisplay() {
        return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    }

    function setInstallButtonState({ hidden = false, disabled = false, text = "Install App" } = {}) {
        const button = getInstallButton();
        if (!button) {
            return;
        }

        button.hidden = hidden;
        button.disabled = disabled;
        button.textContent = text;
    }

    async function registerServiceWorker() {
        if (!("serviceWorker" in navigator) || window.location.protocol === "file:") {
            return;
        }

        try {
            const serviceWorkerUrl = new URL("./sw.js", window.location.href);
            const scopeUrl = new URL("./", window.location.href);
            const registration = await navigator.serviceWorker.register(serviceWorkerUrl.href, {
                scope: scopeUrl.href
            });

            if (navigator.onLine) {
                registration.update().catch(() => {
                    // Ignore update errors so the app still runs.
                });
            }
        } catch (error) {
            // Ignore registration failures so the app still works as a normal web page.
        }
    }

    function setupInstallPrompt() {
        const button = getInstallButton();
        if (!button) {
            return;
        }

        if (window.location.protocol === "file:" || isStandaloneDisplay()) {
            setInstallButtonState({ hidden: true });
            return;
        }

        let deferredPrompt = null;
        setInstallButtonState({ hidden: true });

        window.addEventListener("beforeinstallprompt", (event) => {
            event.preventDefault();
            deferredPrompt = event;
            setInstallButtonState({ hidden: false, disabled: false, text: "Install App" });
        });

        button.addEventListener("click", async () => {
            if (!deferredPrompt) {
                return;
            }

            deferredPrompt.prompt();
            await deferredPrompt.userChoice;
            deferredPrompt = null;
            setInstallButtonState({ hidden: true });
        });

        window.addEventListener("appinstalled", () => {
            deferredPrompt = null;
            setInstallButtonState({ hidden: true });
        });
    }

    window.addEventListener("DOMContentLoaded", () => {
        registerServiceWorker();
        setupInstallPrompt();
    });
})();
