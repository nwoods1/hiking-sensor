import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useUserId } from '@/auth/AuthProvider';
import { useSyncStatus } from '@/hooks/services';
import { loadHikeDetail, type HikeDetail } from '@/hikes/hikeDetail';
import { classifyLandings, DEFAULT_HIGH_IMPACT, MAX_BEND_FOR_BAD_LANDING } from '@/hikes/landing';
import { syncService } from '@/sync/syncService';
import { StepChart, type StepPoint } from '@/ui/charts';
import {
  Body,
  Button,
  Card,
  DetailRow,
  EmptyState,
  Eyebrow,
  Heading,
  Loading,
  Notice,
  Screen,
  Title,
} from '@/ui/components';
import { clock, formatFullDateTime, longDuration, show, timer } from '@/ui/format';
import { colors, radius, spacing } from '@/ui/theme';

export default function HikeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = useUserId();
  const sync = useSyncStatus();
  const [detail, setDetail] = useState<HikeDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Reloads after an upload changes where the hike lives.
  useEffect(() => {
    let cancelled = false;
    loadHikeDetail(id, userId).then(
      (result) => {
        if (cancelled) return;
        setDetail(result);
        setError(null);
      },
      (e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, userId, sync.version, attempt]);

  if (error && detail === undefined) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Notice tone="error">Could not load this hike: {error}</Notice>
        <Button label="Try again" onPress={() => setAttempt((n) => n + 1)} />
      </Screen>
    );
  }
  if (detail === undefined) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Loading label="Loading hike…" />
      </Screen>
    );
  }
  if (detail === null) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <EmptyState title="Hike not found">
          <Body muted>This hike doesn’t exist or isn’t yours.</Body>
        </EmptyState>
      </Screen>
    );
  }

  const { stats, local } = detail;
  const highImpact = stats.high_impact_threshold ?? DEFAULT_HIGH_IMPACT;
  const buckets = stats.impact_buckets;
  const gapSeconds = detail.gaps.reduce((sum, g) => sum + ((g.ended_at ?? g.started_at) - g.started_at) / 1000, 0);

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: detail.name ?? 'Hike' }} />
      <View>
        <Eyebrow>Hike summary</Eyebrow>
        <Title>{detail.name ?? 'Untitled hike'}</Title>
        <Body muted>{formatFullDateTime(detail.startedAt)}</Body>
      </View>

      {local && local.sync_state !== 'synced' && (
        <Card tone="green">
          <Body>
            Saved on this phone{local.sync_error ? `. Upload failed: ${local.sync_error}` : ' and waiting to upload.'}
          </Body>
          <Button
            label="Upload now"
            variant="secondary"
            loading={sync.running}
            onPress={() => void syncService.requestSync({ force: true })}
          />
        </Card>
      )}

      <Card>
        <DetailRow label="Total duration" value={longDuration(stats.duration_s)} />
        <DetailRow label="Active time" value={longDuration(stats.active_time_s)} />
        <DetailRow label="Steps" value={show(stats.step_count)} />
        <DetailRow label="Average cadence" value={show(stats.avg_cadence, ' steps/min')} />
        <DetailRow label="Average impact" value={show(stats.avg_impact, ' g')} />
        <DetailRow label="Hardest step" value={`${show(stats.max_impact, ' g')} at ${clock(stats.max_impact_at_s)}`} />
        <DetailRow
          label="Hard impacts"
          value={`${show(stats.high_impact_count)} (${show(stats.high_impact_pct, '%')})`}
        />
        <DetailRow label="Fatigue ratio" value={show(stats.fatigue_ratio)} />
        <DetailRow label="Avg knee angle at impact" value={show(stats.avg_angle_at_impact, '°')} />
        <DetailRow label="Min knee angle at impact" value={show(stats.min_angle_at_impact, '°')} />
        <DetailRow label="Max knee angle at impact" value={show(stats.max_angle_at_impact, '°')} />
        {detail.gaps.length > 0 && (
          <DetailRow label="Sensor connection gaps" value={`${detail.gaps.length} (${timer(gapSeconds)} total)`} />
        )}
      </Card>

      {buckets && (
        <Card>
          <Heading>Impact distribution</Heading>
          {(
            [
              ['Soft', buckets.soft],
              ['Medium', buckets.medium],
              ['Hard', buckets.hard],
            ] as const
          ).map(([label, count]) => {
            const total = buckets.soft + buckets.medium + buckets.hard || 1;
            const pct = Math.round((count / total) * 100);
            return (
              <View key={label} accessible accessibilityLabel={`${label}: ${count} steps, ${pct} percent`}>
                <Text style={styles.bucketLabel}>
                  {label}: {count} ({pct}%)
                </Text>
                <View style={styles.bucketTrack}>
                  <View style={[styles.bucketBar, { width: `${pct}%` }]} />
                </View>
              </View>
            );
          })}
        </Card>
      )}

      <StepCharts detail={detail} highImpact={highImpact} />

      {stats.per_minute && stats.per_minute.length > 0 && (
        <Card>
          <Heading>Per minute</Heading>
          <View style={[styles.tableRow, styles.tableHead]}>
            {['Minute', 'Steps', 'Avg impact', 'Max impact'].map((h) => (
              <Text key={h} style={[styles.cell, styles.headCell]}>
                {h}
              </Text>
            ))}
          </View>
          {stats.per_minute.map((p) => (
            <View key={p.min} style={styles.tableRow}>
              <Text style={styles.cell}>{p.min + 1}</Text>
              <Text style={styles.cell}>{p.steps}</Text>
              <Text style={styles.cell}>{show(p.avg_impact)}</Text>
              <Text style={styles.cell}>{show(p.max_impact)}</Text>
            </View>
          ))}
        </Card>
      )}

      <Body muted>
        Impact values are a dynamic acceleration proxy (|acceleration − 1 g|) from the shin sensor, and knee angles are
        estimates relative to the straight leg at the start of the hike. They are useful for comparing your own hikes,
        not medically validated measurements.
      </Body>
    </Screen>
  );
}

