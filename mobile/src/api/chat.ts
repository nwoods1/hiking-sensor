// Client for the existing Express backend's POST /chat (backend/server.js),
// which answers questions about the signed-in user's hikes. The backend
// identifies the user from the Supabase access token.

import { env } from '@/config/env';
import { supabase } from '@/supabase/client';

// The Render free tier can take close to a minute to wake up.
const TIMEOUT_MS = 90_000;

export class ChatAuthError extends Error {}

async function post(question: string, token: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${env.backendUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ question }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('The assistant took too long to answer. The server may be waking up; try again.');
    }
    throw new Error('Could not reach the assistant. Check your connection and try again.', { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

export async function askAssistant(question: string): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new ChatAuthError('Please sign in first so I can look at your hikes.');

  let response = await post(question, data.session.access_token);

  // The token may have been revoked or expired server-side; refresh once.
  if (response.status === 401) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error || !refreshed.data.session) {
      throw new ChatAuthError('Your sign-in has expired. Please sign in again.');
    }
    response = await post(question, refreshed.data.session.access_token);
    if (response.status === 401) throw new ChatAuthError('Your sign-in has expired. Please sign in again.');
  }

  const body = (await response.json().catch(() => ({}))) as { answer?: string; error?: string };
  if (!response.ok) throw new Error(body.error || `The assistant failed (HTTP ${response.status}).`);
  return body.answer ?? '';
}
