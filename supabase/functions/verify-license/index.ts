import { createClient } from 'npm:@supabase/supabase-js@2'
import * as jose from 'https://deno.land/x/jose@v4.14.4/index.ts'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        let { licenseKey, machineId } = await req.json()

        if (!machineId) {
            throw new Error("Missing machineId")
        }

        // Initialize Supabase
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        let license = null;

        // 1. Verify License in DB
        if (licenseKey) {
            // Standard verification by Key
            const { data, error } = await supabase
                .from('licenses')
                .select('*')
                .eq('license_key', licenseKey)
                .maybeSingle()

            if (!error) license = data;
        } else {
            // 2. Recovery Lookup by Machine ID (if no key provided)
            // Look for ANY license bound to this machine.
            // Priority: Paid > Trial (if we store trials here? assumed yes or separate)
            // Ideally we want the most recent 'paid' license.
            const { data, error } = await supabase
                .from('licenses')
                .select('*')
                .eq('machine_id', machineId)
                .eq('license_type', 'paid') // Prioritize paid recovery
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (!error && data) {
                license = data;
                licenseKey = data.license_key; // Recover the key
                console.log(`Recovered license ${licenseKey} for machine ${machineId}`);
            }
        }

        if (!license) {
            return new Response(JSON.stringify({ valid: false, message: 'Invalid License' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200
            })
        }

        // Check machine ID matching or binding
        if (license.machine_id && license.machine_id !== machineId) {
            // AUTOMATIC TRANSFER: 
            // Logic: If a valid key is provided, we allow "Taking Over" the license.
            // This fulfills "switch devices" but "one at a time" (since DB only holds one ID).
            console.log(`Transferring license ${licenseKey} from ${license.machine_id} to ${machineId}`)

            const { error: updateError } = await supabase
                .from('licenses')
                .update({ machine_id: machineId })
                .eq('id', license.id)

            if (updateError) {
                throw new Error("Failed to transfer license to new machine")
            }
        }

        // If machine_id is null, bind it now (first use)
        if (!license.machine_id) {
            await supabase.from('licenses').update({ machine_id: machineId }).eq('id', license.id)
        }

        // Check expiration
        let expiresAt: Date | null = null;
        if (license.expires_at) {
            expiresAt = new Date(license.expires_at);
            if (expiresAt < new Date()) {
                return new Response(JSON.stringify({
                    valid: false,
                    message: 'License Expired',
                    licenseType: license.license_type,
                    expiresAt: license.expires_at
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 200
                })
            }
        }

        // 2. Generate Signed JWT
        const privateKeyPem = Deno.env.get('LICENSE_PRIVATE_KEY')
        if (!privateKeyPem) {
            console.error("LICENSE_PRIVATE_KEY secret is missing!")
            throw new Error("Server misconfiguration: Missing signing key")
        }

        const privateKey = await jose.importPKCS8(privateKeyPem, 'RS256')

        // TOKEN EXPIRATION POLICY:
        // Token expires in 24 hours OR when license expires (whichever is sooner).
        const oneDayCheck = new Date(Date.now() + 24 * 60 * 60 * 1000)

        // If license has no expiry (lifetime) or expires > 24h, use 24h token.
        // If license expires < 24h, token dies with license.
        let tokenExpiresAt = oneDayCheck;
        if (expiresAt && expiresAt < oneDayCheck) {
            tokenExpiresAt = expiresAt;
        }

        // Fix: jose expects number (Unix timestamp in seconds) or string duration
        const tokenExpiresEpoch = Math.floor(tokenExpiresAt.getTime() / 1000)

        const jwt = await new jose.SignJWT({
            licenseKey: license.license_key,
            licenseType: license.license_type,
            expiresAt: license.expires_at, // pass original string/null
            machineId: machineId
        })
            .setProtectedHeader({ alg: 'RS256' })
            .setIssuedAt()
            .setExpirationTime(tokenExpiresEpoch) // Token itself dies in 24h
            .sign(privateKey)

        return new Response(JSON.stringify({
            valid: true,
            token: jwt,
            message: 'License Verified',
            licenseType: license.license_type,
            expiresAt: license.expires_at
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        })

    } catch (error) {
        console.error("Verification error:", error)
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400
        })
    }
})
