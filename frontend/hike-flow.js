(() => {
    const form = document.getElementById("new-hike-form");
    const sessionName = document.getElementById("session-hike-name");
    const connectButton = document.getElementById("connect-sensor");
    const startButton = document.getElementById("start-hike");
    const finishButton = document.getElementById("finish-hike");
    const connectionStatus = document.getElementById("status");
    const timerStatus = document.getElementById("timer-status");
    const timerDisplay = document.getElementById("hike-timer");
    const liveData = document.getElementById("hike-live-data");
    const mockMode = new URLSearchParams(window.location.search).get("mockBluetooth") === "1";
    let device;
    let startedAt;
    let timerId;
    let finished = false;

    if (form) {
        const createdAtField = document.getElementById("hike-created-at");
        createdAtField.value = new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short"
        }).format(new Date());

        form.addEventListener("submit", (event) => {
            event.preventDefault();
            const name = form.elements.name.value.trim();
            if (!name) return;
            const createdAt = new Date();
            createdAtField.value = new Intl.DateTimeFormat(undefined, {
                dateStyle: "medium",
                timeStyle: "short"
            }).format(createdAt);
            try {
                sessionStorage.setItem("hiking-sensor-draft", JSON.stringify({
                    name,
                    createdAt: createdAt.toISOString()
                }));
                window.location.href = mockMode
                    ? "hike-session.html?mockBluetooth=1"
                    : "hike-session.html";
            } catch (error) {
                document.getElementById("new-hike-message").textContent =
                    `Could not prepare the hike: ${error.message}`;
            }
        });
    }

    if (!connectButton) return;

    let draft;
    try {
        draft = JSON.parse(sessionStorage.getItem("hiking-sensor-draft") || "null");
    } catch (error) {
        showConnectionMessage(`Could not read the new hike: ${error.message}`, true);
    }
    if (!draft && mockMode) {
        draft = { name: "Mock Hike", createdAt: new Date().toISOString() };
        try {
            sessionStorage.setItem("hiking-sensor-draft", JSON.stringify(draft));
        } catch (error) {
            showConnectionMessage(`Could not save the mock hike draft: ${error.message}`, true);
        }
    }
    if (!draft?.name || !draft?.createdAt) {
        window.location.href = "new-hike.html";
        return;
    }
    sessionName.textContent = draft.name;
    document.getElementById("session-created-at").textContent =
        `Created ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(draft.createdAt))}`;

    if (!navigator.bluetooth && !mockMode) {
        showConnectionMessage("Web Bluetooth is not available in this browser. Use a supported browser over HTTPS to connect.", true);
        connectButton.disabled = true;
    }

    connectButton.addEventListener("click", async () => {
        connectButton.disabled = true;
        showConnectionMessage("Searching for your ESP32…");
        try {
            device = await window.HikingSensor.connectToESP32();
            if (!device) {
                connectButton.disabled = false;
                return;
            }
            device.addEventListener("gattserverdisconnected", handleDisconnect);
            showConnectionMessage(`Connected to ${device.name || "ESP32"}. You can start your hike.`);
            startButton.disabled = false;
        } catch (error) {
            if (device?.gatt?.connected) device.gatt.disconnect();
            device = undefined;
            startButton.disabled = true;
            showConnectionMessage(`Could not connect to the ESP32: ${error.message}`, true);
            connectButton.disabled = false;
        }
    });

    startButton.addEventListener("click", async () => {
        if (!device?.gatt?.connected) {
            showConnectionMessage("Connect to the ESP32 before starting the hike timer.", true);
            startButton.disabled = true;
            connectButton.disabled = false;
            return;
        }
        startButton.disabled = true;
        try {
            await window.HikingSensor.startStepCounting({ name: draft.name });
        } catch (error) {
            timerStatus.textContent = `Could not start recording: ${error.message}`;
            startButton.disabled = false;
            return;
        }
        startedAt = new Date();
        startButton.hidden = true;
        finishButton.hidden = false;
        connectButton.disabled = true;
        timerStatus.textContent = "Hike in progress.";
        liveData.hidden = false;
        timerId = window.setInterval(updateTimer, 1000);
        updateTimer();
    });

    finishButton.addEventListener("click", async () => {
        if (!startedAt) return;
        startedAt = undefined;
        finished = true;
        finishButton.disabled = true;
        window.clearInterval(timerId);
        const { sessionId } = await window.HikingSensor.stopStepCounting({ completed: true });
        if (device?.gatt?.connected) device.gatt.disconnect();

        sessionStorage.removeItem("hiking-sensor-draft");

        // Zip + upload the IndexedDB recording to Supabase (hike-sync.js ->
        // saveHike). If it fails, the session stays unsynced in IndexedDB
        // and is retried the next time a hike page opens.
        timerStatus.textContent = "Saving your hike…";
        try {
            if (sessionId == null) throw new Error("nothing was recorded for this hike");
            const hikeId = await window.HikeSync.uploadSession(sessionId);
            // hike.html loads the hike from Supabase by its Supabase id.
            window.location.href = `hike.html?id=${encodeURIComponent(hikeId)}`;
        } catch (error) {
            console.error("Could not upload hike:", error);
            finishButton.hidden = true;
            timerStatus.textContent =
                `Hike saved on this device, but uploading failed: ${error.message}. ` +
                "It will upload automatically the next time you start a hike.";
            timerStatus.classList.add("notice-error");
        }
    });

    function updateTimer() {
        const seconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainder = seconds % 60;
        timerDisplay.textContent = [hours, minutes, remainder]
            .map((part) => String(part).padStart(2, "0"))
            .join(":");
    }

    function handleDisconnect() {
        // Finishing the hike disconnects the sensor on purpose.
        if (finished) return;
        startButton.disabled = true;
        window.HikingSensor.stopStepCounting();
        if (startedAt) {
            window.clearInterval(timerId);
            timerId = undefined;
            startedAt = undefined;
            timerDisplay.textContent = "00:00:00";
            timerStatus.textContent = "Sensor disconnected. Timer stopped; reconnect to start again.";
            startButton.hidden = false;
            finishButton.hidden = true;
        }
        showConnectionMessage("ESP32 disconnected. Connect again before starting.", true);
        connectButton.disabled = false;
    }

    function showConnectionMessage(text, isError = false) {
        if (!connectionStatus) return;
        connectionStatus.textContent = text;
        connectionStatus.classList.toggle("notice-error", isError);
    }
})();
