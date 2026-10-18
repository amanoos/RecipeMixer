/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The component tests run with CSS switched off (so a CSS import is empty), so the stylesheet is read as plain text.
const css = fs.readFileSync(path.resolve(import.meta.dirname, 'index.css'), 'utf8');

const declaration = (name: string): string => {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (!match) throw new Error(`--${name} is not declared`);
  return match[1]!;
};

describe('font stacks', () => {
  it('lists light serif system fonts for Chinese, Japanese and Korean text', () => {
    const cjk = declaration('font-cjk');
    for (const family of ['Songti SC', 'Noto Serif CJK SC', 'SimSun', 'Yu Mincho', 'Batang']) {
      expect(cjk).toContain(`'${family}'`);
    }
  });

  it.each(['font-sans', 'font-heading'])('puts the CJK fonts into --%s, after the Latin fonts', (name) => {
    const stack = declaration(name);
    const cjkAt = stack.indexOf('var(--font-cjk)');
    expect(cjkAt).toBeGreaterThan(stack.indexOf("'Luthon Southard Serif'"));
    expect(cjkAt).toBeGreaterThan(stack.search(/'Fredoka Variable'|'Geist Variable'/));
  });

  it('keeps the script font falling back to the heading stack, which carries the CJK fonts', () => {
    expect(declaration('font-script')).toContain('var(--font-heading)');
  });

  it('keeps a generic family at the end of the body and heading stacks', () => {
    for (const name of ['font-sans', 'font-heading']) expect(declaration(name).trim().endsWith('sans-serif')).toBe(true);
  });
});
