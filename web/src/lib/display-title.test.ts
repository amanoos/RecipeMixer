import { describe, expect, it } from 'vitest';
import { displayTitle } from './display-title';

describe('displayTitle', () => {
  it('leaves the Chinese name out of a title and tidies the brackets it sat in', () => {
    expect(displayTitle('Braised Pork Belly (Hong Shao Rou/红烧肉), an Easy Version')).toBe(
      'Braised Pork Belly (Hong Shao Rou), an Easy Version',
    );
  });

  it.each([
    ['Chicken Katsu (チキンカツ)', 'Chicken Katsu'],
    ['Bibimbap 비빔밥', 'Bibimbap'],
    ['Pad Thai ผัดไทย', 'Pad Thai'],
    ['Shakshuka شكشوكة', 'Shakshuka'],
    ['Borscht борщ', 'Borscht'],
    ['Dal दाल', 'Dal'],
    ['麻婆豆腐 Mapo Tofu', 'Mapo Tofu'],
    ['Mapo Tofu 麻婆豆腐 (spicy)', 'Mapo Tofu (spicy)'],
    ['Tofu【麻婆豆腐】Stir Fry', 'Tofu Stir Fry'],
    ['Dumplings（饺子）, quick', 'Dumplings, quick'],
    ['Ramen (ラーメン / 拉面)', 'Ramen'],
    ['Congee - 粥', 'Congee'],
  ])('turns %j into %j', (title, expected) => {
    expect(displayTitle(title)).toBe(expected);
  });

  it('keeps accented Latin letters, digits, symbols and emoji', () => {
    for (const title of ['Crème brûlée', 'Jalapeño poppers', 'Smørrebrød', 'Pho 2.0 & more', 'Tacos 🌮 al pastor', 'Œuf à la neige', 'Tacos · al pastor', 'Pho – beef, rare', 'µ-protein bowl', 'Fish & chips (the “proper” way)']) {
      expect(displayTitle(title)).toBe(title);
    }
  });

  it('keeps full-width Latin letters and digits, which are not another script', () => {
    expect(displayTitle('Menu １２３')).toBe('Menu １２３');
  });

  it('returns a title with nothing to remove untouched, including its spacing', () => {
    for (const title of ['Tomato Soup', '  spaced  out  ', 'Mac & Cheese (the easy one)', '']) {
      expect(displayTitle(title)).toBe(title);
    }
  });

  it('shows a title that is entirely in another script as it is, never an empty heading', () => {
    expect(displayTitle('红烧肉')).toBe('红烧肉');
    expect(displayTitle('（红烧肉）')).toBe('（红烧肉）');
    expect(displayTitle('борщ')).toBe('борщ');
  });

  it('is stable: tidying a tidied title changes nothing', () => {
    for (const title of ['Braised Pork Belly (Hong Shao Rou/红烧肉), an Easy Version', 'Ramen (ラーメン / 拉面)', 'A (红) (烧) B']) {
      const once = displayTitle(title);
      expect(displayTitle(once)).toBe(once);
    }
  });

  it('removes nested empty brackets', () => {
    expect(displayTitle('Soup ((汤)) today')).toBe('Soup today');
    expect(displayTitle('Soup [汤] (汤) today')).toBe('Soup today');
  });

  it('never leaves doubled spaces, a space before punctuation or a dangling separator', () => {
    const result = displayTitle('Rice 米饭 , with 鸡 beans 豆 !');
    expect(result).toBe('Rice, with beans!');
    expect(result).not.toMatch(/\s{2,}|\s[,.;:!?)]|^[\s/|·,;:-]|[\s/|·,;:-]$/);
  });

  it('is fast on the longest titles a recipe can have, even full of other scripts', () => {
    const long = '红烧肉 ('.repeat(40) + 'x'.repeat(40);
    const started = Date.now();
    displayTitle(long);
    displayTitle('(/'.repeat(100) + '汤'.repeat(100) + '/)'.repeat(100));
    expect(Date.now() - started).toBeLessThan(200);
  });
});