function StepCharts({ detail, highImpact }: { detail: HikeDetail; highImpact: number }) {
  const impacts = detail.impacts;
  if (!impacts) {
    return <Notice tone="error">Could not load this hike’s step data: {detail.impactsError}</Notice>;
  }
  if (impacts.length === 0) {
    return (
      <EmptyState title="No steps">
        <Body muted>No steps were detected during this hike.</Body>
      </EmptyState>
    );
  }

  const { bad, badCount, bend, straightIs180, angleLimit } = classifyLandings(impacts, highImpact);
  const accelPoints: StepPoint[] = impacts.map((i, n) => ({ step: n + 1, value: i.accel, bad: bad[n] }));
  const anglePoints: StepPoint[] = impacts.map((i, n) => ({ step: n + 1, value: i.angle, bad: bad[n] }));

  let maxAccel = highImpact;
  let minAngle = angleLimit;
  let maxAngle = angleLimit;
  for (const i of impacts) {
    maxAccel = Math.max(maxAccel, i.accel);
    minAngle = Math.min(minAngle, i.angle);
    maxAngle = Math.max(maxAngle, i.angle);
  }

  const describe = (step: number) => {
    const i = impacts[step - 1];
    return (
      `Step ${step}, ${clock(i.t / 1000)} into the hike · impact ${i.accel.toFixed(2)} g · ` +
      `knee ${i.angle.toFixed(1)}° (bent ${bend(i.angle).toFixed(1)}°)` +
      (bad[step - 1] ? ' · bad landing' : '')
    );
  };

  const rule =
    `impact ${highImpact.toFixed(1)} g or more with the knee bent less than ${MAX_BEND_FOR_BAD_LANDING}° ` +
    `(knee angle ${straightIs180 ? 'above' : 'below'} ${angleLimit}°)`;

  return (
    <Card>
      <Heading>Every step</Heading>
      <Body>
        {badCount === 0
          ? `No bad landings in ${impacts.length} steps.`
          : `${badCount} bad landing${badCount === 1 ? '' : 's'} in ${impacts.length} steps (${+((badCount / impacts.length) * 100).toFixed(1)}%).`}
      </Body>
      <View style={styles.legend}>
        <View style={[styles.swatch, { backgroundColor: colors.series }]} />
        <Text style={styles.legendText}>Each step</Text>
        <View style={[styles.swatch, { backgroundColor: colors.bad }]} />
        <Text style={styles.legendText}>Bad landing</Text>
      </View>
      <Body muted>Bad landing: {rule}.</Body>

      <Text style={styles.chartTitle}>Impact (g)</Text>
      <StepChart
        points={accelPoints}
        yDomain={[0, maxAccel * 1.1]}
        yLabel="Impact (g)"
        refLine={{ value: highImpact, label: `${highImpact.toFixed(1)} g` }}
        describe={describe}
      />
      <Text style={styles.chartTitle}>Knee angle at impact (°)</Text>
      <StepChart
        points={anglePoints}
        yDomain={[
          Math.max(0, Math.floor(minAngle - 5)),
          Math.min(straightIs180 ? 185 : Infinity, Math.ceil(maxAngle + 5)),
        ]}
        yLabel="Knee angle (°)"
        refLine={{ value: angleLimit, label: `${angleLimit}° (bent ${MAX_BEND_FOR_BAD_LANDING}°)` }}
        describe={describe}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  bucketLabel: { color: colors.text, fontSize: 14, marginBottom: 4 },
  bucketTrack: { height: 10, borderRadius: radius.sm, backgroundColor: colors.green2, overflow: 'hidden' },
  bucketBar: { height: '100%', backgroundColor: colors.primary },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomColor: colors.green,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableHead: { borderBottomWidth: 1 },
  cell: { flex: 1, color: colors.text, fontSize: 14, fontVariant: ['tabular-nums'] },
  headCell: { fontWeight: '700' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  swatch: { width: 12, height: 12, borderRadius: 6, marginLeft: spacing.sm },
  legendText: { color: colors.text, fontSize: 13 },
  chartTitle: { color: colors.text, fontWeight: '700', marginTop: spacing.md },
});
