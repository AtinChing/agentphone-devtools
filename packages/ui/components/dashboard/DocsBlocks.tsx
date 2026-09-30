"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

/** Inline code. */
export function DocsCode({ children }: { children: ReactNode }) {
  return <code className="data rounded bg-raised px-1.5 py-0.5 text-[12.5px] text-bright">{children}</code>;
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
    <div className="group relative my-4 overflow-hidden rounded-xl border border-line">
      {label ? <div className="micro border-b border-line bg-raised px-4 py-2 text-slate-500">{label}</div> : null}
      <pre className="console-pane overflow-x-auto p-4 text-[12.5px] leading-relaxed">{code}</pre>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy code"
        className={`absolute right-2.5 ${label ? "top-10" : "top-2.5"} flex h-7 w-7 items-center justify-center rounded-md border border-line bg-panel text-slate-500 opacity-0 transition hover:text-bright group-hover:opacity-100 focus:opacity-100`}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

export function DocsSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 border-b border-line pb-10 pt-2 last:border-b-0">
      <h2 className="mb-4 text-[22px] font-bold tracking-tight text-bright">{title}</h2>
      <div className="space-y-3 text-[14.5px] leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

export function DocsSubheading({ children }: { children: ReactNode }) {
  return <h3 className="pt-3 text-[16px] font-semibold text-bright">{children}</h3>;
}

/** Two-column reference table (name → meaning), used for fields, flags, and routes. */
export function DocsTable({ head, rows }: { head: [string, string]; rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="my-4 overflow-x-auto rounded-xl border border-line">
      <table className="w-full border-collapse text-left text-[13.5px]">
        <thead>
          <tr className="border-b border-line bg-raised">
            {head.map((cell) => (
              <th key={cell} className="px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, meaning], index) => (
            <tr key={index} className="border-b border-line/70 align-top last:border-b-0">
              <td className="data whitespace-nowrap px-4 py-2.5 text-[12.5px] text-bright">{name}</td>
              <td className="px-4 py-2.5 text-slate-600">{meaning}</td>
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
      <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">On this page</div>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              onClick={() => setActive(item.id)}
              className={`block rounded-lg px-3 py-1.5 text-[14px] transition ${
                active === item.id ? "bg-panel font-medium text-fern" : "text-slate-600 hover:bg-mist hover:text-bright"
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
