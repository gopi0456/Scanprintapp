import { createClient } from '@supabase/supabase-js';

// Credentials stored base64-encoded (obfuscated) - decoded only at runtime
const SUPABASE_URL_B64 = 'aHR0cHM6Ly9idmNnd3F3ZGJkaXJuemhheGl2eS5zdXBhYmFzZS5jbw==';
const SUPABASE_ANON_KEY_B64 = 'ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW1KMlkyZDNjWGRrWW1ScGNtNTZhR0Y0YVhaNUlpd2ljbTlzWlNJNkltRnViMjRpTENKcFlYUWlPakUzT1RBNE1qTXhNVGNzSW1WNGNDSTZNakV3TmpNNU9URXhOMzAucW8yRUN6LUF3X3FNOFNEWmI2dGdyaXJITmZCU3hFSUpkSy13VEY4eldDWQ==';

function b64decode(s) {
  try { return atob(s); } catch (e) { return s; }
}

export const supabase = createClient(b64decode(SUPABASE_URL_B64), b64decode(SUPABASE_ANON_KEY_B64));
export const TABLE = 'scanprintuser';
