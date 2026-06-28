/**
 * Workers AI shim — replaces the `AI` binding with an embeddings API.
 *
 * The Worker calls: env.AI.run('@cf/baai/bge-large-en-v1.5', { text })
 * and expects { data: [ number[1024] ] }.
 *
 * We map that to OpenAI's text-embedding-3-small with dimensions=1024 so
 * the vector width matches VECTOR_DIM (1024) in src/modules/memory/embed.ts.
 * Set EMBEDDINGS_PROVIDER=openai (default) and OPENAI_API_KEY.
 *
 * If no key is configured the call throws, and the Worker degrades to
 * literal (keyword) memory search — see src/modules/memory/search.ts.
 */

const OPENAI_URL = 'https://api.openai.com/v1/embeddings';

export function makeAiShim(opts = {}) {
  const provider = opts.provider || 'openai';
  const apiKey = opts.apiKey;
  const model = opts.model || 'text-embedding-3-small';
  const dimensions = opts.dimensions || 1024;

  return {
    async run(_modelName, input) {
      const text = input?.text;
      if (!text) throw new Error('embeddings: no text provided');
      if (!apiKey) throw new Error('embeddings: no API key configured (set OPENAI_API_KEY)');

      if (provider === 'openai') {
        const res = await fetch(OPENAI_URL, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ model, input: text, dimensions }),
        });
        if (!res.ok) {
          throw new Error(`embeddings: OpenAI HTTP ${res.status} ${await res.text()}`);
        }
        const json = await res.json();
        const vec = json?.data?.[0]?.embedding;
        if (!Array.isArray(vec)) throw new Error('embeddings: malformed OpenAI response');
        return { data: [vec] };
      }

      throw new Error(`embeddings: unknown provider '${provider}'`);
    },
  };
}
