
import { invoke } from '@tauri-apps/api/core';
import { supabase } from './supabaseClient';
import { LazyStore } from '@tauri-apps/plugin-store';

const STORE_PATH = 'p_license_store.json';
const store = new LazyStore(STORE_PATH);

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
            // Try to get hardware-locked ID from Rust
            const hardwareId = await invoke<string>('get_machine_id');
            if (hardwareId) return hardwareId;
        } catch (e) {
            console.error("Failed to get hardware ID, falling back to soft ID", e);
        }

        // Fallback: Use stored random UUID (Soft ID)
        let machineId = await store.get<string>('machine_id');
        if (!machineId) {
            machineId = crypto.randomUUID();
            await store.set('machine_id', machineId);
            await store.save();
        }
        return machineId;
    },

    async getStoredLicenseKey(): Promise<string | null> {
        const key = await store.get<string>('license_key');
        return key || null;
    },

    async setStoredLicenseKey(key: string) {
        await store.set('license_key', key);
        await store.save();
    },

    async checkLicense(): Promise<LicenseStatus> {
        try {
            const machineId = await this.getMachineId();
            const licenseKey = await this.getStoredLicenseKey();

            if (licenseKey) {
                console.log(`Found local license key: ${licenseKey}, verifying...`);
                // Verify existing license
                const { data, error } = await supabase.rpc('verify_license_key', {
                    p_key: licenseKey,
                    p_machine_id: machineId,
                });

                if (error) {
                    console.error('Verification RPC Error:', error);
                    // On error, we might want to fail safe or check DB? 
                    // Let's assume network error and check DB just in case?
                }

                if (data && data.valid && data.subscription_status === 'active') {
                    // If we have a paid license, we are good.
                    if (data.license_type === 'paid') {
                        return {
                            valid: data.valid,
                            message: data.message,
                            expiresAt: data.expires_at,
                            licenseKey: licenseKey,
                            licenseType: data.license_type,
                        };
                    }
                    // If it's a trial, we should check if there is a PAID license on the server
                    // explicitly before returning only the trial.
                    console.log("Local license is trial. Checking server for a PAID license update...");
                } else {
                    console.log("Local key invalid or expired. Checking DB for a newer license...");
                }

                // Fall through to the DB check below
            }
            // No local license key found.
            console.log(`Checking DB for existing license for machine: ${machineId}`);

            // Check if there is an existing license for this machine in the DB (via secure RPC)
            const { data: existingLicense, error: fetchError } = await supabase.rpc('get_license_by_machine', {
                p_machine_id: machineId
            }).maybeSingle();

            if (fetchError) {
                console.error("Error fetching existing license:", fetchError);
            } else {
                console.log("Existing license query result:", existingLicense);
            }

            if (!fetchError && existingLicense) {
                console.log("Found existing license, restoring...");

                // Check if it is actually valid/unexpired
                let isValid = true;
                if (existingLicense.expires_at) {
                    const expiry = new Date(existingLicense.expires_at);
                    if (expiry < new Date()) {
                        isValid = false;
                        console.log("Restored license is expired.");
                    }
                }

                // Also check if status is specifically 'cancelled' or similar if that field exists
                // For now, expiration date is the main check.

                // Found a valid existing license! Save it and use it.
                await this.setStoredLicenseKey(existingLicense.license_key);
                return {
                    valid: isValid,
                    message: isValid ? 'License restored successfully.' : 'Your license has expired.',
                    expiresAt: existingLicense.expires_at,
                    licenseKey: existingLicense.license_key,
                    licenseType: existingLicense.license_type as 'trial' | 'paid',
                };
            }

            // Really no license found, attempt to start trial
            return await this.startTrial(machineId);
        } catch (err) {
            console.error('License Check Exception:', err);
            return { valid: false, message: 'Unexpected error checking license.' };
        }
    },

    async startTrial(machineId: string): Promise<LicenseStatus> {
        try {
            const { data, error } = await supabase.rpc('create_trial_license', {
                p_machine_id: machineId,
            });

            if (error) {
                console.error('Create Trial RPC Error:', error);
                return { valid: false, message: 'Failed to start trial. Please check internet connection.' };
            }

            if (data.success) {
                await this.setStoredLicenseKey(data.license_key);
                return {
                    valid: true,
                    message: 'Trial started successfully.',
                    expiresAt: data.expires_at,
                    licenseKey: data.license_key,
                    licenseType: data.license_type || 'trial',
                };
            } else {
                // Trial failed (e.g., machine already used)
                return { valid: false, message: data.message };
            }

        } catch (err) {
            console.error('Start Trial Exception:', err);
            return { valid: false, message: 'Error starting trial.' };
        }
    },

    async activateKey(key: string): Promise<LicenseStatus> {
        const machineId = await this.getMachineId();
        const { data, error } = await supabase.rpc('verify_license_key', {
            p_key: key,
            p_machine_id: machineId
        });

        if (error) return { valid: false, message: error.message };

        if (data.valid) {
            await this.setStoredLicenseKey(key);
        }

        return {
            valid: data.valid,
            message: data.message,
            expiresAt: data.expires_at,
            licenseType: data.license_type,
        };
    }
};
