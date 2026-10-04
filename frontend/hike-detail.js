// (() => {
//     const hikeId = new URLSearchParams(window.location.search).get("id");
//     const name = document.getElementById("detail-name");
//     const message = document.getElementById("detail-message");
//     const details = document.getElementById("hike-details");

//     try {
//         const hike = hikeId && window.HikeStore.getHike(hikeId);
//         if (!hike) {
//             name.textContent = "Hike not found";
//             message.textContent = "This hike is not available in this browser.";
//             message.classList.add("notice-error");
//             return;
//         }

//         name.textContent = hike.name;
//         message.textContent = "";
//         addDetail("Date", formatDate(hike.startedAt));
//         addDetail("Started", formatTime(hike.startedAt));
//         addDetail("Finished", hike.endedAt ? formatTime(hike.endedAt) : "In progress");
//         addDetail("Duration", formatDuration(hike.durationSeconds));
//     } catch (error) {
//         name.textContent = "Could not load hike";
//         message.textContent = error.message;
//         message.classList.add("notice-error");
//     }

//     function addDetail(label, value) {
//         const term = document.createElement("dt");
//         term.textContent = label;
//         const description = document.createElement("dd");
//         description.textContent = value;
//         details.append(term, description);
//     }

//     function formatDate(value) {
//         return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(value));
//     }

//     function formatTime(value) {
//         return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(value));
//     }

