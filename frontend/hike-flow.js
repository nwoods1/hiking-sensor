(() => {
    const UUID_SERVICE = "12345678-1234-1234-1234-1234567890ab";
    const UUID_CHARACTERISTIC = "abcdefab-1234-5678-1234-abcdefabcdef";
    const form = document.getElementById("new-hike-form");
    const sessionName = document.getElementById("session-hike-name");
    const connectButton = document.getElementById("connect-sensor");
    const startButton = document.getElementById("start-hike");
    const finishButton = document.getElementById("finish-hike");
    const connectionStatus = document.getElementById("connection-status");
    const timerStatus = document.getElementById("timer-status");
    const timerDisplay = document.getElementById("hike-timer");
    let device;
    let startedAt;
    let timerId;

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
                window.location.href = "hike-session.html";
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
    if (!draft?.name || !draft?.createdAt) {
        window.location.href = "new-hike.html";
        return;
    }
    sessionName.textContent = draft.name;
    document.getElementById("session-created-at").textContent =
        `Created ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(draft.createdAt))}`;

    if (!navigator.bluetooth) {
        showConnectionMessage("Web Bluetooth is not available in this browser. Use a supported browser over HTTPS to connect.", true);
        connectButton.disabled = true;
    }

    connectButton.addEventListener("click", async () => {
        connectButton.disabled = true;
        showConnectionMessage("Searching for your ESP32…");
        try {
            device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [UUID_SERVICE]
            });
            device.addEventListener("gattserverdisconnected", handleDisconnect);
            const server = await device.gatt.connect();
            const service = await server.getPrimaryService(UUID_SERVICE);
            const characteristic = await service.getCharacteristic(UUID_CHARACTERISTIC);
            await characteristic.startNotifications();
            characteristic.addEventListener("characteristicvaluechanged", () => {});
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

    startButton.addEventListener("click", () => {
        if (!device?.gatt?.connected) {
            showConnectionMessage("Connect to the ESP32 before starting the hike timer.", true);
            startButton.disabled = true;
            connectButton.disabled = false;
            return;
        }
        startedAt = new Date();
        startButton.hidden = true;
        finishButton.hidden = false;
        connectButton.disabled = true;
        timerStatus.textContent = "Hike in progress.";
        timerId = window.setInterval(updateTimer, 1000);
        updateTimer();
    });

    finishButton.addEventListener("click", () => {
        if (!startedAt) return;
        window.clearInterval(timerId);
        const endedAt = new Date();
        const hike = {
            id: crypto.randomUUID(),
            name: draft.name,
            createdAt: draft.createdAt,
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            durationSeconds: Math.floor((endedAt - startedAt) / 1000)
        };
        try {
            window.HikeStore.saveHike(hike);
            sessionStorage.removeItem("hiking-sensor-draft");
            if (device?.gatt?.connected) device.gatt.disconnect();
            window.location.href = `hike.html?id=${encodeURIComponent(hike.id)}`;
        } catch (error) {
            timerStatus.textContent = `Could not save the hike: ${error.message}`;
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
        startButton.disabled = true;
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
