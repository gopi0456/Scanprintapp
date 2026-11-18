import { supabase } from '../supabaseClient.js';
export function getSupabase() { return supabase; }
export const supabaseConfigured = true;
export * from '../supabaseClient.js';
