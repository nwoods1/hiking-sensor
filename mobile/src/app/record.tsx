import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useUserId } from '@/auth/AuthProvider';
import { startScan, type ScanHandle, type ScannedDevice } from '@/ble/scanner';
import { MOCK_DEVICE } from '@/ble/mockTransport';
import { env } from '@/config/env';
import { useLiveChart, useNow, useRecorder } from '@/hooks/services';
import { mockTransport, recorder } from '@/recording';
import { LIVE_CHART_POINTS } from '@/sensor/constants';
import { LiveChart } from '@/ui/charts';
import { Body, Button, Card, Eyebrow, Heading, Metric, Notice, Screen, Title } from '@/ui/components';
import { fixed, formatDateTime, timer } from '@/ui/format';
import { colors, radius, spacing } from '@/ui/theme';

const SCAN_DURATION_MS = 20_000;
const showMockOption = __DEV__ || env.enableMockSensor;

export default function RecordScreen() {
  const userId = useUserId();
  const params = useLocalSearchParams<{ name?: string }>();
  const rec = useRecorder();
  const recording = rec.session != null;
  const now = useNow(recording);
  const chart = useLiveChart(recording);

  const hikeName = rec.session?.name ?? rec.pendingResume?.name ?? params.name ?? null;
  const [starting, setStarting] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // Leaving before Start releases the sensor; a running hike keeps going.
  useEffect(
    () => () => {
      if (!recorder.getSnapshot().session) void recorder.disconnect();
    },
    [],
  );

  if (!recording && !rec.pendingResume && !params.name) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Notice>Name your hike before connecting the sensor.</Notice>
        <Button label="Name a new hike" onPress={() => router.replace('/new-hike')} />
      </Screen>
    );
  }

  async function start() {
    setStarting(true);
    try {
      await recorder.start({ name: hikeName, userId });
    } catch (error) {
      Alert.alert('Could not start recording', error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  }

  function confirmFinish() {
    Alert.alert('Finish this hike?', 'Recording stops and the hike is saved and uploaded.', [
      { text: 'Keep recording', style: 'cancel' },
      {
        text: 'Finish hike',
        onPress: async () => {
          setFinishing(true);
          try {
            const id = await recorder.finish();
            router.replace({ pathname: '/hike/[id]', params: { id } });
          } catch (error) {
            Alert.alert('Could not finish', error instanceof Error ? error.message : String(error));
          } finally {
            setFinishing(false);
          }
        },
      },
    ]);
  }

  function confirmDiscard() {
    Alert.alert('Discard this hike?', 'Everything recorded for this hike will be deleted from this phone.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          await recorder.discard();
          router.back();
        },
      },
    ]);
  }

  const lastStrike = rec.live.lastStrike;

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <View>
        <Eyebrow>
          {recording
            ? rec.session?.resumed
              ? 'Resumed hike'
              : 'Recording'
            : rec.pendingResume
              ? 'Resume hike'
              : 'Ready when you are'}
        </Eyebrow>
        <Title>{hikeName ?? 'Untitled hike'}</Title>
        {rec.pendingResume && !recording && (
          <Body muted>
            Started {formatDateTime(rec.pendingResume.startedAt)}. Connect the sensor and press Continue; the time the
            app was closed is saved as a gap.
          </Body>
        )}
      </View>

      {!recording && <ConnectionPanel />}

      <Card tone="green" style={styles.center}>
        <Eyebrow>Hike timer</Eyebrow>
        <Text
          style={styles.timer}
          accessibilityLabel={`Elapsed time ${timer(recording ? (now - rec.session!.startedAt) / 1000 : 0)}`}>
          {timer(recording ? (now - rec.session!.startedAt) / 1000 : 0)}
        </Text>
        <Body muted>
          {recording
            ? rec.phase === 'reconnecting'
              ? 'Hike in progress · waiting for the sensor'
              : 'Hike in progress'
            : 'Timer has not started.'}
        </Body>
        {!recording ? (
          <Button
            label={rec.pendingResume ? 'Continue hike' : 'Start hike'}
            onPress={start}
            disabled={rec.phase !== 'connected'}
            loading={starting}
            accessibilityHint="Keep your leg straight and still for a few seconds after you press start; that position is calibrated as 180 degrees."
            style={styles.wide}
          />
        ) : (
          <Button
            label="Finish hike"
            variant="secondary"
            onPress={confirmFinish}
            loading={finishing}
            style={styles.wide}
          />
        )}
        {!recording && rec.phase === 'connected' && (
          <Body muted style={styles.centerText}>
            Stand with your leg straight and still for a few seconds after you press Start: that position is calibrated
            as a straight knee (180°).
          </Body>
        )}
      </Card>

      {recording && rec.phase === 'reconnecting' && (
        <Card>
          <Notice tone="warning">
            {rec.error ?? 'Sensor disconnected.'} Your hike is still being recorded; the time without data is saved as a
            gap
            {rec.gapStartedAt ? ` (${timer((now - rec.gapStartedAt) / 1000)} so far)` : ''}. Attempt{' '}
            {rec.reconnectAttempts}.
          </Notice>
          <Button label="Try reconnecting now" variant="secondary" onPress={() => recorder.retryReconnect()} />
        </Card>
      )}

      {recording && rec.live.calibrating && (
        <Notice tone="warning">Calibrating: keep your leg straight and still.</Notice>
      )}

      {rec.storageError && <Notice tone="error">{rec.storageError}</Notice>}

      {recording && (
        <>
          <View style={styles.metrics}>
            <Metric label="Knee angle" value={fixed(rec.live.kneeAngle, 1)} unit="°" large />
            <Metric label="Steps" value={String(rec.live.steps)} large />
            <Metric label="Acceleration" value={fixed(rec.live.acceleration, 2)} unit="g" />
            <Metric label="Impact (dynamic)" value={fixed(rec.live.impact, 2)} unit="g" />
          </View>

          <Card>
            <Heading>Last foot strike</Heading>
            <View style={styles.metrics}>
              <Metric label="Knee angle at impact" value={fixed(lastStrike?.kneeAngle, 1)} unit="°" />
              <Metric label="Impact strength" value={fixed(lastStrike?.impact, 2)} unit="g" />
              <Metric label="Average impact" value={fixed(rec.live.averageImpact, 2)} unit="g" />
              <Metric label="Hardest impact" value={fixed(rec.live.maxImpact, 2)} unit="g" />
            </View>
          </Card>

          <Card>
            <Heading>Live knee angle</Heading>
            <LiveChart
              values={chart.knee}
              markers={chart.markers}
              capacity={LIVE_CHART_POINTS}
              maxValue={180}
              unit="°"
              label="Live knee angle chart"
            />
          </Card>
          <Card>
            <Heading>Live impact</Heading>
            <LiveChart
              values={chart.impact}
              markers={chart.markers}
              capacity={LIVE_CHART_POINTS}
              maxValue={3}
              unit="g"
              label="Live impact chart"
            />
            <Body muted>Red dots are detected foot strikes.</Body>
          </Card>

          <Card tone="green">
            <Body muted>
              {rec.packetsPerSecond} packets/s · {rec.packets} received
              {rec.badPackets ? ` · ${rec.badPackets} malformed` : ''}
              {rec.gapCount ? ` · ${rec.gapCount} connection gap${rec.gapCount === 1 ? '' : 's'}` : ''}
            </Body>
            <Body muted>
              Acceleration is the shin sensor’s total acceleration including gravity. Impact is |acceleration − 1 g|, a
              rough dynamic-impact proxy: not a force on the knee and not a medical measurement.
            </Body>
          </Card>

          {rec.device?.source === 'mock' && (
            <Button
              label="Simulate a 10-second dropout"
              variant="secondary"
              onPress={() => mockTransport.simulateDropout(10_000)}
            />
          )}
          <Button label="Discard this hike" variant="text" onPress={confirmDiscard} />
        </>
      )}
    </Screen>
  );
}

