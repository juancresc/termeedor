// In-app replacements for the browser's confirm() and alert(). Both return a promise.
// Enter accepts, Esc or a click outside cancels.

import { el } from "./util.js";
import { focusEditor } from "./editor.js";

/** Resolves to true if accepted. `danger` colors the accept button as a warning. */
export function askConfirm({ title, message, acceptLabel = "OK", danger = false, cancelLabel = "Cancel" }) {
  return new Promise((resolve) => {
    const dialog = el("dialog", "askDialog");
    const accept = el("button", `btn ${danger ? "danger" : "primary"}`, acceptLabel);
    accept.autofocus = true;
    accept.onclick = () => dialog.close("accept");

    const actions = el("div", "askActions");
    if (cancelLabel) {
      const cancel = el("button", "btn", cancelLabel);
      cancel.onclick = () => dialog.close();
      actions.append(cancel);
    }
    actions.append(accept);

    dialog.append(el("h3", null, title), ...(message ? [el("p", null, message)] : []), actions);
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); }); // backdrop
    dialog.addEventListener("keydown", (e) => e.stopPropagation()); // no app shortcuts behind it
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (!document.querySelector("dialog[open]")) focusEditor();
      resolve(dialog.returnValue === "accept");
    });

    document.body.append(dialog);
    dialog.showModal();
  });
}

/** Just tells the user something, with a single button. */
export const showNotice = (title, message) => askConfirm({ title, message, cancelLabel: null });
