import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, Send, Inbox, RefreshCw, MoreHorizontal, BellOff, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '../lib/api';
import { useToast } from '../contexts/ToastContext';

type Tab = 'active' | 'snoozed';

interface ReadyToInvoiceRow {
  id: string;
  name: string;
  updated_at: number;
  snoozed_until: number | null;
  customer_id: string | null;
  customer_name: string | null;
  estimated_total: number;
  last_activity_at: number | null;
}

interface ReadyToInvoiceViewProps {
  onBack: () => void;
  onOpenAndInvoice: (projectId: string) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SNOOZE_OPTIONS: Array<{ label: string; ms: number | null }> = [
  { label: '1 day', ms: 1 * DAY_MS },
  { label: '7 days', ms: 7 * DAY_MS },
  { label: '30 days', ms: 30 * DAY_MS },
  { label: 'Until I un-snooze', ms: null },
];

const formatCurrency = (n: number) =>
  n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });

const formatRelative = (ts: number | null) => {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / (60 * 60_000))}h ago`;
  if (diff < 30 * DAY_MS) return `${Math.floor(diff / DAY_MS)}d ago`;
  return new Date(ts).toLocaleDateString('en-AU');
};

const ReadyToInvoiceView: React.FC<ReadyToInvoiceViewProps> = ({
  onBack,
  onOpenAndInvoice,
}) => {
  const { addToast } = useToast();
  const [tab, setTab] = useState<Tab>('active');
  const [rows, setRows] = useState<ReadyToInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.projects.readyToInvoice({
        includeSnoozed: tab === 'snoozed',
      });
      setRows(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addToast(`Could not load invoice queue: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast, tab]);

  useEffect(() => {
    load();
  }, [load]);

  const snooze = async (projectId: string, durationMs: number | null) => {
    setBusyId(projectId);
    try {
      // null durationMs -> snooze indefinitely (far-future timestamp);
      // a finite duration -> wake up after that many ms.
      const until =
        durationMs === null ? Number.MAX_SAFE_INTEGER : Date.now() + durationMs;
      await api.projects.snooze(projectId, until);
      setRows((prev) => prev.filter((r) => r.id !== projectId));
      addToast('Snoozed', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addToast(`Snooze failed: ${msg}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const unsnooze = async (projectId: string) => {
    setBusyId(projectId);
    try {
      await api.projects.snooze(projectId, null);
      setRows((prev) => prev.filter((r) => r.id !== projectId));
      addToast('Un-snoozed', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addToast(`Un-snooze failed: ${msg}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="border-b border-border bg-card px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Button onClick={onBack} variant="ghost" size="icon" aria-label="Back">
            <ArrowLeft size={18} />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Ready to invoice</h1>
            <p className="text-xs text-muted-foreground">
              {tab === 'active'
                ? "Priced jobs that haven't been pushed to Xero yet"
                : 'Snoozed jobs — un-snooze to put them back on the queue'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            <Button
              size="sm"
              variant={tab === 'active' ? 'default' : 'ghost'}
              className="h-7 px-3 text-xs"
              onClick={() => setTab('active')}
            >
              Active
            </Button>
            <Button
              size="sm"
              variant={tab === 'snoozed' ? 'default' : 'ghost'}
              className="h-7 px-3 text-xs"
              onClick={() => setTab('snoozed')}
            >
              Snoozed
            </Button>
          </div>
          <Button onClick={load} variant="outline" size="sm" className="gap-2" disabled={loading}>
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading queue…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground text-center">
            <Inbox className="w-10 h-10 mb-3 opacity-40" />
            <p className="font-medium text-foreground">
              {tab === 'active' ? 'Inbox zero.' : 'No snoozed jobs.'}
            </p>
            <p className="text-sm mt-1 max-w-md">
              {tab === 'active'
                ? 'Every priced job has been invoiced or snoozed. When you price the next takeoff, it will show up here.'
                : "Anything you snooze from the Active tab lands here. You can un-snooze it from this list to put it back."}
            </p>
          </div>
        ) : (
          <Card className="border-border shadow-sm overflow-hidden">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Job</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Est. total</TableHead>
                    <TableHead>Last activity</TableHead>
                    <TableHead className="w-[280px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>
                        {r.customer_name ?? (
                          <Badge variant="outline" className="text-[10px]">
                            No customer
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(r.estimated_total)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatRelative(r.last_activity_at ?? r.updated_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1">
                          {tab === 'active' ? (
                            <>
                              <Button
                                size="sm"
                                className="gap-1"
                                onClick={() => onOpenAndInvoice(r.id)}
                                disabled={busyId === r.id}
                              >
                                <Send size={14} /> Open &amp; invoice
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    disabled={busyId === r.id}
                                    aria-label="Snooze options"
                                  >
                                    {busyId === r.id ? (
                                      <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                      <MoreHorizontal size={14} />
                                    )}
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {SNOOZE_OPTIONS.map((opt) => (
                                    <DropdownMenuItem
                                      key={opt.label}
                                      onClick={() => snooze(r.id, opt.ms)}
                                    >
                                      <BellOff size={14} className="mr-2" />
                                      Snooze {opt.label}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              onClick={() => unsnooze(r.id)}
                              disabled={busyId === r.id}
                            >
                              {busyId === r.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Bell size={14} />
                              )}
                              Un-snooze
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default ReadyToInvoiceView;
