import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const css = fs.readFileSync(
  path.join(repoRoot, 'features', 'spark', 'src', 'SparkTaskDetail.css'),
  'utf8',
);
const source = fs.readFileSync(
  path.join(repoRoot, 'features', 'spark', 'src', 'SparkTaskDetail.tsx'),
  'utf8',
);

describe('Spark recent-task scroll fade', () => {
  it('uses Gemini Spark\'s 48px variable-driven mask at both scroll edges', () => {
    const rule = css.match(/\.spark-task-detail__recent-list\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const conversationRule = css.match(/\.spark-task-detail__conversation-scroll\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    assert.match(rule, /--fade-progress:\s*0/);
    assert.match(rule, /--fade-bottom:\s*0/);
    assert.match(rule, /--fade-distance:\s*48px/);
    assert.match(rule, /#000 calc\(var\(--fade-progress\) \* var\(--fade-distance\)\)/);
    assert.match(rule, /#000 calc\(100% - var\(--fade-bottom\) \* var\(--fade-distance\)\)/);
    assert.match(conversationRule, /--fade-distance:\s*48px/);
    assert.match(conversationRule, /#000 calc\(var\(--fade-progress\) \* var\(--fade-distance\)\)/);
    assert.match(conversationRule, /#000 calc\(100% - var\(--fade-bottom\) \* var\(--fade-distance\)\)/);
  });

  it('updates the binary top and bottom mask variables from the actual list scroll position', () => {
    assert.match(source, /'--fade-progress', list\.scrollTop > 0 \? '1' : '0'/);
    assert.match(
      source,
      /'--fade-bottom',[\s\S]*?list\.scrollTop \+ list\.clientHeight < list\.scrollHeight \? '1' : '0'/,
    );
    assert.match(source, /ref=\{recentListRef\}/);
    assert.match(source, /onScroll=\{\(event\) => updateScrollFade\(event\.currentTarget\)\}/g);
    assert.match(source, /ref=\{conversationRef\}/);
  });
});
