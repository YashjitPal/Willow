"""Send the notebook hand-off into a SETTLED ChatView, not during its mount."""

# ── App: set the handoff only after the view change has resolved ──────────────
PA = 'apps/studio/src/app/App.tsx'
a = open(PA, encoding='utf8', newline='').read()
NLA = '\r\n' if '\r\n' in a else '\n'


def fixa(s):
    return s.replace('\n', NLA)


old_a = """  const sendFromNotebook = React.useCallback(async (notebook: Notebook, prompt: string) => {
    if (!prompt.trim()) return;
    startNotebookChat(notebook, prompt);
    handleNewChat();
    await handleViewChange('home');
  }, [handleViewChange]);"""

new_a = """  const sendFromNotebook = React.useCallback(async (notebook: Notebook, prompt: string) => {
    if (!prompt.trim()) return;
    /*
     * ORDER MATTERS: reset and navigate FIRST, publish the handoff LAST.
     *
     * Setting it before the view change meant `ChatView` read it inside its own
     * mount, i.e. it started a turn while the surface was still coming up. The
     * turn then never finalised — the thinking indicator span forever, no error,
     * no reply, even though the request had already failed upstream. Publishing
     * after `handleViewChange` resolves means the handoff lands on a mounted,
     * settled ChatView, which is exactly the state a user typing into it is in.
     */
    handleNewChat();
    await handleViewChange('home');
    startNotebookChat(notebook, prompt);
  }, [handleViewChange]);"""

o = fixa(old_a)
assert o in a, 'MISS: sendFromNotebook'
open(PA, 'w', encoding='utf8', newline='').write(a.replace(o, fixa(new_a), 1))
print('ok   App: handoff published after navigation')

# ── ChatView: react to the handoff atom instead of reading once at mount ──────
PC = 'features/chat/src/ChatView.tsx'
c = open(PC, encoding='utf8', newline='').read()
NLC = '\r\n' if '\r\n' in c else '\n'


def fixc(s):
    return s.replace('\n', NLC)


old_imp = """import {
  $chatNotebookId,
  consumeNotebookHandoff,
  getActiveNotebookGrounding,
} from '@willow/notebooks/notebook-chat-store';"""
new_imp = """import {
  $chatNotebookId,
  $notebookHandoff,
  consumeNotebookHandoff,
  getActiveNotebookGrounding,
} from '@willow/notebooks/notebook-chat-store';"""
o = fixc(old_imp)
assert o in c, 'MISS: chatview imports'
c = c.replace(o, fixc(new_imp), 1)

old_eff = """  useEffect(() => {
    if (!isAuthenticated) return;
    const handoff = consumeNotebookHandoff();
    if (!handoff) return;
    void handleSend(handoff.prompt);
  }, [isAuthenticated, handleSend]);"""

new_eff = """  const pendingNotebookHandoff = useStore($notebookHandoff);
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!pendingNotebookHandoff || pendingNotebookHandoff.consumed) return;
    const handoff = consumeNotebookHandoff();
    if (!handoff) return;
    void handleSend(handoff.prompt);
  }, [pendingNotebookHandoff, isAuthenticated, handleSend]);"""

o = fixc(old_eff)
assert o in c, 'MISS: handoff effect'
c = c.replace(o, fixc(new_eff), 1)
open(PC, 'w', encoding='utf8', newline='').write(c)
print('ok   ChatView: handoff consumed reactively')
