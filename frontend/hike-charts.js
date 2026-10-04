// hike-charts.js (classic script)
// Line charts on the hike page, drawn from the hike's unzipped .json.gz
// impacts and averaged over every 10 steps:
//   - average impact acceleration (g)
//   - average knee angle at impact (deg)
// Plain SVG, no chart library.

(() => {
    const NS = "http://www.w3.org/2000/svg";

    const STEPS_PER_POINT = 10;

    const SERIES = "#2a78d6";
    const INK_MUTED = "#66736a";
    const GRID = "#e6ebe4";
    const SURFACE = "#fff";

    const HEIGHT = 240;
    const MARGIN = { top: 16, right: 20, bottom: 44, left: 52 };

    // Average every 10 consecutive steps; the last group may be shorter.
    // -> [{ first, last, startT, endT, accel, angle }] (first/last are 1-based step numbers)
    function groupSteps(impacts) {
        const groups = [];
        for (let i = 0; i < impacts.length; i += STEPS_PER_POINT) {
            const chunk = impacts.slice(i, i + STEPS_PER_POINT);
            const avg = (key) => chunk.reduce((sum, impact) => sum + impact[key], 0) / chunk.length;
            groups.push({
                first: i + 1,
                last: i + chunk.length,
                startT: chunk[0].t,
                endT: chunk[chunk.length - 1].t,
                accel: avg("accel"),
                angle: avg("angle")
            });
        }
        return groups;
    }

    function svgEl(tag, attrs = {}) {
        const node = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
        return node;
    }

    function svgText(text, attrs) {
        const node = svgEl("text", { fill: INK_MUTED, "font-size": 12, ...attrs });
        node.textContent = text;
        return node;
    }

    // ~count round tick values covering [min, max]
    function ticks(min, max, count) {
        const span = max - min || 1;
        const raw = span / count;
        const mag = 10 ** Math.floor(Math.log10(raw));
        const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
        const out = [];
        for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
            out.push(+v.toFixed(10));
        }
        return out;
    }

    function clock(ms) {
        const s = Math.round(ms / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = String(s % 60).padStart(2, "0");
        return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
    }

    // One line chart into `container`, sized to its current width.
    // x = last step number of each group, y = value(group).
    function lineChart(container, groups, { value, yDomain, yLabel, format }) {
        container.replaceChildren();

        const width = Math.max(280, container.clientWidth);
        const plotW = width - MARGIN.left - MARGIN.right;
        const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;

        const xMax = groups[groups.length - 1].last;
        const xMin = groups.length > 1 ? groups[0].last : 0;
        const sx = (v) => MARGIN.left + ((v - xMin) / (xMax - xMin || 1)) * plotW;
        const sy = (v) => MARGIN.top + plotH - ((v - yDomain[0]) / (yDomain[1] - yDomain[0] || 1)) * plotH;

        const svg = svgEl("svg", {
            width, height: HEIGHT, viewBox: `0 0 ${width} ${HEIGHT}`,
            role: "img",
            "aria-label": `${yLabel}, averaged every ${STEPS_PER_POINT} steps, ${groups.length} points`
        });

        // recessive grid + y labels
        for (const v of ticks(yDomain[0], yDomain[1], 4)) {
            const y = sy(v);
            svg.append(
                svgEl("line", { x1: MARGIN.left, x2: width - MARGIN.right, y1: y, y2: y, stroke: GRID, "stroke-width": 1 }),
                svgText(String(+v.toFixed(2)), { x: MARGIN.left - 8, y: y + 4, "text-anchor": "end" })
            );
        }

        // x labels: step numbers
        for (const v of ticks(xMin, xMax, Math.max(2, Math.floor(plotW / 80)))) {
            if (v < xMin) continue;
            svg.append(svgText(String(v), { x: sx(v), y: MARGIN.top + plotH + 18, "text-anchor": "middle" }));
        }
        svg.append(
            svgText("Step number", { x: MARGIN.left + plotW / 2, y: HEIGHT - 6, "text-anchor": "middle" }),
            svgText(yLabel, { x: -(MARGIN.top + plotH / 2), y: 14, transform: "rotate(-90)", "text-anchor": "middle" })
        );

        const points = groups.map((group) => ({ group, px: sx(group.last), py: sy(value(group)) }));

        // 2px line, round joins
        if (points.length > 1) {
            svg.append(svgEl("polyline", {
                points: points.map((p) => `${p.px},${p.py}`).join(" "),
                fill: "none", stroke: SERIES, "stroke-width": 2,
                "stroke-linejoin": "round", "stroke-linecap": "round"
            }));
        }

        // markers: r=4 with a 2px surface ring
        for (const p of points) {
            svg.append(svgEl("circle", { cx: p.px, cy: p.py, r: 4, fill: SERIES, stroke: SURFACE, "stroke-width": 2 }));
        }

        // hover: crosshair + ring + tooltip on the nearest point by x
        const crosshair = svgEl("line", {
            y1: MARGIN.top, y2: MARGIN.top + plotH, stroke: INK_MUTED,
            "stroke-width": 1, "stroke-dasharray": "3 3", visibility: "hidden"
        });
        const ring = svgEl("circle", { r: 7, fill: "none", stroke: SERIES, "stroke-width": 2, visibility: "hidden" });
        svg.append(crosshair, ring);

        const tooltip = document.createElement("div");
        tooltip.className = "chart-tooltip";
        tooltip.hidden = true;

        const hide = () => {
            crosshair.setAttribute("visibility", "hidden");
            ring.setAttribute("visibility", "hidden");
            tooltip.hidden = true;
        };

        svg.addEventListener("pointermove", (event) => {
            const mx = event.clientX - svg.getBoundingClientRect().left;
            if (mx < MARGIN.left - 12 || mx > width - MARGIN.right + 12) return hide();

            let best = points[0];
            for (const p of points) {
                if (Math.abs(p.px - mx) < Math.abs(best.px - mx)) best = p;
            }

            crosshair.setAttribute("x1", best.px);
            crosshair.setAttribute("x2", best.px);
            crosshair.setAttribute("visibility", "visible");
            ring.setAttribute("cx", best.px);
            ring.setAttribute("cy", best.py);
            ring.setAttribute("visibility", "visible");

            const { group } = best;
            const head = document.createElement("div");
            head.className = "chart-tooltip-head";
            head.textContent = format(value(group));
            const steps = document.createElement("div");
            steps.textContent = group.first === group.last
                ? `Step ${group.first}`
                : `Steps ${group.first}–${group.last}`;
            const time = document.createElement("div");
            time.textContent = `${clock(group.startT)}–${clock(group.endT)} into the hike`;
            tooltip.replaceChildren(head, steps, time);
            tooltip.hidden = false;

            // keep the tooltip inside the chart
            const left = best.px + 12 + tooltip.offsetWidth > width ? best.px - 12 - tooltip.offsetWidth : best.px + 12;
            tooltip.style.left = `${Math.max(4, left)}px`;
            tooltip.style.top = `${Math.max(4, best.py - tooltip.offsetHeight / 2)}px`;
        });
        svg.addEventListener("pointerleave", hide);

        container.append(svg, tooltip);
    }

    // Draw both charts; re-draws when the page width changes.
    function render({ impactElement, angleElement }, impacts) {
        const groups = groupSteps(impacts);

        const accels = groups.map((g) => g.accel);
        const angles = groups.map((g) => g.angle);

        const draw = () => {
            lineChart(impactElement, groups, {
                value: (g) => g.accel,
                yDomain: [0, Math.max(...accels) * 1.15 || 1],
                yLabel: "Average impact (g)",
                format: (v) => `Average impact ${v.toFixed(2)} g`
            });
            lineChart(angleElement, groups, {
                value: (g) => g.angle,
                yDomain: [Math.max(0, Math.floor(Math.min(...angles) - 5)), Math.ceil(Math.max(...angles) + 5)],
                yLabel: "Average knee angle (°)",
                format: (v) => `Average knee angle ${v.toFixed(1)}°`
            });
        };

        draw();

        let lastWidth = impactElement.clientWidth;
        let frame = 0;
        new ResizeObserver(() => {
            if (impactElement.clientWidth === lastWidth) return;
            lastWidth = impactElement.clientWidth;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(draw);
        }).observe(impactElement);
    }

    window.HikeCharts = { render };
})();