//     function formatDuration(totalSeconds) {
//         const seconds = Math.max(0, Math.floor(totalSeconds || 0));
//         const hours = Math.floor(seconds / 3600);
//         const minutes = Math.floor((seconds % 3600) / 60);
//         const remainder = seconds % 60;
//         return [hours, minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":");
//     }
// })();
(async () => {
    const $ = (id) => document.getElementById(id);
    const message = $("detail-message");
    const details = $("hike-details");

    // build elements with textContent (never innerHTML), so stored text can't inject HTML
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    // ---------- formatting helpers ----------
    const show = (v, unit = "") => (v == null ? "\u2013" : `${v}${unit}`);

    function clock(totalSeconds) {            // 4520 -> "1:15:20", 95 -> "1:35"
        if (totalSeconds == null) return "\u2013";
        const s = Math.max(0, Math.round(totalSeconds));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = String(s % 60).padStart(2, "0");
        return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
    }

    function longDuration(totalSeconds) {     // 4520 -> "1h 15m"
        if (totalSeconds == null) return "\u2013";
        const s = Math.max(0, Math.round(totalSeconds));
        return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    }

    function fatigueText(ratio) {
        if (ratio == null) return "Not enough steps";
        const pct = Math.round((ratio - 1) * 100);
        if (pct === 0) return "No change";
        return `${pct > 0 ? "+" : ""}${pct}% (last third vs first)`;
    }

    function addDetail(label, value) {
        details.append(el("dt", null, label), el("dd", null, value));
    }

    // ---------- auth guard ----------
    const { data: { session } } = await sb.auth.getSession();
    if (!session || session.user.is_anonymous) {
        window.location.href = "index.html#sign-in";
        return;
    }
    sb.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") window.location.href = "index.html";
    });

    // ---------- load the hike ----------
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) {
        $("detail-name").textContent = "Hike not found";
        message.textContent = "No hike was selected.";
        return;
    }

    message.textContent = "Loading hike...";
    const { data: hike, error } = await sb
        .from("hikes").select("*").eq("id", id).maybeSingle();

    if (error) {
        $("detail-name").textContent = "Could not load hike";
        message.textContent = error.message;
        message.classList.add("notice-error");
        return;
    }
    if (!hike) {   // wrong id, or it belongs to someone else (RLS hides it)
        $("detail-name").textContent = "Hike not found";
        message.textContent = "This hike doesn't exist or isn't yours.";
        return;
    }
    message.textContent = "";

    // ---------- render ----------
    const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" });
    $("detail-name").textContent = hike.name ?? "Untitled hike";
    document.title = `${hike.name ?? "Hike"} | Hiking Sensor`;

    details.replaceChildren();
    addDetail("Date", dateFormatter.format(new Date(hike.started_at)));
    addDetail("Total duration", longDuration(hike.duration_s));
    addDetail("Active time", longDuration(hike.active_time_s));
    addDetail("Steps", show(hike.step_count));
    addDetail("Average cadence", show(hike.avg_cadence, " steps/min"));
    addDetail("Peak cadence", show(hike.max_cadence, " steps/min"));
    addDetail("Average impact", show(hike.avg_impact));
    addDetail("Median impact", show(hike.median_impact));
    addDetail("Hardest step", `${show(hike.max_impact)} at ${clock(hike.max_impact_at_s)}`);
    addDetail("Hard impacts", `${show(hike.high_impact_count)} (${show(hike.high_impact_pct, "%")})`);
    addDetail("Total impact load", show(hike.total_impact_load));
    addDetail("Fatigue", fatigueText(hike.fatigue_ratio));
    addDetail("Avg knee angle at impact", show(hike.avg_angle_at_impact, "\u00b0"));
    addDetail("Min knee angle at impact", show(hike.min_angle_at_impact, "\u00b0"));
    addDetail("Max knee angle at impact", show(hike.max_angle_at_impact, "\u00b0"));
    addDetail("Step threshold", show(hike.step_threshold));
    addDetail("High-impact threshold", show(hike.high_impact_threshold));

    // impact distribution: simple horizontal bars
    const buckets = hike.impact_buckets;
    if (buckets) {
        const bucketsEl = $("impact-buckets");
        bucketsEl.replaceChildren();
        const total = (buckets.soft + buckets.medium + buckets.hard) || 1;
        for (const [label, count] of [["Soft", buckets.soft], ["Medium", buckets.medium], ["Hard", buckets.hard]]) {
            const pct = Math.round((count / total) * 100);
            const bar = el("div", "bucket-bar");
            bar.style.width = `${pct}%`;
            const track = el("div", "bucket-track");
            track.append(bar);
            const row = el("div", "bucket-row");
            row.append(el("span", "bucket-label", `${label}: ${count} (${pct}%)`), track);
            bucketsEl.append(row);
        }
        $("buckets-panel").hidden = false;
    }

    // per-minute table (stored minute index starts at 0, so show +1)
    const perMinute = hike.per_minute ?? [];
    if (perMinute.length > 0) {
        const table = $("per-minute-table");
        table.replaceChildren();
        const head = el("tr");
        for (const h of ["Minute", "Steps", "Avg impact", "Max impact"]) head.append(el("th", null, h));
        table.append(head);
        for (const p of perMinute) {
            const row = el("tr");
            row.append(
                el("td", null, String(p.min + 1)),
                el("td", null, String(p.steps)),
                el("td", null, show(p.avg_impact)),
                el("td", null, show(p.max_impact)),
            );
            table.append(row);
        }
        $("minutes-panel").hidden = false;
    }

    // pauses
    const pauseList = $("pause-list");
    pauseList.replaceChildren();
    const pauses = hike.pauses ?? [];
    if (pauses.length === 0) {
        pauseList.append(el("li", null, "No pauses detected."));
    } else {
        for (const p of pauses) {
            pauseList.append(el("li", null, `At ${clock(p.start_s)} for ${clock(p.length_s)}`));
        }
    }
    $("pauses-panel").hidden = false;

    // ---------- every-step charts from the zipped sensor file ----------
    // loadHikeImpacts (hikeStorage.js) downloads hike-data/<data_path> and
    // unzips it back into [{ t, accel, angle }], one entry per step.
    const chartsMessage = $("step-charts-message");
    $("step-charts-panel").hidden = false;
    chartsMessage.textContent = "Loading step data...";
    try {
        const impacts = await loadHikeImpacts(hike.data_path);
        if (impacts.length === 0) {
            $("step-charts-body").hidden = true;
            chartsMessage.textContent = "No steps were detected during this hike.";
            return;
        }
        chartsMessage.textContent = "";
        window.HikeCharts.render({
            legendElement: $("step-charts-legend"),
            summaryElement: $("bad-landing-summary"),
            impactElement: $("impact-chart"),
            angleElement: $("angle-chart")
        }, hike, impacts);
    } catch (err) {
        $("step-charts-body").hidden = true;
        chartsMessage.textContent = `Could not load this hike's step data: ${err.message}`;
        chartsMessage.classList.add("notice-error");
    }
})();