function ConnectionPanel() {
  const rec = useRecorder();
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [showOthers, setShowOthers] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const scanRef = useRef<ScanHandle | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function stopScan() {
    scanRef.current?.stop();
    scanRef.current = null;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setScanning(false);
  }

  useEffect(() => stopScan, []);

  async function scan() {
    stopScan();
    setDevices([]);
    setScanError(null);
    setScanning(true);
    try {
      scanRef.current = await startScan(
        (device) =>
          setDevices((list) => {
            const others = list.filter((d) => d.id !== device.id);
            return [...others, device].sort(
              (a, b) => Number(b.isSensor) - Number(a.isSensor) || (b.rssi ?? -999) - (a.rssi ?? -999),
            );
          }),
        (message) => {
          setScanError(message);
          stopScan();
        },
      );
      timeoutRef.current = setTimeout(stopScan, SCAN_DURATION_MS);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : String(error));
      setScanning(false);
    }
  }

  async function connect(source: 'ble' | 'mock', id: string) {
    stopScan();
    await recorder.connect(source, id).catch(() => {}); // error shown from rec.error
  }

  const sensors = devices.filter((d) => d.isSensor);
  const others = devices.filter((d) => !d.isSensor && d.name);

  if (rec.phase === 'connecting') {
    return (
      <Card>
        <Heading>Connecting…</Heading>
        <ActivityIndicator color={colors.primary} />
        <Button label="Cancel" variant="secondary" onPress={() => void recorder.disconnect()} />
      </Card>
    );
  }

  if (rec.phase === 'connected' && rec.device) {
    return (
      <Card>
        <Heading>Sensor connected</Heading>
        <Body>
          Connected to {rec.device.name}
          {rec.device.source === 'mock' ? ' (test mode)' : ''}.
        </Body>
        <Body muted>
          {rec.packets === 0 ? 'Waiting for data…' : `Receiving ${rec.packetsPerSecond} packets/s`}
          {rec.badPackets ? ` · ${rec.badPackets} malformed` : ''}
        </Body>
        <Button label="Disconnect" variant="secondary" onPress={() => void recorder.disconnect()} />
      </Card>
    );
  }

  return (
    <Card>
      <Heading>Connect your sensor</Heading>
      <Body muted>
        Turn on the ESP32 and keep it close to your phone. Only one phone can be connected to it at a time.
      </Body>
      {rec.error && <Notice tone="error">{rec.error}</Notice>}
      {scanError && <Notice tone="error">{scanError}</Notice>}
      <Button
        label={scanning ? 'Scanning…' : 'Scan for sensor'}
        onPress={scan}
        loading={scanning && devices.length === 0}
      />

      {sensors.map((d) => (
        <DeviceRow key={d.id} device={d} onPress={() => connect('ble', d.id)} />
      ))}
      {scanning && sensors.length === 0 && devices.length > 0 && <Body muted>No “Hiking Sensor” found yet…</Body>}
      {!scanning && devices.length > 0 && sensors.length === 0 && (
        <Notice tone="warning">
          No device advertising the Soft Steps sensor was found. Check it is powered and not connected to another phone.
        </Notice>
      )}

      {others.length > 0 && (
        <Button
          label={showOthers ? 'Hide other devices' : `Show other devices (${others.length})`}
          variant="text"
          onPress={() => setShowOthers((v) => !v)}
        />
      )}
      {showOthers && others.map((d) => <DeviceRow key={d.id} device={d} onPress={() => connect('ble', d.id)} />)}

      {showMockOption && (
        <Button
          label="Use simulated sensor (no hardware)"
          variant="secondary"
          onPress={() => connect('mock', MOCK_DEVICE.id)}
          accessibilityHint="Generates walking data like the web app's mock Bluetooth mode"
        />
      )}
    </Card>
  );
}

function DeviceRow({ device, onPress }: { device: ScannedDevice; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Connect to ${device.name ?? 'unnamed device'}${device.isSensor ? ', Soft Steps sensor' : ''}`}
      style={({ pressed }) => [styles.device, device.isSensor && styles.deviceSensor, pressed && styles.devicePressed]}>
      <Text style={styles.deviceName}>{device.name ?? 'Unnamed device'}</Text>
      <Text style={styles.deviceMeta}>
        {device.isSensor ? 'Soft Steps sensor · ' : ''}
        {device.rssi != null ? `signal ${device.rssi} dBm` : ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
  wide: { alignSelf: 'stretch' },
  timer: { fontSize: 48, fontWeight: '700', color: colors.timer, fontVariant: ['tabular-nums'] },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  device: {
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.green,
    backgroundColor: colors.surface,
  },
  deviceSensor: { backgroundColor: colors.green2, borderColor: colors.primary },
  devicePressed: { backgroundColor: colors.secondary },
  deviceName: { fontSize: 16, fontWeight: '700', color: colors.text },
  deviceMeta: { fontSize: 13, color: colors.muted },
});
