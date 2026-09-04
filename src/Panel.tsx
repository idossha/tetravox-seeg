/**
 * The sEEG panel — what the module slot renders (ARCHITECTURE.md §13.3).
 *
 * Chrome only, exactly like every §8 panel: it reads `SeegView` through `useSyncExternalStore` and
 * every control is one `model` call, which is one command, which is also one job operation. There is
 * no `useController`, no `useUi` and no `Engine` here, and there cannot be — the module wall forbids
 * the imports that would make it possible.
 *
 * The layout is the design's, top to bottom: the source line, the electrode row (dropdown, count,
 * swatch, snap radius), two rows of buttons, the live shaft numbers, the contact list, and a footer
 * with Undo / Redo / Save / Save as… and the changed count. The whole thing lives inside the slot's
 * `max-h-[55%]` scroller, so the list is what scrolls and the footer is what stays.
 *
 * **Buttons blur on click**, which is not a style choice: the engine's Space-drag pan modifier is a
 * window keydown, so a focused button left focused turns the next Space into a button press
 * (`input/pointer.ts`). Every control here does it, including the ones in the list.
 */

import {
  createElement,
  react,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "@tetravox/module-sdk";
import type { SeegModel, SeegRow, SeegView } from "./editor";

const CHORDS: Record<string, string> = {
  add: "a",
  snap: "s",
  "snap-electrode": "⇧S",
  "flip-tip": "t",
  ghost: "g",
  wire: "d",
  next: "n",
  prev: "p",
  undo: "z",
  redo: "⇧Z",
};

/**
 * The width at which the panel splits into two columns.
 *
 * The docked slot is a 320 px column, so the panel is never wide there and never will be — the
 * threshold is only ever crossed in a popped-out window (§13.10) or, one day, in a resizable aside.
 * 560 px is where the controls stop wrapping into four rows: below it the two-column layout gives
 * the list less room than it takes away from the buttons.
 */
const WIDE_PX = 560;

/**
 * The panel's own measured width.
 *
 * Deliberately **not** `host.ui.placement()`. Where the panel is drawn is not the question the
 * layout has: a popped-out window the user has dragged narrow should get the docked layout back,
 * and a resizable right aside — on the roadmap — would want the wide one without anything being
 * popped out. Measuring answers both, and it degrades to the docked layout in any environment with
 * no `ResizeObserver`.
 */
function useWide(ref: { current: HTMLElement | null }): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (node === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setWide(width >= WIDE_PX);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return wide;
}

function blur(event: React.MouseEvent<HTMLElement>): void {
  event.currentTarget.blur();
}

function millimetres(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)} mm`;
}

function ratio(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(0)} %`;
}

/** The status word. It is the one cell allowed to ellipsis: the name never is. */
function StatusChip({ status }: { status: string }): React.JSX.Element {
  const tone =
    status === "added"
      ? "text-tvx-accent"
      : status === "edited"
        ? "text-tvx-warn"
        : "text-tvx-dim";
  return <span className={`w-12 shrink-0 truncate ${tone}`}>{status}</span>;
}

