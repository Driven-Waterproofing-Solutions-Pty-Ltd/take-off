import React, { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-shell';
import { ShieldCheck, Key, Loader2, AlertCircle, Crown, AlertTriangle, Clock, CreditCard, ExternalLink } from 'lucide-react';
import { licenseService, LicenseStatus } from '../services/licenseService';
import { stripeService } from '../services/stripeService';

interface LicenseManagerProps {
    onSuccess?: () => void;
    initialMessage?: string | null;
    currentLicenseStatus?: LicenseStatus | null;
    forceRefreshOnMount?: boolean;
}

const LicenseManager: React.FC<LicenseManagerProps> = ({ onSuccess, initialMessage, currentLicenseStatus, forceRefreshOnMount = false }) => {
    const [key, setKey] = useState('');
    const [showManualInput, setShowManualInput] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isSubscribing, setIsSubscribing] = useState(false);
    const [error, setError] = useState<string | null>(initialMessage || null);
    const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(currentLicenseStatus || null);

    // Sync prop changes if needed
    useEffect(() => {
        if (currentLicenseStatus !== undefined) {
            setLicenseStatus(currentLicenseStatus);
        } else {
            // Initial fetch if not provided
            licenseService.checkLicense(forceRefreshOnMount).then(setLicenseStatus).catch(console.error);
        }
    }, [currentLicenseStatus, forceRefreshOnMount]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!key.trim()) return;

        setIsLoading(true);
        setError(null);

        try {
            const response = await licenseService.activateKey(key.trim());

            if (response.valid) {
                setLicenseStatus(response);
                if (onSuccess) onSuccess();
            } else {
                setError(response.message || "Invalid License Key.");
            }
        } catch (err: any) {
            console.error(err);
            setError(err.toString() || "Connection error.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubscribe = async () => {
        setIsSubscribing(true);
        setError(null);
        try {
            const response = await stripeService.createCheckoutSession(licenseStatus?.licenseKey || '');
            const { url } = response;

            if (url) {
                await open(url);

                // Poll for success
                let attempts = 0;
                const pollInterval = setInterval(async () => {
                    attempts++;
                    try {
                        // Force online check to bypass local token cache
                        const res = await licenseService.checkLicense(true);
                        if (res.valid && res.licenseType === 'paid') {
                            clearInterval(pollInterval);
                            setLicenseStatus(res);
                            setIsSubscribing(false);
                            if (onSuccess) onSuccess();
                        }
                    } catch (e) {
                        console.error("Poll error", e);
                    }

                    if (attempts > 150) { // 5 minutes
                        clearInterval(pollInterval);
                        setIsSubscribing(false);
                    }
                }, 2000);

            } else {
                const err = "No URL in response from server.";
                alert(err);
                throw new Error("Failed to create checkout session.");
            }
        } catch (e: any) {
            console.error("Subscribe error:", e);
            const msg = e.message || "Failed to start subscription.";
            setError(msg);
            alert(`Subscription Error: ${msg}`);
            setIsSubscribing(false);
        }
    };

    const handleReset = async () => {
        if (confirm("This will clear your local license key and restart the app trial check. Are you sure?")) {
            try {
                console.log("Attempting to clear stored license data...");
                setIsLoading(true);
                await licenseService.clearStoredData();
                console.log("Data cleared. Re-checking license...");

                // Soft reset: Check license again instead of reloading
                const newStatus = await licenseService.checkLicense();
                setLicenseStatus(newStatus);
                setError(newStatus.valid ? null : newStatus.message || "License reset, but still invalid.");

                if (newStatus.valid) {
                    onSuccess();
                }

            } catch (error: any) {
                console.error("Failed to reset license data:", error);
                alert("Failed to reset license data: " + (error.message || error));
            } finally {
                setIsLoading(false);
            }
        }
    };

    // Calculate days until expiration
    const getDaysUntilExpiration = () => {
        if (!licenseStatus?.expiresAt) return null;
        const expiryDate = new Date(licenseStatus.expiresAt);
        const now = new Date();
        const diffTime = expiryDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    };

    const daysLeft = getDaysUntilExpiration();
    const isExpiringSoon = daysLeft !== null && daysLeft > 0 && daysLeft <= 7;
    const isExpired = daysLeft !== null && daysLeft <= 0;
    const isTrial = licenseStatus?.licenseType === 'trial';
    const isPaid = licenseStatus?.licenseType === 'paid';

    return (
        <div className="w-full">
            <div className="flex flex-col items-center mb-6">
                <div className={`p-4 rounded-full mb-4 ${isPaid ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}`}>
                    {isPaid ? <Crown size={48} /> : <ShieldCheck size={48} />}
                </div>
                <h1 className="text-2xl font-bold text-slate-900">ProTakeoff Activation</h1>

                {/* License Type Badge */}
                {licenseStatus?.valid && (
                    <div className="mt-3 flex items-center gap-2">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${isPaid ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                            }`}>
                            {isPaid ? '✓ Paid License' : '⏱ Trial License'}
                        </span>
                    </div>
                )}

                {/* Expiration Warning */}
                {licenseStatus?.valid && (isTrial || isPaid) && (
                    <div className="mt-3 w-full">
                        {isExpired ? (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                                <AlertCircle className="text-red-600 flex-shrink-0 mt-0.5" size={18} />
                                <div className="text-sm">
                                    <p className="font-semibold text-red-800">{isTrial ? 'Trial Expired' : 'License Expired'}</p>
                                    <p className="text-red-600">
                                        {isTrial ? 'Your trial has ended. Subscribe to continue.' : 'Your license has expired. Please renew.'}
                                    </p>
                                </div>
                            </div>
                        ) : isExpiringSoon ? (
                            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-start gap-2">
                                <AlertTriangle className="text-orange-600 flex-shrink-0 mt-0.5" size={18} />
                                <div className="text-sm">
                                    <p className="font-semibold text-orange-800">Expiring Soon</p>
                                    <p className="text-orange-600">
                                        {daysLeft} {daysLeft === 1 ? 'day' : 'days'} remaining.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
                                <Clock className="text-blue-600 flex-shrink-0" size={16} />
                                <p className="text-sm text-blue-700">
                                    {isPaid ? 'Renews in' : 'Trial expires in'} <strong>{daysLeft} days</strong>
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {!licenseStatus?.valid && (
                    <p className="text-slate-500 text-center mt-2">
                        Please enter your serial key to activate the software.
                    </p>
                )}
            </div>

            {/* Current License Key Display (Auto-Generated) */}
            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-center mb-6">
                <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-1">Your License System ID</p>
                <code className="text-lg font-mono font-bold text-slate-700 select-all">
                    {licenseStatus?.licenseKey || "Generating..."}
                </code>
            </div>

            {/* Manual Key Entry (Hidden by default) */}
            {!showManualInput ? (
                <button
                    onClick={() => setShowManualInput(true)}
                    className="text-xs text-slate-400 hover:text-slate-600 underline text-center w-full mb-4"
                >
                    Have an existing key from another machine? Click here to restore.
                </button>
            ) : (
                <form onSubmit={handleSubmit} className="space-y-4 mb-6 relative">
                    <button
                        type="button"
                        onClick={() => setShowManualInput(false)}
                        className="absolute -top-6 right-0 text-xs text-slate-400 hover:text-red-500"
                    >
                        Cancel
                    </button>

                    <div className="bg-amber-50 p-3 rounded-lg border border-amber-200 text-xs text-slate-700 mb-4">
                        <div className="font-bold text-amber-800 mb-1 flex items-center gap-1">
                            <AlertCircle size={14} /> Attention
                        </div>
                        <p>
                            Activating your license here will <strong>disable it on your other devices</strong>.
                            ProTakeoff tracks your active session, and switching devices will transfer your license to this computer immediately.
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5 ml-1">Enter Existing Serial Key</label>
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
                        {/* Error or Message */}
                        {error && (
                            <div className="flex flex-col gap-2">
                                <div className="bg-red-50 text-red-600 p-3 rounded-lg flex items-center gap-2 text-sm border border-red-100">
                                    <AlertCircle size={16} />
                                    {error}
                                </div>
                                <button
                                    type="button"
                                    onClick={handleReset}
                                    className="text-xs text-gray-500 hover:text-gray-700 underline self-start"
                                >
                                    Reset stored license data
                                </button>
                            </div>
                        )}
                    </div>

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
                            "Activate This Key"
                        )}
                    </button>
                </form>
            )}

            {/* Upgrade CTA for Trial Users */}
            {isTrial && (
                <div className="mt-6 p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border border-blue-100">
                    <div className="flex items-center gap-2 mb-2">
                        <Crown className="text-purple-600" size={20} />
                        <h3 className="font-semibold text-slate-900">Upgrade to Paid License</h3>
                    </div>
                    <p className="text-sm text-slate-600 mb-3">
                        Get lifetime access and unlock premium templates from our library.
                    </p>
                    <button
                        onClick={handleSubscribe}
                        disabled={isSubscribing}
                        className="w-full text-center bg-gradient-to-r from-blue-600 to-purple-600 text-white py-2 rounded-lg font-semibold hover:from-blue-700 hover:to-purple-700 transition-all shadow-md flex justify-center items-center gap-2"
                    >
                        {isSubscribing ? <Loader2 size={18} className="animate-spin" /> : <CreditCard size={18} />}
                        Subscribe Now ($29.99/mo)
                    </button>
                </div>
            )}

            {isPaid && (
                <div className="mt-6 text-center">
                    <button
                        onClick={async () => {
                            try {
                                setIsSubscribing(true); // Reuse loading state
                                const response = await stripeService.createCustomerPortalSession(licenseStatus?.licenseKey || '');
                                if (response?.url) {
                                    await open(response.url);
                                } else {
                                    alert("Could not create portal session.");
                                }
                            } catch (e: any) {
                                alert("Failed to open subscription management: " + e.message);
                            } finally {
                                setIsSubscribing(false);
                            }
                        }}
                        className="text-slate-600 hover:text-slate-900 text-sm font-medium flex items-center justify-center gap-1 mx-auto"
                    >
                        {isSubscribing ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
                        Manage Subscription <ExternalLink size={14} />
                    </button>
                    <p className="text-xs text-slate-400 mt-2">Cancel anytime via the portal.</p>
                </div>
            )}

            {!licenseStatus?.valid && (
                <div className="mt-6 text-center">
                    <button
                        onClick={handleSubscribe}
                        disabled={isSubscribing}
                        className="text-blue-600 hover:text-blue-800 text-sm font-semibold hover:underline flex items-center justify-center gap-1 mx-auto"
                    >
                        {isSubscribing ? <Loader2 size={14} className="animate-spin" /> : null}
                        Purchase / Subscribe to a License
                    </button>
                </div>
            )}
        </div>
    );
};

export default LicenseManager;
