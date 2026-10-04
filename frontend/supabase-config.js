// supabase-config.js
SUPABASE_URL='https://umfxgytmfgcpjnzylcmc.supabase.co'
SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtZnhneXRtZmdjcGpuenlsY21jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5Njc5NjQsImV4cCI6MjEwNjU0Mzk2NH0.Y9m2-S6wLla1J_DcILwhROfd5svat9bWWfSQmu7Cb5I'


// the CDN script creates a global called `supabase`, so name our client `sb`
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