function ContactRow({
  row,
  model,
}: {
  row: SeegRow;
  model: SeegModel;
}): React.JSX.Element {
  return (
    <li
      data-testid={`seeg-row-${row.name}`}
      data-selected={row.selected}
      data-status={row.status}
      className={`flex items-center gap-1 leading-5 text-[11px] ${row.selected ? "text-tvx-text" : ""}`}
      /*
        The selected row is marked with an inline style, not a utility class: the panel ships as a
        downloadable bundle and Tailwind only compiles the classes it finds in the *app's* sources,
        so a class this file is the sole user of would resolve to nothing in a packaged build. The
        two theme variables are the app's own, so it re-themes with everything else.
      */
      style={
        row.selected
          ? {
              backgroundColor: "var(--color-tvx-accent-surface)",
              boxShadow: "inset 2px 0 0 0 var(--color-tvx-accent)",
              borderRadius: "2px",
            }
          : undefined
      }
    >
      <button
        type="button"
        data-testid={`seeg-select-${row.name}`}
        /*
          `min-w-0 flex-1`, never `w-16 truncate`: a site naming a contact `L-CING-MID01` got
          `L-CING-…` in every row while the column beside it was empty. The name is the row's
          identity — it takes the space the fixed-width cells leave, and `whitespace-nowrap`
          keeps it on one line.
        */
        className={`min-w-0 flex-1 whitespace-nowrap text-left tabular-nums hover:text-tvx-accent ${
          row.selected ? "font-semibold text-tvx-accent-strong" : ""
        }`}
        title={
          row.selected
            ? `${row.name} — the selected contact`
            : row.tip
              ? `${row.name} — this electrode is numbered from here`
              : row.name
        }
        onClick={(event) => {
          blur(event);
          model.jumpTo(row.id);
        }}
      >
        {row.tip ? "▸" : " "}
        {row.name}
      </button>
      <StatusChip status={row.status} />
      <span
        className="w-16 shrink-0 text-right tabular-nums text-tvx-dim"
        title="3-D centre-to-centre distance to the previous contact"
      >
        {millimetres(row.spacingMm)}
      </span>
      <button
        type="button"
        data-testid={`seeg-jump-${row.name}`}
        className="tvx-btn tvx-btn-sm"
        title="Put the crosshair on this contact"
        onClick={(event) => {
          blur(event);
          model.jumpTo(row.id);
        }}
      >
        ↗
      </button>
      <button
        type="button"
        data-testid={`seeg-delete-${row.name}`}
        className="tvx-btn tvx-btn-sm"
        title="Delete this contact"
        onClick={(event) => {
          blur(event);
          model.deleteContact(row.id);
        }}
      >
        ✕
      </button>
    </li>
  );
}

/**
 * The model section — everything the panel says about *which electrode this is*.
 *
 * Kept as its own component rather than four more blocks inside `SeegPanel`, because it is one
 * subject: the model, where it came from, whether the shaft has all its contacts, and every gap
 * measured against the manufacturer's. It renders whether or not a model resolved — with none, it
 * says so and says what happens instead, which is the state a user with no catalogue and no sidecar
 * is permanently in and should not have to guess about.
 *
 * **Every distance here is 3-D**, like every distance this module prints: `measured` is the
 * centre-to-centre distance between two contacts in space, not their separation in the slice.
 */
