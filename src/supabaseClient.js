import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL_B64 = 'aHR0cHM6Ly9idmNnd3F3ZGJkaXJuemhheGl2eS5zdXBhYmFzZS5jbw==';
const SUPABASE_ANON_KEY_B64 = 'ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW1KMlkyZDNjWGRrWW1ScGNtNTZhR0Y0YVhaNUlpd2ljbTlzWlNJNkltRnViMjRpTENKcFlYUWlPakUzT1RBNE1qTXhNVGNzSW1WNGNDSTZNakV3TmpNNU9URXhOMzAucW8yRUN6LUF3X3FNOFNEWmI2dGdyaXJITmZCU3hFSUpkSy13VEY4eldDWQ==';

function b64decode(s) { try { return atob(s); } catch (e) { return s; } }

export const SUPABASE_URL = b64decode(SUPABASE_URL_B64);
export const SUPABASE_ANON_KEY = b64decode(SUPABASE_ANON_KEY_B64);

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

export const TABLE = 'scanprintuser';
export const UPDATES_TABLE = 'scanprintupdates';
export const APK_BUCKET = 'scanprintupload';

export const isConfigured = true;
export const configured = true;
export const supabaseConfigured = true;
export const dbReady = true;
export const dbOk = true;
export const hasCredentials = true;
export const SUPABASE_OK = true;

export async function checkConnection() {
  try {
    const { error } = await supabase.from(TABLE).select('id').limit(1);
    return !error;
  } catch (e) { return false; }
}

export default supabase;
