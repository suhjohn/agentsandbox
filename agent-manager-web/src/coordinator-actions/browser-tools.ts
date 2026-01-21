import { z } from "zod";
import type { UiExecutionContext } from "./types";
import type { CoordinatorBrowserClientToolName } from "../../../shared/coordinator-client-tools-contract";

const navigateSchema = z.object({
  to: z.string().trim().min(1),
  newTab: z.boolean().optional(),
});

const snapshotSchema = z.object({
  includeHtml: z.boolean().optional(),
  includeText: z.boolean().optional(),
  includeScreenshot: z.boolean().optional(),
  maxHtmlChars: z.number().int().min(1).max(1_000_000).optional(),
  maxTextChars: z.number().int().min(1).max(1_000_000).optional(),
});

const clickSchema = z.object({
  selector: z.string().trim().min(1),
  button: z.enum(["left", "right"]).optional(),
  double: z.boolean().optional(),
  delayMs: z.number().int().min(0).max(10_000).optional(),
});

const typeSchema = z.object({
  selector: z.string().trim().min(1).optional(),
  text: z.string().optional(),
  clear: z.boolean().optional(),
  pressKey: z.string().trim().min(1).optional(),
  submit: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (typeof value.text !== "string" && typeof value.pressKey !== "string") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide at least one of `text` or `pressKey`.",
    });
  }
});

const waitSchema = z.object({
  ms: z.number().int().min(1).max(60_000).optional(),
  selector: z.string().trim().min(1).optional(),
  visible: z.string().trim().min(1).optional(),
  hidden: z.string().trim().min(1).optional(),
  nav: z.boolean().optional(),
  idle: z.boolean().optional(),
  timeoutMs: z.number().int().min(1).max(60_000).optional(),
}).superRefine((value, ctx) => {
  const conditions = [
    typeof value.ms === "number",
    typeof value.selector === "string",
    typeof value.visible === "string",
    typeof value.hidden === "string",
    value.nav === true,
    value.idle === true,
  ].filter(Boolean).length;

  if (conditions !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Provide exactly one wait condition: `ms`, `selector`, `visible`, `hidden`, `nav`, or `idle`.",
    });
  }
});

const scrollSchema = z.object({
  direction: z.enum(["up", "down", "left", "right", "top", "bottom"]).optional(),
  pixels: z.number().int().min(1).max(100_000).optional(),
  selector: z.string().trim().min(1).optional(),
}).superRefine((value, ctx) => {
  if (typeof value.selector !== "string" && typeof value.direction !== "string") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide `selector` or `direction`.",
    });
  }
});

const evalSchema = z.object({
  expression: z.string().trim().min(1),
});

function clampChars(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(1_000_000, Math.floor(value)));
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

