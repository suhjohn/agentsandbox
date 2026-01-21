import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { getCssVarAsNumber } from "../utils/css-vars";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { useHighlightedHtml } from "../utils/syntax-highlighter";

interface CodeBlockProps {
  readonly code: string;
  readonly language?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const highlighted = useHighlightedHtml(code, language);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="overflow-hidden my-3">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-xs text-text-secondary lowercase">{language || "code"}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => void copyToClipboard()}
          title="Copy code"
        >
          {copied ? (
            <Check size={getCssVarAsNumber("--size-icon-sm", 14)} />
          ) : (
            <Copy size={getCssVarAsNumber("--size-icon-sm", 14)} />
          )}
        </Button>
      </div>
      {highlighted ? (
        <div className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: highlighted }} />
      ) : (
        <pre className="m-0 p-3 font-mono text-sm text-text-primary overflow-x-auto leading-relaxed">
          <code>{code}</code>
        </pre>
      )}
    </Card>
  );
}
