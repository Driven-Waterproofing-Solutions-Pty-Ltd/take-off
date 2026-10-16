import type { ItemTemplate } from '../types';

// Web port: the desktop app pulled premium template packs from Supabase.
// On the web build we do not connect to Supabase; assemblies and pricing
// live in the worker memory layer (/api/memory/assemblies), and per-user
// templates are kept in localStorage via utils/storage.ts.
// This stub keeps TemplateManager.tsx compiling unchanged.

export interface TemplateResponse {
  success: boolean;
  templates?: ItemTemplate[];
  message?: string;
  requiresUpgrade?: boolean;
}

export const templateService = {
  async fetchPremiumTemplates(): Promise<TemplateResponse> {
    return {
      success: true,
      templates: [],
      message: 'Premium template gallery is not available in the web build.',
    };
  },
  async hasPremiumAccess(): Promise<boolean> {
    return false;
  },
};
