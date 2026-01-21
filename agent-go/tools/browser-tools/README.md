# Browser Tools (Python)

CDP tools for browser automation and site exploration.

## CLI Invocation

From `agent-go/`:

```bash
python3 tools/browser-tools/start.py
python3 tools/browser-tools/nav.py https://example.com
```

## Python API

```python
import sys
sys.path.append("tools/browser-tools")  # run from agent-go/

from start import StartBrowserInput, ensure_browser_started
from nav import NavigateArgs, navigate_to
from type import TypeInput, type_into_page
from wait import WaitInput, WaitMode, wait_for_condition

# Optional: pass the same argv-style flags used by the CLIs (e.g. ["--port", "9222"])
argv: list[str] = []

ensure_browser_started(StartBrowserInput(), argv)
navigate_to(NavigateArgs(url="https://example.com"), argv)
wait_for_condition(WaitInput(mode=WaitMode(kind="visible", selector="input, textarea")), argv)
type_into_page(TypeInput(selector="input, textarea", text="hello", clear=True), argv)
type_into_page(TypeInput(press_key="Enter"), argv)
```

For extraction/scraping, you can also connect to the active page and call CDP directly:

```python
import json
from _shared import connect_active_page

argv: list[str] = []
conn = connect_active_page(argv)
try:
    result = conn.session.call(
        "Runtime.evaluate",
        {
            "expression": "document.title",
            "awaitPromise": True,
            "returnByValue": True,
            "replMode": True,
        },
    )
    print(json.dumps(result["result"]["value"]))
finally:
    conn.close()
```

## Modules

### Start Chrome

```bash
python3 tools/browser-tools/start.py
python3 tools/browser-tools/start.py --profile
python3 tools/browser-tools/start.py --restart
```

In the Docker image, Chromium is already running (started by `entrypoint.sh`). This tool verifies DevTools connectivity and can trigger a restart with `--restart`. Locally, it launches Chrome with remote debugging on `:9222`.

### Navigate

```bash
python3 tools/browser-tools/nav.py https://example.com
python3 tools/browser-tools/nav.py https://example.com --new
```

### Evaluate JavaScript

```bash
python3 tools/browser-tools/eval.py "document.title"
python3 tools/browser-tools/eval.py "document.querySelectorAll('a').length"
```

Tip: For longer/multiline JavaScript, use a heredoc to avoid shell escaping issues:

```bash
JS=$(cat <<'EOF'
(() => {
  const results = Array.from(document.querySelectorAll("a h3"))
    .slice(0, 5)
    .map((h3) => h3.textContent || "");
  return results;
})()
EOF
)
python3 tools/browser-tools/eval.py "$JS"
```

### Screenshot

```bash
python3 tools/browser-tools/screenshot.py
python3 tools/browser-tools/screenshot.py --path /tmp/current-page.png
```

### Pick Elements

```bash
python3 tools/browser-tools/pick.py "Click the submit button"
```

### Type

```bash
python3 tools/browser-tools/type.py "hello world"
python3 tools/browser-tools/type.py "hello" --selector "#search"
python3 tools/browser-tools/type.py "hello" --selector "#search" --clear
python3 tools/browser-tools/type.py --press Enter
python3 tools/browser-tools/type.py --env API_KEY --selector "#token"
```

### Click

```bash
python3 tools/browser-tools/click.py "#submit"
python3 tools/browser-tools/click.py "#menu" --right
python3 tools/browser-tools/click.py "#item" --double
```

### Scroll

```bash
python3 tools/browser-tools/scroll.py
python3 tools/browser-tools/scroll.py down 500
python3 tools/browser-tools/scroll.py top
python3 tools/browser-tools/scroll.py --selector "#footer"
```

### Wait

```bash
python3 tools/browser-tools/wait.py 2000
python3 tools/browser-tools/wait.py --selector "#results"
python3 tools/browser-tools/wait.py --visible ".modal"
python3 tools/browser-tools/wait.py --hidden ".spinner"
python3 tools/browser-tools/wait.py --nav
python3 tools/browser-tools/wait.py --idle
```

### Cookies

```bash
python3 tools/browser-tools/cookies.py
python3 tools/browser-tools/cookies.py --json
python3 tools/browser-tools/cookies.py --set session_id=abc123
python3 tools/browser-tools/cookies.py --set session_id --env SESSION_TOKEN
python3 tools/browser-tools/cookies.py --delete session_id
```

## Guideline

- Prefer stable selectors: name, type, role, aria-label, data-\*; avoid brittle class chains.
- When a UI varies, use selector fallbacks: A, B, C and keep each alternative simple.
- Always wait on a concrete page condition, not time: wait.py --visible <selector> for “ready to type/click”, and wait.py --visible <results container> for “results loaded”.
- Use --nav only for true navigations; for SPAs or dynamic pages, prefer --visible/--selector (and optionally --idle after).
- Assume first-run friction: handle cookie/consent/modals by detecting common patterns and closing/dismissing before proceeding.
- Keep interactions deterministic: clear before typing, press specific keys (Enter), and avoid relying on autofill/suggestions.
- For extraction, query the smallest stable container (e.g., results region) and dedupe; parse URLs via new URL() and normalize redirect wrappers.
- Capture debugging artifacts on failure: screenshot + current URL + document title before retrying with adjusted selectors.
- Document workflows as composable recipes (nav → wait → type → click → wait → eval) and include a “how to pick selectors” checklist.

## Examples

### Generic “search + extract” chain using the sandbox browser tools (CLI), with placeholders:

```bash

# 1) Ensure Chromium/CDP is up

python3 tools/browser-tools/start.py

# 2) Go to the site

python3 tools/browser-tools/nav.py '<URL>'

# 3) Wait for an input you can type into

python3 tools/browser-tools/wait.py --visible '<INPUT_SELECTOR>' --timeout 30000

# 4) Type the query (clear first) + submit

python3 tools/browser-tools/type.py '<QUERY>' --selector '<INPUT_SELECTOR>' --clear
python3 tools/browser-tools/type.py --press Enter

# 5) Wait for results container (or other “next state” marker)

python3 tools/browser-tools/wait.py --visible '<RESULTS_SELECTOR>' --timeout 30000
```
