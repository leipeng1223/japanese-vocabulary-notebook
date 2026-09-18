import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', workers: 1, use: { baseURL: 'http://127.0.0.1:8002', browserName:'chromium', channel:process.env.PLAYWRIGHT_CHANNEL || undefined },
  webServer: { command:'npm run dev -- --port 8002', url:'http://127.0.0.1:8002', reuseExistingServer:false, env:{VITE_SUPABASE_URL:'https://vocab-test.supabase.co',VITE_SUPABASE_ANON_KEY:'public-test-key'} },
});
