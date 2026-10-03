(() => {
    const hikeId = new URLSearchParams(window.location.search).get("id");
    const name = document.getElementById("detail-name");
    const message = document.getElementById("detail-message");
    const details = document.getElementById("hike-details");

    try {
        const hike = hikeId && window.HikeStore.getHike(hikeId);
        if (!hike) {
            name.textContent = "Hike not found";
            message.textContent = "This hike is not available in this browser.";
            message.classList.add("notice-error");
            return;
        }

        name.textContent = hike.name;
        message.textContent = "";
        addDetail("Date", formatDate(hike.startedAt));
        addDetail("Started", formatTime(hike.startedAt));
        addDetail("Finished", hike.endedAt ? formatTime(hike.endedAt) : "In progress");
        addDetail("Duration", formatDuration(hike.durationSeconds));
    } catch (error) {
        name.textContent = "Could not load hike";
        message.textContent = error.message;
        message.classList.add("notice-error");
    }

    function addDetail(label, value) {
        const term = document.createElement("dt");
        term.textContent = label;
        const description = document.createElement("dd");
        description.textContent = value;
        details.append(term, description);
    }

    function formatDate(value) {
        return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(value));
    }

    function formatTime(value) {
        return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(value));
    }

    function formatDuration(totalSeconds) {
        const seconds = Math.max(0, Math.floor(totalSeconds || 0));
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainder = seconds % 60;
        return [hours, minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":");
    }
})();
