import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseHistory, baseCommand, filterByTimeRange, countByHour } from './history.js';

// builds an epoch-seconds timestamp for a given local hour, so tests don't
// depend on the timezone of the machine running them
function atLocalHour(hour: number): number {
  return Math.floor(new Date(2024, 0, 1, hour, 0, 0).getTime() / 1000);
}

describe('parseHistory bash', () => {
  test('splits one command per line and skips blank lines', () => {
    const entries = parseHistory('git status\n\nls -la\n', 'bash');
    assert.deepEqual(entries, [
      { command: 'git status', timestamp: null },
      { command: 'ls -la', timestamp: null },
    ]);
  });

  test('attaches a leading #<epoch> line as the timestamp of the next command', () => {
    const entries = parseHistory('#1700000000\ngit status\nls\n', 'bash');
    assert.deepEqual(entries, [
      { command: 'git status', timestamp: 1700000000 },
      { command: 'ls', timestamp: null },
    ]);
  });

  test('drops a timestamp comment that is followed by a blank line', () => {
    // matches actual HISTTIMEFORMAT output: a timestamp with nothing to
    // attach it to shouldn't leak onto the next unrelated command
    const entries = parseHistory('#1700000000\n\nls\n', 'bash');
    assert.deepEqual(entries, [{ command: 'ls', timestamp: null }]);
  });

  test('trims surrounding whitespace on each command', () => {
    const entries = parseHistory('  git status  \n', 'bash');
    assert.deepEqual(entries, [{ command: 'git status', timestamp: null }]);
  });
});

describe('parseHistory zsh', () => {
  test('reads timestamp and command out of extended history lines', () => {
    const entries = parseHistory(': 1699999999:0;git status\n', 'zsh');
    assert.deepEqual(entries, [{ command: 'git status', timestamp: 1699999999 }]);
  });

  test('joins a command that continues across lines ending in a backslash', () => {
    const entries = parseHistory(': 1699999999:0;echo a \\\necho b\n', 'zsh');
    assert.deepEqual(entries, [{ command: 'echo a \necho b', timestamp: 1699999999 }]);
  });

  test('falls back to plain entries when extended history is off', () => {
    const entries = parseHistory('git status\nls\n', 'zsh');
    assert.deepEqual(entries, [
      { command: 'git status', timestamp: null },
      { command: 'ls', timestamp: null },
    ]);
  });

  test('handles a mix of extended and plain lines in the same file', () => {
    const entries = parseHistory(': 1699999999:0;git status\nls\n', 'zsh');
    assert.deepEqual(entries, [
      { command: 'git status', timestamp: 1699999999 },
      { command: 'ls', timestamp: null },
    ]);
  });

  test('a trailing backslash outside extended history is not treated as a continuation', () => {
    const entries = parseHistory('echo done\\\n', 'zsh');
    assert.deepEqual(entries, [{ command: 'echo done\\', timestamp: null }]);
  });

  test('ignores blank lines between entries', () => {
    const entries = parseHistory(': 1699999999:0;git status\n\nls\n', 'zsh');
    assert.deepEqual(entries, [
      { command: 'git status', timestamp: 1699999999 },
      { command: 'ls', timestamp: null },
    ]);
  });
});

