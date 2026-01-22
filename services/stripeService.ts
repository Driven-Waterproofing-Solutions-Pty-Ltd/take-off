import { supabase } from './supabaseClient';

export const stripeService = {
    async createCheckoutSession(licenseKey: string) {
        console.log("stripeService.createCheckoutSession called");
        // For Tauri, we need a custom scheme or a known local server if using deep links.
        // But since this is a web-view, we can usually just use standard URLs if hosted, 
        // OR for desktop app we might want to open the browser.
        // The return URL should ideally be a page that says "Success, you can close this window" 
        // or a deep link back to the app like protakeoff://success?session_id=...

        // For this implementation, we'll assume a hosted success page or simple http return.
        // You might need to adjust 'http://localhost:3000' to your actual production URL or deeplink.
        // We use a real URL because Stripe requires http/https for success_url.
        // 'protakeoff.org' is the user's domain.
        const returnUrl = 'https://protakeoff.org';
        console.log("Return URL:", returnUrl);

        try {
            // Generate a random machine ID since no license service
            const machineId = crypto.randomUUID();
            console.log("Machine ID generated:", machineId);

            console.log("Invoking create-checkout-session function...");
            const { data, error } = await supabase.functions.invoke('create-checkout-session', {
                body: {
                    licenseKey,
                    machineId,
                    returnUrl
                }
            });

            if (error) {
                console.error("Supabase function error:", error);
                throw error;
            }

            console.log("Supabase function success, data:", data);
            return data;
        } catch (err) {
            console.error("Error in createCheckoutSession:", err);
            throw err;
        }
    },

    async createCustomerPortalSession(licenseKey: string) {
        console.log("stripeService.createCustomerPortalSession called");
        try {
            const returnUrl = 'https://protakeoff.org';
            console.log("Invoking create-portal-session function...");

            // We need to pass the licenseKey so the backend can look up the customer ID
            const { data, error } = await supabase.functions.invoke('create-portal-session', {
                body: {
                    licenseKey,
                    returnUrl
                }
            });

            if (error) {
                console.error("Supabase function error:", error);
                throw error;
            }

            console.log("Supabase function success, data:", data);
            return data;
        } catch (err) {
            console.error("Error in createCustomerPortalSession:", err);
            throw err;
        }
    },

    async openCustomerPortal() {
        console.warn("Use createCustomerPortalSession instead to get the URL first.");
    }
};