async function waitUntil(
  check: () => boolean,
  timeoutMs: number,
  description: string,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    if (check()) return;
    await waitMs(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function findElement(selector: string): Element {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Element not found for selector: ${selector}`);
  }
  return element;
}

function dispatchKeyboard(input: { target: EventTarget; key: string }): void {
  const eventInit: KeyboardEventInit = {
    key: input.key,
    bubbles: true,
    cancelable: true,
  };
  input.target.dispatchEvent(new KeyboardEvent("keydown", eventInit));
  input.target.dispatchEvent(new KeyboardEvent("keyup", eventInit));
}

function setInputValue(
  target: HTMLInputElement | HTMLTextAreaElement,
  nextValue: string,
): void {
  const prototype = Object.getPrototypeOf(target);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set) {
    descriptor.set.call(target, nextValue);
  } else {
    target.value = nextValue;
  }
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
}

function appendContentEditableText(target: HTMLElement, text: string): void {
  target.focus();
  const current = target.textContent ?? "";
  target.textContent = `${current}${text}`;
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

function toSerializable(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

async function imageFromObjectUrl(url: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to render DOM snapshot image"));
    image.src = url;
  });
}

function isSnapshotSafeUrl(raw: string | null): boolean {
  if (!raw) return true;
  const value = raw.trim();
  if (value.length === 0) return true;
  if (
    value.startsWith("data:") ||
    value.startsWith("blob:") ||
    value.startsWith("about:")
  ) {
    return true;
  }
  try {
    const resolved = new URL(value, window.location.href);
    return resolved.origin === window.location.origin;
  } catch {
    return true;
  }
}

function isSnapshotSafeSrcSet(raw: string | null): boolean {
  if (!raw) return true;
  const parts = raw
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0] ?? "")
    .filter((part) => part.length > 0);
  if (parts.length === 0) return true;
  return parts.every((part) => isSnapshotSafeUrl(part));
}

function sanitizeClonedDomForSnapshot(root: HTMLElement): void {
  for (const node of root.querySelectorAll("script,iframe,canvas,video,object,embed")) {
    const replacement = document.createElement("div");
    replacement.setAttribute(
      "style",
      [
        "display:block",
        "min-height:24px",
        "padding:4px 8px",
        "background:rgba(148,163,184,0.2)",
        "border:1px solid rgba(148,163,184,0.6)",
        "color:rgba(71,85,105,0.95)",
        "font:12px/1.2 monospace",
      ].join(";"),
    );
    replacement.textContent = `[${node.tagName.toLowerCase()} omitted for screenshot]`;
    node.replaceWith(replacement);
  }

  for (const image of root.querySelectorAll("img")) {
    const src = image.getAttribute("src");
    if (!isSnapshotSafeUrl(src)) {
      image.setAttribute("src", "");
      if (!image.getAttribute("alt")) {
        image.setAttribute("alt", "image omitted for screenshot");
      }
    }
    const srcSet = image.getAttribute("srcset");
    if (!isSnapshotSafeSrcSet(srcSet)) {
      image.removeAttribute("srcset");
    }
  }

  for (const source of root.querySelectorAll("source")) {
    const src = source.getAttribute("src");
    if (!isSnapshotSafeUrl(src)) {
      source.removeAttribute("src");
    }
    const srcSet = source.getAttribute("srcset");
    if (!isSnapshotSafeSrcSet(srcSet)) {
      source.removeAttribute("srcset");
    }
  }

  for (const link of root.querySelectorAll("link[rel='stylesheet'][href]")) {
    const href = link.getAttribute("href");
    if (!isSnapshotSafeUrl(href)) {
      link.remove();
    }
  }

  const head = root.querySelector("head");
  if (head) {
    const style = document.createElement("style");
    style.textContent = "*{background-image:none!important}";
    head.append(style);
  }
}

function serializeDomForSnapshot(input: { sanitize: boolean }): string {
  const cloned = document.documentElement.cloneNode(true) as HTMLElement;
  if (input.sanitize) {
    sanitizeClonedDomForSnapshot(cloned);
  }
  return new XMLSerializer().serializeToString(cloned);
}

async function captureVisibleDomAsPngDataUrl(input?: { sanitize?: boolean }): Promise<string> {
  const width = Math.max(1, Math.floor(window.innerWidth));
  const height = Math.max(1, Math.floor(window.innerHeight));
  const serialized = serializeDomForSnapshot({
    sanitize: input?.sanitize === true,
  });
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    '<foreignObject width="100%" height="100%">',
    serialized,
    "</foreignObject>",
    "</svg>",
  ].join("");
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = await imageFromObjectUrl(objectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas rendering context is unavailable");
    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function runBrowserNavigate(
  navigate: UiExecutionContext["navigate"],
  raw: z.infer<typeof navigateSchema>,
) {
  const to = raw.to.trim();
  const current = new URL(window.location.href);
  const resolved = new URL(to, current.href);
  const newTab = raw.newTab === true;

  if (newTab) {
    const opened = window.open(resolved.toString(), "_blank", "noopener,noreferrer");
    if (!opened) throw new Error("Browser blocked opening a new tab");
    return {
      navigated: true as const,
      newTab: true as const,
      url: resolved.toString(),
      title: document.title,
    };
  }

  if (resolved.origin !== current.origin) {
    throw new Error("Cross-origin navigation requires `newTab: true`.");
  }

  const routePath = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  await navigate({ to: routePath });
  return {
    navigated: true as const,
    newTab: false as const,
    url: window.location.href,
    title: document.title,
  };
}

async function runBrowserSnapshot(raw: z.infer<typeof snapshotSchema>) {
  const includeHtml = raw.includeHtml !== false;
  const includeText = raw.includeText !== false;
  const includeScreenshot = raw.includeScreenshot === true;
  const htmlLimit = clampChars(raw.maxHtmlChars, 200_000);
  const textLimit = clampChars(raw.maxTextChars, 100_000);
  const html = includeHtml ? document.documentElement.outerHTML.slice(0, htmlLimit) : undefined;
  const text = includeText ? (document.body?.innerText ?? "").slice(0, textLimit) : undefined;

  let screenshotDataUrl: string | undefined;
  let screenshotError: string | undefined;
  let screenshotMode: "full" | "sanitized" | undefined;
  if (includeScreenshot) {
    try {
      screenshotDataUrl = await captureVisibleDomAsPngDataUrl();
      screenshotMode = "full";
    } catch (error) {
      try {
        screenshotDataUrl = await captureVisibleDomAsPngDataUrl({ sanitize: true });
        screenshotMode = "sanitized";
      } catch (retryError) {
        const primary =
          error instanceof Error ? error.message : "Screenshot capture failed";
        const fallback =
          retryError instanceof Error
            ? retryError.message
            : "Sanitized screenshot capture failed";
        screenshotError =
          fallback === primary ? primary : `${primary} (safe retry failed: ${fallback})`;
      }
    }
  }

  return {
    snapshot: true as const,
    url: window.location.href,
    title: document.title,
    html,
    text,
    screenshotMode,
    screenshotDataUrl,
    screenshotError,
  };
}

async function runBrowserClick(raw: z.infer<typeof clickSchema>) {
  const element = findElement(raw.selector);
  if (element instanceof HTMLElement) {
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    element.focus({ preventScroll: true });
  }
  if (typeof raw.delayMs === "number" && raw.delayMs > 0) {
    await waitMs(raw.delayMs);
  }

  const button = raw.button ?? "left";
  const isDouble = raw.double === true;
  if (button === "right") {
    element.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
      }),
    );
  } else if (isDouble) {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    );
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 2 }),
    );
    element.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }),
    );
  } else if (element instanceof HTMLElement) {
    element.click();
  } else {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }

  return {
    clicked: true as const,
    selector: raw.selector,
    button,
    double: isDouble,
  };
}

async function runBrowserType(raw: z.infer<typeof typeSchema>) {
  const target =
    typeof raw.selector === "string"
      ? findElement(raw.selector)
      : (document.activeElement as Element | null);
  if (!target) {
    throw new Error("No target element found. Provide `selector` or focus an input first.");
  }

  let typed = false;
  if (typeof raw.text === "string") {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      if (raw.clear === true) {
        setInputValue(target, "");
      }
      const current = target.value ?? "";
      setInputValue(target, `${current}${raw.text}`);
      typed = true;
    } else if (target instanceof HTMLElement && target.isContentEditable) {
      if (raw.clear === true) target.textContent = "";
      appendContentEditableText(target, raw.text);
      typed = true;
    } else {
      throw new Error("Target element does not accept typing.");
    }
  } else if (raw.clear === true && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    setInputValue(target, "");
  }

  let keyPressed: string | undefined;
  if (typeof raw.pressKey === "string") {
    dispatchKeyboard({ target, key: raw.pressKey });
    keyPressed = raw.pressKey;
  }
  if (raw.submit === true) {
    dispatchKeyboard({ target, key: "Enter" });
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      target.form?.requestSubmit();
    }
    keyPressed = "Enter";
  }

  return {
    typed,
    keyPressed,
    selector: typeof raw.selector === "string" ? raw.selector : null,
  };
}

async function runBrowserWait(raw: z.infer<typeof waitSchema>) {
  if (typeof raw.ms === "number") {
    await waitMs(raw.ms);
    return { waited: true as const, condition: "ms", ms: raw.ms };
  }

  const timeoutMs = raw.timeoutMs ?? 10_000;
  if (typeof raw.selector === "string") {
    const selector = raw.selector;
    await waitUntil(
      () => document.querySelector(selector) !== null,
      timeoutMs,
      `selector "${selector}"`,
    );
    return { waited: true as const, condition: "selector", selector };
  }
  if (typeof raw.visible === "string") {
    const visibleSelector = raw.visible;
    await waitUntil(() => {
      const element = document.querySelector(visibleSelector);
      return element ? isVisible(element) : false;
    }, timeoutMs, `visible selector "${visibleSelector}"`);
    return { waited: true as const, condition: "visible", selector: visibleSelector };
  }
  if (typeof raw.hidden === "string") {
    const hiddenSelector = raw.hidden;
    await waitUntil(() => {
      const element = document.querySelector(hiddenSelector);
      if (!element) return true;
      return !isVisible(element);
    }, timeoutMs, `hidden selector "${hiddenSelector}"`);
    return { waited: true as const, condition: "hidden", selector: hiddenSelector };
  }
  if (raw.nav === true) {
    const startHref = window.location.href;
    await waitUntil(() => window.location.href !== startHref, timeoutMs, "navigation");
    return {
      waited: true as const,
      condition: "nav",
      from: startHref,
      to: window.location.href,
    };
  }

  await waitMs(Math.min(timeoutMs, 500));
  return { waited: true as const, condition: "idle", ms: Math.min(timeoutMs, 500) };
}

async function runBrowserScroll(raw: z.infer<typeof scrollSchema>) {
  if (typeof raw.selector === "string") {
    const element = findElement(raw.selector);
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    } else {
      element.scrollIntoView();
    }
    return {
      scrolled: true as const,
      selector: raw.selector,
      x: window.scrollX,
      y: window.scrollY,
    };
  }

  const direction = raw.direction ?? "down";
  const pixels = raw.pixels ?? window.innerHeight;
  switch (direction) {
    case "up":
      window.scrollBy({ top: -pixels, behavior: "instant" });
      break;
    case "down":
      window.scrollBy({ top: pixels, behavior: "instant" });
      break;
    case "left":
      window.scrollBy({ left: -pixels, behavior: "instant" });
      break;
    case "right":
      window.scrollBy({ left: pixels, behavior: "instant" });
      break;
    case "top":
      window.scrollTo({ top: 0, behavior: "instant" });
      break;
    case "bottom":
      window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
      break;
    default:
      break;
  }
  return {
    scrolled: true as const,
    direction,
    pixels,
    x: window.scrollX,
    y: window.scrollY,
  };
}

async function runBrowserEval(raw: z.infer<typeof evalSchema>) {
  const fn = new Function(
    "window",
    "document",
    `"use strict"; return (${raw.expression});`,
  ) as (window: Window, document: Document) => unknown;
  const value = fn(window, document);
  const awaited = value instanceof Promise ? await value : value;
  return {
    evaluated: true as const,
    result: toSerializable(awaited),
  };
}

export async function executeBrowserClientToolRequest(input: {
  readonly toolName: CoordinatorBrowserClientToolName;
  readonly args: unknown;
  readonly navigate: UiExecutionContext["navigate"];
}): Promise<unknown> {
  switch (input.toolName) {
    case "ui_browser_navigate":
      return await runBrowserNavigate(input.navigate, navigateSchema.parse(input.args ?? {}));
    case "ui_browser_snapshot":
      return await runBrowserSnapshot(snapshotSchema.parse(input.args ?? {}));
    case "ui_browser_click":
      return await runBrowserClick(clickSchema.parse(input.args ?? {}));
    case "ui_browser_type":
      return await runBrowserType(typeSchema.parse(input.args ?? {}));
    case "ui_browser_wait":
      return await runBrowserWait(waitSchema.parse(input.args ?? {}));
    case "ui_browser_scroll":
      return await runBrowserScroll(scrollSchema.parse(input.args ?? {}));
    case "ui_browser_eval":
      return await runBrowserEval(evalSchema.parse(input.args ?? {}));
    default: {
      const neverName: never = input.toolName;
      throw new Error(`Unsupported browser client tool: ${String(neverName)}`);
    }
  }
}