describe('parseHistory fish', () => {
  test('reads the command and when fields of an entry', () => {
    const content = '- cmd: git status\n  when: 1699999999\n';
    const entries = parseHistory(content, 'fish');
    assert.deepEqual(entries, [{ command: 'git status', timestamp: 1699999999 }]);
  });

  test('an entry with no when line has a null timestamp', () => {
    const content = '- cmd: git status\n- cmd: ls\n  when: 1699999999\n';
    const entries = parseHistory(content, 'fish');
    assert.deepEqual(entries, [
      { command: 'git status', timestamp: null },
      { command: 'ls', timestamp: 1699999999 },
    ]);
  });

  test('ignores paths lines', () => {
    const content = '- cmd: git add file.txt\n  when: 1699999999\n  paths:\n    - file.txt\n';
    const entries = parseHistory(content, 'fish');
    assert.deepEqual(entries, [{ command: 'git add file.txt', timestamp: 1699999999 }]);
  });

  test('unescapes embedded newlines fish writes as a literal backslash-n', () => {
    const content = '- cmd: echo a\\nb\n  when: 1699999999\n';
    const entries = parseHistory(content, 'fish');
    assert.deepEqual(entries, [{ command: 'echo a\nb', timestamp: 1699999999 }]);
  });

  test('unescapes a doubled backslash to a single backslash', () => {
    const content = '- cmd: echo a\\\\b\n  when: 1699999999\n';
    const entries = parseHistory(content, 'fish');
    assert.deepEqual(entries, [{ command: 'echo a\\b', timestamp: 1699999999 }]);
  });
});

describe('baseCommand', () => {
  test('returns the command unchanged when there is nothing to strip', () => {
    assert.equal(baseCommand('git'), 'git');
  });

  test('drops arguments', () => {
    assert.equal(baseCommand('git commit -m "msg"'), 'git');
  });

  test('drops a directory prefix', () => {
    assert.equal(baseCommand('/usr/bin/git status'), 'git');
  });

  test('drops leading environment assignments', () => {
    assert.equal(baseCommand('FOO=bar git status'), 'git');
  });

  test('drops multiple leading environment assignments', () => {
    assert.equal(baseCommand('FOO=bar BAZ=1 /usr/bin/git status'), 'git');
  });

  test('returns an empty string for an empty command', () => {
    assert.equal(baseCommand(''), '');
  });

  test('returns an empty string when the line is only environment assignments', () => {
    assert.equal(baseCommand('FOO=bar'), '');
  });
});

describe('countByHour', () => {
  test('buckets timestamped entries by their local hour of day', () => {
    const entries = [
      { command: 'a', timestamp: atLocalHour(9) },
      { command: 'b', timestamp: atLocalHour(9) },
      { command: 'c', timestamp: atLocalHour(14) },
    ];
    const result = countByHour(entries);
    assert.equal(result.hours[9], 2);
    assert.equal(result.hours[14], 1);
    assert.equal(result.counted, 3);
    assert.equal(result.skipped, 0);
  });

  test('counts entries with no timestamp as skipped, not hour zero', () => {
    const entries = [
      { command: 'a', timestamp: atLocalHour(0) },
      { command: 'b', timestamp: null },
    ];
    const result = countByHour(entries);
    assert.equal(result.hours[0], 1);
    assert.equal(result.counted, 1);
    assert.equal(result.skipped, 1);
  });

  test('returns all-zero hours for an empty list', () => {
    const result = countByHour([]);
    assert.deepEqual(
      result.hours,
      new Array(24).fill(0),
    );
    assert.equal(result.counted, 0);
    assert.equal(result.skipped, 0);
  });
});

describe('filterByTimeRange', () => {
  const entries = [
    { command: 'a', timestamp: 100 },
    { command: 'b', timestamp: 200 },
    { command: 'c', timestamp: 300 },
    { command: 'd', timestamp: null },
  ];

  test('returns entries unchanged when neither bound is given', () => {
    assert.deepEqual(filterByTimeRange(entries, null, null), entries);
  });

  test('drops entries with no timestamp once a bound is given', () => {
    const result = filterByTimeRange(entries, 0, null);
    assert.ok(result.every((e) => e.timestamp !== null));
  });

  test('since is inclusive of the boundary', () => {
    const result = filterByTimeRange(entries, 200, null);
    assert.deepEqual(result.map((e) => e.command), ['b', 'c']);
  });

  test('until is inclusive of the boundary', () => {
    const result = filterByTimeRange(entries, null, 200);
    assert.deepEqual(result.map((e) => e.command), ['a', 'b']);
  });

  test('since and until together narrow to a range', () => {
    const result = filterByTimeRange(entries, 150, 250);
    assert.deepEqual(result.map((e) => e.command), ['b']);
  });
});
