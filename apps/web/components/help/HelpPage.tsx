'use client';
import { useMemo, useState } from 'react';
import { Search, ChevronDown, ChevronRight, BookOpen, Compass, AlertTriangle, Lightbulb } from 'lucide-react';

export interface HelpItem {
  q: string;
  a: React.ReactNode;
  /** Optional tags for search-matching beyond the question/answer text. */
  tags?: string[];
}

export interface HelpSection {
  /** Heading shown in TOC + section header. */
  title: string;
  /** Anchor id (kebab-case). */
  id: string;
  /** One-line subtitle shown under the heading. */
  description?: string;
  /** Icon for the section header. */
  icon?: 'guide' | 'how-to' | 'troubleshoot' | 'tip';
  items: HelpItem[];
}

const ICON_MAP = {
  'guide':        BookOpen,
  'how-to':       Compass,
  'troubleshoot': AlertTriangle,
  'tip':          Lightbulb,
};

interface HelpPageProps {
  appName: string;       // e.g. "Counter", "Ledger", "Sync"
  appTagline: string;    // one-line description
  sections: HelpSection[];
}

export function HelpPage({ appName, appTagline, sections }: HelpPageProps) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Filter sections + items by search term (matches question, answer text, tags)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sections;
    return sections
      .map((s) => ({
        ...s,
        items: s.items.filter((it) => {
          const text = (it.q + ' ' + extractText(it.a) + ' ' + (it.tags ?? []).join(' ')).toLowerCase();
          return text.includes(q);
        }),
      }))
      .filter((s) => s.items.length > 0);
  }, [search, sections]);

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function expandAll() {
    const all = new Set<string>();
    for (const s of filtered) for (const it of s.items) all.add(`${s.id}::${it.q}`);
    setOpen(all);
  }
  function collapseAll() { setOpen(new Set()); }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
          <BookOpen className="w-6 h-6 sm:w-7 sm:h-7 text-[var(--accent)]" />
          {appName} — Help &amp; Guide
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{appTagline}</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder={`Search how to do something in ${appName}…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-11 pl-10 pr-4 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>

      {/* TOC + actions */}
      <div className="flex flex-wrap gap-2 items-center text-xs">
        <span className="text-muted-foreground mr-1">Jump to:</span>
        {filtered.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="px-2.5 py-1 rounded-full border border-border bg-background hover:bg-muted transition-colors"
          >
            {s.title}
          </a>
        ))}
        <div className="ml-auto flex gap-3">
          <button onClick={expandAll}   className="text-[var(--accent)] hover:underline">Expand all</button>
          <button onClick={collapseAll} className="text-muted-foreground hover:underline">Collapse all</button>
        </div>
      </div>

      {/* Sections */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No matches for &ldquo;{search}&rdquo;. Try different terms or
          <button onClick={() => setSearch('')} className="ml-1 underline">clear search</button>.
        </div>
      ) : filtered.map((section) => {
        const Icon = ICON_MAP[section.icon ?? 'guide'];
        return (
          <section key={section.id} id={section.id} className="scroll-mt-4">
            <div className="flex items-center gap-2 mb-3">
              <Icon className="w-5 h-5 text-[var(--accent)]" />
              <h2 className="text-lg sm:text-xl font-semibold">{section.title}</h2>
            </div>
            {section.description && (
              <p className="text-sm text-muted-foreground mb-3 -mt-2">{section.description}</p>
            )}

            <div className="rounded-xl border border-border bg-background divide-y divide-border overflow-hidden">
              {section.items.map((item) => {
                const key = `${section.id}::${item.q}`;
                const isOpen = open.has(key);
                return (
                  <div key={key}>
                    <button
                      onClick={() => toggle(key)}
                      className="w-full px-4 py-3 flex items-start gap-2 text-left hover:bg-muted/40 transition-colors"
                    >
                      {isOpen ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                      )}
                      <span className="text-sm font-medium flex-1">{item.q}</span>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 pt-1 pl-10 text-sm text-muted-foreground leading-relaxed prose prose-sm max-w-none">
                        {item.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Quick text extraction from React nodes for search matching. */
function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join(' ');
  if (typeof node === 'object' && 'props' in node) {
    return extractText((node as { props: { children?: React.ReactNode } }).props.children);
  }
  return '';
}
