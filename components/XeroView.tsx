import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TakeoffItem } from '../types';
import {
    DEFAULT_GST_PERCENT,
    DEFAULT_XERO_TAX_RATE_NAME,
    DEFAULT_XERO_TAX_TYPE,
    addDays,
    billableLines,
    buildXeroCsv,
    computeLineItems,
    computeTotals,
    formatIsoDate,
    sumLineCents,
    toCents,
    toLocalIsoDate,
    xeroLineDescription,
} from '../utils/jobSheet';
import {
    ArrowLeft,
    Receipt,
    FileDown,
    Link2,
    Link2Off,
    Settings,
    CheckCircle2,
    Loader2,
    ExternalLink,
    RefreshCw,
    Printer,
    Send,
    Copy,
    AlertCircle,
    Building2,
    ChevronDown,
    ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useToast } from '../contexts/ToastContext';
import { isMobilePlatform } from '../utils/platform';
import {
    xeroService,
    XeroContact,
    XeroAccount,
    XeroTenant,
    XeroTaxRate,
    XeroLineItem,
} from '../services/xeroService';

// ── Local types ───────────────────────────────────────────────────────────────

type Tab = 'jobsheet' | 'xero' | 'settings';

interface CompanySettings {
    name: string;
    abn: string;
    address: string;
    phone: string;
    email: string;
    website: string;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface XeroViewProps {
    items: TakeoffItem[];
    projectName: string;
    onBack: () => void;
}

const COMPANY_SETTINGS_KEY = 'xero_company_settings';

function loadCompanySettings(): CompanySettings {
    try {
        const raw = localStorage.getItem(COMPANY_SETTINGS_KEY);
        if (raw) return JSON.parse(raw);
    } catch {
        // ignore
    }
    return { name: '', abn: '', address: '', phone: '', email: '', website: '' };
}

function saveCompanySettings(s: CompanySettings) {
    localStorage.setItem(COMPANY_SETTINGS_KEY, JSON.stringify(s));
}

// ── Currency formatter ────────────────────────────────────────────────────────
const fmt = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
});
const fmtCents = (cents: number) => fmt.format(cents / 100);

// Tauri's Android/iOS WebViews ignore window.print() and blob downloads.
const IS_MOBILE = isMobilePlatform();

function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/**
 * Xero's Australian GST on Income rate if the organisation has it, else its
 * first sales rate. A rate is always chosen explicitly, so the job sheet, the
 * CSV and the draft invoice all use the same one.
 */
function defaultTaxType(rates: XeroTaxRate[]): string {
    const preferred =
        rates.find((r) => r.TaxType === DEFAULT_XERO_TAX_TYPE) ??
        rates.find((r) => r.ReportTaxType === DEFAULT_XERO_TAX_TYPE) ??
        rates[0];
    return preferred?.TaxType ?? '';
}

// ═══════════════════════════════════════════════════════════════════════════════
// XeroView Component
// ═══════════════════════════════════════════════════════════════════════════════

