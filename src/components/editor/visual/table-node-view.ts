import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { NodeView } from "@tiptap/pm/view";
import { CellSelection, TableMap, deleteColumn, deleteRow } from "@tiptap/pm/tables";

// A table in the Visual editor: the grid you edit in, rather than the finished thing you read.
//
// The published table is hairlines under each row and a bold header — lovely to read, useless to
// edit, because nothing shows where a cell ends or how to get another row. So the editor draws the
// cell grid (CSS, in platform.css) and this node view hangs the chrome off it: `+` to append a
// column or a row, and a handle per column and per row that selects it, with `✕` to remove the
// selected one. None of it is in the document — the MDX is the same table either way.
//
// PLAIN DOM, not ReactNodeViewRenderer, and not by preference: React's `NodeViewContent` renders
// its own wrapper element around the content hole, and a `<div>` between `<table>` and its `<tr>`s
// is not a table — the rows stop being rows, the columns stop dividing the width, and you get a
// grid that looks nearly right and lays out nothing. (Same reason the task checkbox is plain DOM.)
//
// The handles are positioned by MEASUREMENT: a markdown table's columns size themselves to their
// content, so a strip of evenly-divided buttons above the table would drift out of alignment the
// moment a cell's text changed. A ResizeObserver keeps them honest as you type.

/** Which column/row the current selection covers, if it covers exactly one. */
function selectedBand(
  editor: Editor,
  node: ProseMirrorNode,
  tablePos: number,
): { axis: "col" | "row"; index: number } | null {
  const sel = editor.state.selection;
  if (!(sel instanceof CellSelection)) return null;
  // Not this table — a document can hold several, each with its own node view.
  if (sel.$anchorCell.start(-1) - 1 !== tablePos) return null;
  const map = TableMap.get(node);
  const anchor = map.findCell(sel.$anchorCell.pos - (tablePos + 1));
  const head = map.findCell(sel.$headCell.pos - (tablePos + 1));
  const top = Math.min(anchor.top, head.top);
  const bottom = Math.max(anchor.bottom, head.bottom);
  const left = Math.min(anchor.left, head.left);
  const right = Math.max(anchor.right, head.right);
  if (top === 0 && bottom === map.height && right - left === 1) return { axis: "col", index: left };
  if (left === 0 && right === map.width && bottom - top === 1) return { axis: "row", index: top };
  return null;
}

/**
 * The cell the caret is in, as {row, col} — what the grid highlights so you can see where you are
 * in it. Null when the caret is elsewhere, or when a whole band is selected (that has its own
 * highlight, and outlining one cell of it as well would just be noise).
 */
function activeCell(
  editor: Editor,
  node: ProseMirrorNode,
  tablePos: number,
): { row: number; col: number } | null {
  const sel = editor.state.selection;
  if (sel instanceof CellSelection) return null;
  const $head = sel.$head;
  for (let depth = $head.depth; depth > 0; depth--) {
    const role = $head.node(depth).type.spec.tableRole;
    if (role !== "cell" && role !== "header_cell") continue;
    const offset = $head.before(depth) - (tablePos + 1);
    if (offset < 0) return null;
    try {
      const rect = TableMap.get(node).findCell(offset);
      return { row: rect.top, col: rect.left };
    } catch {
      // The caret is in a cell of a DIFFERENT table — findCell throws rather than answering, so
      // this is the "not mine" branch, not an error worth surfacing.
      return null;
    }
  }
  return null;
}

/** Document positions of the first and last cell of one column/row. */
function bandCells(node: ProseMirrorNode, tablePos: number, axis: "col" | "row", index: number) {
  const map = TableMap.get(node);
  const rect =
    axis === "col"
      ? { left: index, right: index + 1, top: 0, bottom: map.height }
      : { left: 0, right: map.width, top: index, bottom: index + 1 };
  const cells = map.cellsInRect(rect);
  if (!cells.length) return null;
  const start = tablePos + 1; // TableMap positions are relative to the table's content
  return { first: start + cells[0], last: start + cells[cells.length - 1] };
}

