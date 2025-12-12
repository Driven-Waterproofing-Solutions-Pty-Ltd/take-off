
import { invoke } from '@tauri-apps/api/core';
import { supabase } from './supabaseClient';
import { LazyStore } from '@tauri-apps/plugin-store';
import * as jose from 'jose'; // Using the installed 'jose' package

const STORE_PATH = 'p_license_store.json';
const store = new LazyStore(STORE_PATH);

// --- PUBLIC KEY FROM GENERATION SCRIPT ---
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzdUFgbvp4MXXsI5NQgXl
KTRobSp9asJYyqITC/9RXbpgQ9Yb3b4FWrLymGuIREw4/vLnmfYRf4w3B7iJlnMw
hlbmpeI39XvH5Anq+a4ha9wH19x4QBUY3jiGWfMwxGnRl4nGjbjqGYbtKEZmIHPY
7i3kl+HZ6Rfd3FtfTh/ggQoDcLMuzrsKfYekpGVoUJhYWyCdBt5UW4Jju4o0Htv6
cBVQ5ertVXuqS9oi106zHBGSOpqlEkEQCdCz7bUGimJPYTsu+HPhQ8W5gLCNIJIH
ll30d8Ou8unSwJxz3ncPQGVY/csq/Er4PROCBT8gwkrFC7Yahnl2Ej5W4MF+4rB7
nwIDAQAB
-----END PUBLIC KEY-----`;

export interface LicenseStatus {
    valid: boolean;
    message: string;
    expiresAt?: string;
    licenseKey?: string;
    licenseType?: 'trial' | 'paid';
    subscriptionStatus?: string;
    stripeSubscriptionId?: string;
}

export const licenseService = {
    async getMachineId(): Promise<string> {
        try {
            const hardwareId = await invoke<string>('get_machine_id');
            if (hardwareId) return hardwareId;
        } catch (e) {
            console.error("Failed to get hardware ID, falling back to soft ID", e);
        }
        let machineId = await store.get<string>('machine_id');
        if (!machineId) {
            machineId = crypto.randomUUID();
            await store.set('machine_id', machineId);
            await store.save();
        }
        return machineId;
    },

    async getStoredToken(): Promise<string | null> {
        return (await store.get<string>('license_token')) || null;
    },

    async setStoredToken(token: string) {
        await store.set('license_token', token);
        await store.save();
    },

    // Verify the JWT signature client-side
    async verifyTokenSignature(token: string): Promise<any> {
        try {
            const publicKey = await jose.importSPKI(PUBLIC_KEY_PEM, 'RS256');
            const { payload } = await jose.jwtVerify(token, publicKey);
            return payload;
        } catch (e) {
            console.error("Token verification failed:", e);
            return null;
        }
    },

    async checkLicense(): Promise<LicenseStatus> {
        try {
            const machineId = await this.getMachineId();

            // 1. Try to load and verify local signed token first (OFFLINE CAPABLE)
            const localToken = await this.getStoredToken();
            if (localToken) {
                const payload = await this.verifyTokenSignature(localToken);
                if (payload) {
                    // Check if machine ID matches (prevent copying file to another PC)
                    if (payload.machineId === machineId) {
                        // Check expiration (although jwtVerify does this, we double check for UI logic)
                        const expiry = new Date((payload.exp as number) * 1000);
                        if (expiry > new Date()) {
                            console.log("Valid local signed token found.");
                            return {
                                valid: true,
                                message: 'License verified (Offline)',
                                expiresAt: expiry.toISOString(),
                                licenseKey: payload.licenseKey as string,
                                licenseType: payload.licenseType as 'trial' | 'paid',
                            };
                        } else {
                            console.log("Local token expired.");
                        }
                    } else {
                        console.log("Local token machine ID mismatch.");
                    }
                }
            }

            // 2. If no valid local token, check ONLINE
            console.log("Checking license online...");

            // We need to look up the key to check. 
            // If they had a token before, we can extract the key from it (unsafe) or just ask the user.
            // But usually we store the raw key too for convenience.
            const storedKey = await store.get<string>('license_key');

            if (storedKey) {
                return await this.activateKey(storedKey);
            }

            // 3. Fallback: No key, no token. Check if we can start/resume a trial?
            // Existing logic for trial...
            return await this.startTrial(machineId);

        } catch (err) {
            console.error('License Check Exception:', err);
            return { valid: false, message: 'Unexpected error checking license.' };
        }
    },

    async startTrial(machineId: string): Promise<LicenseStatus> {
        // ... (Keep existing trial logic, or update it to return a token if you upgrade the trial system too)
        // For now, let's keep the legacy trial logic as a fallback, 
        // BUT ideally trials should also issue a signed token.
        // Let's assume the user wants critical paths secured, so we might leave trial as insecure for now?
        // Or better: update verify-license to handle trials too?
        // For simplicity, I'll keep the legacy trial logic but NOT trust it for "Offline Critical" features if we enforced that.
        // Since we are just securing the subscription:

        try {
            const { data, error } = await supabase.rpc('create_trial_license', {
                p_machine_id: machineId,
            });

            if (error) {
                // ... error handling
                return { valid: false, message: 'Failed to start trial.' };
            }
            if (data.success) {
                // Try to "activate" this new trial key to get a signed token immediately
                return await this.activateKey(data.license_key);
            }
            return { valid: false, message: data.message };

        } catch (e) {
            return { valid: false, message: 'Error starting trial.' };
        }
    },

    async activateKey(key: string): Promise<LicenseStatus> {
        const machineId = await this.getMachineId();

        console.log("Verifying key online via Edge Function: verify-license");

        const { data, error } = await supabase.functions.invoke('verify-license', {
            body: { licenseKey: key, machineId }
        });

        if (error) {
            console.error("Edge function error:", error);
            return { valid: false, message: "Connection error verifying license." };
        }

        if (data && data.valid && data.token) {
            // Verify the token returned by server matches our public key (Security Check)
            const payload = await this.verifyTokenSignature(data.token);
            if (!payload) {
                return { valid: false, message: "Security Error: Invalid server signature." };
            }

            // Save the valid token and key
            await this.setStoredToken(data.token);
            await store.set('license_key', key);
            await store.save();

            return {
                valid: true,
                message: data.message,
                expiresAt: data.expiresAt,
                licenseType: data.licenseType,
            };
        }

        return {
            valid: false,
            message: data?.message || "Invalid License",
        };
    }
};
