import React, { useState } from 'react';
import { ShieldCheck, Key, Loader2, AlertCircle } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { Store } from '@tauri-apps/plugin-store';

interface LicenseModalProps {
    onSuccess: () => void;
}

const LicenseModal: React.FC<LicenseModalProps> = ({ onSuccess }) => {
    const [key, setKey] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!key.trim()) return;

        setIsLoading(true);
        setError(null);

        try {
            const response = await invoke<{ valid: boolean; message: string; token?: string }>('verify_license', { key: key.trim() });
            
            if (response.valid) {
                // Save license info
                const store = await Store.load('store.json');
                await store.set('license_key', key.trim());
                await store.set('license_token', response.token);
                await store.save();
                onSuccess();
            } else {
                setError(response.message || "Invalid License Key.");
            }
        } catch (err: any) {
            console.error(err);
            setError(err.toString() || "Connection error. Please check internet.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] bg-slate-900 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 animate-in zoom-in-95 duration-300">
                <div className="flex flex-col items-center mb-6">
                    <div className="bg-blue-100 p-4 rounded-full text-blue-600 mb-4">
                        <ShieldCheck size={48} />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900">ProTakeoff Activation</h1>
                    <p className="text-slate-500 text-center mt-2">
                        Please enter your serial key to activate the software.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5 ml-1">Serial Key</label>
                        <div className="relative">
                            <Key className="absolute left-3 top-2.5 text-slate-400" size={18} />
                            <input 
                                type="text"
                                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all uppercase font-mono tracking-widest text-center"
                                placeholder="XXXX-XXXX-XXXX-XXXX"
                                value={key}
                                onChange={(e) => setKey(e.target.value)}
                                disabled={isLoading}
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded-lg border border-red-100">
                            <AlertCircle size={16} />
                            <span>{error}</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={isLoading || !key.trim()}
                        className="w-full bg-slate-900 hover:bg-slate-800 text-white py-3 rounded-lg font-semibold shadow-lg transition-all flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 size={18} className="animate-spin" /> Verifying...
                            </>
                        ) : (
                            "Activate License"
                        )}
                    </button>
                </form>
                
                <div className="mt-6 text-center">
                    <a href="#" className="text-sm text-blue-600 hover:underline">Purchase a license key</a>
                </div>
            </div>
        </div>
    );
};

export default LicenseModal;