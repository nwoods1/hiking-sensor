// hike-charts.js (classic script)
// Line charts on the hike page, drawn from the hike's unzipped .json.gz
// impacts, one point per detected step:
//   - impact acceleration (g)
//   - knee angle at impact (deg)
// Steps that count as a "bad landing" are drawn in red on both charts.
// Plain SVG, no chart library.

(() => {
    const NS = "http://www.w3.org/2000/svg";

    // ---------- bad landing ----------
    // A hard hit taken on a nearly straight knee, so the joint absorbs the
    // shock instead of the muscles. Both must be true:
    //   1. impact >= the hike's high-impact threshold (HIGH_IMPACT_THRESHOLD
    //      in script.js, saved per hike; 2.0 g)
    //   2. knee bent less than 15 deg at impact. In normal walking the knee is
    //      ~5 deg bent at heel strike and flexes to ~15-20 deg as weight comes
    //      on, which is when the impact peak is measured; downhill it's more.
    //      Still under 15 deg at the peak = landing stiff-legged.
    const DEFAULT_HIGH_IMPACT = 2.0; // g
    const MAX_BEND_FOR_BAD_LANDING = 15; // deg of knee bend

    // Hikes recorded since the knee calibration change store 180 = straight
    // (smaller = more bent); older hikes store 0 = straight. A walking knee
    // at impact is never bent past 90 deg, so the median tells them apart.
    function bendOf(angles) {
        const sorted = [...angles].sort((a, b) => a - b);
        const straightIs180 = sorted[Math.floor(sorted.length / 2)] > 90;
        return {
            straightIs180,
            bend: (angle) => (straightIs180 ? 180 - angle : angle)
        };
    }

    const SERIES = "#2a78d6";
    const BAD = "#d03b3b";
    const INK_MUTED = "#66736a";
    const GRID = "#e6ebe4";
    const SURFACE = "#fff";

    // Up to this many steps, every step gets a marker; above it the line
    // alone shows normal steps and only bad landings get a marker.
    const MAX_MARKED_STEPS = 150;

    const HEIGHT = 240;
    const MARGIN = { top: 16, right: 20, bottom: 44, left: 52 };

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

    function swatch(color) {
        const node = document.createElement("span");
        node.className = "chart-swatch";
        node.style.background = color;
        return node;
    }

    // One line chart into `container`, sized to its current width.
    // steps: [{ step (1-based), impact, bad }]; x = step number, y = value(step).
    function lineChart(container, steps, { value, yDomain, yLabel, refLine, describe }) {
        container.replaceChildren();

        const width = Math.max(280, container.clientWidth);
        const plotW = width - MARGIN.left - MARGIN.right;
        const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;

        const xMin = 1;
        const xMax = Math.max(2, steps.length);
        const sx = (v) => MARGIN.left + ((v - xMin) / (xMax - xMin)) * plotW;
        const sy = (v) => MARGIN.top + plotH - ((v - yDomain[0]) / (yDomain[1] - yDomain[0] || 1)) * plotH;

        const svg = svgEl("svg", {
            width, height: HEIGHT, viewBox: `0 0 ${width} ${HEIGHT}`,
            role: "img",
            "aria-label": `${yLabel} for each of ${steps.length} steps, ` +
                `${steps.filter((s) => s.bad).length} bad landings in red`
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

        const points = steps.map((s) => ({ ...s, px: sx(s.step), py: sy(value(s)) }));
        const lineWidth = points.length > MAX_MARKED_STEPS ? 1.5 : 2;

        // the whole hike in blue
        if (points.length > 1) {
            svg.append(svgEl("polyline", {
                points: points.map((p) => `${p.px},${p.py}`).join(" "),
                fill: "none", stroke: SERIES, "stroke-width": lineWidth,
                "stroke-linejoin": "round", "stroke-linecap": "round"
            }));
        }

        // red over the stretch of line into and out of each bad landing
        for (let i = 0; i < points.length; i++) {
            if (!points[i].bad) continue;
            const stretch = points.slice(Math.max(0, i - 1), i + 2);
            if (stretch.length > 1) {
                svg.append(svgEl("polyline", {
                    points: stretch.map((p) => `${p.px},${p.py}`).join(" "),
                    fill: "none", stroke: BAD, "stroke-width": lineWidth + 0.5,
                    "stroke-linejoin": "round", "stroke-linecap": "round"
                }));
            }
        }

        // markers (r=4, 2px surface ring): every step on short hikes,
        // otherwise just the bad landings; bad ones drawn last, on top
        const marked = points.length <= MAX_MARKED_STEPS ? points : points.filter((p) => p.bad);
        for (const p of [...marked.filter((p) => !p.bad), ...marked.filter((p) => p.bad)]) {
            svg.append(svgEl("circle", {
                cx: p.px, cy: p.py, r: 4,
                fill: p.bad ? BAD : SERIES, stroke: SURFACE, "stroke-width": 2
            }));
        }

        // bad-landing threshold, dashed
        if (refLine.value >= yDomain[0] && refLine.value <= yDomain[1]) {
            const y = sy(refLine.value);
            svg.append(
                svgEl("line", {
                    x1: MARGIN.left, x2: width - MARGIN.right, y1: y, y2: y,
                    stroke: INK_MUTED, "stroke-width": 1, "stroke-dasharray": "4 4"
                }),
                // white halo keeps the label readable over the line
                svgText(refLine.label, {
                    x: width - MARGIN.right, y: y - 5, "text-anchor": "end", "font-size": 11,
                    stroke: SURFACE, "stroke-width": 4, "paint-order": "stroke", "stroke-linejoin": "round"
                })
            );
        }

        // hover: crosshair + ring + tooltip on the nearest step by x
        const crosshair = svgEl("line", {
            y1: MARGIN.top, y2: MARGIN.top + plotH, stroke: INK_MUTED,
            "stroke-width": 1, "stroke-dasharray": "3 3", visibility: "hidden"
        });
        const ring = svgEl("circle", { r: 7, fill: "none", "stroke-width": 2, visibility: "hidden" });
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

            // points are evenly spaced by step number
            const index = Math.round(((mx - MARGIN.left) / plotW) * (xMax - xMin));
            const best = points[Math.min(points.length - 1, Math.max(0, index))];

            crosshair.setAttribute("x1", best.px);
            crosshair.setAttribute("x2", best.px);
            crosshair.setAttribute("visibility", "visible");
            ring.setAttribute("cx", best.px);
            ring.setAttribute("cy", best.py);
            ring.setAttribute("stroke", best.bad ? BAD : SERIES);
            ring.setAttribute("visibility", "visible");

            tooltip.replaceChildren(...describe(best));
            tooltip.hidden = false;

            // keep the tooltip inside the chart
            const left = best.px + 12 + tooltip.offsetWidth > width ? best.px - 12 - tooltip.offsetWidth : best.px + 12;
            tooltip.style.left = `${Math.max(4, left)}px`;
            tooltip.style.top = `${Math.max(4, Math.min(best.py - tooltip.offsetHeight / 2, HEIGHT - tooltip.offsetHeight - 4))}px`;
        });
        svg.addEventListener("pointerleave", hide);

        container.append(svg, tooltip);
    }

    // Draw both charts plus the legend/summary; re-draws when the page
    // width changes.
    function render({ legendElement, summaryElement, impactElement, angleElement }, hike, impacts) {
        const highImpact = hike.high_impact_threshold ?? DEFAULT_HIGH_IMPACT;
        const { straightIs180, bend } = bendOf(impacts.map((i) => i.angle));
        // the same 15 deg bend limit, in this hike's angle convention
        const angleLimit = straightIs180 ? 180 - MAX_BEND_FOR_BAD_LANDING : MAX_BEND_FOR_BAD_LANDING;

        const steps = impacts.map((impact, index) => ({
            step: index + 1,
            impact,
            bad: impact.accel >= highImpact && bend(impact.angle) < MAX_BEND_FOR_BAD_LANDING
        }));

        const badCount = steps.filter((s) => s.bad).length;
        const rule = `impact ${highImpact.toFixed(1)} g or more with the knee bent less than ` +
            `${MAX_BEND_FOR_BAD_LANDING}° (knee angle ${straightIs180 ? "above" : "below"} ${angleLimit}°)`;

        const stepItem = document.createElement("li");
        stepItem.append(swatch(SERIES), "Each step");
        const badItem = document.createElement("li");
        badItem.append(swatch(BAD), `Bad landing: ${rule}`);
        legendElement.replaceChildren(stepItem, badItem);

        summaryElement.textContent = badCount === 0
            ? `No bad landings in ${steps.length} steps.`
            : `${badCount} bad landing${badCount === 1 ? "" : "s"} in ${steps.length} steps ` +
              `(${+((badCount / steps.length) * 100).toFixed(1)}%).`;

        const describe = (s) => {
            const lines = [];
            const head = document.createElement("div");
            head.className = "chart-tooltip-head";
            head.textContent = `Step ${s.step}, ${clock(s.impact.t)} into the hike`;
            lines.push(head);
            const impactLine = document.createElement("div");
            impactLine.textContent = `Impact ${s.impact.accel.toFixed(2)} g`;
            const angleLine = document.createElement("div");
            angleLine.textContent = `Knee angle ${s.impact.angle.toFixed(1)}° (bent ${bend(s.impact.angle).toFixed(1)}°)`;
            lines.push(impactLine, angleLine);
            if (s.bad) {
                const badLine = document.createElement("div");
                badLine.className = "chart-tooltip-flag";
                badLine.append(swatch(BAD), "Bad landing");
                lines.push(badLine);
            }
            return lines;
        };

        const accels = impacts.map((i) => i.accel);
        const angles = impacts.map((i) => i.angle);

        const draw = () => {
            lineChart(impactElement, steps, {
                value: (s) => s.impact.accel,
                yDomain: [0, Math.max(highImpact, ...accels) * 1.1],
                yLabel: "Impact (g)",
                refLine: { value: highImpact, label: `${highImpact.toFixed(1)} g` },
                describe
            });
            lineChart(angleElement, steps, {
                value: (s) => s.impact.angle,
                yDomain: [
                    Math.max(0, Math.floor(Math.min(angleLimit, ...angles) - 5)),
                    Math.min(straightIs180 ? 185 : Infinity, Math.ceil(Math.max(angleLimit, ...angles) + 5))
                ],
                yLabel: "Knee angle (°)",
                refLine: { value: angleLimit, label: `${angleLimit}° (bent ${MAX_BEND_FOR_BAD_LANDING}°)` },
                describe
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
