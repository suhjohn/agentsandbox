import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronRight } from "lucide-react";
import { CodeBlock } from "./code-block";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";

type DiffPreview = {
  readonly title: string;
  readonly markdown: string;
};

const MARKDOWN_EXTENSIONS = [
  ".md",
  ".mdx",
  ".markdown",
  ".mdown",
  ".mkd",
  ".mkdn",
];

function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function looksLikeMarkdown(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  if (t.includes("```")) return true;
  if (/\n#{1,6}\s+/.test(t)) return true;
  if (/\n\s*[-*]\s+/.test(t)) return true;
  if (/\[[^\]]+\]\([^)]+\)/.test(t)) return true;
  return false;
}

function extractAddedLines(lines: readonly string[]): string {
  const added: string[] = [];
  for (const line of lines) {
    if (line.startsWith("+++")) continue;
    if (line.startsWith("+")) {
      added.push(line.slice(1));
    }
  }
  return added.join("\n").trim();
}

function extractPatchedHunks(lines: readonly string[]): string {
  const out: string[] = [];

  for (const line of lines) {
    if (
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++") ||
      line.startsWith("@@") ||
      line.startsWith("*** ")
    ) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      out.push(line.slice(1));
      continue;
    }

    if (line.startsWith(" ")) {
      out.push(line.slice(1));
    }
  }

  return out.join("\n").trim();
}

function parseDiffPreviews(code: string): DiffPreview[] {
  const lines = code.replace(/\r\n/g, "\n").split("\n");

  const sections: Array<{ readonly filePath: string; readonly start: number; end: number }> = [];
  let current: { filePath: string; start: number; end: number } | null = null;

  const gitHeaderRe = /^diff --git a\/(.+?) b\/(.+?)\s*$/;
  const applyHeaderRe = /^\*\*\* (?:Update|Add|Delete) File:\s+(.+?)\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const gitMatch = lines[i].match(gitHeaderRe);
    const applyMatch = lines[i].match(applyHeaderRe);

    if (gitMatch) {
      if (current) {
        current.end = i;
        sections.push(current);
      }
      current = { filePath: gitMatch[2], start: i, end: lines.length };
      continue;
    }

    if (applyMatch) {
      if (current) {
        current.end = i;
        sections.push(current);
      }
      current = { filePath: applyMatch[1], start: i, end: lines.length };
    }
  }

  if (current) sections.push({ ...current, end: current.end });

  const previews: DiffPreview[] = [];

  for (const section of sections) {
    const patched = extractPatchedHunks(lines.slice(section.start, section.end));
    if (!patched) continue;
    if (!isMarkdownPath(section.filePath)) continue;
    previews.push({
      title: `${section.filePath} (patched hunks)`,
      markdown: patched,
    });
  }

  if (previews.length > 0) return previews;

  const addedWhole = extractAddedLines(lines);
  if (looksLikeMarkdown(addedWhole)) {
    previews.push({ title: "Preview (added lines)", markdown: addedWhole });
  }

  return previews;
}

function PreviewMarkdown(props: { readonly markdown: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...rest }) {
          const match = /language-(\w+)/.exec(className || "");
          const language = match?.[1];
          const isInline = !language && !className;

          if (isInline) {
            return (
              <code
                className="bg-surface-2 rounded px-1.5 py-0.5 font-mono text-sm text-text-primary whitespace-pre-wrap break-all"
                style={{ overflowWrap: "anywhere" }}
                {...rest}
              >
                {children}
              </code>
            );
          }

          return (
            <CodeBlock
              language={language}
              code={String(children).replace(/\n$/, "")}
            />
          );
        },
        pre({ children }) {
          return <>{children}</>;
        },
        p({ children }) {
          return (
            <p className="mb-2 last:mb-0 leading-relaxed whitespace-pre-wrap break-words">
              {children}
            </p>
          );
        },
        a({ href, children }) {
          return (
            <a
              href={href}
              className="text-[var(--color-info)] hover:underline break-all"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          );
        },
        ul({ children }) {
          return (
            <ul className="list-disc pl-5 mb-2 last:mb-0 space-y-1">
              {children}
            </ul>
          );
        },
        ol({ children }) {
          return (
            <ol className="list-decimal pl-5 mb-2 last:mb-0 space-y-1">
              {children}
            </ol>
          );
        },
        li({ children }) {
          return (
            <li className="leading-relaxed [&>p]:mb-0 [&>p]:inline">
              {children}
            </li>
          );
        },
        blockquote({ children }) {
          return (
            <blockquote className="border-l-4 border-border-strong pl-4 py-1 mb-2 last:mb-0 italic text-text-tertiary">
              {children}
            </blockquote>
          );
        },
        hr() {
          return <hr className="my-4 border-border" />;
        },
      }}
    >
      {props.markdown}
    </ReactMarkdown>
  );
}

function DiffPreviewCollapsible(props: DiffPreview) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-1 border-none cursor-pointer text-xs text-text-tertiary">
        <ChevronRight
          size={14}
          className={`flex-shrink-0 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
        />
        <span className="truncate">{props.title}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 px-3 py-2 bg-surface-3 text-xs rounded">
        <PreviewMarkdown markdown={props.markdown} />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function DiffBlock(props: { readonly code: string }) {
  const previews = useMemo(() => parseDiffPreviews(props.code), [props.code]);
  return (
    <div className="my-3 space-y-2">
      <CodeBlock language="diff" code={props.code} />
      {previews.map((preview, idx) => (
        <DiffPreviewCollapsible
          key={`${idx}:${preview.title}`}
          title={preview.title}
          markdown={preview.markdown}
        />
      ))}
    </div>
  );
}
