// rlab_ref: shallow-clone a public GitHub repo and auto-generate a study note.
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RefResult {
  repo: string;
  dir: string;
  readme: string;
  claudeMd: string;
  tree: string[];
  files: number;
  noteFile: string;
}

export function cloneAndStudy(url: string, outDir: string, maxTree = 30): RefResult {
  const m = url.match(/github\.com\/([^\/]+)\/([^\/\s]+?)(?:\.git)?(?:\/|$)/);
  if (!m) throw new Error('not a github.com URL: ' + url);
  const repo = m[1] + '/' + m[2].replace(/\.git$/, '');
  fs.mkdirSync(outDir, { recursive: true });
  const dir = path.join(outDir, m[2].replace(/\.git$/, ''));
  execSync('git clone --depth 1 https://github.com/' + repo + '.git "' + dir + '"', { stdio: 'pipe', timeout: 120000 });
  const head = (name: string, n = 40) => {
    const f = path.join(dir, name);
    try { return fs.readFileSync(f, 'utf8').slice(0, 1800); } catch { return ''; }
  };
  const readme = head('README.md') || head('README_EN.md') || head('README.adoc');
  const claudeMd = head('CLAUDE.md') || head('AGENTS.md');
  const tree: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 2 || tree.length >= maxTree) return;
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (f.name.startsWith('.') || f.name === 'node_modules') continue;
      const rel = path.relative(dir, path.join(d, f.name));
      tree.push((depth ? '  '.repeat(depth) : '') + rel + (f.isDirectory() ? '/' : ''));
      if (f.isDirectory()) walk(path.join(d, f.name), depth + 1);
    }
  };
  walk(dir, 0);
  let files = 0;
  const count = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (f.name.startsWith('.')) continue;
      if (f.isDirectory()) count(path.join(d, f.name)); else files++;
    }
  };
  count(dir);
  const note: string[] = [
    '# Ref study: ' + repo,
    '',
    'source: https://github.com/' + repo + '  |  cloned: ' + new Date().toISOString().slice(0, 10),
    'files: ' + files,
    '',
    '## README (excerpt)',
    '',
    readme,
    '',
    claudeMd ? '## CLAUDE.md / AGENTS.md (excerpt - often reveals the real contract)' : '',
    '',
    claudeMd,
    '',
    '## Structure (top 2 levels)',
    '',
    '```',
    ...tree,
    '```',
    '',
    '## Absorption notes (fill in)',
    '',
    '| aspect | verdict |',
    '|---|---|',
    '| what it is |  |',
    '| absorb-worthy mechanisms |  |',
    '| code to port |  |',
    '| conflicts with our design |  |',
    '| license |  |',
    '',
  ];
  const noteFile = path.join(dir, 'REF.md');
  fs.writeFileSync(noteFile, note.join('\n'), 'utf8');
  return { repo, dir, readme, claudeMd, tree, files, noteFile };
}