#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseHistory, baseCommand, filterByTimeRange, type Shell } from './history.js';

interface Options {
  shell: Shell;
  file: string | null;
  limit: number;
  json: boolean;
  since: number | null;
  until: number | null;
}

interface RankedCommand {
  command: string;
  count: number;
  percent: number;
}

function detectShell(): Shell {
  return (process.env.SHELL ?? '').includes('zsh') ? 'zsh' : 'bash';
}

function defaultHistoryFile(shell: Shell): string {
  const home = homedir();
  return shell === 'zsh' ? join(home, '.zsh_history') : join(home, '.bash_history');
}

function printHelp(): void {
  console.log(`topcmd - find your most-used shell commands

Usage:
  topcmd [options]

Options:
  --shell <bash|zsh>   history format to parse (default: guessed from $SHELL)
  --file <path>        history file to read (default: ~/.bash_history or ~/.zsh_history)
  --limit <n>          how many commands to show (default: 20)
  --since <when>       only count commands run at or after this time
  --until <when>       only count commands run at or before this time
  --json               print results as JSON instead of a table
  -h, --help           show this help text

<when> accepts an ISO date/time (2024-01-01, 2024-01-01T10:00:00), a raw
epoch-seconds number, or a relative duration ago (30m, 12h, 7d, 2w).
Entries with no timestamp in the history file are excluded whenever --since
or --until is used, since there's no way to know where they'd fall.

Examples:
  topcmd
  topcmd --shell zsh --limit 10
  topcmd --file ./old_bash_history --json
  topcmd --since 7d
  topcmd --since 2024-01-01 --until 2024-02-01
`);
}

// accepts epoch seconds, an ISO date/time string, or a relative duration
// like "7d" / "12h" meaning "that long ago, relative to now"
function parseTimeArg(raw: string): number {
  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }

  const relative = /^(\d+)(s|m|h|d|w)$/.exec(raw);
  if (relative) {
    const amount = Number(relative[1]);
    const unitSeconds = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[relative[2] as 's' | 'm' | 'h' | 'd' | 'w'];
    return Math.floor(Date.now() / 1000) - amount * unitSeconds;
  }

  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`could not parse "${raw}" as a date, epoch time, or relative duration`);
  }
  return Math.floor(parsed / 1000);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    shell: detectShell(),
    file: null,
    limit: 20,
    json: false,
    since: null,
    until: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--json':
        options.json = true;
        break;
      case '--shell': {
        const value = argv[++i];
        if (value !== 'bash' && value !== 'zsh') {
          throw new Error(`--shell must be "bash" or "zsh", got "${value}"`);
        }
        options.shell = value;
        break;
      }
      case '--file':
        options.file = argv[++i] ?? null;
        if (options.file === null) throw new Error('--file requires a path');
        break;
      case '--limit': {
        const value = Number(argv[++i]);
        if (!Number.isInteger(value) || value <= 0) {
          throw new Error('--limit must be a positive integer');
        }
        options.limit = value;
        break;
      }
      case '--since': {
        const value = argv[++i];
        if (value === undefined) throw new Error('--since requires a value');
        options.since = parseTimeArg(value);
        break;
      }
      case '--until': {
        const value = argv[++i];
        if (value === undefined) throw new Error('--until requires a value');
        options.until = parseTimeArg(value);
        break;
      }
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument: ${arg} (see --help)`);
    }
  }

  return options;
}

function rankCommands(entries: { command: string }[], limit: number): RankedCommand[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const name = baseCommand(entry.command);
    if (name.length === 0) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const total = entries.length;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([command, count]) => ({
      command,
      count,
      percent: total === 0 ? 0 : Math.round((count / total) * 1000) / 10,
    }));
}

function printTable(ranked: RankedCommand[], totalEntries: number): void {
  if (ranked.length === 0) {
    console.log('no history entries found');
    return;
  }

  const countWidth = Math.max(...ranked.map((r) => String(r.count).length), 5);
  console.log(`${'COUNT'.padStart(countWidth)}   PCT   COMMAND`);
  for (const r of ranked) {
    const pct = `${r.percent.toFixed(1)}%`.padStart(5);
    console.log(`${String(r.count).padStart(countWidth)}   ${pct}   ${r.command}`);
  }
  console.log(`\n${totalEntries} total commands in history`);
}

function run(): void {
  const options = parseArgs(process.argv.slice(2));
  if (options.since !== null && options.until !== null && options.since > options.until) {
    throw new Error('--since must be before --until');
  }
  const file = options.file ?? defaultHistoryFile(options.shell);

  const content = readFileSync(file, { encoding: 'utf8' });
  const allEntries = parseHistory(content, options.shell);
  const entries = filterByTimeRange(allEntries, options.since, options.until);
  const ranked = rankCommands(entries, options.limit);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          shell: options.shell,
          file,
          since: options.since,
          until: options.until,
          total: entries.length,
          commands: ranked,
        },
        null,
        2,
      ),
    );
  } else {
    printTable(ranked, entries.length);
  }
}

try {
  run();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`topcmd: ${message}`);
  process.exitCode = 1;
}
