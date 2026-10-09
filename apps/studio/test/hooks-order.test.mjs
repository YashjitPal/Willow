/**
 * No React component may call a hook after an early return.
 *
 * Rendered once down the early return and once past it, the component calls a different number of
 * hooks, and React throws "Rendered more hooks than during the previous render". The video view
 * did exactly that — its scene is built after the view first renders — and with no error boundary
 * above it the throw unmounted the whole app and left the window black. It typechecks fine, so
 * this reads every component instead.
 *
 * A component is a function named in PascalCase, or one a PascalCase const holds (including through
 * memo/forwardRef). Only its own body counts: hooks inside nested functions are not checked here.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function componentFiles() {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        // features/figma is the unfinished prototype the typecheck skips too.
        if (!['node_modules', 'dist', '.git'].includes(e.name) && p !== join(root, 'features', 'figma')) walk(p);
      } else if (e.name.endsWith('.tsx')) files.push(p);
    }
  };
  for (const top of ['apps', 'features', 'platform']) walk(join(root, top));
  return files;
}

const nested = (n) => ts.isFunctionLike(n) || ts.isClassLike(n);

function firstHook(node) {
  let found = null;
  const visit = (n) => {
    if (found || (n !== node && nested(n))) return;
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : '';
      if (/^use[A-Z0-9]/.test(name)) { found = n; return; }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function canReturn(stmt) {
  let found = false;
  const visit = (n) => {
    if (found || nested(n)) return;
    if (ts.isReturnStatement(n)) { found = true; return; }
    ts.forEachChild(n, visit);
  };
  visit(stmt);
  return found;
}

test('no component calls a hook after an early return', () => {
  const findings = [];
  for (const file of componentFiles()) {
    const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const line = (n) => src.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    const check = (name, fn) => {
      if (!fn.body || !ts.isBlock(fn.body)) return;
      const stmts = fn.body.statements;
      let early = null;
      for (let i = 0; i < stmts.length; i += 1) {
        const hook = early && firstHook(stmts[i]);
        if (hook) {
          findings.push(`${relative(root, file)}:${line(hook)} ${name} calls ${hook.expression.getText()}() after the return on line ${line(early)}`);
          return;
        }
        if (!early && i < stmts.length - 1 && canReturn(stmts[i])) early = stmts[i];
      }
    };
    const visit = (n) => {
      if (ts.isFunctionDeclaration(n) && n.name && /^[A-Z]/.test(n.name.text)) check(n.name.text, n);
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && /^[A-Z]/.test(n.name.text) && n.initializer) {
        let init = n.initializer;
        while (ts.isCallExpression(init) && init.arguments[0] && /(^|\.)(memo|forwardRef)$/.test(init.expression.getText())) init = init.arguments[0];
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) check(n.name.text, init);
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  assert.deepEqual(findings, []);
});