const XeroView: React.FC<XeroViewProps> = ({ items, projectName, onBack }) => {
    const { addToast } = useToast();
    const printRef = useRef<HTMLDivElement>(null);

    // ── Tab state ───────────────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState<Tab>('jobsheet');

    // ── Company settings ────────────────────────────────────────────────────
    const [company, setCompany] = useState<CompanySettings>(loadCompanySettings);
    const [editingCompany, setEditingCompany] = useState(false);
    const [draftCompany, setDraftCompany] = useState<CompanySettings>(company);

    // ── Job sheet ───────────────────────────────────────────────────────────
    const [clientName, setClientName] = useState('');
    const [clientAddress, setClientAddress] = useState('');
    const [reference, setReference] = useState('');
    const [invoiceDate, setInvoiceDate] = useState(() => toLocalIsoDate(new Date()));
    const [dueDate, setDueDate] = useState(() => toLocalIsoDate(addDays(new Date(), 30)));

    // ── Xero connection ─────────────────────────────────────────────────────
    const [clientId, setClientId] = useState('');
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [authCode, setAuthCode] = useState('');
    const [authState, setAuthState] = useState('');
    const [awaitingCode, setAwaitingCode] = useState(false);
    const [tenants, setTenants] = useState<XeroTenant[]>([]);
    const [selectedTenant, setSelectedTenant] = useState('');
    const [contacts, setContacts] = useState<XeroContact[]>([]);
    const [selectedContact, setSelectedContact] = useState('');
    const [accounts, setAccounts] = useState<XeroAccount[]>([]);
    const [selectedAccount, setSelectedAccount] = useState('');
    const [taxRates, setTaxRates] = useState<XeroTaxRate[]>([]);
    const [selectedTaxType, setSelectedTaxType] = useState('');
    const [manualAccountCode, setManualAccountCode] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [loadingXero, setLoadingXero] = useState(false);
    // Each organisation load gets a sequence number so a slow response for a
    // previously selected organisation can't overwrite the current one.
    const tenantLoadSeq = useRef(0);
    const autoLoaded = useRef(false);

    // ── Collapsible groups ──────────────────────────────────────────────────
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

    // ── Computed data ───────────────────────────────────────────────────────
    const lineItems = computeLineItems(items);
    const billable = billableLines(lineItems);
    const groups = Array.from(new Set(lineItems.map((r) => r.group)));
    const selectedTaxRate = taxRates.find((r) => r.TaxType === selectedTaxType);
    const gstPercent =
        isConnected && selectedTaxRate && Number.isFinite(Number(selectedTaxRate.EffectiveRate))
            ? Number(selectedTaxRate.EffectiveRate)
            : DEFAULT_GST_PERCENT;
    const totals = computeTotals(lineItems, gstPercent);
    const groupTotalCents = (group: string) => sumLineCents(lineItems.filter((r) => r.group === group));
    const selectedAccountCode = accounts.find((a) => a.AccountID === selectedAccount)?.Code ?? '';
    const csvAccountCode = (isConnected ? selectedAccountCode : manualAccountCode).trim();
    const selectedContactName = contacts.find((c) => c.ContactID === selectedContact)?.Name ?? '';
    const datesSet = Boolean(invoiceDate && dueDate);

    // ── Load saved settings on mount ────────────────────────────────────────
    useEffect(() => {
        (async () => {
            const savedId = await xeroService.getClientId();
            if (savedId) setClientId(savedId);
            const connected = await xeroService.isConnected();
            setIsConnected(connected);
        })();
    }, []);

    // ── Save company settings ───────────────────────────────────────────────
    const handleSaveCompany = () => {
        setCompany(draftCompany);
        saveCompanySettings(draftCompany);
        setEditingCompany(false);
        addToast('Company details saved', 'success');
    };

    // ── Print job sheet ─────────────────────────────────────────────────────
    const handlePrint = () => {
        window.print();
    };

    // ── Xero OAuth ──────────────────────────────────────────────────────────
    const handleConnectXero = async () => {
        if (!clientId.trim()) {
            addToast('Please enter your Xero Client ID first', 'error');
            return;
        }
        setIsConnecting(true);
        try {
            await xeroService.setClientId(clientId.trim());
            await xeroService.startOAuthFlow(clientId.trim());
            setAwaitingCode(true);
        } catch (e: unknown) {
            addToast(`Failed to start authorization: ${errorMessage(e)}`, 'error');
        } finally {
            setIsConnecting(false);
        }
    };

    const handleSubmitCode = async () => {
        if (!authCode.trim()) {
            addToast('Please paste the authorization code', 'error');
            return;
        }
        if (!authState.trim()) {
            addToast('Please paste the state value from the authorization page', 'error');
            return;
        }
        setIsConnecting(true);
        try {
            await xeroService.exchangeCode(authCode.trim(), clientId.trim(), authState.trim());
            // Organisations, contacts and accounts load via the auto-load effect below.
            autoLoaded.current = false;
            setIsConnected(true);
            setAwaitingCode(false);
            setAuthCode('');
            setAuthState('');
            addToast('Connected to Xero successfully!', 'success');
        } catch (e: unknown) {
            addToast(`Connection failed: ${errorMessage(e)}`, 'error');
        } finally {
            setIsConnecting(false);
        }
    };

    /** Contacts, accounts and tax rates belong to one organisation: drop them on switch. */
    const clearTenantData = useCallback(() => {
        setContacts([]);
        setAccounts([]);
        setTaxRates([]);
        setSelectedContact('');
        setSelectedAccount('');
        setSelectedTaxType('');
    }, []);

    const handleDisconnect = async () => {
        const revoked = await xeroService.disconnect(clientId.trim());
        tenantLoadSeq.current += 1;
        clearTenantData();
        autoLoaded.current = false;
        setIsConnected(false);
        setTenants([]);
        setSelectedTenant('');
        setAwaitingCode(false);
        setAuthCode('');
        setAuthState('');
        if (revoked) {
            addToast('Disconnected from Xero', 'info');
        } else {
            addToast('Disconnected here, but Xero could not confirm the access was revoked. Remove ProTakeoff under Connected apps in Xero.', 'error');
        }
    };

    /** Loads one organisation's data; `seq` is the load generation taken before any await. */
    const loadTenantData = useCallback(async (token: string, tenantId: string, seq: number) => {
        const [fetchedContacts, fetchedAccounts, fetchedTaxRates] = await Promise.all([
            xeroService.getContacts(token, tenantId),
            xeroService.getAccounts(token, tenantId),
            xeroService.getTaxRates(token, tenantId),
        ]);
        if (seq !== tenantLoadSeq.current) return;
        setContacts(fetchedContacts);
        setAccounts(fetchedAccounts);
        setTaxRates(fetchedTaxRates);
        setSelectedContact((prev) => (fetchedContacts.some((c) => c.ContactID === prev) ? prev : ''));
        setSelectedAccount((prev) => (fetchedAccounts.some((a) => a.AccountID === prev) ? prev : ''));
        setSelectedTaxType((prev) =>
            fetchedTaxRates.some((r) => r.TaxType === prev) ? prev : defaultTaxType(fetchedTaxRates)
        );
    }, []);

    const handleTenantSelect = async (tenantId: string) => {
        const seq = ++tenantLoadSeq.current;
        setSelectedTenant(tenantId);
        clearTenantData();
        if (!tenantId) return;
        setLoadingXero(true);
        try {
            await xeroService.setTenantId(tenantId);
            const token = await xeroService.getValidToken(clientId);
            if (seq !== tenantLoadSeq.current) return;
            await loadTenantData(token, tenantId, seq);
        } catch (e: unknown) {
            if (seq === tenantLoadSeq.current) addToast(`Failed to load Xero data: ${errorMessage(e)}`, 'error');
        } finally {
            if (seq === tenantLoadSeq.current) setLoadingXero(false);
        }
    };

    const handleLoadXeroData = useCallback(async () => {
        const seq = ++tenantLoadSeq.current;
        setLoadingXero(true);
        try {
            const token = await xeroService.getValidToken(clientId);
            // Always fetch organisations, so a tenant that was never chosen (or
            // has since been disconnected in Xero) can still be picked.
            const fetchedTenants = await xeroService.getTenants(token);
            if (seq !== tenantLoadSeq.current) return;
            setTenants(fetchedTenants);
            const savedTenant = selectedTenant || (await xeroService.getTenantId()) || '';
            if (seq !== tenantLoadSeq.current) return;
            let tenantId = fetchedTenants.some((t) => t.tenantId === savedTenant) ? savedTenant : '';
            if (!tenantId && fetchedTenants.length === 1) tenantId = fetchedTenants[0].tenantId;
            if (tenantId !== selectedTenant) {
                clearTenantData();
                setSelectedTenant(tenantId);
            }
            if (tenantId && tenantId !== savedTenant) await xeroService.setTenantId(tenantId);
            if (tenantId && seq === tenantLoadSeq.current) await loadTenantData(token, tenantId, seq);
        } catch (e: unknown) {
            if (seq === tenantLoadSeq.current) addToast(`Failed to refresh Xero data: ${errorMessage(e)}`, 'error');
        } finally {
            if (seq === tenantLoadSeq.current) setLoadingXero(false);
        }
    }, [clientId, selectedTenant, loadTenantData, clearTenantData, addToast]);

    // When we switch to the Xero tab and are connected, load data once
    useEffect(() => {
        if (activeTab === 'xero' && isConnected && !autoLoaded.current) {
            autoLoaded.current = true;
            void handleLoadXeroData();
        }
    }, [activeTab, isConnected, handleLoadXeroData]);

    // ── CSV export for Xero ─────────────────────────────────────────────────
    const handleExportCSV = () => {
        if (IS_MOBILE) {
            addToast('CSV export is only available in the desktop app', 'error');
            return;
        }
        if (billable.length === 0) {
            addToast('There are no line items to export', 'error');
            return;
        }
        if (!csvAccountCode) {
            addToast('Enter or select a revenue account code for the Xero CSV', 'error');
            return;
        }
        if (!datesSet) {
            addToast('Set both the invoice date and the due date', 'error');
            return;
        }
        try {
            const csvContent = buildXeroCsv({
                rows: lineItems,
                // The chosen Xero contact wins, so the import bills that customer.
                contactName: (isConnected && selectedContactName) || clientName || projectName,
                address: clientAddress,
                // One invoice number for every row, so Xero imports a single invoice.
                invoiceNumber: reference || `INV-${Date.now().toString().slice(-6)}`,
                reference: projectName,
                invoiceDate,
                dueDate,
                accountCode: csvAccountCode,
                taxRateName: (isConnected && selectedTaxRate?.Name) || DEFAULT_XERO_TAX_RATE_NAME,
                currency: 'AUD',
            });

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${projectName.replace(/\s+/g, '_')}_Xero_Import.csv`;
            a.click();
            URL.revokeObjectURL(url);
            addToast('Xero CSV exported successfully', 'success');
        } catch (e: unknown) {
            addToast(`CSV export failed: ${errorMessage(e)}`, 'error');
        }
    };

    // ── Send invoice directly to Xero ───────────────────────────────────────
    const handleSendToXero = async () => {
        if (!selectedContact) { addToast('Please select a Xero contact', 'error'); return; }
        if (!selectedTenant) { addToast('Please select a Xero organisation', 'error'); return; }
        if (billable.length === 0) { addToast('There are no line items to invoice', 'error'); return; }
        if (!datesSet) { addToast('Set both the invoice date and the due date', 'error'); return; }

        setIsSending(true);
        try {
            const token = await xeroService.getValidToken(clientId);

            const xeroLineItems: XeroLineItem[] = billable.map((row) => ({
                Description: xeroLineDescription(row),
                Quantity: 1,
                UnitAmount: toCents(row.total) / 100,
                AccountCode: selectedAccountCode || undefined,
                // The same rate the job sheet and CSV use (see defaultTaxType).
                TaxType: selectedTaxType || undefined,
            }));

            const result = await xeroService.createInvoice(token, selectedTenant, {
                Type: 'ACCREC',
                Contact: { ContactID: selectedContact },
                LineItems: xeroLineItems,
                Date: invoiceDate,
                DueDate: dueDate,
                Reference: reference || projectName,
                Status: 'DRAFT',
                LineAmountTypes: 'Exclusive',
                // Every amount in this view is AUD; without this Xero would read
                // them in the organisation's base currency.
                CurrencyCode: 'AUD',
            });

            addToast(`Invoice ${result.InvoiceNumber} created in Xero!`, 'success');
            // Opening the browser is optional: a failure here must not read as a
            // failed send, or a retry would create a second draft invoice.
            try {
                await xeroService.openInvoiceInXero(result.InvoiceID);
            } catch {
                addToast(`Couldn't open the browser. Invoice ${result.InvoiceNumber} is in Xero as a draft.`, 'info');
            }
        } catch (e: unknown) {
            addToast(`Failed to send to Xero: ${errorMessage(e)}`, 'error');
        } finally {
            setIsSending(false);
        }
    };

    const toggleGroup = (g: string) => {
        setCollapsedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(g)) next.delete(g);
            else next.add(g);
            return next;
        });
    };

    // ══════════════════════════════════════════════════════════════════════════
    // Render
    // ══════════════════════════════════════════════════════════════════════════

    return (
        <div className="flex flex-col h-full bg-background">
            {/* ── Header ───────────────────────────────────────────────────── */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-background/95 shrink-0">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
                    <ArrowLeft size={16} />
                </Button>
                <div className="flex items-center gap-2">
                    <Receipt size={18} className="text-primary" />
                    <h1 className="font-semibold text-sm">Job Sheet &amp; Xero</h1>
                </div>
                <Badge variant="secondary" className="text-xs ml-1">{projectName}</Badge>
                <div className="flex-1" />
                {/* Connection status pill */}
                {activeTab === 'xero' && (
                    <div className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full ${isConnected ? 'bg-green-50 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                        {isConnected ? <CheckCircle2 size={12} /> : <Link2Off size={12} />}
                        {isConnected ? 'Xero Connected' : 'Not Connected'}
                    </div>
                )}
            </div>

            {/* ── Tab bar ───────────────────────────────────────────────────── */}
            <div className="flex items-center gap-0 px-4 pt-3 border-b border-border shrink-0 bg-background">
                {(['jobsheet', 'xero', 'settings'] as Tab[]).map((tab) => {
                    const labels: Record<Tab, { icon: React.ReactNode; label: string }> = {
                        jobsheet: { icon: <Printer size={13} />, label: 'Job Sheet' },
                        xero: { icon: <Receipt size={13} />, label: 'Send to Xero' },
                        settings: { icon: <Settings size={13} />, label: 'Settings' },
                    };
                    const isActive = activeTab === tab;
                    return (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors ${isActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                        >
                            {labels[tab].icon}
                            {labels[tab].label}
                        </button>
                    );
                })}
            </div>

            {/* ── Tab content ───────────────────────────────────────────────── */}
            <div className="flex-1 overflow-auto">

                {/* ────────────────── JOB SHEET TAB ─────────────────────────── */}
                {activeTab === 'jobsheet' && (
                    <div className="p-5 max-w-4xl mx-auto">
                        {/* Job sheet controls (no-print) */}
                        <div className="flex items-center gap-3 mb-5 no-print">
                            <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-3">
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Client / Contact</label>
                                    <Input
                                        value={clientName}
                                        onChange={(e) => setClientName(e.target.value)}
                                        placeholder="Client name"
                                        className="h-8 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Client Address</label>
                                    <Input
                                        value={clientAddress}
                                        onChange={(e) => setClientAddress(e.target.value)}
                                        placeholder="Billing address"
                                        className="h-8 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Reference</label>
                                    <Input
                                        value={reference}
                                        onChange={(e) => setReference(e.target.value)}
                                        placeholder="Job / Invoice #"
                                        className="h-8 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Date</label>
                                    <Input
                                        type="date"
                                        value={invoiceDate}
                                        onChange={(e) => setInvoiceDate(e.target.value)}
                                        className="h-8 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Due Date</label>
                                    <Input
                                        type="date"
                                        value={dueDate}
                                        onChange={(e) => setDueDate(e.target.value)}
                                        className="h-8 text-sm"
                                    />
                                </div>
                            </div>
                            {IS_MOBILE ? (
                                <span className="text-xs text-muted-foreground shrink-0 max-w-[10rem]">
                                    Printing is only available in the desktop app.
                                </span>
                            ) : (
                                <Button onClick={handlePrint} className="h-8 text-xs shrink-0" variant="outline">
                                    <Printer size={13} className="mr-1.5" /> Print / Save PDF
                                </Button>
                            )}
                        </div>

                        {/* Printable job sheet */}
                        <div ref={printRef} className="printable bg-white rounded-xl border border-border shadow-sm p-8 print:shadow-none print:border-none print:rounded-none print:p-0">
                            {/* Company header */}
                            <div className="flex items-start justify-between mb-8 border-b border-gray-200 pb-6">
                                <div>
                                    <h2 className="text-2xl font-bold text-gray-900">
                                        {company.name || 'Your Company Name'}
                                    </h2>
                                    {company.address && <p className="text-sm text-gray-500 mt-1">{company.address}</p>}
                                    {company.phone && <p className="text-sm text-gray-500">{company.phone}</p>}
                                    {company.email && <p className="text-sm text-gray-500">{company.email}</p>}
                                    {company.abn && <p className="text-xs text-gray-400 mt-1">ABN: {company.abn}</p>}
                                </div>
                                <div className="text-right">
                                    <div className="text-3xl font-black text-primary uppercase tracking-wide">Job Sheet</div>
                                    <div className="mt-2 text-sm text-gray-600">
                                        <div><span className="font-medium">Project:</span> {projectName}</div>
                                        {reference && <div><span className="font-medium">Ref:</span> {reference}</div>}
                                        <div><span className="font-medium">Date:</span> {formatIsoDate(invoiceDate)}</div>
                                        {dueDate && <div><span className="font-medium">Due:</span> {formatIsoDate(dueDate)}</div>}
                                    </div>
                                </div>
                            </div>

                            {/* Client info */}
                            {(clientName || clientAddress) && (
                                <div className="mb-6">
                                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Bill To</div>
                                    {clientName && <div className="font-semibold text-gray-900">{clientName}</div>}
                                    {clientAddress && <div className="text-sm text-gray-600">{clientAddress}</div>}
                                </div>
                            )}

                            {/* Line items by group */}
                            {groups.map((group) => {
                                const groupTotal = groupTotalCents(group);
                                const isCollapsed = collapsedGroups.has(group);

                                return (
                                    <div key={group} className="mb-6">
                                        {/* Group header */}
                                        <div
                                            className="flex items-center justify-between cursor-pointer py-2 border-b-2 border-gray-200 no-print"
                                            onClick={() => toggleGroup(group)}
                                        >
                                            <div className="flex items-center gap-2">
                                                {isCollapsed ? <ChevronRight size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                                                <span className="font-semibold text-sm text-gray-700">{group}</span>
                                            </div>
                                            <span className="text-sm font-medium text-gray-600">{fmtCents(groupTotal)}</span>
                                        </div>
                                        <div className="font-semibold text-sm text-gray-700 py-2 border-b-2 border-gray-200 print-only hidden print:flex justify-between">
                                            <span>{group}</span>
                                            <span>{fmtCents(groupTotal)}</span>
                                        </div>

                                        <table className={`w-full text-sm mt-2 ${isCollapsed ? 'hidden print:table' : ''}`}>
                                                <thead>
                                                    <tr className="text-xs text-gray-400 uppercase tracking-wider border-b border-gray-100">
                                                        <th className="text-left py-2 font-medium">Description</th>
                                                        <th className="text-right py-2 font-medium w-24">Qty</th>
                                                        <th className="text-right py-2 font-medium w-28">Unit Price</th>
                                                        <th className="text-right py-2 font-medium w-28">Total</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {lineItems
                                                        .filter((r) => r.group === group)
                                                        .map((row, idx) => (
                                                            <tr
                                                                key={idx}
                                                                className={`border-b border-gray-50 hover:bg-gray-50/50 ${row.isSubItem ? 'text-gray-500 text-xs' : ''}`}
                                                            >
                                                                <td className="py-2 pr-4">
                                                                    {row.isSubItem ? (
                                                                        <span className="pl-4 text-gray-400">{row.label}</span>
                                                                    ) : (
                                                                        row.label
                                                                    )}
                                                                </td>
                                                                <td className="py-2 text-right text-gray-600">
                                                                    {row.qty.toFixed(2)} <span className="text-xs text-gray-400">{row.unit}</span>
                                                                </td>
                                                                <td className="py-2 text-right text-gray-600">
                                                                    {row.unitPrice > 0 ? fmt.format(row.unitPrice) : '—'}
                                                                </td>
                                                                <td className="py-2 text-right font-medium">
                                                                    {/* Sub-items are a breakdown of the row above, not extra charges */}
                                                                    {row.isSubItem ? '' : row.total > 0 ? fmt.format(row.total) : '—'}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                </tbody>
                                            </table>
                                    </div>
                                );
                            })}

                            {/* Totals */}
                            <div className="flex justify-end mt-4">
                                <div className="w-64">
                                    <div className="flex justify-between py-2 text-sm">
                                        <span className="text-gray-600">Subtotal</span>
                                        <span className="font-medium">{fmtCents(totals.subtotalCents)}</span>
                                    </div>
                                    <div className="flex justify-between py-2 text-sm text-gray-400">
                                        <span>GST ({gstPercent}%)</span>
                                        <span>{fmtCents(totals.gstCents)}</span>
                                    </div>
                                    <Separator className="my-1" />
                                    <div className="flex justify-between py-2 font-bold text-base">
                                        <span>Total (inc. GST)</span>
                                        <span className="text-primary">{fmtCents(totals.totalCents)}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Footer note */}
                            <div className="mt-8 pt-4 border-t border-gray-100 text-xs text-gray-400 text-center">
                                {company.website && <span>{company.website} · </span>}
                                Generated by ProTakeoff · {new Date().toLocaleDateString('en-AU', { dateStyle: 'long' })}
                            </div>
                        </div>
                    </div>
                )}

                {/* ─────────────────── XERO TAB ─────────────────────────────── */}
                {activeTab === 'xero' && (
                    <div className="p-5 max-w-2xl mx-auto space-y-5">
                        {/* ── Connection card ───────────────────────────────── */}
                        <Card>
                            <CardContent className="p-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-300'}`} />
                                    <span className="font-semibold text-sm">Xero Connection</span>
                                    {isConnected && (
                                        <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground ml-auto" onClick={handleDisconnect}>
                                            <Link2Off size={12} className="mr-1" /> Disconnect
                                        </Button>
                                    )}
                                </div>

                                {!isConnected && !awaitingCode && (
                                    <div className="space-y-3">
                                        <p className="text-xs text-muted-foreground">
                                            Enter your <strong>Xero Client ID</strong> from the{' '}
                                            <a
                                                href="https://developer.xero.com/app/manage"
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-primary underline"
                                            >
                                                Xero Developer Portal
                                            </a>{' '}
                                            to connect your account.
                                        </p>
                                        <div className="flex gap-2">
                                            <Input
                                                value={clientId}
                                                onChange={(e) => setClientId(e.target.value)}
                                                placeholder="Xero Client ID"
                                                className="h-8 text-sm flex-1"
                                            />
                                            <Button
                                                onClick={handleConnectXero}
                                                disabled={isConnecting || !clientId.trim()}
                                                className="h-8 text-xs shrink-0"
                                            >
                                                {isConnecting ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <Link2 size={13} className="mr-1.5" />}
                                                Connect
                                            </Button>
                                        </div>
                                        <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700 space-y-1">
                                            <div className="font-semibold flex items-center gap-1"><AlertCircle size={12} /> Setup Instructions</div>
                                            <ol className="list-decimal list-inside space-y-1 text-blue-600">
                                                <li>Go to <strong>developer.xero.com/app/manage</strong></li>
                                                <li>Create a new app (or use an existing one)</li>
                                                <li>Add <code className="bg-blue-100 px-1 rounded text-[10px]">https://poyashauvewhifohkxeg.supabase.co/functions/v1/xero-oauth/callback</code> as a redirect URI</li>
                                                <li>Copy the <strong>Client ID</strong> and paste it above</li>
                                                <li>Click <strong>Connect</strong> and follow the prompts</li>
                                            </ol>
                                        </div>
                                    </div>
                                )}

                                {awaitingCode && (
                                    <div className="space-y-3">
                                        <div className="bg-amber-50 rounded-lg p-3 text-xs text-amber-700">
                                            <div className="font-semibold mb-1">Your browser has opened the Xero login page.</div>
                                            After authorizing, copy the <strong>Authorization Code</strong> and <strong>State</strong> shown on the page and paste them below.
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground mb-1 block">Authorization Code</label>
                                            <Input
                                                value={authCode}
                                                onChange={(e) => setAuthCode(e.target.value)}
                                                placeholder="Paste authorization code here"
                                                className="h-8 text-sm font-mono text-xs"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground mb-1 block">State</label>
                                            <Input
                                                value={authState}
                                                onChange={(e) => setAuthState(e.target.value)}
                                                placeholder="Paste state value here"
                                                className="h-8 text-sm font-mono text-xs"
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <Button onClick={handleSubmitCode} disabled={isConnecting || !authCode.trim() || !authState.trim()} className="h-8 text-xs">
                                                {isConnecting ? <Loader2 size={13} className="animate-spin" /> : 'Confirm'}
                                            </Button>
                                            <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setAwaitingCode(false); setAuthCode(''); setAuthState(''); }}>
                                                Cancel
                                            </Button>
                                        </div>
                                    </div>
                                )}

                                {isConnected && (
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2 text-xs text-green-700 font-medium">
                                            <CheckCircle2 size={14} />
                                            Connected to Xero
                                            <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto" onClick={handleLoadXeroData} title="Refresh">
                                                <RefreshCw size={12} className={loadingXero ? 'animate-spin' : ''} />
                                            </Button>
                                        </div>

                                        {/* Organisation selector */}
                                        {tenants.length > 1 && (
                                            <div>
                                                <label className="text-xs font-medium text-muted-foreground mb-1 block">Organisation</label>
                                                <select
                                                    value={selectedTenant}
                                                    onChange={(e) => handleTenantSelect(e.target.value)}
                                                    className="w-full h-8 text-sm border border-border rounded-md px-2 bg-background"
                                                >
                                                    <option value="">Select organisation…</option>
                                                    {tenants.map((t) => (
                                                        <option key={t.tenantId} value={t.tenantId}>{t.tenantName}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* ── Invoice details ───────────────────────────────── */}
                        <Card>
                            <CardContent className="p-4 space-y-3">
                                <div className="font-semibold text-sm mb-1">Invoice Details</div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground mb-1 block">Invoice Date</label>
                                        <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="h-8 text-sm" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground mb-1 block">Due Date</label>
                                        <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-8 text-sm" />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Reference</label>
                                    <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Job reference / number" className="h-8 text-sm" />
                                </div>

                                {isConnected && (
                                    <>
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground mb-1 block">Contact (Customer)</label>
                                            {loadingXero ? (
                                                <div className="flex items-center gap-2 text-xs text-muted-foreground h-8"><Loader2 size={12} className="animate-spin" /> Loading contacts…</div>
                                            ) : (
                                                <select
                                                    value={selectedContact}
                                                    onChange={(e) => setSelectedContact(e.target.value)}
                                                    className="w-full h-8 text-sm border border-border rounded-md px-2 bg-background"
                                                >
                                                    <option value="">Select contact…</option>
                                                    {contacts.map((c) => (
                                                        <option key={c.ContactID} value={c.ContactID}>{c.Name}</option>
                                                    ))}
                                                </select>
                                            )}
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground mb-1 block">Revenue Account <span className="font-normal">(optional when sending, required for CSV)</span></label>
                                            {loadingXero ? (
                                                <div className="flex items-center gap-2 text-xs text-muted-foreground h-8"><Loader2 size={12} className="animate-spin" /> Loading accounts…</div>
                                            ) : (
                                                <select
                                                    value={selectedAccount}
                                                    onChange={(e) => setSelectedAccount(e.target.value)}
                                                    className="w-full h-8 text-sm border border-border rounded-md px-2 bg-background"
                                                >
                                                    <option value="">No account / use Xero default</option>
                                                    {accounts.map((a) => (
                                                        <option key={a.AccountID} value={a.AccountID}>{a.Code} – {a.Name}</option>
                                                    ))}
                                                </select>
                                            )}
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground mb-1 block">Tax Rate</label>
                                            {loadingXero ? (
                                                <div className="flex items-center gap-2 text-xs text-muted-foreground h-8"><Loader2 size={12} className="animate-spin" /> Loading tax rates…</div>
                                            ) : (
                                                <select
                                                    value={selectedTaxType}
                                                    onChange={(e) => setSelectedTaxType(e.target.value)}
                                                    className="w-full h-8 text-sm border border-border rounded-md px-2 bg-background"
                                                >
                                                    {taxRates.length === 0 && <option value="">No tax rates loaded</option>}
                                                    {taxRates.map((r) => (
                                                        <option key={r.TaxType} value={r.TaxType}>{r.Name}</option>
                                                    ))}
                                                </select>
                                            )}
                                        </div>
                                    </>
                                )}

                                {!isConnected && (
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground mb-1 block">Revenue Account Code <span className="font-normal">(required for CSV)</span></label>
                                        <Input
                                            value={manualAccountCode}
                                            onChange={(e) => setManualAccountCode(e.target.value)}
                                            placeholder="Xero account code, e.g. 200"
                                            className="h-8 text-sm"
                                        />
                                        <p className="text-[11px] text-muted-foreground mt-1">
                                            CSV lines use the &ldquo;{DEFAULT_XERO_TAX_RATE_NAME}&rdquo; tax rate.
                                        </p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* ── Summary ───────────────────────────────────────── */}
                        <Card>
                            <CardContent className="p-4">
                                <div className="font-semibold text-sm mb-3">Summary ({billable.length} items)</div>
                                <div className="space-y-1 text-sm">
                                    {groups.map((g) => {
                                        return (
                                            <div key={g} className="flex justify-between text-muted-foreground">
                                                <span>{g}</span>
                                                <span>{fmtCents(groupTotalCents(g))}</span>
                                            </div>
                                        );
                                    })}
                                    <Separator className="my-2" />
                                    <div className="flex justify-between font-semibold">
                                        <span>Total (ex GST)</span>
                                        <span>{fmtCents(totals.subtotalCents)}</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* ── Action buttons ────────────────────────────────── */}
                        <div className="flex gap-3">
                            <Button
                                variant="outline"
                                className="flex-1 h-9 text-sm"
                                onClick={handleExportCSV}
                                disabled={IS_MOBILE || billable.length === 0 || !csvAccountCode || !datesSet}
                                title={
                                    IS_MOBILE
                                        ? 'CSV export is only available in the desktop app'
                                        : !csvAccountCode
                                            ? 'A revenue account code is required for the Xero CSV'
                                            : undefined
                                }
                            >
                                <FileDown size={14} className="mr-2" /> Export CSV for Xero
                            </Button>
                            {isConnected && (
                                <Button
                                    className="flex-1 h-9 text-sm"
                                    onClick={handleSendToXero}
                                    disabled={isSending || !selectedContact || !selectedTenant || billable.length === 0 || !datesSet}
                                >
                                    {isSending ? (
                                        <Loader2 size={14} className="mr-2 animate-spin" />
                                    ) : (
                                        <Send size={14} className="mr-2" />
                                    )}
                                    Send to Xero
                                </Button>
                            )}
                        </div>
                    </div>
                )}

                {/* ──────────────────── SETTINGS TAB ────────────────────────── */}
                {activeTab === 'settings' && (
                    <div className="p-5 max-w-lg mx-auto space-y-5">
                        <Card>
                            <CardContent className="p-4">
                                <div className="flex items-center gap-2 mb-4">
                                    <Building2 size={16} className="text-primary" />
                                    <span className="font-semibold text-sm">Company Details</span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 text-xs ml-auto"
                                        onClick={() => {
                                            if (editingCompany) {
                                                handleSaveCompany();
                                            } else {
                                                setDraftCompany(company);
                                                setEditingCompany(true);
                                            }
                                        }}
                                    >
                                        {editingCompany ? 'Save' : 'Edit'}
                                    </Button>
                                </div>

                                {editingCompany ? (
                                    <div className="space-y-3">
                                        {(
                                            [
                                                { key: 'name', label: 'Company Name', placeholder: 'Driven Waterproofing Solutions' },
                                                { key: 'abn', label: 'ABN', placeholder: '12 345 678 901' },
                                                { key: 'address', label: 'Address', placeholder: '123 Main St, Sydney NSW 2000' },
                                                { key: 'phone', label: 'Phone', placeholder: '+61 2 9000 0000' },
                                                { key: 'email', label: 'Email', placeholder: 'admin@example.com.au' },
                                                { key: 'website', label: 'Website', placeholder: 'www.example.com.au' },
                                            ] as { key: keyof CompanySettings; label: string; placeholder: string }[]
                                        ).map(({ key, label, placeholder }) => (
                                            <div key={key}>
                                                <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
                                                <Input
                                                    value={draftCompany[key]}
                                                    onChange={(e) => setDraftCompany((prev) => ({ ...prev, [key]: e.target.value }))}
                                                    placeholder={placeholder}
                                                    className="h-8 text-sm"
                                                />
                                            </div>
                                        ))}
                                        <div className="flex gap-2 pt-1">
                                            <Button onClick={handleSaveCompany} className="h-8 text-xs flex-1">Save Details</Button>
                                            <Button variant="outline" className="h-8 text-xs" onClick={() => setEditingCompany(false)}>Cancel</Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-1.5 text-sm text-muted-foreground">
                                        {company.name ? (
                                            <>
                                                <div className="font-semibold text-foreground">{company.name}</div>
                                                {company.abn && <div className="text-xs">ABN: {company.abn}</div>}
                                                {company.address && <div>{company.address}</div>}
                                                {company.phone && <div>{company.phone}</div>}
                                                {company.email && <div>{company.email}</div>}
                                                {company.website && <div>{company.website}</div>}
                                            </>
                                        ) : (
                                            <div className="text-muted-foreground text-xs italic">No company details set. Click Edit to add your details.</div>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Xero App Settings */}
                        <Card>
                            <CardContent className="p-4">
                                <div className="flex items-center gap-2 mb-4">
                                    <Receipt size={16} className="text-primary" />
                                    <span className="font-semibold text-sm">Xero App Settings</span>
                                </div>
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground mb-1 block">Client ID</label>
                                        <div className="flex gap-2">
                                            <Input
                                                value={clientId}
                                                onChange={(e) => setClientId(e.target.value)}
                                                placeholder="Xero OAuth2 Client ID"
                                                className="h-8 text-sm flex-1"
                                                disabled={isConnected}
                                            />
                                            <Button
                                                variant="outline"
                                                className="h-8 text-xs shrink-0"
                                                disabled={isConnected}
                                                onClick={async () => {
                                                    if (clientId) {
                                                        await xeroService.setClientId(clientId);
                                                        addToast('Client ID saved', 'success');
                                                    }
                                                }}
                                            >
                                                Save
                                            </Button>
                                        </div>
                                        {isConnected && (
                                            <p className="text-[11px] text-muted-foreground mt-1">
                                                Disconnect from Xero to change the Client ID; the current connection is tied to it.
                                            </p>
                                        )}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        You need a Xero developer app to connect. Visit{' '}
                                        <a href="https://developer.xero.com/app/manage" target="_blank" rel="noreferrer" className="text-primary underline">
                                            developer.xero.com/app/manage
                                        </a>{' '}
                                        and use the following redirect URI in your app:
                                    </p>
                                    <div className="bg-muted rounded-md p-2 flex items-center gap-2">
                                        <code className="text-xs text-foreground flex-1 break-all">
                                            https://poyashauvewhifohkxeg.supabase.co/functions/v1/xero-oauth/callback
                                        </code>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 shrink-0"
                                            onClick={() => {
                                                navigator.clipboard.writeText('https://poyashauvewhifohkxeg.supabase.co/functions/v1/xero-oauth/callback');
                                                addToast('Redirect URI copied', 'success');
                                            }}
                                        >
                                            <Copy size={11} />
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}

            </div>
        </div>
    );
};

export default XeroView;
