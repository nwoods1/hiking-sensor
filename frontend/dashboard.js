(() => {
    const list = document.getElementById("hike-list");
    const message = document.getElementById("hike-list-message");
    const dateFormatter = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
    });

    try {
        const hikes = window.HikeStore.getHikes();
        if (hikes.length === 0) {
            message.textContent = "No hikes recorded yet. Start a new hike to see it here.";
            return;
        }

        for (const hike of hikes) {
            const card = document.createElement("a");
            card.className = "hike-card";
            card.href = `hike.html?id=${encodeURIComponent(hike.id)}`;

            const title = document.createElement("h3");
            title.textContent = hike.name;
            const date = document.createElement("p");
            date.textContent = dateFormatter.format(new Date(hike.startedAt));
            const duration = document.createElement("p");
            duration.className = "muted";
            duration.textContent = `Duration: ${formatDuration(hike.durationSeconds)}`;

            card.append(title, date, duration);
            list.append(card);
        }
    } catch (error) {
        message.textContent = `Could not load saved hikes: ${error.message}`;
        message.classList.add("notice-error");
    }

    function formatDuration(totalSeconds) {
        const seconds = Math.max(0, Math.floor(totalSeconds || 0));
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${minutes}m`;
    }
})();
