
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
                // Verify existing license
                const { data, error } = await supabase.rpc('verify_license_key', {
                    p_key: licenseKey,
                    p_machine_id: machineId,
                });

                if (error) {
                    console.error('Verification RPC Error:', error);
                    return { valid: false, message: 'Network or Server Error during verification.' };
                }

                return {
                    valid: data.valid,
                    message: data.message,
                    expiresAt: data.expires_at,
                    licenseKey: licenseKey,
                    licenseType: data.license_type,
                };
            } else {
                // No license found, attempt to start trial
                return await this.startTrial(machineId);
            }
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
