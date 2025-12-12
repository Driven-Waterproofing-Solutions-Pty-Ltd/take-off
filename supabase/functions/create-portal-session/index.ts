import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@17.3.1'

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
    apiVersion: '2024-11-20.acacia',
    httpClient: Stripe.createFetchHttpClient(),
})

Deno.serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { licenseKey, returnUrl } = await req.json()

        if (!licenseKey) {
            throw new Error("Missing licenseKey")
        }

        console.log(`Creating portal session for license: ${licenseKey}`)

        // Initialize Supabase client
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // 1. Look up the stripe_customer_id for this license
        const { data: license, error: dbError } = await supabase
            .from('licenses')
            .select('stripe_customer_id')
            .eq('license_key', licenseKey)
            .single()

        if (dbError || !license || !license.stripe_customer_id) {
            console.error("License fetch error or no customer ID:", dbError)
            throw new Error("Could not find subscription customer for this license.")
        }

        const customerId = license.stripe_customer_id
        console.log(`Found customer ID: ${customerId}`)

        // 2. Create Portal Session
        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl || 'https://protakeoff.org',
        })

        console.log(`Portal session created: ${session.url}`)

        return new Response(
            JSON.stringify({ url: session.url }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            }
        )

    } catch (error) {
        console.error('Error creating portal session:', error)
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})
