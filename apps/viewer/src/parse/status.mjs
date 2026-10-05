// Parse .warp/STATUS.md into { version, updatedAt, runState, counts, sections, tickets }.
// Line shapes written by the Warp status script:
//   - **WV-02** claimed agent=shuttle-WV-02 pr=— — Summary         (Working now)
//   - **WV-01** merged — Summary                                    (Done)
//   - **WV-04** queued L — Summary                                  (Left)

const SECTIONS = [
  [/^working\b/i, 'working'],
  [/^done\b/i, 'done'],
  [/^left\b/i, 'left'],
];

const LINE = /^\s*[-*]\s+\*\*([A-Za-z][A-Za-z0-9]*-\d+)\*\*\s+(\S+)(.*)$/;

export function parseStatus(text) {
  const out = {
    version: null,
    updatedAt: null,
    runState: null,
    counts: null,
    tickets: {},
  };
  if (text == null) return out;
  let section = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    const head = /^#{2,}\s+(.*)$/.exec(line);
    if (head) {
      const hit = SECTIONS.find(([re]) => re.test(head[1].trim()));
      section = hit ? hit[1] : null;
      continue;
    }
    let m;
    if ((m = /^Warp v(\S+)/.exec(line))) out.version = m[1];
    else if ((m = /^Updated\s+(\S+)/.exec(line))) {
      out.updatedAt = m[1];
      const rs = /runState=(\S+)/.exec(line);
      if (rs) out.runState = rs[1];
    } else if ((m = /^Done\s+(\d+)\s*·\s*working\s+(\d+)\s*·\s*left\s+(\d+)/i.exec(line))) {
      out.counts = { done: +m[1], working: +m[2], left: +m[3] };
    }
    const t = LINE.exec(line);
    if (!t || !section) continue;
    const [, id, status, rest] = t;
    const entry = { id, status, section };
    const agent = /\bagent=(\S+)/.exec(rest);
    if (agent) entry.agent = agent[1];
    const pr = /\bpr=(\S+)/.exec(rest);
    if (pr && !/^[—-]+$/.test(pr[1])) entry.pr = pr[1];
    const size = /^\s*(XL|[SML])\s+—/.exec(rest);
    if (size) entry.size = size[1];
    const summary = /\s—\s+(.+)$/.exec(rest);
    if (summary) entry.summary = summary[1].trim();
    out.tickets[id] = entry;
  }
  return out;
}
