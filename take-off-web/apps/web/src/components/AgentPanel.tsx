import React, { useMemo, useState } from 'react';
import { Bot, Loader2, Send, Square, AlertCircle, Wrench, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTakeoffAgent } from '../hooks/useTakeoffAgent';
import type { AgentToolContext } from '../lib/agentTools';
import { api } from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import type { PlanSet } from '../types';
import type { QuoteDraft } from '@takeoff/shared';

interface AgentPanelProps {
  projectId: string | null;
  planSets: PlanSet[];
  // Plan set id that the canvas currently has loaded into mupdfController —
  // get_page_image can only render from that set, so the agent context
  // gates page requests against it.
  activePlanSetId: string | null;
  // Called after the agent loop completes so App can re-fetch items /
  // projectData from the server. Agent writes go through REST and never
  // flow back through useShapeSync (which only pushes outward), so without
  // this the canvas, markup export, and saved snapshot would miss the
  // agent-created shapes even though the review quote includes them.
  onAgentDone: () => void | Promise<void>;
  onClose: () => void;
}

// Resolve a project-wide page index to its plan set + local index within
// that PDF — mirrors getActivePlanDetails in App.tsx. Returning the
// planSetId lets get_page_image refuse pages outside the currently-loaded
// set instead of silently rendering the wrong PDF.
function makeResolveLocalPageIndex(planSets: PlanSet[]) {
  return (globalPageIndex: number): { planSetId: string; localIndex: number } | null => {
    for (const set of planSets) {
      if (globalPageIndex >= set.startPageIndex && globalPageIndex < set.startPageIndex + set.pageCount) {
        const local = globalPageIndex - set.startPageIndex;
        const localIndex = set.pages && set.pages[local] !== undefined ? set.pages[local] : local;
        return { planSetId: set.id, localIndex };
      }
    }
    return null;
  };
}

