export interface HistoryEntry {
  command: string;
  timestamp: number | null;
}

export type Shell = 'bash' | 'zsh';

export function parseHistory(content: string, shell: Shell): HistoryEntry[] {
  return shell === 'zsh' ? parseZshHistory(content) : parseBashHistory(content);
}

// zsh extended history: ": <start-epoch>:<elapsed-seconds>;<command>"
// a command line ending in a lone backslash continues onto the next raw line
const ZSH_EXTENDED_LINE = /^: (\d+):(\d+);(.*)$/;

function parseZshHistory(content: string): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  const lines = content.split('\n');

  let pendingLines: string[] | null = null;
  let pendingTimestamp: number | null = null;

  const flush = () => {
    if (pendingLines === null) return;
    const command = pendingLines.join('\n').trim();
    if (command.length > 0) {
      entries.push({ command, timestamp: pendingTimestamp });
    }
    pendingLines = null;
    pendingTimestamp = null;
  };

  const isContinuation = (line: string) => line.endsWith('\\');

  for (const rawLine of lines) {
    const match = ZSH_EXTENDED_LINE.exec(rawLine);
    if (match) {
      flush();
      const [, start, , rest] = match;
      pendingTimestamp = Number(start);
      pendingLines = [rest];
      if (!isContinuation(rest)) flush();
    } else if (pendingLines !== null) {
      pendingLines.push(rawLine);
      if (!isContinuation(rawLine)) flush();
    } else if (rawLine.trim().length > 0) {
      // history file written without extended history enabled
      entries.push({ command: rawLine.trim(), timestamp: null });
    }
  }
  flush();

  return entries;
}

// plain bash history is one command per line; with HISTTIMEFORMAT set, each
// command is preceded by a "#<epoch-seconds>" line
function parseBashHistory(content: string): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  const lines = content.split('\n');
  let pendingTimestamp: number | null = null;

  for (const rawLine of lines) {
    if (/^#\d+$/.test(rawLine.trim())) {
      pendingTimestamp = Number(rawLine.trim().slice(1));
      continue;
    }
    const command = rawLine.trim();
    if (command.length > 0) {
      entries.push({ command, timestamp: pendingTimestamp });
    }
    pendingTimestamp = null;
  }

  return entries;
}

// entries with no timestamp (history written without extended/HISTTIMEFORMAT
// timing) can't be placed in a range, so they're dropped rather than guessed at
export function filterByTimeRange(
  entries: HistoryEntry[],
  since: number | null,
  until: number | null,
): HistoryEntry[] {
  if (since === null && until === null) return entries;
  return entries.filter((entry) => {
    if (entry.timestamp === null) return false;
    if (since !== null && entry.timestamp < since) return false;
    if (until !== null && entry.timestamp > until) return false;
    return true;
  });
}

// reduces a full command line to the program that was actually invoked:
// drops leading env assignments (FOO=bar mycommand ...) and any directory
// prefix, so "/usr/bin/git status" and "git log" both count as "git"
export function baseCommand(command: string): string {
  const tokens = command.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) {
    i++;
  }
  const head = tokens[i] ?? '';
  const slashIndex = head.lastIndexOf('/');
  return slashIndex === -1 ? head : head.slice(slashIndex + 1);
}
