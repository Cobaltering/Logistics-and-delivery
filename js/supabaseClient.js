// Shared Supabase connection used by the browser pages.
// The browser may use the public anon key only; never put the service-role key here.
const SUPABASE_URL = 'https://ruvqweqnrmwruindpmgy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1dnF3ZXFucm13cnVpbmRwbWd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4MjkxOTIsImV4cCI6MjEwODQwNTE5Mn0.Qz02pMSERyoxeJtRD4eeqQjuu2bLAVYvPSSIPjrWezk';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);