import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TakeoffItem, ToolType, Unit } from '../types';
import { evaluateFormula, convertValue, toVariableName } from '../utils/math';
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
import {
    xeroService,
    XeroContact,
    XeroAccount,
    XeroTenant,
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

interface ComputedLineItem {
    group: string;
    label: string;
    type: string;
    qty: number;
    unit: string;
    unitPrice: number;
    total: number;
    isSubItem?: boolean;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface XeroViewProps {
    items: TakeoffItem[];
    projectName: string;
    onBack: () => void;
}

// ── Helper: compute line items from TakeoffItems ──────────────────────────────

function computeLineItems(items: TakeoffItem[]): ComputedLineItem[] {
    const rows: ComputedLineItem[] = [];

    items
        .filter((i) => i.type !== ToolType.NOTE)
        .forEach((item) => {
            const convertedQty = convertValue(item.totalValue, Unit.FEET, item.unit, item.type);
            const calculated = evaluateFormula(item, convertedQty);

            const subContext: Record<string, number> = {};
            let subTotal = 0;
            const subRows: ComputedLineItem[] = [];

            if (item.subItems && item.subItems.length > 0) {
                item.subItems.forEach((sub) => {
                    const subQty = evaluateFormula(item, convertedQty, sub.formula, subContext);
                    const varName = toVariableName(sub.label);
                    if (varName) subContext[varName] = subQty;
                    const lineTotal = subQty * sub.price;
                    subTotal += lineTotal;
                    subRows.push({
                        group: item.group || 'General',
                        label: `  ↳ ${sub.label}`,
                        type: 'Sub-Item',
                        qty: subQty,
                        unit: sub.unit,
                        unitPrice: sub.price,
                        total: lineTotal,
                        isSubItem: true,
                    });
                });
            }

            let totalCost: number;
            let unitPrice: number;
            if ((!item.price || item.price === 0) && subTotal > 0 && calculated > 0) {
                totalCost = subTotal;
                unitPrice = totalCost / calculated;
            } else {
                totalCost = calculated * (item.price || 0);
                unitPrice = item.price || 0;
            }

            rows.push({
                group: item.group || 'General',
                label: item.label,
                type: item.type,
                qty: calculated,
                unit: item.unit,
                unitPrice,
                total: totalCost,
            });
            rows.push(...subRows);
        });

    return rows;
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
    const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [dueDate, setDueDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        return d.toISOString().slice(0, 10);
    });

    // ── Xero connection ─────────────────────────────────────────────────────
    const [clientId, setClientId] = useState('');
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [authCode, setAuthCode] = useState('');
    const [awaitingCode, setAwaitingCode] = useState(false);
    const [tenants, setTenants] = useState<XeroTenant[]>([]);
    const [selectedTenant, setSelectedTenant] = useState('');
    const [contacts, setContacts] = useState<XeroContact[]>([]);
    const [selectedContact, setSelectedContact] = useState('');
    const [accounts, setAccounts] = useState<XeroAccount[]>([]);
    const [selectedAccount, setSelectedAccount] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [loadingXero, setLoadingXero] = useState(false);

    // ── Collapsible groups ──────────────────────────────────────────────────
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

    // ── Computed data ───────────────────────────────────────────────────────
    const lineItems = computeLineItems(items);
    const grandTotal = lineItems.reduce((s, r) => (!r.isSubItem ? s + r.total : s), 0);
    const groups = Array.from(new Set(lineItems.map((r) => r.group)));

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
        } catch (e: any) {
            addToast(`Failed to start authorization: ${e.message}`, 'error');
        } finally {
            setIsConnecting(false);
        }
    };

    const handleSubmitCode = async () => {
        if (!authCode.trim()) {
            addToast('Please paste the authorization code', 'error');
            return;
        }
        setIsConnecting(true);
        try {
            await xeroService.exchangeCode(authCode.trim(), clientId.trim());
            const token = await xeroService.getValidToken(clientId.trim());
            const fetchedTenants = await xeroService.getTenants(token);
            setTenants(fetchedTenants);
            if (fetchedTenants.length === 1) {
                setSelectedTenant(fetchedTenants[0].tenantId);
                await xeroService.setTenantId(fetchedTenants[0].tenantId);
            }
            setIsConnected(true);
            setAwaitingCode(false);
            setAuthCode('');
            addToast('Connected to Xero successfully!', 'success');
        } catch (e: any) {
            addToast(`Connection failed: ${e.message}`, 'error');
        } finally {
            setIsConnecting(false);
        }
    };

    const handleDisconnect = async () => {
        await xeroService.clearTokens();
        setIsConnected(false);
        setTenants([]);
        setContacts([]);
        setAccounts([]);
        setSelectedTenant('');
        setSelectedContact('');
        setSelectedAccount('');
        setAwaitingCode(false);
        addToast('Disconnected from Xero', 'info');
    };

    const handleTenantSelect = async (tenantId: string) => {
        setSelectedTenant(tenantId);
        await xeroService.setTenantId(tenantId);
        setLoadingXero(true);
        try {
            const token = await xeroService.getValidToken(clientId);
            const [fetchedContacts, fetchedAccounts] = await Promise.all([
                xeroService.getContacts(token, tenantId),
                xeroService.getAccounts(token, tenantId),
            ]);
            setContacts(fetchedContacts);
            setAccounts(fetchedAccounts);
        } catch (e: any) {
            addToast(`Failed to load Xero data: ${e.message}`, 'error');
        } finally {
            setLoadingXero(false);
        }
    };

    const handleLoadXeroData = useCallback(async () => {
        const tenantId = selectedTenant || (await xeroService.getTenantId());
        if (!tenantId) return;
        setLoadingXero(true);
        try {
            const token = await xeroService.getValidToken(clientId);
            const [fetchedContacts, fetchedAccounts, fetchedTenants] = await Promise.all([
                xeroService.getContacts(token, tenantId),
                xeroService.getAccounts(token, tenantId),
                tenants.length === 0 ? xeroService.getTenants(token) : Promise.resolve(tenants),
            ]);
            setContacts(fetchedContacts);
            setAccounts(fetchedAccounts);
            if (tenants.length === 0) setTenants(fetchedTenants);
            if (!selectedTenant && tenantId) setSelectedTenant(tenantId);
        } catch (e: any) {
            addToast(`Failed to refresh Xero data: ${e.message}`, 'error');
        } finally {
            setLoadingXero(false);
        }
    }, [clientId, selectedTenant, tenants, addToast]);

    // When we switch to the Xero tab and are connected, load data lazily
    useEffect(() => {
        if (activeTab === 'xero' && isConnected && contacts.length === 0) {
            handleLoadXeroData();
        }
    }, [activeTab, isConnected, handleLoadXeroData]);

    // ── CSV export for Xero ─────────────────────────────────────────────────
    const handleExportCSV = () => {
        try {
            const headers = [
                '*ContactName', 'EmailAddress', 'POAddressLine1', 'POCity',
                '*InvoiceNumber', 'Reference', '*InvoiceDate', '*DueDate',
                'Total', '*InventoryItemCode', '*Description', '*Quantity',
                '*UnitAmount', 'Discount', '*AccountCode', '*TaxType', 'TaxAmount', 'Currency',
            ];

            const mainRows = lineItems.filter((r) => !r.isSubItem);
            const csvRows: string[][] = [];

            mainRows.forEach((row, idx) => {
                csvRows.push([
                    clientName || projectName,
                    '',
                    clientAddress,
                    '',
                    reference || `INV-${Date.now().toString().slice(-6)}`,
                    projectName,
                    invoiceDate,
                    dueDate,
                    idx === 0 ? grandTotal.toFixed(2) : '',
                    '',
                    `${row.group}: ${row.label}`,
                    row.qty.toFixed(2),
                    row.unitPrice.toFixed(2),
                    '',
                    selectedAccount ? (accounts.find((a) => a.AccountID === selectedAccount)?.Code || '') : '',
                    'NOTAX',
                    '0',
                    'AUD',
                ]);
            });

            const csvContent = [
                headers.join(','),
                ...csvRows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')),
            ].join('\n');

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${projectName.replace(/\s+/g, '_')}_Xero_Import.csv`;
            a.click();
            URL.revokeObjectURL(url);
            addToast('Xero CSV exported successfully', 'success');
        } catch (e: any) {
            addToast(`CSV export failed: ${e.message}`, 'error');
        }
    };

    // ── Send invoice directly to Xero ───────────────────────────────────────
    const handleSendToXero = async () => {
        if (!selectedContact) { addToast('Please select a Xero contact', 'error'); return; }
        if (!selectedTenant) { addToast('Please select a Xero organisation', 'error'); return; }

        setIsSending(true);
        try {
            const token = await xeroService.getValidToken(clientId);

            const xeroLineItems: XeroLineItem[] = lineItems
                .filter((r) => !r.isSubItem)
                .map((row) => ({
                    Description: `${row.group}: ${row.label} (${row.qty.toFixed(2)} ${row.unit})`,
                    Quantity: 1,
                    UnitAmount: row.total,
                    AccountCode: selectedAccount
                        ? (accounts.find((a) => a.AccountID === selectedAccount)?.Code)
                        : undefined,
                    TaxType: 'NOTAX',
                }));

            const result = await xeroService.createInvoice(token, selectedTenant, {
                Type: 'ACCREC',
                Contact: { ContactID: selectedContact },
                LineItems: xeroLineItems,
                Date: invoiceDate,
                DueDate: dueDate,
                Reference: reference || projectName,
                Status: 'DRAFT',
                LineAmountTypes: 'NOTAX',
            });

            addToast(`Invoice ${result.InvoiceNumber} created in Xero!`, 'success');
            await xeroService.openInvoiceInXero(result.InvoiceID);
        } catch (e: any) {
            addToast(`Failed to send to Xero: ${e.message}`, 'error');
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
                            <div className="flex-1 grid grid-cols-3 gap-3">
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
                            </div>
                            <Button onClick={handlePrint} className="h-8 text-xs shrink-0" variant="outline">
                                <Printer size={13} className="mr-1.5" /> Print / Save PDF
                            </Button>
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
                                        <div><span className="font-medium">Date:</span> {new Date(invoiceDate).toLocaleDateString('en-AU')}</div>
                                        {dueDate && <div><span className="font-medium">Due:</span> {new Date(dueDate).toLocaleDateString('en-AU')}</div>}
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
                                const groupRows = lineItems.filter((r) => r.group === group && !r.isSubItem);
                                const groupTotal = groupRows.reduce((s, r) => s + r.total, 0);
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
                                            <span className="text-sm font-medium text-gray-600">{fmt.format(groupTotal)}</span>
                                        </div>
                                        <div className="font-semibold text-sm text-gray-700 py-2 border-b-2 border-gray-200 print-only hidden print:flex justify-between">
                                            <span>{group}</span>
                                            <span>{fmt.format(groupTotal)}</span>
                                        </div>

                                        {!isCollapsed && (
                                            <table className="w-full text-sm mt-2">
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
                                                                    {row.total > 0 ? fmt.format(row.total) : '—'}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Totals */}
                            <div className="flex justify-end mt-4">
                                <div className="w-64">
                                    <div className="flex justify-between py-2 text-sm">
                                        <span className="text-gray-600">Subtotal</span>
                                        <span className="font-medium">{fmt.format(grandTotal)}</span>
                                    </div>
                                    <div className="flex justify-between py-2 text-sm text-gray-400">
                                        <span>GST (10%)</span>
                                        <span>{fmt.format(grandTotal * 0.1)}</span>
                                    </div>
                                    <Separator className="my-1" />
                                    <div className="flex justify-between py-2 font-bold text-base">
                                        <span>Total (inc. GST)</span>
                                        <span className="text-primary">{fmt.format(grandTotal * 1.1)}</span>
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
                                            After authorizing, you will see a page with an authorization code.
                                            Copy it and paste it below.
                                        </div>
                                        <div className="flex gap-2">
                                            <Input
                                                value={authCode}
                                                onChange={(e) => setAuthCode(e.target.value)}
                                                placeholder="Paste authorization code here"
                                                className="h-8 text-sm flex-1 font-mono text-xs"
                                            />
                                            <Button onClick={handleSubmitCode} disabled={isConnecting || !authCode.trim()} className="h-8 text-xs shrink-0">
                                                {isConnecting ? <Loader2 size={13} className="animate-spin" /> : 'Confirm'}
                                            </Button>
                                        </div>
                                        <Button variant="ghost" size="sm" className="text-xs" onClick={() => setAwaitingCode(false)}>
                                            Cancel
                                        </Button>
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
                                            <label className="text-xs font-medium text-muted-foreground mb-1 block">Revenue Account <span className="font-normal">(optional)</span></label>
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
                                    </>
                                )}
                            </CardContent>
                        </Card>

                        {/* ── Summary ───────────────────────────────────────── */}
                        <Card>
                            <CardContent className="p-4">
                                <div className="font-semibold text-sm mb-3">Summary ({lineItems.filter((r) => !r.isSubItem).length} items)</div>
                                <div className="space-y-1 text-sm">
                                    {groups.map((g) => {
                                        const gTotal = lineItems.filter((r) => r.group === g && !r.isSubItem).reduce((s, r) => s + r.total, 0);
                                        return (
                                            <div key={g} className="flex justify-between text-muted-foreground">
                                                <span>{g}</span>
                                                <span>{fmt.format(gTotal)}</span>
                                            </div>
                                        );
                                    })}
                                    <Separator className="my-2" />
                                    <div className="flex justify-between font-semibold">
                                        <span>Total (ex GST)</span>
                                        <span>{fmt.format(grandTotal)}</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* ── Action buttons ────────────────────────────────── */}
                        <div className="flex gap-3">
                            <Button variant="outline" className="flex-1 h-9 text-sm" onClick={handleExportCSV}>
                                <FileDown size={14} className="mr-2" /> Export CSV for Xero
                            </Button>
                            {isConnected && (
                                <Button
                                    className="flex-1 h-9 text-sm"
                                    onClick={handleSendToXero}
                                    disabled={isSending || !selectedContact}
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
                                            />
                                            <Button
                                                variant="outline"
                                                className="h-8 text-xs shrink-0"
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
