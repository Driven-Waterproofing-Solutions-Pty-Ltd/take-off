import { createClient } from '@supabase/supabase-js';

// Configuration - REPLACE WITH YOUR PROJECT DETAILS
const SUPABASE_URL = 'https://poyashauvewhifohkxeg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBveWFzaGF1dmV3aGlmb2hreGVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5NTI2OTgsImV4cCI6MjA4MDUyODY5OH0.WWDtyUhPo1GO48sgDGPi5RCHmTvzvzMSSckTyAAqiwA';

// A license key to test with (replace if you have a specific one, otherwise this tests the "Invalid License" path which still hits the function)
const LICENSE_KEY = 'TEST-KEY-1234';
const MACHINE_ID = 'test-machine-id';

console.log("Testing verify-license Edge Function...");

async function test() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    try {
        const { data, error } = await supabase.functions.invoke('verify-license', {
            body: { licenseKey: LICENSE_KEY, machineId: MACHINE_ID }
        });

        if (error) {
            console.error("❌ Function Call Error:", error);
            return;
        }

        console.log("✅ Function Response:", data);

        if (data.token) {
            console.log("\n✨ SUCCESS! The server returned a Signed Token.");
            console.log("Token:", data.token);
            console.log("This confirms the Private Key is set correctly on Supabase.");
        } else if (data.message === 'Invalid License') {
            console.log("\n✅ Function is working (it correctly rejected a fake key).");
            console.log("To fully test the signature, edit this script with a REAL valid license key.");
        }

    } catch (e) {
        console.error("Unexpected error:", e);
    }
}

test();
