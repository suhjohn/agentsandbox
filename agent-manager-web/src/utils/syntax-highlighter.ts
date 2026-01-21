import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createHighlighter, type Highlighter } from "shiki";

const SHIKI_THEME = "github-dark-default";
const HIGHLIGHT_LANGUAGES = [
  "bash",
  "css",
  "html",
  "javascript",
  "json",
  "markdown",
  "python",
  "sql",
  "tsx",
  "typescript",
  "yaml",
] as const;

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  jsx: "tsx",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  md: "markdown",
  yml: "yaml",
};

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighterOnce(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [SHIKI_THEME],
      langs: [...HIGHLIGHT_LANGUAGES],
    });
  }
  return highlighterPromise;
}

function normalizeLanguage(language?: string): string {
  if (!language) return "";
  const key = language.toLowerCase();
  return LANGUAGE_ALIASES[key] ?? key;
}

export function useHighlightedHtml(code: string, language?: string) {
  const resolvedLanguage = useMemo(() => normalizeLanguage(language), [language]);
  const enabled = Boolean(code) && Boolean(resolvedLanguage);

  const query = useQuery({
    queryKey: ["highlightedHtml", resolvedLanguage, code],
    enabled,
    retry: false,
    staleTime: Infinity,
    gcTime: 60_000,
    queryFn: async ({ signal }): Promise<string | null> => {
      if (!enabled || signal.aborted) return null;
      try {
        const highlighter = await getHighlighterOnce();
        if (signal.aborted) return null;
        const loadedLanguages = highlighter.getLoadedLanguages() as readonly string[];
        if (!loadedLanguages.includes(resolvedLanguage)) return null;
        return highlighter.codeToHtml(code, {
          lang: resolvedLanguage,
          theme: SHIKI_THEME,
        });
      } catch {
        return null;
      }
    },
  });

  return query.data ?? null;
}
