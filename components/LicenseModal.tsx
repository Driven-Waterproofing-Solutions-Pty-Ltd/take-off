import React, { useState, useEffect } from 'react';
import { open as openShell } from '@tauri-apps/plugin-shell';
import { ShieldCheck, Key, Loader2, AlertCircle, Crown, Clock, Check, ExternalLink, Zap, Copy, ChevronLeft } from 'lucide-react';
import { licenseService, LicenseStatus } from '../services/licenseService';
import { stripeService } from '../services/stripeService';
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export interface LicenseModalProps {
    isOpen: boolean;
    onClose?: () => void;
    onSuccess?: () => void;
    initialMessage?: string | null;
    currentLicenseStatus?: LicenseStatus | null;
    forceRefreshOnMount?: boolean;
    allowClose?: boolean;
}

const LicenseModal: React.FC<LicenseModalProps> = ({
    isOpen,
    onClose,
    onSuccess,
    initialMessage,
    currentLicenseStatus,
    forceRefreshOnMount = false,
    allowClose = true
}) => {
    const [view, setView] = useState<'status' | 'enter-key'>('status');
    const [machineId, setMachineId] = useState<string>('');
    const [key, setKey] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSubscribing, setIsSubscribing] = useState(false);
    const [error, setError] = useState<string | null>(initialMessage || null);
    const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(currentLicenseStatus || null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (isOpen) {
            if (currentLicenseStatus) {
                setLicenseStatus(currentLicenseStatus);
            } else {
                licenseService.checkLicense(forceRefreshOnMount).then(setLicenseStatus).catch(console.error);
            }
            licenseService.getMachineId().then(setMachineId);
        }
    }, [isOpen, currentLicenseStatus, forceRefreshOnMount]);

    const handleCopyMachineId = () => {
        navigator.clipboard.writeText(machineId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

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
                setView('status');
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
            const keyToUse = licenseStatus?.licenseKey || '';
            const response = await stripeService.createCheckoutSession(keyToUse);
            const { url } = response;

            if (url) {
                await openShell(url);
                let attempts = 0;
                const pollInterval = setInterval(async () => {
                    attempts++;
                    try {
                        const res = await licenseService.checkLicense(true);
                        if (res.valid && res.licenseType === 'paid') {
                            clearInterval(pollInterval);
                            setLicenseStatus(res);
                            if (onSuccess) onSuccess();
                            setIsSubscribing(false);
                        }
                    } catch (e) { /* ignore */ }
                    if (attempts > 60) {
                        clearInterval(pollInterval);
                        setIsSubscribing(false);
                    }
                }, 2000);
            } else {
                throw new Error("Failed to create checkout session.");
            }
        } catch (e: any) {
            setError(e.message || "Failed to start subscription.");
            setIsSubscribing(false);
        }
    };

    const handleManageSubscription = async () => {
        try {
            setIsSubscribing(true);
            const response = await stripeService.createCustomerPortalSession(licenseStatus?.licenseKey || '');
            if (response?.url) {
                await openShell(response.url);
            } else {
                alert("Could not create portal session.");
            }
        } catch (e: any) {
            alert("Failed to open subscription management: " + e.message);
        } finally {
            setIsSubscribing(false);
        }
    };

    const handleReset = async () => {
        if (confirm("This will clear your local license key and restart the app trial check. Are you sure?")) {
            try {
                await licenseService.clearStoredData();
                const newStatus = await licenseService.checkLicense();
                setLicenseStatus(newStatus);
                setError(null);
                if (newStatus.valid && onSuccess) onSuccess();
            } catch (error: any) {
                alert("Reset failed: " + error.message);
            }
        }
    };

    const getDaysUntilExpiration = () => {
        if (!licenseStatus?.expiresAt) return null;
        const expiryDate = new Date(licenseStatus.expiresAt);
        const now = new Date();
        return Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    };

    const daysLeft = getDaysUntilExpiration();
    const isExpiringSoon = daysLeft !== null && daysLeft > 0 && daysLeft <= 7;
    const isExpired = daysLeft !== null && daysLeft <= 0;
    const isTrial = licenseStatus?.licenseType === 'trial';
    const isPaid = licenseStatus?.licenseType === 'paid';

    return (
        <Dialog
            open={isOpen}
            onOpenChange={(open) => {
                if (!open && allowClose && onClose) {
                    onClose();
                }
            }}
        >
            <DialogContent
                className="sm:max-w-[500px] p-0 gap-0 overflow-hidden"
                onInteractOutside={(e) => {
                    if (!allowClose) e.preventDefault();
                }}
                onEscapeKeyDown={(e) => {
                    if (!allowClose) e.preventDefault();
                }}
                showCloseButton={allowClose}
            >
                <DialogTitle className="sr-only">License Manager</DialogTitle>
                <DialogDescription className="sr-only">
                    Manage your ProTakeoff license status, activate a new key, or start a trial.
                </DialogDescription>
                <div className="w-full flex flex-col h-full max-h-[85vh] overflow-hidden">
                    <div className="px-5 py-3 flex items-center justify-between border-b bg-muted/20 shrink-0">
                        <div className="flex items-center gap-2.5">
                            <div className={cn(
                                "h-8 w-8 rounded-lg flex items-center justify-center shadow-sm",
                                isPaid ? "bg-gradient-to-br from-green-100 to-emerald-100 text-green-600" : "bg-gradient-to-br from-orange-100 to-amber-100 text-orange-600"
                            )}>
                                <ShieldCheck size={16} />
                            </div>
                            <div>
                                <h2 className="text-sm font-semibold leading-none">License Manager</h2>
                                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
                                    {isPaid ? "Pro Edition Active" : "Trial Version"}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">

                            <div className="flex flex-col items-end gap-0.5">
                                <img src="/protakeoff.png" alt="ProTakeoff" className="h-8 object-contain" />
                                <a href="mailto:info@protakeoff.org" className="text-[10px] text-muted-foreground hover:text-primary transition-colors">
                                    info@protakeoff.org
                                </a>
                            </div>
                        </div>
                    </div>

                    <div className="p-4 overflow-y-auto flex-1">
                        <Tabs value={view} onValueChange={(v: any) => setView(v)} className="w-full h-full flex flex-col">
                            <TabsList className="grid w-full grid-cols-2 mb-4 h-8 shrink-0">
                                <TabsTrigger value="status" className="text-xs">Status</TabsTrigger>
                                <TabsTrigger value="enter-key" className="text-xs">Transfer / Restore</TabsTrigger>
                            </TabsList>

                            <TabsContent value="status" className="flex-1 flex flex-col gap-3 outline-none mt-0">
                                {/* Compact Status Block */}
                                <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-3 flex flex-col gap-2">
                                    <div className="flex justify-between items-start">
                                        <div className="space-y-0.5">
                                            <h3 className="font-semibold text-sm flex items-center gap-1.5">
                                                {isPaid ? <Check size={14} className="text-green-600" /> : <Clock size={14} className="text-orange-600" />}
                                                {isPaid ? "Subscription Active" : "Trial Period"}
                                            </h3>
                                            <p className="text-xs text-muted-foreground">
                                                {isPaid ? "Your license is valid." : "You are using the free trial."}
                                            </p>
                                        </div>
                                        <div className={cn("text-xs font-bold px-2 py-1 rounded", isExpiringSoon ? "bg-red-100 text-red-700" : "bg-secondary text-secondary-foreground")}>
                                            {isExpired ? "Expired" : daysLeft !== null ? `${daysLeft} days left` : "Unknown"}
                                        </div>
                                    </div>

                                    {isPaid && (
                                        <Button variant="outline" size="sm" className="w-full h-7 text-xs mt-1" onClick={handleManageSubscription} disabled={isSubscribing}>
                                            <ExternalLink className="mr-1.5 h-3 w-3" />
                                            Manage Subscription
                                        </Button>
                                    )}
                                </div>

                                {/* Upgrade Banner - Horizontal & Thin */}
                                {(!isPaid || isExpired) && (
                                    <div className="rounded-lg border border-indigo-100 bg-gradient-to-r from-indigo-50 to-white p-3 flex items-center justify-between gap-3 shadow-sm">
                                        <div className="flex items-center gap-2.5">
                                            <div className="bg-white p-1.5 rounded-md shadow-sm text-indigo-600">
                                                <Zap size={14} className="fill-indigo-600" />
                                            </div>
                                            <div className="leading-3">
                                                <div className="font-bold text-xs text-indigo-950">{isExpired ? "Renew Subscription" : "Upgrade to Pro"}</div>
                                                <div className="text-[10px] text-indigo-600/80 font-medium mt-0.5">{isExpired ? "Restore Pro access" : "Unlimited features"}</div>
                                            </div>
                                        </div>
                                        <Button size="sm" className="h-7 px-3 text-xs bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm shrink-0" onClick={handleSubscribe} disabled={isSubscribing}>
                                            {isSubscribing ? <Loader2 className="h-3 w-3 animate-spin" /> : (isExpired ? "Renew Now" : "Subscribe $23.49")}
                                        </Button>
                                    </div>
                                )}

                                {/* Footer System ID - Compact Row */}
                                <div className="mt-auto pt-2">
                                    <div className="rounded-md bg-muted/30 border border-border/50 p-2 flex items-center justify-between gap-2">
                                        <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider shrink-0 pl-1">ID</span>
                                        <code className="text-[10px] font-mono bg-background px-1.5 py-0.5 rounded border text-muted-foreground truncate flex-1 text-center select-all">
                                            {machineId || "..."}
                                        </code>
                                        <Button size="icon" variant="ghost" className="h-5 w-5 shrink-0 hover:bg-background" onClick={handleCopyMachineId}>
                                            {copied ? <Check size={10} className="text-green-600" /> : <Copy size={10} className="text-muted-foreground" />}
                                        </Button>
                                    </div>
                                </div>
                            </TabsContent>

                            <TabsContent value="enter-key" className="flex-1 flex flex-col gap-3 outline-none mt-0">
                                <div className="rounded-lg border bg-card p-3 space-y-3">
                                    <div className="space-y-1">
                                        <Label htmlFor="license-key" className="text-xs">Product Key</Label>
                                        <div className="text-[10px] text-muted-foreground mb-2 space-y-1">
                                            <p>Enter a key ONLY if you are transferring a license from another computer.</p>
                                            <div className="text-black flex items-start gap-1.5 bg-orange-50 p-1.5 rounded border border-orange-100">
                                                <AlertCircle size={12} className="mt-0.5 shrink-0 text-orange-600" />
                                                <span><strong>Warning:</strong> Configuring this key will deactivate ProTakeoff on the previous machine immediately.</span>
                                            </div>
                                        </div>
                                        <div className="relative">
                                            <Key className="absolute left-2.5 top-2.5 text-muted-foreground opacity-50" size={12} />
                                            <Input
                                                id="license-key"
                                                value={key}
                                                onChange={(e) => setKey(e.target.value)}
                                                className="pl-8 font-mono uppercase text-xs h-8"
                                                placeholder="XXXX-XXXX-XXXX-XXXX"
                                                autoFocus
                                            />
                                        </div>
                                    </div>
                                    {error && (
                                        <div className="text-[10px] text-destructive flex items-center gap-1 font-medium bg-destructive/10 p-2 rounded">
                                            <AlertCircle size={10} /> {error}
                                        </div>
                                    )}
                                </div>

                                <div className="mt-auto space-y-2">
                                    <Button
                                        className="w-full h-8 text-xs bg-primary"
                                        type="submit"
                                        onClick={handleSubmit}
                                        disabled={isLoading || !key.trim()}
                                    >
                                        {isLoading ? (
                                            <><Loader2 className="mr-2 h-3 w-3 animate-spin" /> Verifying...</>
                                        ) : (
                                            "Activate License"
                                        )}
                                    </Button>
                                    <div className="flex justify-center">
                                        <Button variant="link" size="sm" className="text-[10px] h-auto p-0 text-muted-foreground" onClick={handleReset}>
                                            Reset data
                                        </Button>
                                    </div>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default LicenseModal;