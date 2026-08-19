import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const css = fs.readFileSync(
  path.join(repoRoot, 'features', 'spark', 'src', 'SparkTaskDetail.css'),
  'utf8',
);

it('matches Gemini Spark focus bloom on the upper task composer', () => {
  assert.match(
    css,
    /\.spark-task-detail__new-composer \.willow-gemini-composer \{[\s\S]*?box-shadow: 0 0 20px 0 rgba\(0, 0, 0, 0\.28\);[\s\S]*?\}/,
    'the upper composer must rest at Gemini Spark elevation level 1',
  );
  assert.match(
    css,
    /@keyframes spark-task-detail-composer-focus-bloom \{[\s\S]*?0% \{[\s\S]*?rgba\(0, 0, 0, 0\.28\)[\s\S]*?20% \{[\s\S]*?rgba\(0, 0, 0, 0\.4\)[\s\S]*?100% \{[\s\S]*?rgba\(0, 0, 0, 0\.28\)/,
    'the bloom must use Gemini Spark elevation levels 1 -> 2 -> 1',
  );
  assert.match(
    css,
    /\.spark-task-detail__new-composer \.willow-gemini-composer:focus-within \{\s*animation: spark-task-detail-composer-focus-bloom 1000ms cubic-bezier\(0, 0, 0, 1\);\s*\}/,
    'the focus trigger, duration and easing must match Gemini Spark',
  );
});
