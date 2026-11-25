import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';

import { colors, spacing } from './theme';

const HEIGHT = 200;
const MARGIN = { top: 12, right: 12, bottom: 24, left: 44 };

function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  return [width, (e) => setWidth(Math.round(e.nativeEvent.layout.width))];
}

// ~count round tick values covering [min, max] (hike-charts.js ticks()).
export function ticks(min: number, max: number, count: number): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

// ---------- live chart (script.js drawGraph) ----------

// Fixed x scale of `capacity` slots, newest on the right; values clamped to
// [0, maxValue] like the web canvas graph. Red dots mark detected strikes.
export const LiveChart = memo(function LiveChart({
  values,
  markers,
  capacity,
  maxValue,
  unit,
  label,
}: {
  values: number[];
  markers: boolean[];
  capacity: number;
  maxValue: number;
  unit: string;
  label: string;
}) {
  const [width, onLayout] = useWidth();
  const plotW = Math.max(1, width - MARGIN.left - MARGIN.right);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const offset = capacity - values.length; // right-align so "now" is at the edge
  const sx = (i: number) => MARGIN.left + ((i + offset) / (capacity - 1)) * plotW;
  const sy = (v: number) => MARGIN.top + plotH - (Math.min(Math.max(v, 0), maxValue) / maxValue) * plotH;

  const points = values.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
  const latest = values.length ? values[values.length - 1] : null;

  return (
    <View
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${label}. ${latest == null ? 'No data yet' : `Latest ${latest.toFixed(2)} ${unit}`}. ${markers.filter(Boolean).length} foot strikes shown.`}>
      {width > 0 && (
        <Svg width={width} height={HEIGHT}>
          {ticks(0, maxValue, 4).map((v) => (
            <Line
              key={`g${v}`}
              x1={MARGIN.left}
              x2={width - MARGIN.right}
              y1={sy(v)}
              y2={sy(v)}
              stroke={colors.grid}
              strokeWidth={1}
            />
          ))}
          {ticks(0, maxValue, 4).map((v) => (
            <SvgText key={`t${v}`} x={MARGIN.left - 6} y={sy(v) + 4} fontSize={11} fill={colors.muted} textAnchor="end">
              {`${+v.toFixed(1)}`}
            </SvgText>
          ))}
          <SvgText x={MARGIN.left} y={HEIGHT - 6} fontSize={11} fill={colors.muted}>
            Older
          </SvgText>
          <SvgText x={width - MARGIN.right} y={HEIGHT - 6} fontSize={11} fill={colors.muted} textAnchor="end">
            {`Now (${unit})`}
          </SvgText>
          {values.length > 1 && (
            <Polyline points={points} fill="none" stroke={colors.series} strokeWidth={2} strokeLinejoin="round" />
          )}
          {values.map((v, i) =>
            markers[i] ? (
              <Circle key={i} cx={sx(i)} cy={sy(v)} r={5} fill={colors.bad} stroke={colors.surface} strokeWidth={1.5} />
            ) : null,
          )}
        </Svg>
      )}
    </View>
  );
});

// ---------- per-step chart (hike-charts.js lineChart) ----------

export type StepPoint = { step: number; value: number; bad: boolean };

// Keep rendering cheap on long hikes: at most ~2 points per pixel column
// (min and max of each bucket), and every bad landing.
export function decimate(points: StepPoint[], buckets: number): StepPoint[] {
  if (points.length <= buckets * 2) return points;
  const out: StepPoint[] = [];
  const size = points.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const slice = points.slice(Math.floor(b * size), Math.floor((b + 1) * size));
    if (!slice.length) continue;
    let lo = slice[0];
    let hi = slice[0];
    for (const p of slice) {
      if (p.value < lo.value) lo = p;
      if (p.value > hi.value) hi = p;
    }
    const keep = new Set([lo, hi, ...slice.filter((p) => p.bad)]);
    out.push(...[...keep].sort((a, b2) => a.step - b2.step));
  }
  return out;
}

const MAX_MARKED_STEPS = 150;

export function StepChart({
  points,
  yDomain,
  yLabel,
  refLine,
  describe,
}: {
  points: StepPoint[];
  yDomain: [number, number];
  yLabel: string;
  refLine: { value: number; label: string };
  describe: (step: number) => string;
}) {
  const [width, onLayout] = useWidth();
  const [selected, setSelected] = useState<number | null>(null);
  const plotW = Math.max(1, width - MARGIN.left - MARGIN.right);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const xMin = 1;
  const xMax = Math.max(2, points.length);
  const sx = (v: number) => MARGIN.left + ((v - xMin) / (xMax - xMin)) * plotW;
  const sy = (v: number) => MARGIN.top + plotH - ((v - yDomain[0]) / (yDomain[1] - yDomain[0] || 1)) * plotH;

  const drawn = decimate(points, Math.max(50, Math.floor(plotW)));
  const line = drawn.map((p) => `${sx(p.step).toFixed(1)},${sy(p.value).toFixed(1)}`).join(' ');
  const marked = points.length <= MAX_MARKED_STEPS ? points : points.filter((p) => p.bad);
  const badCount = points.filter((p) => p.bad).length;
  const selectedPoint = selected != null ? points[selected - 1] : null;

  return (
    <View>
      <Pressable
        onLayout={onLayout}
        onPress={(e) => {
          const index = Math.round(((e.nativeEvent.locationX - MARGIN.left) / plotW) * (xMax - xMin)) + xMin;
          setSelected(Math.min(points.length, Math.max(1, index)));
        }}
        accessibilityRole="image"
        accessibilityLabel={`${yLabel} for each of ${points.length} steps, ${badCount} bad landings in red`}
        accessibilityHint="Tap the chart to inspect a step">
        {width > 0 && (
          <Svg width={width} height={HEIGHT}>
            {ticks(yDomain[0], yDomain[1], 4).map((v) => (
              <Line
                key={`g${v}`}
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={sy(v)}
                y2={sy(v)}
                stroke={colors.grid}
                strokeWidth={1}
              />
            ))}
            {ticks(yDomain[0], yDomain[1], 4).map((v) => (
              <SvgText
                key={`t${v}`}
                x={MARGIN.left - 6}
                y={sy(v) + 4}
                fontSize={11}
                fill={colors.muted}
                textAnchor="end">
                {`${+v.toFixed(2)}`}
              </SvgText>
            ))}
            {ticks(xMin, xMax, Math.max(2, Math.floor(plotW / 80)))
              .filter((v) => v >= xMin)
              .map((v) => (
                <SvgText
                  key={`x${v}`}
                  x={sx(v)}
                  y={MARGIN.top + plotH + 16}
                  fontSize={11}
                  fill={colors.muted}
                  textAnchor="middle">
                  {`${v}`}
                </SvgText>
              ))}
            {drawn.length > 1 && (
              <Polyline
                points={line}
                fill="none"
                stroke={colors.series}
                strokeWidth={points.length > MAX_MARKED_STEPS ? 1.5 : 2}
                strokeLinejoin="round"
              />
            )}
            {refLine.value >= yDomain[0] && refLine.value <= yDomain[1] && (
              <>
                <Line
                  x1={MARGIN.left}
                  x2={width - MARGIN.right}
                  y1={sy(refLine.value)}
                  y2={sy(refLine.value)}
                  stroke={colors.muted}
                  strokeDasharray="4 4"
                />
                <SvgText
                  x={width - MARGIN.right}
                  y={sy(refLine.value) - 5}
                  fontSize={11}
                  fill={colors.muted}
                  textAnchor="end">
                  {refLine.label}
                </SvgText>
              </>
            )}
            {[...marked.filter((p) => !p.bad), ...marked.filter((p) => p.bad)].map((p) => (
              <Circle
                key={p.step}
                cx={sx(p.step)}
                cy={sy(p.value)}
                r={4}
                fill={p.bad ? colors.bad : colors.series}
                stroke={colors.surface}
                strokeWidth={2}
              />
            ))}
            {selectedPoint && (
              <>
                <Line
                  x1={sx(selectedPoint.step)}
                  x2={sx(selectedPoint.step)}
                  y1={MARGIN.top}
                  y2={MARGIN.top + plotH}
                  stroke={colors.muted}
                  strokeDasharray="3 3"
                />
                <Circle
                  cx={sx(selectedPoint.step)}
                  cy={sy(selectedPoint.value)}
                  r={7}
                  fill="none"
                  stroke={selectedPoint.bad ? colors.bad : colors.series}
                  strokeWidth={2}
                />
              </>
            )}
          </Svg>
        )}
      </Pressable>
      <Text style={chartStyles.caption}>Step number</Text>
      {selectedPoint && (
        <Text style={chartStyles.tooltip} accessibilityLiveRegion="polite">
          {describe(selectedPoint.step)}
        </Text>
      )}
    </View>
  );
}

const chartStyles = StyleSheet.create({
  caption: { textAlign: 'center', color: colors.muted, fontSize: 12 },
  tooltip: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.green2,
    color: colors.text,
    fontSize: 14,
  },
});
