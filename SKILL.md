---
name: webapp-reviewer
description: Read and act on webapp review feedback from the Webapp Reviewer Chrome extension
user_invocable: true
---

# Webapp Reviewer

Read review feedback (speech, clicked elements, boxed areas, text selections, page screenshots) captured by the Webapp Reviewer Chrome extension and apply the requested changes to the codebase.

## Trigger

User says: `/webapp-reviewer` or "read my review" or "apply review feedback" or "check my webapp review"

## Workflow

### 1. Read the latest review

```bash
REVIEW_DIR=$(readlink -f ~/.claude/reviews/latest 2>/dev/null || ls -td ~/.claude/reviews/review-* 2>/dev/null | head -1)
```

Read `$REVIEW_DIR/review.md` to understand the feedback. The folder also has:

- `timeline.json` — the same events as structured data, each with its page number
- `console.log` — every console entry, uncaught error, unhandled rejection and failed `fetch` captured during the review, with time offset and page URL (absent when nothing was logged)
- `pages/NN.jpg` — a screenshot of each page, taken after it loaded
- `screenshots/NNN.jpg` — screenshots belonging to clicks, boxes and whole-screen captures

### 2. Start from the page index

`review.md` opens with a **Pages** table: page number, title, URL, when the reviewer was there, how many remarks they made and the page screenshot. Pages with no remarks were only passed through; skip them.

Do not read every image. Read a box's or click's screenshot with the remark it belongs to. Open a page screenshot from `pages/` only when a remark is about the page as a whole ("this page is a mess") or you need its layout to place a change.

### 3. Read the transcript, then the timeline

After the Pages table comes a **Transcript**: per page visit, everything the reviewer said as continuous text, with their actions as bracketed markers (`[+3:13 box under "Results"]`, `[+0:51 clicked link <a> "…", no page load]`). Read it first to list the feedback; look a marker up in the Timeline by its time for the element, link target and screenshot.

The timeline is grouped by page visit (`### +16:17 · Page 07 · Topics`). Each visit says how the reviewer got there (the link they clicked, back/forward, a page load) and which page screenshot belongs to it. Headings show the offset from the start of the review.

- **Voice** -- continuous transcription of the reviewer talking. This is the primary feedback channel. Headings give the time range the speech covered (`+0:03–0:23`). Words are placed by when they were spoken, and a sentence cut off by a page change is finished on the page where it began.
  - It is raw live speech recognition: thinking aloud, false starts, and misheard words. Read a word that makes no sense as the similar-sounding one that fits the page.
  - Remarks still drift: the reviewer often comments on a page while already moving to the next one, or a few seconds after the click they mean.
- **Pointed at** -- the reviewer clicked an element while talking. "This is wrong" refers to the element pointed at around it. Comes with a screenshot with the element boxed. "(the click opened it)" means it was a disclosure or expandable: the reviewer was opening it to look, and the screenshot shows it opened.
- **Clicked link** -- a link click that did not lead to a page load in this tab, with **Link to** (its target) and "(opens in a new tab)" when it does. Link clicks that loaded their target are folded into that page visit's "Arrived by clicking", which warns **the page appeared N s after the click** when it took 3 s or more. A "this link doesn't work" remark next to a Clicked link is often a slow page the reviewer gave up on: compare its target with slow arrivals elsewhere in the review before assuming the link is broken.
- **Load** -- on page visits from a click or the address bar: time to first byte, page ready (DOMContentLoaded) and fully loaded, measured from the click. Use it for remarks about speed.
- **Set … to "…"** -- the reviewer changed a dropdown, checkbox or text field (search terms, filters that do not change the URL).
- **On another tab or window** -- the reviewer was looking at another tab for that span, usually one a new-tab link opened; speech in it is about that page, not this one.
- **Box** -- the reviewer marked an area. It has a cropped screenshot (the area outlined in red, with some margin), the **Container** (closest common parent of everything in the box), and an **Inside** outline of its headings, links, controls and text, indented by how they are nested in the DOM. An item indented under the wrong parent is often the bug. Link labels repeated on every item are listed once. Search the code for the outline's text.
- **Selected text** -- exact wording the reviewer selected, often a typo or OCR error.
- **Typed note** -- the reviewer typed instead of talking; read it like speech.
- **Console** -- errors only (repeats collapsed as ×N); warnings and logs are in `console.log`.
- **Screenshot of the whole screen** -- a manual capture.

Element entries carry, when available: **Component** (React/Vue component chain, innermost first, plus the source file and line in dev builds), test id, id, role, landmark and nearest heading, text content, and a CSS selector with generated hash classes removed.

Read the timeline in order. A click, box or selection marks what the reviewer meant by the speech just before and after it; a sentence often runs across one.

### 4. Apply changes

For each piece of feedback:
1. Start from the **Component** line and its source path when present: that is the fastest route to the code
2. Otherwise search for the test id, visible text, aria-label or heading, then the selector's ids and classes
3. For a box, search for the text in its **Inside** outline, starting from the containing element
4. Voice and typed notes describe what to change; clicks, boxes and selections show what the reviewer meant
5. The **viewport/scroll metadata** tells you if this is mobile/desktop and above/below fold
6. Apply the requested changes

### 5. Browse all reviews

Run `~/.claude/skills/webapp-reviewer/bin/start`, then visit `http://localhost:10002/reviews` to see all saved review sessions grouped by date and domain. Each review has a detail page with inline screenshots. This server is only for browsing; recording and saving reviews do not need it.

## First-time setup

From a clone of the repository, run `./install.sh`. It links the folder into `~/.claude/skills`, registers the native messaging host that saves reviews to `~/.claude/reviews` (Chrome starts it for each export, so no server has to run) and creates `.env` for the Soniox API key that voice needs. Then load `extension/` once as an unpacked extension in `chrome://extensions` with Developer mode on.

After updating the extension files, click the reload icon on the extension card in `chrome://extensions`. The review continues across page loads in the same tab, and the timeline is saved per tab until it is exported. If the export code changes, `bin/rebuild-review [review folder]` rewrites a saved `review.md` from its `timeline.json`.

## Extension usage

1. **Start** -- click "Start Review" in the extension popup, or press `Alt+R`
2. **Talk** -- everything you say is recorded; this is the main channel
3. **Click** -- point at one element while talking; the agent gets it boxed in a screenshot
4. **Option + drag** -- box an area (or click the box button, then drag); the agent gets a cropped screenshot and what is inside it
5. **Select text** -- quote exact wording, such as a typo
6. **Move around freely** -- every page you open is screenshotted about a second after it loads, and the review carries on across page loads
7. **Export** -- press `Alt+X`. The path to `review.md` is copied to the clipboard and the timeline clears. If saving fails, the markdown is copied and the timeline is kept.

The timeline panel (`Alt+N`) shows each entry as the agent will read it, marked "screenshot" or "no screenshot"; your latest action shows briefly in the bottom-left corner.

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+R` | Start / stop the review |
| Option + drag | Box an area |
| `Alt+T` | Type a note instead of talking |
| `Alt+S` | Screenshot the whole screen |
| `Alt+N` | Show what has been recorded |
| `Alt+X` | Export review (saves + clears) |
| `Escape` | Cancel / close |
| `?` | Show help |
