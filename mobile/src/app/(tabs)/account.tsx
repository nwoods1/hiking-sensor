import Constants from 'expo-constants';
import { useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { useRecorder, useSyncStatus } from '@/hooks/services';
import { syncService } from '@/sync/syncService';
import { Body, Button, Card, DetailRow, Eyebrow, Heading, Notice, Screen, Title } from '@/ui/components';
import { formatDateTime } from '@/ui/format';

export default function AccountScreen() {
  const { session, signOut } = useAuth();
  const rec = useRecorder();
  const sync = useSyncStatus();
  const [busy, setBusy] = useState(false);

  async function doSignOut() {
    setBusy(true);
    try {
      await signOut();
    } catch (error) {
      Alert.alert('Could not sign out', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function confirmSignOut() {
    if (rec.session) {
      Alert.alert('Finish your hike first', 'A hike is being recorded. Finish it before signing out.');
      return;
    }
    if (sync.pending > 0) {
      Alert.alert(
        'Hikes not uploaded yet',
        `${sync.pending} hike${sync.pending === 1 ? ' is' : 's are'} saved on this phone but not uploaded. ` +
          'They stay on this phone and upload the next time you sign in with this account.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign out', style: 'destructive', onPress: () => void doSignOut() },
        ],
      );
      return;
    }
    void doSignOut();
  }

  return (
    <Screen tabs>
      <Eyebrow>Account</Eyebrow>
      <Title>Your account</Title>

      <Card>
        <DetailRow label="Signed in as" value={session?.user.email ?? 'your account'} />
        <DetailRow label="Hikes waiting to upload" value={String(sync.pending)} />
        <DetailRow
          label="Last upload"
          value={sync.lastSyncedAt ? formatDateTime(sync.lastSyncedAt) : 'This session: none'}
        />
        {sync.lastError && <Notice tone="warning">Last upload problem: {sync.lastError}</Notice>}
        <Button
          label="Upload pending hikes"
          variant="secondary"
          loading={sync.running}
          disabled={sync.pending === 0}
          onPress={() => void syncService.requestSync({ force: true })}
        />
        <Button label="Sign out" variant="danger" onPress={confirmSignOut} loading={busy} />
      </Card>

      <Card tone="green">
        <Heading>About the measurements</Heading>
        <Body>
          Knee angle is estimated from two motion sensors (thigh and shin), with 180° meaning the straight-leg position
          captured when you start a hike. Acceleration is the shin sensor’s total acceleration; impact is how far it is
          from 1 g, a rough proxy for how hard a step lands.
        </Body>
        <Body>
          These are estimates for comparing your own hikes. They are not measurements of force on the knee and are not
          medically validated.
        </Body>
      </Card>

      <Body muted>Soft Steps {Constants.expoConfig?.version ?? ''} · Made by the Hacker Snackers</Body>
    </Screen>
  );
}
