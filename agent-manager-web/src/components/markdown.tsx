import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MarkdownCode } from "./markdown-code";

const FENCE_RE = /^(\s{0,3})((`{3,})|(~{3,}))(.*?)$/;

/**
 * Fix nested code fences that would cause the CommonMark parser to
 * prematurely close an outer code block.
 *
 * For example, a ```diff block whose content contains bare ``` lines
 * (e.g. from an inner ```python block) would be closed at the first
 * bare ```.  We detect this and bump the outer fence to use more
 * backticks so that the inner ones are treated as content.
 */
function fixNestedCodeFences(markdown: string): string {
  let text = markdown;

  for (let pass = 0; pass < 10; pass++) {
    const lines = text.split("\n");

    type Fence = {
      idx: number; // index in `fences` array
      lineIdx: number;
      indent: string;
      char: string;
      len: number;
      info: string;
    };

    const fences: Fence[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(FENCE_RE);
      if (m) {
        fences.push({
          idx: fences.length,
          lineIdx: i,
          indent: m[1],
          char: m[2][0],
          len: m[2].length,
          info: (m[5] || "").trim(),
        });
      }
    }

    if (fences.length < 2) return text;

    // Simulate CommonMark fence pairing
    const paired = new Set<number>();
    let inBlock = false;
    let blockChar = "";
    let blockLen = 0;
    let lastOpenIdx = -1;

    for (let fi = 0; fi < fences.length; fi++) {
      const f = fences[fi];
      if (!inBlock) {
        inBlock = true;
        blockChar = f.char;
        blockLen = f.len;
        lastOpenIdx = fi;
        paired.add(fi);
      } else if (
        f.char === blockChar &&
        f.len >= blockLen &&
        f.info === ""
      ) {
        paired.add(fi);
        inBlock = false;
      }
    }

    // Treat a trailing unclosed bare fence as an orphan – it is more likely a
    // misplaced closing fence than an intentional unclosed code block.
    if (inBlock && lastOpenIdx >= 0 && fences[lastOpenIdx].info === "") {
      paired.delete(lastOpenIdx);
    }

    // Rebuild pairs list
    const pairs: Array<{ open: Fence; close: Fence }> = [];
    {
      let ib = false;
      let curOpen: Fence | null = null;
      for (let fi = 0; fi < fences.length; fi++) {
        if (!paired.has(fi)) continue;
        const f = fences[fi];
        if (!ib) {
          curOpen = f;
          ib = true;
        } else {
          pairs.push({ open: curOpen!, close: f });
          ib = false;
          curOpen = null;
        }
      }
    }

    const orphans = fences.filter((_, i) => !paired.has(i));
    const bareOrphans = orphans.filter((o) => o.info === "");

    if (bareOrphans.length === 0) return text;

    // Find the first pair (with info string) that has bare orphans after it
    let fixed = false;
    for (const pair of pairs) {
      if (pair.open.info === "") continue;

      const orphansAfter = bareOrphans.filter(
        (o) => o.lineIdx > pair.close.lineIdx && o.char === pair.open.char,
      );
      if (orphansAfter.length === 0) continue;

      const realClose = orphansAfter[orphansAfter.length - 1];

      // Max bare fence length between the opening and the intended closing
      let maxInner = 0;
      for (const f of fences) {
        if (
          f.lineIdx > pair.open.lineIdx &&
          f.lineIdx < realClose.lineIdx &&
          f.char === pair.open.char &&
          f.info === ""
        ) {
          maxInner = Math.max(maxInner, f.len);
        }
      }

      const newLen = Math.max(pair.open.len, maxInner) + 1;
      const newFence = pair.open.char.repeat(newLen);

      lines[pair.open.lineIdx] = `${pair.open.indent}${newFence} ${pair.open.info}`;
      lines[realClose.lineIdx] = `${realClose.indent}${newFence}`;

      text = lines.join("\n");
      fixed = true;
      break; // one fix per pass, then re-parse
    }

    if (!fixed) break;
  }

  return text;
}

export function Markdown(props: { readonly children: string }) {
  const processed = fixNestedCodeFences(props.children);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...rest }) {
          return (
            <MarkdownCode className={className} {...rest}>
              {children}
            </MarkdownCode>
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
      {processed}
    </ReactMarkdown>
  );
}
