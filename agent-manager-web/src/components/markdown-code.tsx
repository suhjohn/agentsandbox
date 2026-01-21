import type { HTMLAttributes, ReactNode } from "react";
import { DiffBlock } from "./diff-block";
import { CodeBlock } from "./code-block";

interface MarkdownCodeProps extends HTMLAttributes<HTMLElement> {
  readonly className?: string;
  readonly children: ReactNode;
}

export function MarkdownCode({ className, children, ...props }: MarkdownCodeProps) {
  const match = /language-(\w+)/.exec(className || "");
  const isInline = !match && !className;
  const language = match?.[1];

  if (isInline) {
    return (
      <code
        className="bg-surface-2 rounded px-1.5 py-0.5 font-mono text-sm text-text-primary whitespace-pre-wrap break-all"
        style={{ overflowWrap: "anywhere" }}
        {...props}
      >
        {children}
      </code>
    );
  }

  if (language === "diff" || language === "patch") {
    return <DiffBlock code={String(children).replace(/\n$/, "")} />;
  }

  return (
    <CodeBlock
      language={language}
      code={String(children).replace(/\n$/, "")}
    />
  );
}
