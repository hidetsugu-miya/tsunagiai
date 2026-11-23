// The entry of src/vendor/milkdown.js (A-26): Milkdown with the CommonMark and GFM presets and the history, under one global, `TsunagiaiMilkdown`.
// An editor is read only until `edit` is called on it; the page decides, from `normalize`, whether the text may be edited.
import { defaultValueCtx, Editor, editorViewCtx, editorViewOptionsCtx, rootCtx } from "@milkdown/kit/core";
import { history } from "@milkdown/kit/plugin/history";
import {
  codeBlockSchema,
  commonmark,
  createCodeBlockCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import { gfm, toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { DOMSerializer } from "@milkdown/kit/prose/model";
import { Plugin } from "@milkdown/kit/prose/state";
import { $prose, $view, callCommand, getMarkdown, replaceAll } from "@milkdown/kit/utils";

// The diagram of a `mermaid` code block (A-26): the SVG that Pele draws (the page's `pele` and `DOMPurify`, read before the file is drawn), or null when Pele is not there or cannot draw the text.
// Pele makes no HTML label and no script, and draws with no link and no image; its SVG goes through DOMPurify's SVG profile all the same, as the diagrams of a decision page do (ts/formation-page-blocks.ts).
let drawn = 0;
function draw(source, root) {
  const { pele, DOMPurify } = globalThis;
  if (!pele || !DOMPurify) return null;
  try {
    const { svg, width } = pele.render(source, { fontFamily: getComputedStyle(root).fontFamily, idPrefix: `md-pele-${++drawn}`, links: false, images: false });
    const holder = document.createElement("div");
    holder.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
    const el = holder.querySelector("svg");
    if (!el) return null;
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", "図");
    el.style.maxWidth = `${width}px`;
    return el;
  } catch {
    return null;
  }
}

// The look of a code block, and only that: the document is the same, so the export and the text that is saved are the same. A `mermaid` block shows its diagram in place of its text (the text stays in the block, hidden, and is what the source shows);
// a diagram that cannot be drawn leaves the block as it is for any other language.
const isDiagram = (node) => node.attrs.language === "mermaid";
function diagramView(root) {
  return $view(codeBlockSchema.node, () => (initial) => {
    let node = initial;
    const { dom, contentDOM } = DOMSerializer.renderSpec(document, node.type.spec.toDOM(node));
    const figure = document.createElement("div");
    figure.className = "orca-diagram";
    figure.contentEditable = "false";
    const paint = () => {
      const svg = isDiagram(node) ? draw(node.textContent, root) : null;
      figure.replaceChildren(...(svg ? [svg] : []));
      if (svg) {
        dom.dataset.diagram = "drawn";
        dom.contentEditable = "false";
      } else {
        delete dom.dataset.diagram;
        dom.removeAttribute("contenteditable");
      }
    };
    if (isDiagram(node)) {
      dom.prepend(figure);
      paint();
    }
    return {
      dom,
      contentDOM,
      update: (next) => {
        if (next.type !== node.type || next.attrs.language !== node.attrs.language) return false;
        node = next;
        if (isDiagram(node)) paint();
        return true;
      },
      ignoreMutation: (mutation) => mutation.type !== "selection" && !contentDOM.contains(mutation.target),
    };
  });
}

function make(root, markdown, state, editable = false, diagrams = false) {
  // Tells the page, at once and without the text, that the document changed (the page asks for the text when it needs it).
  const watch = $prose(
    () =>
      new Plugin({
        view: () => ({
          update: (view, previous) => {
            if (!view.state.doc.eq(previous.doc)) state.onEdit?.();
          },
        }),
      }),
  );
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
      ctx.update(editorViewOptionsCtx, (prev) => ({ ...prev, editable: () => editable }));
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(watch);
  // Only the rich view of a file draws diagrams: the second editor of `normalize` is drawn nowhere, and the posting fields (`compose`) show a mermaid block as code.
  if (diagrams) editor.use(diagramView(root));
  return editor.create();
}

// Draws `markdown` in `root`, read only. `markdown()` is what the editor exports now, `edit(onEdit)` makes it editable and calls `onEdit` after each change of the document, and `destroy` takes the editor out of `root`.
export async function mount(root, markdown) {
  const state = { onEdit: null };
  const editor = await make(root, markdown, state, false, true);
  return {
    destroy: () => editor.destroy(),
    markdown: () => editor.action(getMarkdown()),
    edit: (onEdit) => {
      state.onEdit = onEdit;
      editor.action((ctx) => ctx.get(editorViewCtx).setProps({ editable: () => true }));
    },
  };
}

// What an editor exports for `markdown`, drawn nowhere. The page exports the export again, to know that loading and exporting a text twice gives the same text.
export async function normalize(markdown) {
  const editor = await make(document.createElement("div"), markdown, { onEdit: null });
  const exported = editor.action(getMarkdown());
  await editor.destroy();
  return exported;
}

const COMPOSE_COMMANDS = {
  bold: toggleStrongCommand,
  italic: toggleEmphasisCommand,
  strike: toggleStrikethroughCommand,
  link: toggleLinkCommand,
  orderedList: wrapInOrderedListCommand,
  bulletList: wrapInBulletListCommand,
  quote: wrapInBlockquoteCommand,
  code: toggleInlineCodeCommand,
  codeBlock: createCodeBlockCommand,
};

// An editable editor for writing a message (S-21), empty to begin with. `onChange` is called after each change of the document, also one made by `set`.
// `markdown()` is what it exports, `blank()` whether it holds no text but spaces, `set(markdown)` replaces its content, `run(name, payload)` runs one command of the toolbar
// (bold, italic, strike, link with `{href}`, orderedList, bulletList, quote, code, codeBlock) and gives the focus back to the text, `focus()` focuses it, `setEditable(on)` turns the typing on or off, and `destroy` takes the editor out of `root`.
export async function compose(root, onChange) {
  const state = { onEdit: onChange };
  const editor = await make(root, "", state, true);
  const view = () => editor.action((ctx) => ctx.get(editorViewCtx));
  return {
    destroy: () => editor.destroy(),
    markdown: () => editor.action(getMarkdown()),
    blank: () => view().state.doc.textContent.trim() === "",
    set: (markdown) => editor.action(replaceAll(markdown)),
    focus: () => view().focus(),
    setEditable: (on) => view().setProps({ editable: () => on }),
    run: (name, payload) => {
      editor.action(callCommand(COMPOSE_COMMANDS[name].key, payload));
      view().focus();
    },
  };
}
