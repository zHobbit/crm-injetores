# 📇 CRM Injetores

A local-first sales CRM for a business that sells diesel injectors and pumps. Built with React, TypeScript and Zustand, with a data model inspired by Kommo: pipelines, stages, custom fields, catalogs and a rule-based automation engine. All data lives in the browser, with no backend.

## ✨ Technologies

- `React 18`
- `TypeScript`
- `Zustand 5` (state + persistence)
- `dnd-kit` (drag and drop)
- `Tailwind CSS 4`
- `date-fns`
- `Vite 5`
- `Vitest`

## 🚀 Features

- **Kanban pipeline** - Drag deals between stages with mouse or keyboard
- **Won / lost stages** - Deal outcome comes from the stage it sits in
- **Custom fields** - Text, number, money, date, select, checkbox and catalog fields, each one optionally required per stage
- **Parts catalog** - Link injectors and pumps to a deal (many-to-many, one quote can hold several parts)
- **Contacts & companies** - Separate entities, with normalized Brazilian phone numbers
- **Automation engine** - Rules fire on deal created, stage changed, field changed or tag changed, and can create tasks, move deals, set fields, add tags or notes, or spin off after-sales and warranty deals
- **Time-based rules** - Checked when the app opens, every hour and when you come back to the tab
- **Smart search & filters** - Search by name, part code, application or phone; filter by customer profile and last-contact recency
- **Backup** - Export and import JSON snapshots, with automatic migration from the v1 schema
- **Dark mode**

## 📍 The Process

The goal was a CRM shaped around how diesel parts are actually sold: quotes for specific part codes, customer profiles and follow-ups. I studied how Kommo models its data and rebuilt the parts that mattered here, as a normalized schema that fits in `localStorage`. The first version stored flat deals; v2 moved to pipelines, stages, custom fields indexed by a stable `code`, and contacts as their own entity, so I wrote a migration that upgrades old backups on import.

The automation engine is pure: it only evaluates rules and returns the actions to run, which keeps it easy to test. The store applies those actions and records when each rule last fired. Fields like `delay` and `workWindow` are already in the schema for when a real job queue exists.

## 🎯 Architecture

- **`domain/types.ts`** - Normalized v2 schema: `Pipeline`, `Stage`, `Deal`, `Contact`, `CustomField`, `Catalog`, `AutomationRule`
- **`domain/automationEngine.ts`** - Pure rule evaluation (conditions with AND/OR logic → fired actions)
- **`domain/migration.ts`** - v1 → v2 data migration
- **`store/useCrmStore.ts`** - Zustand store, persistence and automation tick
- **`lib/throttledStorage.ts`** - Throttled writes to `localStorage`
- **`lib/exportImport.ts`** - JSON backup and restore
- **`components/kanban`** - `Board`, `Column` and `DealCard`
- **`components/deal`** - `DealDrawer` (deal details) and `ImportModal`

## 🚦 Running the Project

1. Clone the repository
2. Install dependencies: `npm install`
3. Run development server: `npm run dev`
4. Open `http://localhost:5173` in your browser

Run the tests with `npm test`.

## 🎞️ Preview

<!-- TODO: add a screenshot or short screen recording of the Kanban board -->
