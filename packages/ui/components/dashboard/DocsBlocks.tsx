"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy } from "@phosphor-icons/react";

/** Inline code. */
export function DocsCode({ children }: { children: ReactNode }) {
  return <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[12.5px] text-text">{children}</code>;
}

/** A copyable code block in the console pane style. */
export function DocsBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the text is still selectable */
    }
  }

  return (
    <div className="group relative my-4 overflow-hidden rounded-[12px] border border-white/[0.06] bg-[#111]">
      {label ? <div className="border-b border-white/[0.06] px-4 py-2 pr-12 text-xs font-medium text-text-secondary">{label}</div> : null}
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-white/80">{code}</pre>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy code"
        className={`focus-ring absolute right-2.5 ${label ? "top-1" : "top-2.5"} flex h-7 w-7 items-center justify-center rounded-[8px] border border-white/[0.08] bg-surface text-white/50 opacity-0 transition hover:text-white group-hover:opacity-100 focus:opacity-100`}
      >
        {copied ? <Check size={13} weight="bold" className="text-primary" /> : <Copy size={13} />}
      </button>
    </div>
  );
}

export function DocsSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 border-b border-white/[0.06] pb-10 pt-2 last:border-b-0 last:pb-0">
      <h2 className="mb-4 font-heading text-[22px] font-bold leading-tight text-white">{title}</h2>
      <div className="space-y-3 text-[14px] leading-relaxed text-text-secondary">{children}</div>
    </section>
  );
}

export function DocsSubheading({ children }: { children: ReactNode }) {
  return <h3 className="pt-3 font-heading text-[17px] font-bold leading-tight text-white">{children}</h3>;
}

/** Two-column reference table (name → meaning), used for fields, flags, and routes. */
export function DocsTable({ head, rows }: { head: [string, string]; rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="my-4 overflow-x-auto rounded-[12px] border border-white/[0.06]">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell} className="border-b border-surface-border px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-dim">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, meaning], index) => (
            <tr key={index} className="border-b border-white/[0.04] align-top transition-colors last:border-b-0 hover:bg-white/[0.02]">
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-text">{name}</td>
              <td className="px-4 py-3 text-text-secondary">{meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Sticky table of contents that highlights the section currently in view. */
export function DocsToc({ items }: { items: { id: string; title: string }[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");

  useEffect(() => {
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.set(entry.target.id, entry.boundingClientRect.top);
          else visible.delete(entry.target.id);
        }
        const first = items.find((item) => visible.has(item.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "0px 0px -60% 0px" }
    );
    for (const item of items) {
      const element = document.getElementById(item.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav className="sticky top-6" aria-label="On this page">
      <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/35">On this page</div>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              onClick={() => setActive(item.id)}
              className={`focus-ring block rounded-lg px-3 py-1.5 text-[14px] transition-colors ${
                active === item.id ? "bg-white/[0.06] font-medium text-primary" : "text-white/60 hover:bg-white/[0.04] hover:text-white"
              }`}
            >
              {item.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
