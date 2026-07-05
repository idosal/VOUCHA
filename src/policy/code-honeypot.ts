import type { CodeHoneypotSignal } from "../config";
import { matchesGlob } from "./exemptions";

export interface CodeHoneypotMatch {
  path: string;
  signalIndex: number;
  patternIndex: number;
}

export interface CodeHoneypotResult {
  triggered: boolean;
  matches: CodeHoneypotMatch[];
}

function diffPath(raw: string): string | null {
  const value = diffPathToken(raw);
  if (!value || value === "/dev/null") return null;
  return value.startsWith("b/") ? value.slice(2) : value;
}

function diffPathToken(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (!value.startsWith("\"")) return value.split("\t")[0];

  let token = "";
  for (let i = 1; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\"") return token;
    if (ch === "\\" && i + 1 < value.length) {
      i++;
      token += value[i];
    } else {
      token += ch;
    }
  }
  return token;
}

function signalAppliesToPath(signal: CodeHoneypotSignal, path: string): boolean {
  return signal.paths.some((pattern) => matchesGlob(pattern, path));
}

export function evaluateCodeHoneypotSignals(
  diff: string,
  signals: CodeHoneypotSignal[]
): CodeHoneypotResult {
  if (signals.length === 0 || signals.every((signal) => signal.patterns.length === 0)) {
    return { triggered: false, matches: [] };
  }

  const matches: CodeHoneypotMatch[] = [];
  let currentPath: string | null = null;
  const seen = new Set<string>();

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      currentPath = null;
      continue;
    }
    if (line.startsWith("+++ ")) {
      currentPath = diffPath(line.slice(4));
      continue;
    }
    if (!currentPath || !line.startsWith("+") || line.startsWith("+++")) continue;

    const addedLine = line.slice(1);
    signals.forEach((signal, signalIndex) => {
      if (!signalAppliesToPath(signal, currentPath!)) return;
      signal.patterns.forEach((pattern, patternIndex) => {
        if (!addedLine.includes(pattern)) return;
        const key = `${currentPath}\0${signalIndex}\0${patternIndex}`;
        if (seen.has(key)) return;
        seen.add(key);
        matches.push({ path: currentPath!, signalIndex, patternIndex });
      });
    });
  }

  return { triggered: matches.length > 0, matches };
}
