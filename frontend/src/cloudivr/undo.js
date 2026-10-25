import { toast } from 'sonner';

// Delete with Undo: the item disappears at once, the real delete runs when the toast times out (or the page is
// left). Undo puts it back and nothing is sent to the server.
//   undoable('Preset deleted', { hide, restore, run: () => api(`/x/${id}`, { method: 'DELETE' }) })
const pending = new Set();
const MS = 6000;

export function undoable(message, { hide, restore, run, ms = MS, testid = 'undo-toast', description }) {
  hide();
  let done = false;
  let timer = null;
  const commit = async () => {
    if (done) return;
    done = true; clearTimeout(timer); pending.delete(commit);
    try { await run(); } catch (e) { restore(); toast.error(e.message); }
  };
  pending.add(commit);
  timer = setTimeout(commit, ms);
  toast(message, {
    description,
    duration: ms,
    className: testid,
    action: {
      label: 'Undo',
      onClick: () => {
        if (done) return;
        done = true; clearTimeout(timer); pending.delete(commit);
        restore();
        toast.success('Restored');
      },
    },
  });
}

if (typeof window !== 'undefined') {
  // Closing or reloading the tab finishes waiting deletes (DELETE requests use keepalive, see api.js).
  window.addEventListener('pagehide', () => { [...pending].forEach(c => c()); });
}
