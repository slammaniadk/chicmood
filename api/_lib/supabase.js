const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

// Public client (anon key) — 카탈로그 읽기용
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Admin client (service_role key) — 회원/주문 CUD, RLS 우회
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

module.exports = { supabase, supabaseAdmin };
