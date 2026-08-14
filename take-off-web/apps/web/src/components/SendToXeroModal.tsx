import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ExternalLink, Search, UserPlus, FileText } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import type { QuoteDraft } from '@takeoff/shared';

interface SendToXeroModalProps {
  open: boolean;
  projectId: string;
  projectName?: string;
  onClose: () => void;
}

interface XeroDoc {
  id: string;
  kind: string;
  xero_id: string;
  total: number;
  created_at: number;
  status: string | null;
  deep_link: string;
}

type CustomerMode = 'existing' | 'new';

const statusVariant = (status: string | null): 'default' | 'secondary' | 'outline' => {
  const s = (status ?? '').toUpperCase();
  if (s === 'PAID') return 'default';
  if (s === 'AUTHORISED' || s === 'SUBMITTED') return 'secondary';
  return 'outline';
};

const SendToXeroModal: React.FC<SendToXeroModalProps> = ({
  open,
  projectId,
  projectName,
  onClose,
}) => {
  const { addToast } = useToast();

  const [quote, setQuote] = useState<QuoteDraft | null>(null);
  const [docs, setDocs] = useState<XeroDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);

  const [mode, setMode] = useState<CustomerMode>('existing');

  // Existing-customer search
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ id: string; name: string; xeroContactId?: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);

  // New-customer form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');

  const [reference, setReference] = useState('');
  const [pushing, setPushing] = useState(false);
  const [pushed, setPushed] = useState<{ deep_link: string } | null>(null);

  // Two effects, intentionally split: data-fetch is keyed only on (open,
  // projectId) so a parent re-render that bumps projectName/addToast can't
  // wipe the user's mid-flow input and re-trigger the (now-bulked) Xero
  // call. The reference-seed effect listens to projectName on open only.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setQuote(null);
    setDocs([]);
    setMode('existing');
    setQuery('');
    setResults([]);
    setSelectedContactId(null);
    setNewName('');
    setNewEmail('');
    setNewPhone('');
    setPushed(null);
    setLoadingDocs(true);

    api.memory
      .quote(projectId)
      .then((q) => {
        if (!cancelled) setQuote(q);
      })
      .catch((e) => {
        if (cancelled) return;
        // 404 / empty-quote = "no quote built yet, go price items"; any other
        // failure surfaces the real reason (auth, 5xx) so the user can act on it.
        const msg = e instanceof Error ? e.message : String(e);
        if (/404|not found|no quote/i.test(msg)) {
          addToast('No quote to send yet — price some items first', 'error');
        } else {
          addToast(`Could not load quote: ${msg}`, 'error');
        }
      });

    api.xero
      .projectDocs(projectId)
      .then((r) => {
        if (!cancelled) setDocs(r.docs);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        // 401/403 = unconnected / not allowed; 5xx = real outage. Either way
        // tell the user instead of silently showing an empty 'Already in Xero'
        // panel that looks like a clean project.
        addToast(`Could not load Xero history: ${msg}`, 'info');
      })
      .finally(() => {
        if (!cancelled) setLoadingDocs(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, projectId, addToast]);

  // Seed the Reference field with the project name on open (and on rename
  // while the modal is open). User can edit / clear it; an explicit empty
  // string is honoured by the server (the `verbatim send` change below).
  useEffect(() => {
    if (!open) return;
    setReference(projectName ? `Take-off: ${projectName}` : '');
  }, [open, projectName]);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const rows = await api.memory.searchCustomers(query.trim());
      setResults(rows.filter((r) => r.xeroContactId));
      setSelectedContactId(null);
      if (rows.filter((r) => r.xeroContactId).length === 0) {
        addToast('No matching Xero customers — add a new contact instead', 'info');
      }
    } catch {
      addToast('Customer search failed', 'error');
    } finally {
      setSearching(false);
    }
  };

  const resolveContactId = async (): Promise<string | null> => {
    if (mode === 'existing') return selectedContactId;
    // New customer: find-or-create in Xero.
    if (!newName.trim()) {
      addToast('Enter a customer name', 'error');
      return null;
    }
    const res = await api.xero.findOrCreateContact({
      name: newName.trim(),
      email: newEmail.trim() || undefined,
      phone: newPhone.trim() || undefined,
    });
    addToast(res.created ? `Created ${res.name} in Xero` : `Matched ${res.name} in Xero`, 'success');
    return res.contact_id;
  };

  const send = async () => {
    setPushing(true);
    try {
      const contactId = await resolveContactId();
      if (!contactId) return;
      // Send Reference verbatim — including an explicit empty string the user
      // typed to clear it. The server only auto-fills `Take-off: <name>` when
      // the field is OMITTED, not when it's an explicit empty string.
      const res = await api.xero.pushInvoice(projectId, contactId, reference);
      setPushed({ deep_link: res.deep_link });
      addToast('DRAFT invoice created in Xero', 'success');
      // Refresh the docs list so the new draft shows immediately.
      api.xero.projectDocs(projectId).then((r) => setDocs(r.docs)).catch(() => {});
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Xero push failed', 'error');
    } finally {
      setPushing(false);
    }
  };

  const canSend =
    !pushing &&
    !!quote &&
    quote.lines.length > 0 &&
    (mode === 'existing' ? !!selectedContactId : !!newName.trim());

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Send to Xero as Draft Invoice</DialogTitle>
          <DialogDescription>
            Creates a DRAFT ACCREC invoice in Xero. Always review and send it yourself in Xero —
            this never authorises or emails the invoice.
          </DialogDescription>
        </DialogHeader>

        {/* Already-pushed docs */}
        {(loadingDocs || docs.length > 0) && (
          <div className="rounded border bg-muted/30 p-2 text-xs space-y-1">
            <div className="font-medium text-muted-foreground flex items-center gap-1">
              <FileText className="w-3.5 h-3.5" /> Already in Xero
            </div>
            {loadingDocs ? (
              <div className="text-muted-foreground flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Checking…
              </div>
            ) : (
              docs.map((d) => (
                <a
                  key={d.id}
                  href={d.deep_link}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between hover:underline"
                >
                  <span className="flex items-center gap-1.5">
                    {d.kind} · ${d.total.toFixed(2)}
                    {d.status && (
                      <Badge variant={statusVariant(d.status)} className="text-[10px] py-0">
                        {d.status}
                      </Badge>
                    )}
                  </span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              ))
            )}
          </div>
        )}

        {/* Quote summary */}
        {quote && (
          <div className="text-sm flex justify-between border-b pb-2">
            <span className="text-muted-foreground">
              {quote.lines.length} line{quote.lines.length === 1 ? '' : 's'} · GST $
              {quote.gst.toFixed(2)}
            </span>
            <span className="font-semibold">Total ${quote.total.toFixed(2)}</span>
          </div>
        )}

        {pushed ? (
          <a
            href={pushed.deep_link}
            target="_blank"
            rel="noreferrer"
            className="block text-center text-sm text-primary underline py-3"
          >
            Open DRAFT invoice in Xero →
          </a>
        ) : (
          <>
            {/* Customer mode toggle */}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === 'existing' ? 'default' : 'outline'}
                className="flex-1 gap-1"
                onClick={() => setMode('existing')}
              >
                <Search className="w-3.5 h-3.5" /> Existing customer
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === 'new' ? 'default' : 'outline'}
                className="flex-1 gap-1"
                onClick={() => setMode('new')}
              >
                <UserPlus className="w-3.5 h-3.5" /> New customer
              </Button>
            </div>

            {mode === 'existing' ? (
              <div className="space-y-2">
                <div className="flex gap-1">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search Xero customers…"
                    aria-label="Search Xero customers"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') search();
                    }}
                  />
                  <Button type="button" variant="outline" onClick={search} disabled={searching}>
                    {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
                  </Button>
                </div>
                {results.length > 0 && (
                  <select
                    className="w-full text-sm border rounded px-2 py-2 bg-background"
                    value={selectedContactId ?? ''}
                    onChange={(e) => setSelectedContactId(e.target.value || null)}
                    aria-label="Select Xero customer"
                  >
                    <option value="">Select customer…</option>
                    {results.map((c) => (
                      <option key={c.id} value={c.xeroContactId!}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Customer name (required)"
                  aria-label="Customer name"
                  autoFocus
                />
                <Input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="Email (optional)"
                  aria-label="Customer email"
                  type="email"
                />
                <Input
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="Phone (optional)"
                  aria-label="Customer phone"
                />
                <p className="text-[11px] text-muted-foreground">
                  We’ll match an existing Xero contact by name or email, or create one if there’s no
                  match.
                </p>
              </div>
            )}

            {/* Reference */}
            <div className="space-y-1">
              <label htmlFor="xero-reference" className="text-xs text-muted-foreground">
                Reference (shown in Xero)
              </label>
              <Input
                id="xero-reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Take-off: …"
              />
            </div>

            <Button className="w-full" disabled={!canSend} onClick={send}>
              {pushing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Create DRAFT Invoice in Xero
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SendToXeroModal;
