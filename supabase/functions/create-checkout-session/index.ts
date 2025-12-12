import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@17.3.1'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
    apiVersion: '2024-11-20.acacia',
    httpClient: Stripe.createFetchHttpClient(),
})

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
            }
        })
    }

    try {
        const { licenseKey, machineId, returnUrl } = await req.json()

        console.log(`Creating checkout session for license: ${licenseKey}, machine: ${machineId}`)

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price: 'price_1SdXf8DFznUtiVVQA5mBpqRi',
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            success_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${returnUrl}`,
            metadata: {
                license_key: licenseKey || '',
                machine_id: machineId || '',
            },
            subscription_data: {
                metadata: {
                    license_key: licenseKey || '',
                    machine_id: machineId || '',
                }
            },
        })

        console.log(`Checkout session created: ${session.id}`)

        return new Response(
            JSON.stringify({ sessionId: session.id, url: session.url }),
            {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
                    'Content-Type': 'application/json',
                },
                status: 200,
            }
        )

    } catch (error) {
        console.error('Error creating checkout session:', error)
        return new Response(JSON.stringify({ error: error.message }), {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            status: 400,
        })
    }
})