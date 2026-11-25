import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useUserId } from '@/auth/AuthProvider';
import { useNow, useRecorder, useSyncStatus } from '@/hooks/services';
import { recorder } from '@/recording';
import { getRepository } from '@/storage/database';
import type { LocalSessionSummary } from '@/storage/hikeRepository';
import { listHikes, type RemoteHike } from '@/supabase/hikesApi';
import { syncService } from '@/sync/syncService';
import { Body, Button, Card, EmptyState, Eyebrow, Heading, Loading, Notice, Screen, Title } from '@/ui/components';
import { formatDateTime, longDuration, timer } from '@/ui/format';
import { colors, radius, spacing } from '@/ui/theme';

type ListItem = {
  id: string;
  name: string | null;
  startedAt: number;
  durationS: number | null;
  steps: number | null;
  status: 'uploaded' | 'waiting' | 'failed';
  error: string | null;
};

function mergeHikes(remote: RemoteHike[], local: LocalSessionSummary[]): ListItem[] {
  const items = new Map<string, ListItem>();
  for (const h of remote) {
    items.set(h.id, {
      id: h.id,
      name: h.name,
      startedAt: Date.parse(h.started_at),
      durationS: h.duration_s,
      steps: h.step_count,
      status: 'uploaded',
      error: null,
    });
  }
  for (const s of local) {
    if (s.status !== 'finished' || items.has(s.id)) continue;
    items.set(s.id, {
      id: s.id,
      name: s.name,
      startedAt: s.started_at,
      durationS: s.ended_at != null ? Math.round((s.ended_at - s.started_at) / 1000) : null,
      steps: s.step_count,
      status: s.sync_state === 'synced' ? 'uploaded' : s.sync_error ? 'failed' : 'waiting',
      error: s.sync_error,
    });
  }
  return [...items.values()].sort((a, b) => b.startedAt - a.startedAt);
}

async function loadDashboard(userId: string) {
  const repo = await getRepository();
  const [local, recording] = await Promise.all([repo.listSessions(userId), repo.listRecording(userId)]);
  let remote: RemoteHike[] = [];
  let remoteError: string | null = null;
  try {
    remote = await listHikes();
  } catch (error) {
    remoteError = error instanceof Error ? error.message : String(error);
  }
  return {
    hikes: mergeHikes(remote, local),
    // The hike being recorded right now isn't "unfinished".
    unfinished: recording.filter((s) => s.id !== recorder.getSnapshot().session?.id),
    remoteError,
  };
}

