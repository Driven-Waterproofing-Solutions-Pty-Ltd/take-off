/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />

import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@17.3.1'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
    apiVersion: '2024-11-20.acacia',
    httpClient: Stripe.createFetchHttpClient(),
})
const endpointSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')

Deno.serve(async (req) => {
    try {
        const signature = req.headers.get('stripe-signature')
        if (!signature) {
            return new Response("No signature", { status: 400 })
        }

        const body = await req.text()

        let event
        try {
            event = await stripe.webhooks.constructEventAsync(body, signature, endpointSecret!)
        } catch (err) {
            console.error('Webhook signature verification failed:', err.message)
            return new Response(`Webhook Error: ${err.message}`, { status: 400 })
        }

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        console.log(`Processing event: ${event.type}`)

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object
            const licenseKey = session.metadata?.license_key
            const machineId = session.metadata?.machine_id
            const subscriptionId = session.subscription
            const customerId = session.customer

            console.log(`Checkout completed - License: ${licenseKey}, Machine: ${machineId}`)
            console.log(`Subscription ID: ${subscriptionId}, Customer ID: ${customerId}`)
            console.log(`Full metadata:`, JSON.stringify(session.metadata, null, 2))

            let matchFound = false

            if (licenseKey) {
                console.log(`Attempting to update existing license by license_key: ${licenseKey}`)
                const { error, count } = await supabase
                    .from('licenses')
                    .update({
                        license_type: 'paid',
                        stripe_subscription_id: subscriptionId,
                        stripe_customer_id: customerId,
                        subscription_status: 'active',
                        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                        is_active: true
                    })
                    .eq('license_key', licenseKey)
                    .select('count', { count: 'exact' })

                if (!error && count && count > 0) {
                    matchFound = true
                    console.log(`Updated existing license: ${licenseKey}`)
                } else if (error) {
                    console.error(`Error updating by license_key:`, error)
                } else {
                    console.log(`No license found with key: ${licenseKey}`)
                }
            }

            if (!matchFound && machineId) {
                console.log(`Attempting to update existing license by machine_id: ${machineId}`)
                const { error, count } = await supabase
                    .from('licenses')
                    .update({
                        license_key: licenseKey || `PAID-${crypto.randomUUID().toUpperCase().slice(0, 18)}`,
                        license_type: 'paid',
                        stripe_subscription_id: subscriptionId,
                        stripe_customer_id: customerId,
                        subscription_status: 'active',
                        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                        is_active: true,
                    })
                    .eq('machine_id', machineId)
                    .select('count', { count: 'exact' })

                if (!error && count && count > 0) {
                    matchFound = true
                    console.log(`Updated license by machine_id: ${machineId}`)
                } else if (error) {
                    console.error(`Error updating by machine_id:`, error)
                } else {
                    console.log(`No license found with machine_id: ${machineId}`)
                }
            }

            if (!matchFound) {
                // If we get here, updates failed or were skipped. Use upsert to handle both creation and update of existing keys.
                const newLicenseKey = licenseKey || `PAID-${crypto.randomUUID().toUpperCase().slice(0, 18)}`

                console.log(`Upserting license (Create or Update) with key: ${newLicenseKey}, machine: ${machineId}`)

                const { data: insertedData, error } = await supabase
                    .from('licenses')
                    .upsert({
                        license_key: newLicenseKey,
                        machine_id: machineId || 'unknown_machine',
                        license_type: 'paid',
                        stripe_subscription_id: subscriptionId,
                        stripe_customer_id: customerId,
                        subscription_status: 'active',
                        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                        is_active: true
                    }, { onConflict: 'license_key' })
                    .select()

                if (error) {
                    console.error("❌ Insert failed:", JSON.stringify(error, null, 2))
                    console.error("Error details - code:", error.code, "message:", error.message, "details:", error.details)
                } else {
                    console.log(`✅ Created new paid license ${newLicenseKey} for machine ${machineId}`)
                    console.log("Inserted data:", JSON.stringify(insertedData, null, 2))
                }
            }

        } else if (event.type === 'invoice.payment_succeeded') {
            const invoice = event.data.object
            const subscriptionId = invoice.subscription

            if (subscriptionId) {
                console.log(`Payment succeeded for subscription: ${subscriptionId}`)
                const { error, count } = await supabase
                    .from('licenses')
                    .update({
                        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                        subscription_status: 'active',
                        license_type: 'paid',
                        is_active: true
                    })
                    .eq('stripe_subscription_id', subscriptionId)
                    .select('count', { count: 'exact' })

                if (error) {
                    console.error('Error extending license:', error)
                } else if (count === 0) {
                    console.log(`License not found linked to subscription ${subscriptionId}. Attempting recovery via Stripe metadata...`)
                    try {
                        const subscription = await stripe.subscriptions.retrieve(subscriptionId as string)
                        const { license_key, machine_id } = subscription.metadata || {}

                        if (license_key || machine_id) {
                            console.log(`Found metadata in subscription - License: ${license_key}, Machine: ${machine_id}`)
                            let recovered = false

                            if (license_key) {
                                const { count: lc } = await supabase.from('licenses').update({
                                    stripe_subscription_id: subscriptionId,
                                    stripe_customer_id: invoice.customer,
                                    license_type: 'paid',
                                    subscription_status: 'active',
                                    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                                    is_active: true
                                }).eq('license_key', license_key).select('count', { count: 'exact' })

                                if (lc && lc > 0) {
                                    console.log(`Recovered/Updated license by key: ${license_key}`)
                                    recovered = true
                                }
                            }

                            if (!recovered && machine_id) {
                                const { count: mc } = await supabase.from('licenses').update({
                                    stripe_subscription_id: subscriptionId,
                                    stripe_customer_id: invoice.customer,
                                    license_type: 'paid',
                                    subscription_status: 'active',
                                    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                                    is_active: true
                                }).eq('machine_id', machine_id).select('count', { count: 'exact' })

                                if (mc && mc > 0) {
                                    console.log(`Recovered/Updated license by machine_id: ${machine_id}`)
                                }
                            }
                        } else {
                            console.log('No metadata found on subscription to recover license link.')
                        }
                    } catch (e) {
                        console.error('Error fetching subscription for recovery:', e)
                    }
                }
            }

        } else if (event.type === 'customer.subscription.deleted') {
            const subscription = event.data.object
            const subscriptionId = subscription.id

            if (subscriptionId) {
                console.log(`Subscription canceled: ${subscriptionId}`)
                const { error } = await supabase
                    .from('licenses')
                    .update({
                        subscription_status: 'canceled'
                    })
                    .eq('stripe_subscription_id', subscriptionId)

                if (error) console.error('Error cancelling license:', error)
            }
        }

        return new Response(JSON.stringify({ received: true }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        })

    } catch (error) {
        console.error('Unexpected error:', error)
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { 'Content-Type': 'application/json' },
            status: 500,
        })
    }
})