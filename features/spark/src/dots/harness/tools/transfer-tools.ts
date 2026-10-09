/**
 * `transfer_file`: a file between the bot's own computer and the user's, as it is — what lets work done on one land
 * on the other (`runtime/transfer.ts`). Offered only when both are there: the bot's computer, and the user's connected.
 *
 * Copying from theirs is looking, and needs no one's go-ahead (secrets stay out of reach). Copying onto theirs makes
 * a new file there — never over one — shown on an edit card; while the user has the bot ask before doing anything,
 * the card proposes it and the copy waits for Apply.
 */
import { getDotThread, appendDotItem } from '../thread/thread-store';
import { copyToTheirs, copyToYours, sizeOf } from '../runtime/transfer';
import type { DotMachineBridge } from '../runtime/machine-bridge';
import { isSecretPath, locatePath, shownPath, type DotComputerEnv } from './computer-tools';
import { MACHINE_WORKSPACE } from './machine-tools';
import { fail, ok, permissionsNow, stringArg, type DotToolEntry } from './tool-env';

export type DotTransferEnv = DotComputerEnv & { machine: { bridge: DotMachineBridge; ready: boolean } };

const SIDES: Record<string, 'yours' | 'theirs'> = {
  yours: 'yours', mine: 'yours', bot: 'yours', own: 'yours', machine: 'yours', 'your computer': 'yours',
  theirs: 'theirs', user: 'theirs', "user's": 'theirs', 'their computer': 'theirs', "the user's computer": 'theirs',
};

/** A path in the bot's folder, as its own computer takes it. */
const ownPath = (raw: string): string | null => {
  const value = raw.trim().replace(/\\/g, '/').replace(/^~\/workspace\/?/, '').replace(/^workspace\//, '');
  if (!value || value.startsWith('/') || value.startsWith('~') || value.split('/').includes('..')) return null;
  return value;
};

const fileName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export const transferTool = (env: DotTransferEnv): DotToolEntry => ({
  doc: {
    name: 'transfer_file',
    args: '{"from": "yours", "path": "reports/summary.pdf", "to": "Downloads/summary.pdf"}',
    description: `Copy a file between your own computer and the user's, as it is — any kind, up to 50 MB. "from" is "yours" or "theirs": "path" is where the file is on that one and "to" where it goes on the other, each as that computer takes paths — in your folder (${MACHINE_WORKSPACE}) on yours, ${env.computer.whole ? 'a full path, or one from their home folder,' : 'relative to the connected folder'} on theirs. It never replaces a file that is already there.${env.permissions === 'ask' ? ' A copy onto their computer reaches them as a card, and lands once they apply it.' : ''}`,
  },
  handler: {
    id: 'transfer_file',
    async run(args, context) {
      const side = SIDES[(stringArg(args, 'from') ?? '').toLowerCase()];
      const path = stringArg(args, 'path');
      const to = stringArg(args, 'to');
      if (!side) return fail('Say "from": "yours" for a file on your own computer, or "theirs" for one on the user\'s.');
      if (!path || !to) return fail('Give "path", where the file is now, and "to", where it goes.');
      if (!env.machine.ready) return fail('Your own computer is not set up yet, so nothing can be copied to or from it.');
      if (getDotThread(env.dotId)?.runtime.computer?.root !== env.computer.root) return fail('The user has disconnected their computer; you can no longer reach it.');

      if (side === 'theirs') {
        const source = locatePath(env.computer, path);
        if (!source || source.path === '.') return fail(`"${path}" is not a file you can reach on their computer.`);
        if (isSecretPath(source.path)) return fail(`${path} looks like it holds secrets, so it stays off limits.`);
        const target = ownPath(to);
        if (!target) return fail('"to" is a path in your folder on your own computer, such as data/report.csv.');
        const outcome = await copyToYours(env.machine.bridge, env.dotId, env.computer.bridge, source, target, context.signal);
        const shown = shownPath(env.computer, source.root, source.path);
        return 'problem' in outcome
          ? fail(`${shown} was not copied: ${outcome.problem}`)
          : ok(`Copied ${shown} from the user's computer to ${target} in your folder (${sizeOf(outcome.bytes)}).`);
      }

      const from = ownPath(path);
      if (!from) return fail('"path" is a file in your folder on your own computer, such as reports/summary.pdf.');
      const target = locatePath(env.computer, to);
      if (!target || target.path === '.') return fail(`"${to}" is not a place you can reach on their computer.`);
      if (isSecretPath(target.path)) return fail(`${to} looks like a place for secrets, so it stays off limits.`);
      const shown = shownPath(env.computer, target.root, target.path);
      const folder = env.computer.whole ? shown.slice(0, Math.max(shown.lastIndexOf('\\'), shown.lastIndexOf('/'))) || target.root : env.computer.root;
      const name = env.computer.whole ? fileName(shown) : target.path;

      if (permissionsNow(env) === 'ask') {
        const item = appendDotItem(env.dotId, {
          kind: 'edit',
          text: name,
          turnId: context.turnId,
          edit: {
            root: folder,
            files: [{ path: name, kind: 'add', added: 0, removed: 0 }],
            proposed: { copy: { from, root: target.root, path: target.path }, scope: { root: env.computer.root, ...(env.computer.whole ? { whole: true } : {}) } },
          },
        });
        return ok(`Asked the user to accept a copy of ${from} at ${shown} (${item.id}). Nothing is there yet: their decision will reach you as an event. Carry on with anything that does not depend on it, or end your turn.`);
      }

      const outcome = await copyToTheirs(env.machine.bridge, env.dotId, env.computer.bridge, from, target, context.signal);
      if ('problem' in outcome) return fail(`${from} was not copied: ${outcome.problem}`);
      const item = appendDotItem(env.dotId, {
        kind: 'edit',
        text: name,
        turnId: context.turnId,
        edit: { root: folder, files: [{ path: name, kind: 'add', added: 0, removed: 0, bytes: outcome.bytes }] },
      });
      return ok(`Copied ${from} from your computer to ${shown} on theirs (${sizeOf(outcome.bytes)}, ${item.id}).`);
    },
  },
});
