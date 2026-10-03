(() => {
    const STORAGE_KEY = "hiking-sensor-hikes";

    function getHikes() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return [];
        const hikes = JSON.parse(stored);
        if (!Array.isArray(hikes)) throw new Error("Saved hike data has an invalid format.");
        return hikes;
    }

    function saveHike(hike) {
        const hikes = getHikes();
        hikes.unshift(hike);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(hikes));
    }

    function getHike(id) {
        return getHikes().find((hike) => hike.id === id);
    }

    window.HikeStore = { getHikes, saveHike, getHike };
})();