export function tableNodeView() {
  return ({
    editor,
    node,
    getPos,
  }: {
    editor: Editor;
    node: ProseMirrorNode;
    getPos: () => number | undefined;
  }): NodeView => {
    let current = node;

    const dom = document.createElement("div");
    dom.className = "pv-table-block";

    const scroll = document.createElement("div");
    scroll.className = "pv-table-scroll";

    const table = document.createElement("table");
    const tbody = document.createElement("tbody");
    table.append(tbody);
    scroll.append(table);

    // Chrome. contentEditable=false keeps ProseMirror from reading clicks and keystrokes in here
    // as edits to the document.
    const grips = document.createElement("div");
    grips.className = "pv-table-grips";
    grips.contentEditable = "false";

    const addCol = chromeButton("pv-table-add pv-table-add-col", "Add column");
    const addRow = chromeButton("pv-table-add pv-table-add-row", "Add row");
    addCol.append(tip("column", "columns"));
    addRow.append(tip("row", "rows"));

    // One grid: the table, the column control down its right side, the row control across its
    // bottom — so each control is exactly as long as the edge it adds to (see platform.css).
    scroll.append(grips);
    dom.append(scroll, addCol, addRow);

    const tablePos = () => getPos();

    /** Put the caret in the last cell of the far column/row, then add after it. */
    const append = (axis: "col" | "row") => {
      const pos = tablePos();
      if (pos === undefined) return;
      const map = TableMap.get(current);
      const cells = bandCells(current, pos, axis, axis === "col" ? map.width - 1 : map.height - 1);
      if (!cells) return;
      const chain = editor.chain().focus().setTextSelection(cells.last + 1);
      (axis === "col" ? chain.addColumnAfter() : chain.addRowAfter()).run();
    };
    addCol.addEventListener("click", () => append("col"));
    addRow.addEventListener("click", () => append("row"));

    const select = (axis: "col" | "row", index: number) => {
      const pos = tablePos();
      if (pos === undefined) return;
      const cells = bandCells(current, pos, axis, index);
      if (!cells) return;
      const { doc, tr } = editor.state;
      const selection =
        axis === "col"
          ? CellSelection.colSelection(doc.resolve(cells.first), doc.resolve(cells.last))
          : CellSelection.rowSelection(doc.resolve(cells.first), doc.resolve(cells.last));
      editor.view.dispatch(tr.setSelection(selection));
      editor.view.focus();
    };

    const remove = (axis: "col" | "row", index: number) => {
      select(axis, index); // the delete commands act on the selection, so set it first
      (axis === "col" ? deleteColumn : deleteRow)(editor.state, editor.view.dispatch);
      editor.view.focus();
    };

    /**
     * Drag the `+` to resize the table by more than one at a time: pull away from the table to add,
     * back over it to remove. The unit is the last band's own size, so the table grows exactly as
     * far as you've dragged rather than at some invented rate.
     *
     * A drag is only meaningful because the click already works — pointerdown doesn't commit
     * anything, and if the pointer never moves a whole band the click handler does its usual job.
     */
    const dragToResize = (axis: "col" | "row", button: HTMLElement) => {
      button.addEventListener("pointerdown", (event: PointerEvent) => {
        if (event.button !== 0 || tablePos() === undefined) return;
        const lastRow = tbody.rows[tbody.rows.length - 1];
        const unit =
          axis === "col"
            ? lastRow?.children[lastRow.children.length - 1]?.getBoundingClientRect().width
            : lastRow?.getBoundingClientRect().height;
        if (!unit) return;

        const from = axis === "col" ? event.clientX : event.clientY;
        let applied = 0; // bands added (+) or removed (−) so far in this drag
        button.setPointerCapture(event.pointerId);

        const onMove = (move: PointerEvent) => {
          const moved = (axis === "col" ? move.clientX : move.clientY) - from;
          const want = Math.round(moved / unit);
          while (applied < want) {
            append(axis);
            applied += 1;
          }
          while (applied > want) {
            const map = TableMap.get(current);
            const count = axis === "col" ? map.width : map.height;
            // Never drag a table out of existence: a header row and one column are the least it
            // can be and still be a table. Deleting it outright is the drag handle's job.
            if (count <= 1) break;
            remove(axis, count - 1);
            applied -= 1;
          }
        };

        const onUp = () => {
          button.removeEventListener("pointermove", onMove);
          button.removeEventListener("pointerup", onUp);
          button.removeEventListener("pointercancel", onUp);
          // A drag ends in a click event too; swallow that one so it doesn't add one more.
          if (applied !== 0) {
            button.addEventListener("click", (click) => click.stopImmediatePropagation(), {
              capture: true,
              once: true,
            });
          }
        };

        button.addEventListener("pointermove", onMove);
        button.addEventListener("pointerup", onUp);
        button.addEventListener("pointercancel", onUp);
      });
    };
    dragToResize("col", addCol);
    dragToResize("row", addRow);

    /** Rebuild the handles from the table's real geometry. */
    const render = () => {
      const pos = tablePos();
      const firstRow = tbody.querySelector("tr");
      if (!firstRow) {
        grips.replaceChildren();
        return;
      }
      const base = table.getBoundingClientRect();
      const band = pos === undefined ? null : selectedBand(editor, current, pos);
      const active = pos === undefined ? null : activeCell(editor, current, pos);
      const next: HTMLElement[] = [];

      [...firstRow.children].forEach((cell, i) => {
        const r = cell.getBoundingClientRect();
        next.push(
          grip("col", i, r.left - base.left, r.width, {
            selected: band?.axis === "col" && band.index === i,
            active: active?.col === i,
          }),
        );
      });
      [...tbody.querySelectorAll("tr")].forEach((row, i) => {
        const r = row.getBoundingClientRect();
        next.push(
          grip("row", i, r.top - base.top, r.height, {
            selected: band?.axis === "row" && band.index === i,
            active: active?.row === i,
          }),
        );
      });

      // The caret's own cell, outlined. Drawn as an overlay rather than a class on the <td>,
      // because the cells are ProseMirror's — mutating them is an edit as far as it's concerned,
      // and this is chrome.
      const cell = active && tbody.rows[active.row]?.children[active.col];
      if (cell) {
        const r = cell.getBoundingClientRect();
        const box = document.createElement("span");
        box.className = "pv-table-active-cell";
        box.style.left = `${r.left - base.left}px`;
        box.style.top = `${r.top - base.top}px`;
        box.style.width = `${r.width}px`;
        box.style.height = `${r.height}px`;
        next.push(box);
      }
      grips.replaceChildren(...next);
    };

    function grip(
      axis: "col" | "row",
      index: number,
      start: number,
      size: number,
      state: { selected: boolean; active: boolean },
    ): HTMLElement {
      const { selected: isSelected } = state;
      const wrap = document.createElement("span");
      wrap.className = `pv-table-grip pv-table-grip-${axis}`;
      if (axis === "col") {
        wrap.style.left = `${start}px`;
        wrap.style.width = `${size}px`;
      } else {
        wrap.style.top = `${start}px`;
        wrap.style.height = `${size}px`;
      }

      const label = `${axis === "col" ? "column" : "row"} ${index + 1}`;
      const bar = chromeButton("pv-table-grip-bar", `Select ${label}`);
      bar.dataset.selected = String(isSelected);
      // Lit, but softer than selected: this is the band the caret is in, which is a "you are here",
      // not a thing you've picked out to act on.
      bar.dataset.active = String(state.active);
      bar.addEventListener("click", () => select(axis, index));
      wrap.append(bar);

      // The ✕ exists only once its band is selected, so it can sit ON the handle without crowding
      // a table you're only typing in.
      if (isSelected) {
        const kill = chromeButton("pv-table-grip-remove", `Delete ${label}`);
        kill.textContent = "✕";
        kill.addEventListener("click", () => remove(axis, index));
        wrap.append(kill);
      }
      return wrap;
    }

    // Re-measure when the table's own box changes (typing widens a column, a row wraps).
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => render());
    observer?.observe(table);
    // …and when the selection changes, which is what makes a handle show its ✕.
    editor.on("selectionUpdate", render);
    requestAnimationFrame(render);

    return {
      dom,
      contentDOM: tbody,
      update(updated) {
        if (updated.type !== current.type) return false;
        current = updated;
        render();
        return true;
      },
      // Everything outside the content hole is chrome we own: without this, ProseMirror reads the
      // handles being rebuilt as a document edit and re-parses the table on every measurement.
      ignoreMutation(mutation) {
        return !tbody.contains(mutation.target) || mutation.target === tbody;
      },
      destroy() {
        observer?.disconnect();
        editor.off("selectionUpdate", render);
      },
    };
  };
}

/**
 * The hint under (or beside) a `+`. Both of its gestures are worth saying out loud: the click is
 * discoverable from the icon, the drag is not, and a control that quietly does more than it looks
 * like it does may as well not.
 */
function tip(one: string, many: string): HTMLElement {
  const panel = document.createElement("span");
  panel.className = "pv-table-tip";
  // aria-hidden: the button's own accessible name already says what it does, and a tooltip that
  // duplicates it just makes a screen reader say everything twice.
  panel.setAttribute("aria-hidden", "true");
  panel.append(line("Click", ` to add a new ${one}`), line("Drag", ` to add or remove ${many}`));
  return panel;
}

function line(verb: string, rest: string): HTMLElement {
  const row = document.createElement("span");
  const strong = document.createElement("strong");
  strong.textContent = verb;
  row.append(strong, rest);
  return row;
}

function chromeButton(className: string, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.contentEditable = "false";
  // Keep the press from moving the selection out of the table before the click runs.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  return button;
}
