# Project guidance

## Overview

Mini_Tools is a collection of small utilities. Keep each tool's code, dependency
configuration, resources, and README in its own directory. Update the root README
tool list when adding a tool; avoid shared dependencies unless they are needed.

The current tool is `github-zh-cn/github-zh-cn.user.js`, a standalone userscript that
localizes GitHub and Gist interface text into Simplified Chinese. It runs at
`document-start` and uses optional userscript-manager APIs for its enable toggle.
This tool currently has no package manifest, build pipeline, or automated test suite.
The userscript-specific guidance below applies to `github-zh-cn/`.

## Structure

- Userscript metadata and settings appear at the top of the script.
- `DICT` contains interface translations grouped by UI area.
- `REGEX_RULES` handles labels containing counts or variable text.
- `SKIP_SELECTOR` protects user-authored content from translation.
- Translation helpers process text, selected attributes, and time elements.
- A `MutationObserver` and page lifecycle listeners handle dynamic navigation.

## Editing conventions

- Keep the script standalone and dependency-free unless the task requires otherwise.
- Follow the existing two-space indentation, single quotes, and semicolons.
- Preserve UTF-8 Chinese text. In Windows PowerShell, read with
  `Get-Content -Encoding UTF8` to avoid misleading garbled output.
- Add dictionary entries to the relevant group and check for existing keys.
- Use narrowly scoped, anchored regex rules for variable UI labels; preserve
  captured values and surrounding whitespace.
- Preserve the userscript metadata block, supported hosts, and optional GM API
  guards. Change version metadata deliberately when preparing a release.

## Behavioral constraints

- Translate interface text only. Preserve code, Markdown, comments, issue titles,
  repository and user names, filenames, and editable content.
- Keep skip checks effective for both initial traversal and dynamically added nodes.
- Avoid unnecessary DOM writes and observer feedback loops. Repeated translation
  passes should leave already translated content stable.
- Keep initial loading and GitHub Turbo navigation working.

## Validation

- When Node.js is available, run `node --check github-zh-cn/github-zh-cn.user.js` for syntax
  validation. This does not verify browser behavior.
- For behavioral changes, load the script in a userscript manager and check the
  affected GitHub or Gist UI, initial load, dynamic updates, and Turbo navigation.
- Verify that protected user content remains unchanged, translated attributes
  behave correctly, and the enable/disable menu works after reload.
- Report which checks actually ran and any unavailable runtime or browser coverage.
