#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

from _shared import BrowserToolsError, connect_active_page, has_flag, positional_args, print_result, run_cli


PICK_HELPER_SCRIPT = r"""
(() => {
  if (window.pick) return;
  window.pick = async (message) => {
    if (!message) throw new Error("pick() requires a message parameter");

    return await new Promise((resolve) => {
      const selections = [];
      const selectedElements = new Set();

      const overlay = document.createElement("div");
      overlay.style.cssText =
        "position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;pointer-events:none";

      const highlight = document.createElement("div");
      highlight.style.cssText =
        "position:absolute;border:2px solid #3b82f6;background:rgba(59,130,246,0.12);transition:all 0.05s";
      overlay.appendChild(highlight);

      const banner = document.createElement("div");
      banner.style.cssText =
        "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#111827;color:white;padding:12px 16px;border-radius:10px;font:14px/1.4 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;box-shadow:0 10px 30px rgba(0,0,0,0.35);pointer-events:auto;z-index:2147483647";

      const updateBanner = () => {
        banner.textContent = message + " (" + selections.length + " selected, Cmd/Ctrl+click to add, Enter to finish, ESC to cancel)";
      };
      updateBanner();

      const cleanup = () => {
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("keydown", onKey, true);
        overlay.remove();
        banner.remove();
        for (const el of selectedElements) {
          try {
            el.style.outline = "";
          } catch {
            // ignore
          }
        }
      };

      const buildElementInfo = (el) => {
        const parents = [];
        let current = el;
        for (let i = 0; i < 8 && current; i++) {
          const parentInfo = current.tagName.toLowerCase();
          const id = current.id ? "#" + current.id : "";
          const cls = current.className
            ? "." + String(current.className).trim().split(/\s+/).join(".")
            : "";
          parents.push(parentInfo + id + cls);
          current = current.parentElement;
        }

        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          class: el.className || null,
          text: el.textContent?.trim().slice(0, 200) || null,
          html: el.outerHTML?.slice(0, 500) || null,
          parents: parents.join(" > "),
        };
      };

      const onMove = (e) => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || overlay.contains(el) || banner.contains(el)) return;
        const r = el.getBoundingClientRect();
        highlight.style.left = Math.max(0, r.left) + "px";
        highlight.style.top = Math.max(0, r.top) + "px";
        highlight.style.width = Math.max(0, r.width) + "px";
        highlight.style.height = Math.max(0, r.height) + "px";
      };

      const onClick = (e) => {
        if (banner.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || overlay.contains(el) || banner.contains(el)) return;

        if (e.metaKey || e.ctrlKey) {
          if (!selectedElements.has(el)) {
            selectedElements.add(el);
            el.style.outline = "3px solid #10b981";
            selections.push(buildElementInfo(el));
            updateBanner();
          }
          return;
        }

        cleanup();
        const info = buildElementInfo(el);
        resolve(selections.length > 0 ? selections : info);
      };

      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cleanup();
          resolve(null);
          return;
        }
        if (e.key === "Enter" && selections.length > 0) {
          e.preventDefault();
          cleanup();
          resolve(selections);
        }
      };

      document.body.appendChild(overlay);
      document.body.appendChild(banner);
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKey, true);
    });
  };
})();
"""


def usage() -> None:
    print("Usage: pick.py 'message'")


def pick_elements(message: str, argv: list[str]) -> Any:
    conn = connect_active_page(argv)
    try:
        conn.session.evaluate(PICK_HELPER_SCRIPT, await_promise=False, return_by_value=False)
        message_json = json.dumps(message)
        script = (
            "(async () => {"
            "const pickFn = globalThis.pick;"
            "if (typeof pickFn !== 'function') throw new Error('Picker not available');"
            f"return await pickFn({message_json});"
            "})()"
        )
        return conn.session.evaluate(script, await_promise=True, return_by_value=True)
    finally:
        conn.close()


def run_pick_cli() -> int:
    argv = os.sys.argv[1:]
    if has_flag(argv, "--help") or has_flag(argv, "-h"):
        usage()
        return 0

    message = " ".join(positional_args(argv)).strip()
    if not message:
        usage()
        return 1

    result = pick_elements(message, argv)
    print_result(result)
    return 0


if __name__ == "__main__":
    run_cli(run_pick_cli)
