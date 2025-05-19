// SupabaseClient.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

export const supabase = createClient(
    'https://your-project.supabase.co',
    'public-anon-key'
);
