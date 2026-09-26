# topcmd

I kept typing `history | awk '{print $2}' | sort | uniq -c | sort -rn | head` to
see what I actually run all day, and it's wrong often enough to be annoying:
it splits on the wrong field once timestamps are in the history file, it
doesn't know about zsh's extended history format, and it treats
`/usr/bin/git` and `git` as different commands. `topcmd` is that one-liner
done properly, with a `--json` mode so the output can be piped into something
else instead of eyeballed.

It answers exactly one question: **which commands do you run most often?**
Nothing about arguments, working directories, or exit codes — just frequency
of the base command, read straight out of your shell's history file.

## Usage

```
topcmd
topcmd --shell zsh --limit 10
topcmd --file ./old_bash_history --json
topcmd --since 7d
topcmd --since 2024-01-01 --until 2024-02-01
topcmd --exclude cd,ls,clear
topcmd --by-hour
```

Human-readable output:

```
$ topcmd --limit 5
COUNT   PCT   COMMAND
  842  18.4%   git
  511  11.2%   cd
  398   8.7%   ls
  310   6.8%   npm
  204   4.5%   docker

4576 total commands in history
```

`--by-hour` swaps the ranking for a count of commands run per hour of day
(local time), to answer "when do I actually work" instead of "what do I
run":

```
$ topcmd --by-hour
00:00      3
...
09:00    204  ################
10:00    398  ################################
...
23:00     12  #

4238 timestamped commands, 338 skipped (no timestamp)
```

JSON output (same data, for scripts):

```
$ topcmd --limit 3 --json
{
  "shell": "zsh",
  "file": "/Users/me/.zsh_history",
  "total": 4576,
  "commands": [
    { "command": "git", "count": 842, "percent": 18.4 },
    { "command": "cd", "count": 511, "percent": 11.2 },
    { "command": "ls", "count": 398, "percent": 8.7 }
  ]
}
```

## Options

| Flag             | Meaning                                                            |
|------------------|---------------------------------------------------------------------|
| `--shell <name>` | `bash`, `zsh`, or `fish`; guessed from `$SHELL` if not given         |
| `--file <path>`  | history file to read (default `~/.bash_history`, `~/.zsh_history`, or `~/.local/share/fish/fish_history`) |
| `--limit <n>`    | how many commands to show (default 20)                              |
| `--since <when>` | only count commands run at or after this time                       |
| `--until <when>` | only count commands run at or before this time                      |
| `--exclude <names>` | comma-separated base commands to leave out of the ranking (repeatable) |
| `--by-hour`      | show commands run per hour of day (local time) instead of ranking by name |
| `--json`         | print a JSON object instead of a table                              |
| `-h`, `--help`   | usage text                                                           |

`<when>` accepts an ISO date/time (`2024-01-01`, `2024-01-01T10:00:00`), a
raw epoch-seconds number, or a relative duration ago (`30m`, `12h`, `7d`,
`2w`). History entries with no timestamp are dropped whenever `--since` or
`--until` is given, since there's no way to know where they'd fall in the
range.

## How parsing works

- **zsh** extended history lines look like `: 1699999999:0;git status`.
  `topcmd` reads the timestamp and the command out of that, and also
  handles plain zsh history (extended history off) and multi-line commands
  that end in a trailing backslash.
- **bash** history is one command per line. If `HISTTIMEFORMAT` is set,
  each command is preceded by a `#<epoch-seconds>` line, which `topcmd`
  strips out and uses as the timestamp.
- **fish** history is a YAML-like file of `- cmd:`/`when:`/`paths:` entries.
  `topcmd` reads the command and timestamp out of each entry and unescapes
  the backslash/newline escaping fish applies when writing it out.
- The "base command" is the first token after any leading `VAR=value`
  environment assignments, with any directory prefix removed — so
  `FOO=1 /usr/bin/git commit` counts as `git`.

## Building

No dependencies, standard library only.

```
npm run build   # runs tsc, writes dist/
node dist/index.js
```

Tests use the built-in `node:test` runner, no test framework installed:

```
npm test        # runs tsc, then node --test against dist/
```

## Status

Early. `--shell fish` now parses fish's history format, `src/history.ts`
has unit test coverage, and `--by-hour` gives an hour-of-day view.
