import { useEffect, useState } from 'react';
import { api } from './lib/api';

interface ProjectSummary {
  id: string;
  name: string;
  created_at: number;
}

export function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.projects
      .list()
      .then((p) => setProjects(p))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function createProject() {
    if (!name.trim()) return;
    try {
      const created = await api.projects.create(name.trim());
      setProjects((prev) => [
        { id: created.id, name: name.trim(), created_at: Date.now() },
        ...prev,
      ]);
      setName('');
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '40px auto', padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>Driven Takeoff</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        Standalone measurement & quoting platform — Phase 1 scaffold.
      </p>

      <section style={{ marginTop: 32 }}>
        <h2>Projects</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New project name (e.g. 12 King St — Smith)"
            style={{ flex: 1, padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
            onKeyDown={(e) => e.key === 'Enter' && createProject()}
          />
          <button onClick={createProject} style={{ padding: '8px 16px' }}>
            Create
          </button>
        </div>
        {loading && <p>Loading…</p>}
        {error && <p style={{ color: 'crimson' }}>Error: {error}</p>}
        <ul style={{ padding: 0, listStyle: 'none' }}>
          {projects.map((p) => (
            <li
              key={p.id}
              style={{
                padding: 12,
                border: '1px solid #eee',
                borderRadius: 4,
                marginBottom: 8,
              }}
            >
              <strong>{p.name}</strong>
              <div style={{ fontSize: 12, color: '#888' }}>
                {p.id} · {new Date(p.created_at).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: 32, padding: 16, background: '#f4f4f5', borderRadius: 4 }}>
        <h3 style={{ marginTop: 0 }}>What's next</h3>
        <ol>
          <li>
            Phase 1 (in progress): port <code>BlueprintCanvas</code> + tools palette from the desktop
            app into <code>apps/web/src/components/</code>.
          </li>
          <li>Phase 2: <code>/mcp</code> endpoint already live — provision an MCP token to drive from Claude Desktop.</li>
          <li>Phase 3: assemblies & customer memory.</li>
          <li>Phase 4: Xero OAuth → Draft Quote / Invoice.</li>
          <li>Phase 5 (optional): in-app AI chat.</li>
          <li>Phase 6: Aqua iframe embed.</li>
        </ol>
      </section>
    </div>
  );
}
