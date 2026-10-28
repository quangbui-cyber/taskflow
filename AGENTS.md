<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Design System & UI/UX Aesthetic Principles

All UI design and front-end code in this repo MUST adhere to `docs/DESIGN_GUIDELINES.md`:

1. **Restraint & Breathing Room ("Front Porch" Principle):**
   - The Homepage (`/`) is the front porch of the company: calm, warm, spacious, and inviting.
   - NEVER clutter the homepage with dense project lists, stressful D-Day countdowns, or aggressive alerts that create anxiety ("ngột ngạt vì công việc").
   - Detailed operational workflows belong to sub-pages (`/tasks`, `/projects`, `/revenue`).

2. **Visual Hierarchy & Clean Typography:**
   - Follow Refactoring UI: Use whitespace (`gap`, `padding`) instead of heavy borders and nested cards to group content.
   - 90% neutral surfaces (`bg-white`, `bg-zinc-50`, text `zinc-900` to `zinc-500`). 10% lime-green brand accent (`brand-400` / `brand-500` / `brand-700`).
   - Soft borders (`border-zinc-200`), rounded corners (`rounded-[14px]` - `rounded-[18px]`), subtle shadows (`shadow-sm`).

3. **Subtle Micro-interactions:**
   - Transitions must be quick (150ms-200ms) and tactile (`hover:-translate-y-0.5`).
   - No infinite looping animations on static elements.
   - Zero-reflow: only animate `transform` and `opacity`. Always support `prefers-reduced-motion`.

