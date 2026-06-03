import { useCallback, useRef, useState } from 'react';
import { api } from '../lib/api';
import { executeAgentTurn, type AgentToolContext } from '../lib/agentTools';

// Client-side orchestrator for the autonomous takeoff agent. Runs the
// turn → execute-tools → turn loop against /api/ai/turn until the model
// stops, capped by a tool-iteration budget. push_to_xero is never in the
// agent's tool surface — when the agent calls build_quote and stops, the
// AgentPanel renders the draft and a human pushes the DRAFT. See
// dispatches/takeoff-agent-design.md.

export interface AgentEvent {
  kind: 'thinking' | 'tool' | 'text' | 'done' | 'error' | 'aborted';
  text?: string;
  toolName?: string;
  toolInput?: unknown;
  isError?: boolean;
}

export interface AgentRunState {
  running: boolean;
  events: AgentEvent[];
  inputTokens: number;
  outputTokens: number;
  iterations: number;
}

const MAX_ITERATIONS = 40;
// Soft token ceiling per run; the loop stops cleanly when crossed so a
// confused model can't rack up cost. Tune in the panel later.
const DEFAULT_TOKEN_BUDGET = 400_000;

interface RunOptions {
  instruction: string;
  ctx: AgentToolContext;
  system?: string;
  model?: string;
  tokenBudget?: number;
}

export function useTakeoffAgent() {
  const [state, setState] = useState<AgentRunState>({
    running: false,
    events: [],
    inputTokens: 0,
    outputTokens: 0,
    iterations: 0,
  });
  const abortRef = useRef(false);

  const push = useCallback((ev: AgentEvent) => {
    setState((s) => ({ ...s, events: [...s.events, ev] }));
  }, []);

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  const run = useCallback(
    async ({ instruction, ctx, system, model, tokenBudget }: RunOptions) => {
      abortRef.current = false;
      const budget = tokenBudget ?? DEFAULT_TOKEN_BUDGET;
      setState({ running: true, events: [], inputTokens: 0, outputTokens: 0, iterations: 0 });

      // The transcript the loop owns. First user turn carries the instruction
      // plus the current project id so the model threads it through tool args.
      const messages: unknown[] = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `Project id: ${ctx.projectId}\n\n${instruction}\n\n` +
                'Work step by step. Call get_page_image to see a page before measuring it. ' +
                'Calibrate the scale before any measurement. Pass snap:true on area/linear ' +
                'shapes so vertices lock onto the PDF vector geometry. When you have measured ' +
                'everything requested, call build_quote and then stop — do not attempt to push ' +
                'to Xero.',
            },
          ],
        },
      ];

      let inTok = 0;
      let outTok = 0;

      try {
        for (let i = 0; i < MAX_ITERATIONS; i++) {
          if (abortRef.current) {
            push({ kind: 'aborted', text: 'Stopped by user.' });
            break;
          }
          if (inTok + outTok > budget) {
            push({ kind: 'aborted', text: `Token budget (${budget}) reached — stopping.` });
            break;
          }

          setState((s) => ({ ...s, iterations: i + 1 }));
          push({ kind: 'thinking', text: `Turn ${i + 1}…` });

          const turn = await api.ai.turn({ messages, system, model });
          inTok += turn.usage?.input_tokens ?? 0;
          outTok += turn.usage?.output_tokens ?? 0;
          setState((s) => ({ ...s, inputTokens: inTok, outputTokens: outTok }));

          // Surface any text the model emitted this turn.
          for (const block of turn.content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              push({ kind: 'text', text: block.text as string });
            }
            if (block.type === 'tool_use') {
              push({
                kind: 'tool',
                toolName: block.name as string,
                toolInput: block.input,
              });
            }
          }

          // Append the assistant turn verbatim (Anthropic requires the exact
          // content echoed back before tool_result).
          messages.push({ role: 'assistant', content: turn.content });

          if (turn.stopReason !== 'tool_use') {
            push({ kind: 'done', text: 'Agent finished.' });
            break;
          }

          const { toolResults } = await executeAgentTurn(turn.content, ctx);
          for (const tr of toolResults) {
            if (tr.is_error) {
              const t = tr.content.find((c) => c.type === 'text');
              push({ kind: 'tool', isError: true, text: t && 'text' in t ? t.text : 'tool error' });
            }
          }
          messages.push({ role: 'user', content: toolResults });
        }
      } catch (err) {
        push({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
      } finally {
        setState((s) => ({ ...s, running: false }));
      }
    },
    [push]
  );

  return { state, run, abort };
}
