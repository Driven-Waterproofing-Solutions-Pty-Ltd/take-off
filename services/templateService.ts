import { supabase } from './supabaseClient';
import { ItemTemplate } from '../types';
import { licenseService } from './licenseService';

export interface TemplateResponse {
    success: boolean;
    templates?: ItemTemplate[];
    message?: string;
    requiresUpgrade?: boolean;
}

export const templateService = {
    /**
     * Fetch premium templates from Supabase
     * Only available to paid license holders
     */
    async fetchPremiumTemplates(): Promise<TemplateResponse> {
        try {
            // First, verify the user has a paid license
            const licenseStatus = await licenseService.checkLicense();

            console.log('License Status:', licenseStatus);

            if (!licenseStatus.valid) {
                return {
                    success: false,
                    message: 'No valid license found. Please activate a license to access premium templates.',
                    requiresUpgrade: true,
                };
            }

            if (licenseStatus.licenseType === 'trial') {
                return {
                    success: false,
                    message: 'Premium templates are only available with a paid license. Upgrade to access premium content.',
                    requiresUpgrade: true,
                };
            }

            // Fetch templates from Supabase - include category column
            console.log('Fetching templates from Supabase...');
            const { data, error } = await supabase
                .from('templates')
                .select('template_data, category')
                .eq('is_active', true)
                .order('created_at', { ascending: false });

            console.log('Supabase response:', { data, error });

            if (error) {
                console.error('Template fetch error:', error);
                return {
                    success: false,
                    message: 'Failed to fetch templates from server. Please check your connection.',
                };
            }

            // Extract template_data and merge category as group
            const templates = data?.map(row => {
                // If template_data is a string, parse it; otherwise use it directly
                const templateData = typeof row.template_data === 'string'
                    ? JSON.parse(row.template_data)
                    : row.template_data;

                // Merge the category column into the template as 'group'
                return {
                    ...templateData,
                    group: row.category || 'General'
                } as ItemTemplate;
            }) || [];

            console.log('Parsed templates:', templates);

            return {
                success: true,
                templates,
            };
        } catch (err) {
            console.error('Template service error:', err);
            return {
                success: false,
                message: 'An unexpected error occurred while fetching templates.',
            };
        }
    },

    /**
     * Fetch templates by category
     */
    async fetchPremiumTemplatesByCategory(category: string): Promise<TemplateResponse> {
        try {
            const licenseStatus = await licenseService.checkLicense();

            if (!licenseStatus.valid || licenseStatus.licenseType === 'trial') {
                return {
                    success: false,
                    message: 'Premium templates require a paid license.',
                    requiresUpgrade: true,
                };
            }

            const { data, error } = await supabase
                .from('templates')
                .select('template_data, category')
                .eq('is_active', true)
                .eq('category', category)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Template fetch error:', error);
                return {
                    success: false,
                    message: 'Failed to fetch templates.',
                };
            }

            const templates = data?.map(row => {
                const templateData = typeof row.template_data === 'string'
                    ? JSON.parse(row.template_data)
                    : row.template_data;

                return {
                    ...templateData,
                    group: row.category || 'General'
                } as ItemTemplate;
            }) || [];

            return {
                success: true,
                templates,
            };
        } catch (err) {
            console.error('Template service error:', err);
            return {
                success: false,
                message: 'An unexpected error occurred.',
            };
        }
    },

    /**
     * Check if user has access to premium templates
     */
    async hasPremiumAccess(): Promise<boolean> {
        const licenseStatus = await licenseService.checkLicense();
        return licenseStatus.valid && licenseStatus.licenseType === 'paid';
    }
};
