import React, { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-shell';
import { ShieldCheck, Key, Loader2, AlertCircle, Crown, AlertTriangle, Clock, CreditCard, ExternalLink } from 'lucide-react';
import { licenseService, LicenseStatus } from '../services/licenseService';
import { stripeService } from '../services/stripeService';

interface LicenseModalProps {
    onSuccess: () => void;
    initialMessage?: string | null;
    currentLicenseStatus?: LicenseStatus | null;
}

const LicenseModal: React.FC<LicenseModalProps> = ({ onSuccess, initialMessage, currentLicenseStatus }) => {
    const [key, setKey] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSubscribing, setIsSubscribing] = useState(false);
    const [error, setError] = useState<string | null>(initialMessage || null);
    const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(currentLicenseStatus || null);

    useEffect(() => {
        if (currentLicenseStatus) {
            setLicenseStatus(currentLicenseStatus);
        }
    }, [currentLicenseStatus]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!key.trim()) return;

        setIsLoading(true);
        setError(null);

        try {
            const response = await licenseService.activateKey(key.trim());

            if (response.valid) {
                setLicenseStatus(response);
                onSuccess();
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
        console.log("Subscribe button clicked");
        // We allow subscribing without a license key (will use machine ID in backend)
        setIsSubscribing(true);
        setError(null);
        try {
            console.log(`Calling stripeService with key: ${licenseStatus?.licenseKey}`);
            const response = await stripeService.createCheckoutSession(licenseStatus?.licenseKey || '');
            console.log("Stripe response received:", response);
            const { url } = response;

            if (url) {
                console.log(`Opening external browser: ${url}`);
                await open(url); // Open in default browser

                // Start polling for success in the UI since we are in an external browser
                // addToast("Checkout opened in browser. Waiting for completion...", "info");

                // Poll for up to 5 minutes? Or just let user manage it? 
                // Let's rely on the existing polling or just let the user click "Activate" if they have a key, 
                // BUT for subscription, we want auto-detect.

                // Simple polling loop here since we don't have a deep link return guaranteed
                let attempts = 0;
                const pollInterval = setInterval(async () => {
                    attempts++;
                    try {
                        const res = await licenseService.checkLicense();
                        if (res.valid && res.licenseType === 'paid') {
                            clearInterval(pollInterval);
                            setLicenseStatus(res);
                            onSuccess();
                            // addToast("Subscription confirmed!", "success");
                        }
                    } catch (e) {
                        // console.error("Poll error", e); 
                    }

                    if (attempts > 60) { // 2 minutes approx (assuming 2s interval) - adjust as needed
                        clearInterval(pollInterval);
                        setIsSubscribing(false); // Stop the spinner/loading state
                        // Don't show error, just stop polling. User can manually check.
                    }
                }, 2000);

            } else {
                const err = "No URL in response";
                console.error(err);
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
        <div className="fixed inset-0 z-[200] bg-slate-900 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 animate-in zoom-in-95 duration-300">
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
                        <button className="text-slate-600 hover:text-slate-900 text-sm font-medium flex items-center justify-center gap-1 mx-auto">
                            Manage Subscription <ExternalLink size={14} />
                        </button>
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
        </div>
    );
};

export default LicenseModal;