export default function DashboardScreen() {
  const userId = useUserId();
  const rec = useRecorder();
  const sync = useSyncStatus();
  const now = useNow(rec.session != null);

  const [hikes, setHikes] = useState<ListItem[] | null>(null);
  const [unfinished, setUnfinished] = useState<LocalSessionSummary[]>([]);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // Reload on focus, on pull-to-refresh, and whenever a sync changes what's uploaded.
  useFocusEffect(reload);
  useEffect(() => {
    let cancelled = false;
    loadDashboard(userId).then((data) => {
      if (cancelled) return;
      setHikes(data.hikes);
      setUnfinished(data.unfinished);
      setRemoteError(data.remoteError);
      setRefreshing(false);
    });
    void syncService.refreshPendingCount();
    return () => {
      cancelled = true;
    };
  }, [userId, reloadKey, sync.version]);

  function refresh() {
    setRefreshing(true);
    syncService
      .requestSync({ force: true })
      .catch(() => {})
      .finally(reload);
  }

  function resume(session: LocalSessionSummary) {
    recorder.prepareResume(session);
    router.push('/record');
  }

  function finishUnfinished(session: LocalSessionSummary) {
    Alert.alert('Finish this hike?', 'It will be saved as it was when the app stopped recording.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Finish',
        onPress: async () => {
          await recorder.finishRecovered(session).catch((e) => Alert.alert('Could not finish', String(e)));
          reload();
        },
      },
    ]);
  }

  function discardUnfinished(session: LocalSessionSummary) {
    Alert.alert('Delete this hike?', 'Its recorded steps will be removed from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await recorder.discardRecovered(session).catch((e) => Alert.alert('Could not delete', String(e)));
          reload();
        },
      },
    ]);
  }

  const recording = rec.session != null;

  return (
    <Screen
      tabs
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
      <View style={styles.header}>
        <Image source={require('@/assets/images/logo.png')} style={styles.logo} accessibilityIgnoresInvertColors />
        <View style={styles.headerText}>
          <Eyebrow>Your hikes</Eyebrow>
          <Title>Soft Steps</Title>
        </View>
      </View>

      {recording ? (
        <Card tone="green">
          <Eyebrow>{rec.phase === 'reconnecting' ? 'Recording · sensor reconnecting' : 'Recording now'}</Eyebrow>
          <Heading>{rec.session?.name ?? 'Untitled hike'}</Heading>
          <Text style={styles.timer}>{timer((now - rec.session!.startedAt) / 1000)}</Text>
          <Body muted>{rec.live.steps} steps detected</Body>
          <Button label="Open recording" onPress={() => router.push('/record')} />
        </Card>
      ) : (
        <Button label="Start a new hike" onPress={() => router.push('/new-hike')} />
      )}

      {unfinished.map((s) => (
        <Card key={s.id}>
          <Eyebrow>Unfinished hike</Eyebrow>
          <Heading>{s.name ?? 'Untitled hike'}</Heading>
          <Body muted>
            Started {formatDateTime(s.started_at)} · {s.step_count} steps saved. The app closed before this hike was
            finished.
          </Body>
          <View style={styles.row}>
            {!recording && <Button label="Resume" onPress={() => resume(s)} style={styles.flex} />}
            <Button label="Finish" variant="secondary" onPress={() => finishUnfinished(s)} style={styles.flex} />
          </View>
          <Button label="Delete" variant="text" onPress={() => discardUnfinished(s)} />
        </Card>
      ))}

      {sync.pending > 0 && (
        <Notice tone={sync.lastError ? 'warning' : 'info'}>
          {sync.running
            ? `Uploading ${sync.pending} hike${sync.pending === 1 ? '' : 's'}…`
            : `${sync.pending} hike${sync.pending === 1 ? ' is' : 's are'} saved on this phone and waiting to upload.` +
              (sync.lastError ? ` Last attempt: ${sync.lastError}` : '')}
        </Notice>
      )}
      {sync.pending > 0 && !sync.running && (
        <Button
          label="Retry upload now"
          variant="secondary"
          onPress={() => void syncService.requestSync({ force: true })}
        />
      )}

      {remoteError && (
        <Notice tone="warning">
          Couldn’t load hikes from your account ({remoteError}). Showing hikes saved on this phone.
        </Notice>
      )}

      {hikes == null ? (
        <Loading label="Loading your hikes…" />
      ) : hikes.length === 0 ? (
        <EmptyState title="No hikes yet">
          <Body muted>Start a new hike to see it here.</Body>
        </EmptyState>
      ) : (
        <View style={styles.list} accessibilityRole="list">
          {hikes.map((h) => (
            <Pressable
              key={h.id}
              onPress={() => router.push({ pathname: '/hike/[id]', params: { id: h.id } })}
              accessibilityRole="button"
              accessibilityLabel={`${h.name ?? 'Untitled hike'}, ${formatDateTime(h.startedAt)}, ${longDuration(h.durationS)}${h.status === 'uploaded' ? '' : ', not uploaded yet'}`}
              style={({ pressed }) => [styles.hikeCard, pressed && styles.hikeCardPressed]}>
              <Text style={styles.hikeName}>{h.name ?? 'Untitled hike'}</Text>
              <Body>{formatDateTime(h.startedAt)}</Body>
              <Body muted>
                Duration: {longDuration(h.durationS)}
                {h.steps != null ? ` · ${h.steps} steps` : ''}
              </Body>
              {h.status !== 'uploaded' && (
                <Text style={[styles.badge, h.status === 'failed' && styles.badgeFailed]}>
                  {h.status === 'failed' ? 'Upload failed · will retry' : 'On this phone · waiting to upload'}
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerText: { flex: 1 },
  logo: { width: 64, height: 59 },
  timer: { fontSize: 40, fontWeight: '700', color: colors.timer, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  list: { gap: spacing.md },
  hikeCard: {
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.green,
    backgroundColor: colors.green2,
    gap: 2,
  },
  hikeCardPressed: { backgroundColor: colors.green },
  hikeName: { fontSize: 18, fontWeight: '700', color: colors.text },
  badge: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.secondaryAccent,
    color: colors.text,
    fontSize: 13,
    overflow: 'hidden',
  },
  badgeFailed: { backgroundColor: colors.errorBackground, color: colors.error },
});
