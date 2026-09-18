import { createClient } from '@supabase/supabase-js';
import { createHandler } from './core.js';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const scoped = (token: string) => createClient(url, anonKey, {
  global: { headers: { Authorization: `Bearer ${token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(createHandler({
  allowedOrigins: (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean),
  deeplKey: Deno.env.get('DEEPL_API_KEY') || '',
  authenticate: async (token: string) => {
    const { data, error } = await scoped(token).auth.getUser(token);
    return !error && Boolean(data.user);
  },
  quota: async (token: string) => {
    const { data, error } = await scoped(token).rpc('consume_dictionary_quota');
    if (error) throw new Error('quota unavailable');
    return data === true;
  },
}));
