# Form patterns from the Vice project

MotoGPT currently has no real forms — the record dialogs (`components/log-entry-dialog.tsx`,
`components/setup-vehicle-dialog.tsx`) are a handful of `useState` fields, and the entity
detail pages are a raw JSON editor (`components/json-editor.tsx`). That's deliberate for now,
which is why the `zod` + `react-hook-form` + `@hookform/resolvers` stack and the
`components/app-form.tsx` / `components/ui/form.tsx` pair inherited from Vice were removed as
dead code (commit `7475af1`).

The Vice project (`../vice`) built up a genuinely useful record-editing pattern on that stack,
though. This doc captures what's worth reviving when MotoGPT grows real forms — e.g. proper
edit pages for vehicles/logs to replace the JSON editor, or richer log-entry dialogs.

## Where the code lives

- In this repo's history: `git show 7475af1^:components/app-form.tsx` and
  `git show 7475af1^:components/ui/form.tsx`
- Live and in use in the sibling repo: `../vice/components/app-form.tsx`, with the flagship
  callers at `../vice/app/vice/types/[id]/[[...action]]/page.tsx` (the richest example) and
  `../vice/app/goals/[[...action]]/page.tsx`
- `ui/form.tsx` is the stock shadcn/ui form primitive — it can also be regenerated with
  `npx shadcn@latest add form` rather than restored from history

## The core pattern: record → field map → Form / EditForm

One generic pipeline renders *any* entity record as a detail view or an edit form, without a
per-entity form component:

```
record (from the store)
  → dataToFormFields(record, EntityOptions.fieldDisplayOrder)   // generic map
  → per-page enrichment (types, validation, links, interactivity)
  → <Form fields={...}/>       // read-only detail view
    or
    <EditForm fields={...}/>   // react-hook-form + zod editor
```

`dataToFormFields(data, order)` turns a record into `{ [key]: { label, value } }`, sorted
alphabetically, with the fields named in `order` hoisted to the top. The order array lives on
the entity's `Options` const in `types/*.ts` (`fieldDisplayOrder`), co-located with `lookups`/
`hardDelete` — the same "entity metadata lives next to the type" convention this repo already
uses for the store configs.

Both `Form` (read-only) and `EditForm` (editable) consume the **same fields shape**, so a page
builds the map once and renders either depending on mode.

## The field-enrichment vocabulary

Pages take the generic map and selectively upgrade fields. This is the heart of the pattern —
the base component stays dumb, and each page opts fields into behavior:

```ts
const formFields = dataToFormFields(type, ViceTypeOptions.fieldDisplayOrder);

// render as formatted date instead of epoch millis
formFields.createdAt.datatype = "timestamp";

// editable + validated: presence of `zod` (or `editable: true`) marks a field editable;
// the dynamic schema is built from ONLY those fields
formFields.name.zod = z.string().min(1, "Name is required");
formFields.units.datatype = "number";               // renders <input type="number">
formFields.units.zod = z.coerce.number().positive(); // coerce: HTML inputs yield strings
formFields.description.datatype = "text";            // renders <Textarea>
formFields.description.zod = z.string().optional();

// `value` and `label` accept ReactNodes: link a denormalized name to its entity,
// then drop the raw id field from display
formFields.category.value =
  <Link href={`/vice/categories/${formFields.categoryId.value}`}>{formFields.category.value}</Link>;
delete formFields.categoryId;
```

Fields without `zod`/`editable` still display in `EditForm`, just read-only — so an edit page
shows the full record with only the meaningful fields unlocked. Note the double duty: `zod`
doubles as the "this field is editable" marker. A field can also set `editable: true` without
`zod` and get a default `z.string().min(1, "<label> is required")` validator.

## EditForm ergonomics worth keeping

From `git show 7475af1^:components/app-form.tsx`:

- **Dynamic schema**: `z.object(...)` is assembled at render time from just the editable
  fields, with `zodResolver`. No per-entity schema files.
- **Keyboard**: `Enter` validates (`await form.trigger()`) then submits; `Shift+Enter` inserts
  a newline (textareas); `Escape` cancels. Listener on `document.body`, removed on unmount.
- **Dirty-gated submit**: the submit button is disabled unless `form.formState.isDirty`
  (bypassed when `submitLabel="Add"` for create flows).
- **`disabled` prop** threads through every field and button for the submitting state.
- **`onChange`** (backed by `form.watch()`) lets the page react live to edits. Vice used it
  for a debounced (500ms lodash `debounce`) AI call: type a free-text description → AI
  generates a name + units.
- **Programmatic back-fill**: to push those AI-generated values *into* react-hook-form, the
  page sets `field.value = generated; field.updated = true` and `EditForm`'s effect applies
  `form.setValue(k, v, { shouldValidate: true, shouldDirty: true, shouldTouch: true })`.
  That's the bridge for any "server/AI computes some fields" flow.
- **Interactive labels**: `label` as a ReactNode — Vice made the description label a
  clickable "✨" that triggered the same AI describe on demand.

## The routing convention around it

View/edit/create are one page component using an optional catch-all segment:

```
app/vice/types/[id]/[[...action]]/page.tsx
  /vice/types/abc123        → read-only <Form> + Back/Edit buttons
  /vice/types/abc123/edit   → <EditForm>
  /vice/types/new/add       → <EditForm> for a default record (id === "new" ⇒ isNew)
```

The `add` action additionally chains a follow-up after save ("create the type, then
immediately log an entry against it, then go home") via `{ onSuccess }` callbacks accepted by
the hooks' `add`/`update` mutations — a small hook-API detail worth replicating: MotoGPT's
current hooks return `mutateAsync` (awaitable) which covers the same need differently.

## Rough edges — fix these if reviving, don't copy them

- The zod schema and defaults are rebuilt on **every render**; fine at Vice's scale, but memoize
  (`useMemo` keyed on the editable-field names) if forms get bigger.
- `capitalize(v.label)` in the default validator message breaks when `label` is a ReactNode.
- Several `@ts-ignore`s; the fields map is `any` throughout. A typed `FormField` interface
  (`label`, `value`, `datatype?`, `zod?`, `editable?`, `updated?`) would cost little.
- The `document.body` keydown listener means two mounted EditForms would fight; scope to the
  form element.
- Version drift since removal: the removed code ran zod 3 / @hookform/resolvers 3. Reinstalling
  today means zod 4 (breaking API changes, e.g. error customization) and resolvers 5 — expect
  small adjustments in the dynamic-schema code. react-hook-form current works with React 19.

## When to reach for this vs. what MotoGPT does today

- **Keep plain `useState` dialogs** for 2–4 field quick-capture flows (current log/vehicle
  dialogs) — the pattern above would be overkill.
- **Revive this pattern** when replacing the JSON-editor detail pages with real field-level
  editing, when validation gets non-trivial (numbers, requireds, cross-field), or when an
  AI-assisted "describe it and I'll fill in the fields" flow appears — that's exactly what it
  was built for in Vice.
