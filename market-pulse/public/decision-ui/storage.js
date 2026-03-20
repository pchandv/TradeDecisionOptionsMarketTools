export function readStorageJson(key, fallback = null) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        return fallback;
    }
}

export function writeStorageJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

export function removeStorageKey(key) {
    localStorage.removeItem(key);
}
