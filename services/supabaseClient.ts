
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://poyashauvewhifohkxeg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBveWFzaGF1dmV3aGlmb2hreGVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5NTI2OTgsImV4cCI6MjA4MDUyODY5OH0.WWDtyUhPo1GO48sgDGPi5RCHmTvzvzMSSckTyAAqiwA';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
