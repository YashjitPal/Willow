// Finds React components that call a hook after an early return — the bug that blanked the video
// view: render once down the early return, once past it, and React throws "Rendered more hooks
// than during the previous render". A component here is any function whose name is PascalCase or
// that a PascalCase const holds (React.FC arrows, memo/forwardRef wrappers). Only the component's
// own body counts; hooks in nested functions are another matter.
//   node tools/scratch/hooks-after-return.cjs [dirs...]   (default: apps features platform)
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['apps', 'features', 'platform'];
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'dist', '.git', 'figma'].includes(e.name)) walk(p); }
    else if (/\.tsx$/.test(e.name)) files.push(p);
  }
};
roots.forEach(walk);

const isHookName = (name) => /^use[A-Z0-9]/.test(name);
const isNestedFunction = (n) => ts.isFunctionLike(n) || ts.isClassLike(n);

/** The first hook call inside `node`, not descending into nested functions. */
function hookIn(node) {
  let found = null;
  const visit = (n) => {
    if (found) return;
    if (n !== node && isNestedFunction(n)) return;
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : '';
      if (isHookName(name)) { found = n; return; }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Whether the statement can return from the component (a return not inside a nested function). */
function returnsIn(stmt) {
  let found = false;
  const visit = (n) => {
    if (found || isNestedFunction(n)) return;
    if (ts.isReturnStatement(n)) { found = true; return; }
    ts.forEachChild(n, visit);
  };
  visit(stmt);
  return found;
}

const findings = [];
for (const file of files) {
  const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const check = (name, fn) => {
    if (!fn.body || !ts.isBlock(fn.body)) return;
    const stmts = fn.body.statements;
    let earlyReturn = null;
    for (let i = 0; i < stmts.length; i += 1) {
      const s = stmts[i];
      if (earlyReturn) {
        const hook = hookIn(s);
        if (hook) {
          const at = (n) => src.getLineAndCharacterOfPosition(n.getStart()).line + 1;
          findings.push(`${path.relative(process.cwd(), file)}:${at(hook)}  ${name}: ${hook.expression.getText().slice(0, 40)}() after the return on line ${at(earlyReturn)}`);
          return;
        }
      }
      // The last statement is the normal return, not an early one.
      if (!earlyReturn && i < stmts.length - 1 && returnsIn(s)) earlyReturn = s;
    }
  };
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && /^[A-Z]/.test(n.name.text)) check(n.name.text, n);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && /^[A-Z]/.test(n.name.text) && n.initializer) {
      let init = n.initializer;
      // memo(...) / forwardRef(...) / React.memo(...): the component is the first argument.
      while (ts.isCallExpression(init) && init.arguments[0] && /(^|\.)(memo|forwardRef)$/.test(init.expression.getText())) init = init.arguments[0];
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) check(n.name.text, init);
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
}
console.log(`${files.length} files checked`);
console.log(findings.length ? findings.join('\n') : 'no hook after an early return');