const AgentPanel: React.FC<AgentPanelProps> = ({ projectId, planSets, activePlanSetId, onAgentDone, onClose }) => {
  const { addToast } = useToast();
  const { state, run, abort } = useTakeoffAgent();
  const [instruction, setInstruction] = useState('');

  // Review gate: after the agent stops, we fetch the current quote draft and
  // present it for human approval. The agent never pushes to Xero itself.
  const [quote, setQuote] = useState<QuoteDraft | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customers, setCustomers] = useState<Array<{ id: string; name: string; xeroContactId?: string }>>([]);
  const [selectedXeroId, setSelectedXeroId] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushed, setPushed] = useState<{ deep_link: string } | null>(null);

  const ctx: AgentToolContext | null = useMemo(
    () =>
      projectId
        ? {
            projectId,
            resolveLocalPageIndex: makeResolveLocalPageIndex(planSets),
            activePlanSetId,
          }
        : null,
    [projectId, planSets, activePlanSetId]
  );

  const start = async () => {
    if (!ctx || !instruction.trim()) return;
    setQuote(null);
    setPushed(null);
    setCustomers([]);
    setSelectedXeroId(null);
    await run({ instruction: instruction.trim(), ctx });
    // Pull the resulting draft for review (the agent built items server-side).
    try {
      const q = await api.memory.quote(ctx.projectId);
      setQuote(q);
    } catch {
      /* no quote yet — that's fine */
    }
    // Re-hydrate App's local items/projectData so the canvas, markup export
    // and saved snapshot see the agent-created shapes. Runs after the quote
    // fetch so we never block the review gate on this.
    try {
      await onAgentDone();
    } catch (e) {
      console.error('agent refresh failed', e);
    }
  };

  const searchCustomers = async () => {
    if (!customerQuery.trim()) return;
    try {
      const rows = await api.memory.searchCustomers(customerQuery.trim());
      setCustomers(rows);
      // Reset the selected Xero contact when the option list changes —
      // otherwise a stale selectedXeroId from a previous search can sneak
      // through Push DRAFT and send the quote to the wrong contact when
      // the new results don't include the old one.
      setSelectedXeroId(null);
    } catch (e) {
      addToast('Customer search failed', 'error');
    }
  };

  const pushDraft = async () => {
    if (!projectId || !selectedXeroId) return;
    setPushing(true);
    try {
      const res = await api.xero.pushQuote(projectId, selectedXeroId);
      setPushed({ deep_link: res.deep_link });
      addToast('DRAFT quote pushed to Xero', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Xero push failed', 'error');
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-[380px] border-l bg-white">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2 font-semibold">
          <Bot className="w-5 h-5 text-blue-600" /> Takeoff Agent
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>

      {!projectId && (
        <div className="p-4 text-sm text-amber-700 bg-amber-50 m-3 rounded flex gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          Create or open a project first — the agent measures against a saved project.
        </div>
      )}

      {/* Instruction box */}
      <div className="p-3 border-b">
        <Input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder='e.g. "Calibrate page 1, measure all flat roof sections, apply the TPO assembly"'
          disabled={state.running || !projectId}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) start(); }}
        />
        <div className="flex gap-2 mt-2">
          {state.running ? (
            <Button variant="destructive" size="sm" onClick={abort} className="flex-1">
              <Square className="w-4 h-4 mr-1" /> Stop
            </Button>
          ) : (
            <Button size="sm" onClick={start} disabled={!projectId || !instruction.trim()} className="flex-1">
              <Send className="w-4 h-4 mr-1" /> Run
            </Button>
          )}
        </div>
        {(state.inputTokens > 0 || state.outputTokens > 0) && (
          <div className="text-[11px] text-gray-400 mt-1">
            {state.iterations} turns · {state.inputTokens.toLocaleString()} in / {state.outputTokens.toLocaleString()} out tokens
          </div>
        )}
      </div>

      {/* Event stream */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 text-sm">
        {state.events.map((ev, i) => {
          if (ev.kind === 'tool') {
            return (
              <div key={i} className={`flex gap-2 items-start ${ev.isError ? 'text-red-600' : 'text-gray-600'}`}>
                <Wrench className="w-3.5 h-3.5 mt-1 shrink-0" />
                <span className="font-mono text-xs break-all">
                  {ev.isError ? ev.text : ev.toolName}
                </span>
              </div>
            );
          }
          if (ev.kind === 'text') {
            return <div key={i} className="text-gray-800 whitespace-pre-wrap">{ev.text}</div>;
          }
          if (ev.kind === 'error') {
            return <div key={i} className="text-red-600 flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5" />{ev.text}</div>;
          }
          if (ev.kind === 'done') {
            return <div key={i} className="text-green-600 flex gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5" />{ev.text}</div>;
          }
          if (ev.kind === 'aborted') {
            return <div key={i} className="text-amber-600">{ev.text}</div>;
          }
          if (ev.kind === 'thinking' && i === state.events.length - 1 && state.running) {
            return <div key={i} className="text-gray-400 flex gap-2 items-center"><Loader2 className="w-3.5 h-3.5 animate-spin" />{ev.text}</div>;
          }
          return null;
        })}
      </div>

      {/* Review gate — only after the agent stops and a quote exists. */}
      {quote && quote.lines.length > 0 && !state.running && (
        <div className="border-t p-3 space-y-2 bg-gray-50">
          <div className="font-semibold text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-blue-600" /> Review draft quote
          </div>
          <div className="max-h-40 overflow-y-auto text-xs border rounded bg-white">
            {quote.lines.map((l, i) => (
              <div key={i} className="flex justify-between px-2 py-1 border-b last:border-0">
                <span className="truncate pr-2">{l.description}</span>
                <span className="tabular-nums shrink-0">${l.lineTotal.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="text-xs text-gray-600 flex justify-between">
            <span>Subtotal ${quote.subtotal.toFixed(2)} · GST ${quote.gst.toFixed(2)}</span>
            <span className="font-semibold">Total ${quote.total.toFixed(2)}</span>
          </div>

          {pushed ? (
            <a href={pushed.deep_link} target="_blank" rel="noreferrer" className="block text-center text-sm text-blue-600 underline py-1">
              Open DRAFT in Xero →
            </a>
          ) : (
            <>
              <div className="flex gap-1">
                <Input
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  placeholder="Find Xero customer…"
                  className="text-xs h-8"
                  onKeyDown={(e) => { if (e.key === 'Enter') searchCustomers(); }}
                />
                <Button size="sm" variant="outline" className="h-8" onClick={searchCustomers}>Search</Button>
              </div>
              {customers.length > 0 && (
                <select
                  className="w-full text-xs border rounded px-2 py-1.5"
                  value={selectedXeroId ?? ''}
                  onChange={(e) => setSelectedXeroId(e.target.value || null)}
                >
                  <option value="">Select customer…</option>
                  {customers.filter((c) => c.xeroContactId).map((c) => (
                    <option key={c.id} value={c.xeroContactId!}>{c.name}</option>
                  ))}
                </select>
              )}
              <Button
                size="sm"
                className="w-full"
                disabled={!selectedXeroId || pushing}
                onClick={pushDraft}
              >
                {pushing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                Push DRAFT Quote to Xero
              </Button>
              <p className="text-[11px] text-gray-400 text-center">
                Always DRAFT — review and send in Xero yourself.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default AgentPanel;
