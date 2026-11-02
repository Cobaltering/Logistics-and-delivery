// supabaseClient.js - ikinokonekta ang mga page sa Supabase
// Ang public "anon" key lang ang pwede dito. HUWAG galawin guys, mawawalan ng connection sa database

const SUPABASE_URL = 'https://ruvqweqnrmwruindpmgy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1dnF3ZXFucm13cnVpbmRwbWd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4MjkxOTIsImV4cCI6MjEwODQwNTE5Mn0.Qz02pMSERyoxeJtRD4eeqQjuu2bLAVYvPSSIPjrWezk';

// Ang "sb" ang pangalan ng koneksyon na gamit sa ibang file
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);