function ModelSection({
  view,
  model: controller,
}: {
  view: SeegView;
  model: SeegModel;
}): React.JSX.Element {
  const command =
    (id: string) =>
    (event: React.MouseEvent<HTMLElement>): void => {
      blur(event);
      void controller.run(id);
    };
  const model = view.model;
  const incomplete = model !== null && model.present < model.expected;
  // A `sidecar-measured` geometry is this shaft's own median pitch repeated — seegprep's stand-in
  // when *its* catalogue matched nothing — not a manufacturer's vector. It is worth snapping to and
  // worth measuring against, and it must never be read as a datasheet, so it is named as what it is.
  const measured = model?.source === 'sidecar-measured';

  return (
    <div
      data-testid="seeg-model"
      data-model={model?.name ?? ''}
      data-source={model?.source ?? 'none'}
      className="flex flex-col gap-1 border-t border-tvx-line pt-1"
    >
      <div className="flex items-center gap-1.5">
        <span
          data-testid="seeg-model-name"
          className="min-w-0 flex-1 truncate"
          title={
            model === null
              ? 'No geometry sidecar entry, and no model column or part number the catalogue recognises'
              : model.source === 'sidecar'
                ? 'from this subject’s seegprep geometry sidecar'
                : measured
                  ? 'seegprep matched no model either, so this is the shaft’s own measured median ' +
                    'pitch repeated — a nominal to compare against, not a manufacturer’s geometry'
                  : 'from the bundled seegprep catalogue, matched on the part number'
          }
        >
          {model === null ? (
            <span className="text-tvx-dim">no model — gaps are reported against the observed median</span>
          ) : (
            <>
              <span className={measured ? 'text-tvx-warn' : 'text-tvx-text'}>
                {measured ? 'measured pitch' : model.name}
              </span>{' '}
              <span className="text-tvx-dim">· {model.source}</span>
            </>
          )}
        </span>
        {model !== null && (
          <span
            data-testid="seeg-model-count"
            className={`shrink-0 tabular-nums ${incomplete ? 'text-tvx-warn' : 'text-tvx-dim'}`}
            title="contacts present, of the number this model has"
          >
            {model.present} / {model.expected}
          </span>
        )}
        <button
          type="button"
          data-testid="seeg-model-list"
          className="tvx-btn tvx-btn-sm shrink-0"
          title="Read a site electrode list (name, part_number, n_contacts) for its part numbers"
          onClick={(event) => {
            blur(event);
            void controller.loadElectrodeList();
          }}
        >
          List…
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          data-testid="seeg-extend"
          className="tvx-btn"
          disabled={!incomplete}
          title={
            model === null
              ? 'This electrode has no model, so there is no count to extend to'
              : incomplete
                ? `Place the ${model.expected - model.present} missing contacts beyond the entry end at the ${measured ? 'measured' : 'model’s'} spacing (asks first)`
                : 'This electrode already has every contact its model has'
          }
          onClick={command('extend')}
        >
          Extend
        </button>
      </div>

      {model !== null && model.gaps.length > 0 && (
        <table
          data-testid="seeg-model-gaps"
          className="w-full leading-4 tabular-nums"
          /* A real table, not a flex list: the four columns are a small numeric matrix and a
             screen reader reading it as one row of prose would be reading it wrong. */
        >
          <thead className="text-tvx-dim">
            <tr>
              <th className="w-10 text-left font-normal">gap</th>
              <th className="text-right font-normal" title="3-D centre-to-centre distance">
                3-D
              </th>
              <th className="text-right font-normal" title="what this model says the gap is">
                model
              </th>
              <th className="text-right font-normal" title="measured − model">
                Δ
              </th>
            </tr>
          </thead>
          <tbody>
            {model.gaps.map((gap) => (
              <tr
                key={gap.index}
                data-testid={`seeg-gap-${gap.index}`}
                data-flagged={gap.flagged}
                className={gap.flagged ? 'text-tvx-warn' : 'text-tvx-dim'}
              >
                <td className="text-left">
                  {gap.index}–{gap.index + 1}
                </td>
                <td className="text-right">{gap.measuredMm.toFixed(2)}</td>
                <td className="text-right">{gap.modelMm.toFixed(2)}</td>
                <td className="text-right">
                  {gap.residualMm >= 0 ? '+' : '−'}
                  {Math.abs(gap.residualMm).toFixed(2)}
                  {gap.flagged && ' !'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {model !== null && model.flagged > 0 && (
        <p data-testid="seeg-model-flags" className="text-tvx-warn">
          {model.flagged} of {model.gaps.length} gaps are more than 0.75 mm from the model.
        </p>
      )}
    </div>
  );
}

export function SeegPanel({ model }: { model: SeegModel }): React.JSX.Element {
  const view = useSyncExternalStore(model.subscribe, model.state, model.state);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const wide = useWide(rootRef);

  const command =
    (id: string) =>
    (event: React.MouseEvent<HTMLElement>): void => {
      blur(event);
      void model.run(id);
    };

  const label = (id: string, text: string): string => {
    const chord = CHORDS[id];
    return chord === undefined ? text : `${text} (${chord})`;
  };

  // The sketch is drawn in the electrode's own colour — the same one the swatch shows — so it reads
  // as this shaft and not a generic diagram. `currentColor` is the fallback for a set with no colour.
  const shaftColor =
    view.electrodes.find((e) => e.name === view.electrode)?.color ??
    "currentColor";

  return (
    <div
      ref={rootRef}
      data-testid="seeg-panel"
      data-layout={wide ? "wide" : "narrow"}
      className={wide ? "text-[11px]" : "flex flex-col gap-1.5 text-[11px]"}
      /*
        The wide layout is an **inline style**, not a utility class, for the reason the selected row
        below already is: this panel ships as a downloadable bundle and Tailwind compiles only the
        classes it finds in the *app's* sources, so an arbitrary-value class this file is the sole
        user of (`grid-cols-[…]`) resolves to nothing in a packaged build. It silently did: the
        panel reported `data-layout="wide"` and rendered one stacked column.
      */
      style={
        wide
          ? {
              display: "grid",
              // 22rem is what the controls column measures with nothing wrapping to a third row;
              // 19rem wrapped the six edit buttons and pushed the gap table below the fold.
              gridTemplateColumns: "minmax(0, 22rem) minmax(0, 1fr)",
              gap: "0.5rem",
              height: "100%",
              minHeight: 0,
              // Each column scrolls; the window never does. The host's mount is `overflow-y-auto`,
              // so a panel taller than its own box would scroll the whole surface and take the
              // footer and the list header with it.
              overflow: "hidden",
            }
          : undefined
      }
    >
      {/*
        Two columns when there is room, one when there is not — and the narrow case renders
        `display: contents`, so the docked panel's box tree is exactly what it was before §13.10 and
        no golden, no `max-h-[55%]` cap and no existing test moves. Wide, the controls take a fixed
        column and the list takes the rest and scrolls on its own, which is the whole point: a
        fifteen-shaft subject is ~200 rows, and in the slot they are behind one small scroller.
      */}
      <div
        className={wide ? "flex flex-col gap-2" : "contents"}
        // The controls column scrolls on its own: a fifteen-gap model table is taller than any
        // window worth opening, and without this it simply ran off the bottom.
        style={wide ? { minWidth: 0, minHeight: 0, overflowY: "auto" } : undefined}
      >
      {/*
        The source line is also the Inputs step: the manifest's reader only claims a file whose
        basename says `electrodes` / `contacts` / `markups`, and a site exporting `DIXI_locs.csv`
        has no other way in. The `load` command opens the module's own sheet with an All-files
        filter, and without this button nothing could reach it — no key, no menu entry (§13.3 keeps
        module commands out of both).
      */}
      <div className="flex items-center gap-1.5">
        <p
          data-testid="seeg-source"
          className="min-w-0 flex-1 truncate text-tvx-dim"
          title="the files this is editing"
        >
          {view.ctName === null && view.tsvName === null ? (
            "Open a CT and its electrodes table."
          ) : (
            <>
              {view.subject !== null && (
                <span className="text-tvx-text">{view.subject} · </span>
              )}
              {view.ctName ?? "no CT"} · {view.tsvName ?? "no table"}
            </>
          )}
        </p>
        <button
          type="button"
          data-testid="seeg-open"
          className="tvx-btn tvx-btn-sm shrink-0"
          title="Open an electrodes table this module did not claim by name"
          onClick={command("load")}
        >
          Open…
        </button>
      </div>

      {view.banner !== null && (
        <p data-testid="seeg-banner" className="text-tvx-warn">
          {view.banner}
        </p>
      )}
      {view.warning !== null && (
        <p data-testid="seeg-warning" className="text-tvx-warn">
          {view.warning}
        </p>
      )}
      {view.message !== null && (
        <p data-testid="seeg-message" className="text-tvx-dim">
          {view.message}
        </p>
      )}

      <div className="flex items-center gap-1.5">
        <select
          data-testid="seeg-electrode"
          className="tvx-input min-w-0 flex-1"
          value={view.electrode ?? ""}
          disabled={view.electrodes.length === 0}
          onChange={(event) => model.setElectrode(event.target.value)}
        >
          {view.electrodes.length === 0 && (
            <option value="">no electrodes</option>
          )}
          {view.electrodes.map((option) => (
            <option key={option.name} value={option.name}>
              {option.name} ({option.count})
            </option>
          ))}
        </select>
        <span
          data-testid="seeg-swatch"
          className="h-3 w-3 shrink-0 rounded-sm border border-tvx-line"
          style={{
            backgroundColor:
              view.electrodes.find((e) => e.name === view.electrode)?.color ??
              "transparent",
          }}
        />
        <label
          className="flex shrink-0 items-center gap-1 text-tvx-dim"
          title="snap radius"
        >
          r
          <input
            data-testid="seeg-radius"
            type="number"
            className="tvx-input w-14 tabular-nums"
            min={0.5}
            max={5}
            step={0.25}
            value={view.snapRadiusMm}
            onChange={(event) =>
              model.setSnapRadius(Number(event.target.value))
            }
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          data-testid="seeg-add"
          aria-pressed={view.placing}
          className={`tvx-btn ${view.placing ? "tvx-btn-on" : ""}`}
          title={label(
            "add",
            "Every click in a pane drops a contact on this electrode",
          )}
          onClick={command("add")}
        >
          Add
        </button>
        <button
          type="button"
          data-testid="seeg-snap"
          className="tvx-btn"
          disabled={view.selectedId === null}
          title={label(
            "snap",
            "Put the selected contact on its electrode's fitted axis, at the CT peak along it",
          )}
          onClick={command("snap")}
        >
          Snap
        </button>
        <button
          type="button"
          data-testid="seeg-snap-electrode"
          className="tvx-btn"
          title={label(
            "snap-electrode",
            "Put every contact of this electrode on its fitted axis, at the CT peak along it",
          )}
          onClick={command("snap-electrode")}
        >
          Snap elec
        </button>
        <button
          type="button"
          data-testid="seeg-snap-all"
          className="tvx-btn"
          title="Snap every contact of every electrode onto its own shaft axis (asks first)"
          onClick={command("snap-all")}
        >
          Snap all…
        </button>
      </div>

      {/* There is one Snap now; this line is the only way to tell which mode ran. */}
      {view.snapNote !== null && (
        <p data-testid="seeg-snap-mode" className="truncate text-tvx-dim" title={view.snapNote}>
          {view.snapNote}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          data-testid="seeg-renumber"
          className="tvx-btn"
          title="Number this electrode 1…n from the tip, without moving anything"
          onClick={command("renumber")}
        >
          Renumber
        </button>
        <button
          type="button"
          data-testid="seeg-flip-tip"
          className="tvx-btn"
          title={label(
            "flip-tip",
            "Use the other end of this electrode as contact 1",
          )}
          onClick={command("flip-tip")}
        >
          Flip tip
        </button>
        <button
          type="button"
          data-testid="seeg-ghost"
          aria-pressed={view.ghost}
          className={`tvx-btn ${view.ghost ? "tvx-btn-on" : ""}`}
          title={label(
            "ghost",
            "Draw off-slice contacts, so a shaft reads as a shaft",
          )}
          onClick={command("ghost")}
        >
          Ghost
        </button>
        <button
          type="button"
          data-testid="seeg-wire"
          aria-pressed={view.wire}
          className={`tvx-btn ${view.wire ? "tvx-btn-on" : ""}`}
          title={label(
            "wire",
            "Draw the shaft line between consecutive contacts",
          )}
          onClick={command("wire")}
        >
          Wire
        </button>
        <button
          type="button"
          data-testid="seeg-revert"
          className="tvx-btn"
          title="Put every contact back where the table had it"
          onClick={command("revert")}
        >
          Revert
        </button>
        {/*
          Size is a stepper and not a slider: the useful range is ten whole pixels wide, a slider
          would need a label to say which of them it is on, and the gesture a clinician wants is
          "one more" rather than "somewhere around here". It is the one control here that is not a
          command — it changes what is drawn, not what is on disk, so it has no key (§13.5's pool is
          for commands) and `+`/`-` belong to the engine's zoom.
        */}
        <span className="ml-auto flex shrink-0 items-center gap-1 text-tvx-dim">
          <span title="how big a contact is drawn, in pixels">size</span>
          <button
            type="button"
            data-testid="seeg-size-down"
            className="tvx-btn tvx-btn-sm"
            disabled={view.dotRadiusPx <= view.sizeBounds.min}
            title="Smaller contacts"
            onClick={(event) => {
              blur(event);
              model.setSize(view.dotRadiusPx - view.sizeBounds.step);
            }}
          >
            −
          </button>
          <span
            data-testid="seeg-size"
            className="w-4 text-center tabular-nums text-tvx-text"
          >
            {view.dotRadiusPx}
          </span>
          <button
            type="button"
            data-testid="seeg-size-up"
            className="tvx-btn tvx-btn-sm"
            disabled={view.dotRadiusPx >= view.sizeBounds.max}
            title="Bigger contacts"
            onClick={(event) => {
              blur(event);
              model.setSize(view.dotRadiusPx + view.sizeBounds.step);
            }}
          >
            +
          </button>
        </span>
      </div>

      {/* One line, ellipsised: wrapped to three in a narrow window and shoved the diagram down. */}
      <p data-testid="seeg-stats" className="truncate tabular-nums text-tvx-dim">
        {view.stats === null ? (
          "no electrode selected"
        ) : (
          <>
            rms {millimetres(view.stats.rmsMm)} · spacing cv{" "}
            {ratio(view.stats.spacingCv)} · pitch{" "}
            {millimetres(view.stats.pitchMm)}
            {view.tipName !== null && (
              <>
                {" "}
                · tip <span data-testid="seeg-tip">{view.tipName}</span>
              </>
            )}
          </>
        )}
      </p>

      {/*
        The shaft sketch: the selected electrode as a baseline with one dot per contact, contact 1
        (the tip) drawn larger. The geometry is the model's — `shaftDiagram` in `shaft.ts` — and it
        is guarded so a one-contact electrode or an all-identical-position export never yields a
        non-finite coordinate; a bare `(t − min) / span` would feed the SVG an `Infinity` there and
        the browser would log it on every render.
      */}
      {view.diagram !== null && (
        <svg
          data-testid="seeg-diagram"
          className="h-5 w-full"
          viewBox={`0 0 ${view.diagram.width} ${view.diagram.height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="the selected electrode, drawn as a shaft"
        >
          <line
            x1={view.diagram.line.x1}
            y1={view.diagram.line.y1}
            x2={view.diagram.line.x2}
            y2={view.diagram.line.y2}
            stroke={shaftColor}
            strokeWidth={1}
            strokeOpacity={0.5}
          />
          {view.diagram.dots.map((dot, index) => (
            <g key={index}>
              {/* The selected contact gets a halo in the theme's accent, so the sketch, the list
                  and the panes all point at the same dot. */}
              {dot.selected && (
                <circle
                  data-testid="seeg-diagram-selected"
                  cx={dot.cx}
                  cy={dot.cy}
                  r={dot.tip ? 6 : 5}
                  fill="none"
                  stroke="var(--color-tvx-accent)"
                  strokeWidth={1.5}
                />
              )}
              <circle
                cx={dot.cx}
                cy={dot.cy}
                r={dot.tip ? 3 : 2}
                fill={shaftColor}
              />
            </g>
          ))}
        </svg>
      )}

      {/* The model section is its own component and its own block: what electrode this *is* is a
          different subject from where its contacts are, and it renders whether or not one
          resolved. */}
      <ModelSection view={view} model={model} />

      </div>

      <div
        className={wide ? "flex flex-col gap-2" : "contents"}
        style={wide ? { minWidth: 0, minHeight: 0, overflow: "hidden" } : undefined}
      >
      <ul
        data-testid="seeg-list"
        className="flex flex-col gap-0.5"
        style={wide ? { flex: "1 1 0%", minHeight: 0, overflowY: "auto" } : undefined}
      >
        {view.rows.map((row) => (
          <ContactRow key={row.id} row={row} model={model} />
        ))}
      </ul>

      <div className="flex items-center gap-1 border-t border-tvx-line pt-1">
        <button
          type="button"
          data-testid="seeg-undo"
          className="tvx-btn"
          disabled={!view.canUndo}
          title={label("undo", "Undo the last edit")}
          onClick={command("undo")}
        >
          Undo
        </button>
        <button
          type="button"
          data-testid="seeg-redo"
          className="tvx-btn"
          disabled={!view.canRedo}
          title={label("redo", "Redo")}
          onClick={command("redo")}
        >
          Redo
        </button>
        <button
          type="button"
          data-testid="seeg-save"
          className="tvx-btn"
          disabled={view.busy}
          title="Write the table, its backup and its editlog"
          onClick={command("save")}
        >
          Save
        </button>
        <button
          type="button"
          data-testid="seeg-save-as"
          className="tvx-btn"
          disabled={view.busy}
          title="Choose where to write the table"
          onClick={command("save-as")}
        >
          Save as…
        </button>
        <span
          data-testid="seeg-changed"
          className="ml-auto tabular-nums text-tvx-dim"
        >
          {view.dirty && "• "}
          {view.changed} changed
        </span>
      </div>

      <QcExportSheet model={model} />
      </div>
    </div>
  );
}

/**
 * Its own function component rather than more inline JSX because it holds state (`SeegModel` has
 * no view field for "which figures are checked" — that is a form, not editor state, and does not
 * belong in the undo/redo/persisted state every other control here shares).
 */
function QcExportSheet({ model }: { model: SeegModel }): React.JSX.Element {
  const [reslice, setReslice] = useState(true);
  const [implant3d, setImplant3d] = useState(true);
  const [busy, setBusy] = useState(false);
  /** One line per figure: what was written, or why it was not. Never a bare "error" (0.2.1). */
  const [outcomes, setOutcomes] = useState<{ name: string; ok: boolean; detail: string }[]>([]);

  const runExport = (chooseOutput: boolean): void => {
    setBusy(true);
    setOutcomes([]);
    void model
      .exportQc({ reslice, implant3d, chooseOutput })
      .then((results) => {
        setOutcomes(
          Object.entries(results).map(([name, r]) => ({ name, ok: r.ok, detail: r.detail })),
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <div
      data-testid="seeg-qc-export"
      className="flex flex-col gap-1 border-t border-tvx-line pt-1.5"
    >
      <div className="text-tvx-dim">QC export (PDF)</div>
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={reslice}
          onChange={(e: { target: { checked: boolean } }) => setReslice(e.target.checked)}
        />
        Per-electrode reslice — one page each
      </label>
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={implant3d}
          onChange={(e: { target: { checked: boolean } }) => setImplant3d(e.target.checked)}
        />
        3-D implant — four views and a legend
      </label>
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-testid="seeg-qc-export-run"
          className="tvx-btn"
          disabled={busy || (!reslice && !implant3d)}
          onClick={() => runExport(false)}
        >
          Export
        </button>
        <button
          type="button"
          data-testid="seeg-qc-export-choose-folder"
          className="tvx-btn"
          disabled={busy}
          title="Choose where the two PDFs go. Asked once per table otherwise."
          onClick={() => runExport(true)}
        >
          Export to…
        </button>
      </div>
      {outcomes.length > 0 && (
        <ul data-testid="seeg-qc-export-result" className="flex flex-col gap-0.5">
          {outcomes.map((outcome) => (
            <li key={outcome.name} className={outcome.ok ? "text-tvx-dim" : "text-tvx-warn"}>
              {outcome.name}: {outcome.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
