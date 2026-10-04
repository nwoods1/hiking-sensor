(async () => {
    const list = document.getElementById("hike-list");
    const message = document.getElementById("hike-list-message");
    const accountMessage = document.getElementById("account-message");
    const signOutButton = document.querySelector("[data-sign-out]");
    const dateFormatter = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
    });

    // NEW: auth guard (replaces the old data-require-auth behaviour)
    const { data: { session } } = await sb.auth.getSession();
    if (!session || session.user.is_anonymous) {
        window.location.href = "index.html#sign-in";
        return;
    }
    signOutButton.hidden = false;
    signOutButton.addEventListener("click", () => sb.auth.signOut());

    // NEW: leave the page if the user signs out (here or in another tab)
    sb.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") window.location.href = "index.html";
    });

    message.textContent = "Loading your hikes...";

    try {
        const hikes = await listHikes();                 // CHANGED: Supabase instead of HikeStore
        if (hikes.length === 0) {
            message.textContent = "No hikes recorded yet. Start a new hike to see it here.";
            return;
        }
        message.textContent = "";

        for (const hike of hikes) {
            const card = document.createElement("a");
            card.className = "hike-card";
            card.href = `hike.html?id=${encodeURIComponent(hike.id)}`;

            const title = document.createElement("h3");
            title.textContent = hike.name ?? "Untitled hike";            // CHANGED: name can be null
            const date = document.createElement("p");
            date.textContent = dateFormatter.format(new Date(hike.started_at));   // CHANGED: startedAt -> started_at
            const duration = document.createElement("p");
            duration.className = "muted";
            duration.textContent = `Duration: ${formatDuration(hike.duration_s)}`; // CHANGED: durationSeconds -> duration_s

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