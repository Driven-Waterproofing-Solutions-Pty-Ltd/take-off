import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Mirrors aqua's src/__guards__/memory-protection.test.ts in spirit:
 * chat_memory is long-term knowledge and must never be hard-deleted,
 * DROPped, or TRUNCATEd. Soft-delete (is_active = 0) only.
 *
 * This guard scans migrations + source so a future edit can't silently
 * remove the protection.
 */

const ROOT = join(__dirname, '..', '..');

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.wrangler') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

describe('memory protection guard', () => {
  it('the chat_memory migration declares a BEFORE DELETE trigger', () => {
    const sql = readFileSync(join(ROOT, 'migrations', '0002_chat_memory.sql'), 'utf8');
    expect(sql).toMatch(/BEFORE DELETE ON chat_memory/i);
    expect(sql).toMatch(/RAISE\s*\(\s*ABORT/i);
  });

  it('no source or migration file hard-deletes, drops, or truncates chat_memory', () => {
    const files = [
      ...walk(join(ROOT, 'src'), ['.ts']),
      ...walk(join(ROOT, 'migrations'), ['.sql']),
    ];
    const offenders: string[] = [];

    const forbidden = [
      /DELETE\s+FROM\s+chat_memory/i,
      /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?chat_memory/i,
      /TRUNCATE\s+(TABLE\s+)?chat_memory/i,
    ];

    for (const file of files) {
      // The trigger body itself contains the words "DELETE ON chat_memory";
      // skip the migration that defines the protection.
      if (file.endsWith('0002_chat_memory.sql')) continue;
      const text = readFileSync(file, 'utf8');
      for (const re of forbidden) {
        if (re.test(text)) offenders.push(`${file}: ${re}`);
      }
    }

    expect(offenders, `chat_memory must be soft-deleted only:\n${offenders.join('\n')}`).toEqual([]);
  });
});
