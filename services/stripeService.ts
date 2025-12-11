
import { supabase } from './supabaseClient';

export const stripeService = {
    async createCheckoutSession(licenseKey: string) {
        // For Tauri, we need a custom scheme or a known local server if using deep links.
        // But since this is a web-view, we can usually just use standard URLs if hosted, 
        // OR for desktop app we might want to open the browser.
        // The return URL should ideally be a page that says "Success, you can close this window" 
        // or a deep link back to the app like protakeoff://success?session_id=...

        // For this implementation, we'll assume a hosted success page or simple http return.
        // You might need to adjust 'http://localhost:3000' to your actual production URL or deeplink.
        const returnUrl = window.location.origin;
        const { licenseService } = await import('./licenseService');
        const machineId = await licenseService.getMachineId();

        const { data, error } = await supabase.functions.invoke('create-checkout-session', {
            body: {
                licenseKey,
                machineId,
                returnUrl
            }
        });

        if (error) throw error;
        return data;
    },

    async openCustomerPortal() {
        // Implement if you want users to manage subs. 
        // Requires a separate edge function to create portal session.
        console.log("Customer portal not yet implemented.");
    }
};
