import { describe, it, expect } from 'vitest';
import { areaKey, intentTopics, browseTopic } from '../src/topics';

const loc = (o: Record<string, unknown> = {}): any => ({ country: 'BR', state: '', city: 'Sao Paulo', ...o });

describe('areaKey', () => {
  it('joins country + city, slugged and diacritic-stripped', () => {
    expect(areaKey(loc({ city: 'São Paulo' }))).toBe('br_saopaulo');
  });
  it('falls back to state when there is no city', () => {
    expect(areaKey(loc({ city: '', state: 'Sao Paulo' }))).toBe('br_saopaulo');
  });
  it('uses country alone when no city/state', () => {
    expect(areaKey(loc({ country: 'SG', city: '', state: '' }))).toBe('sg');
  });
  it('is "global" when nothing is set', () => {
    expect(areaKey(loc({ country: '', city: '', state: '' }))).toBe('global');
  });
});

describe('intentTopics', () => {
  const sg = loc({ country: 'SG', city: '', state: '' });
  it('emits area, area_category, area_category_subcategory', () => {
    expect(intentTopics(sg, 'Ridesharing', 'Compact car')).toEqual([
      'sg', 'sg_ridesharing', 'sg_ridesharing_compactcar',
    ]);
  });
  it('omits the subcategory tag when none is given', () => {
    expect(intentTopics(sg, 'Home services')).toEqual(['sg', 'sg_homeservices']);
  });
});

describe('browseTopic', () => {
  const sg = loc({ country: 'SG', city: '', state: '' });
  it('is rideshare-only when services are disabled', () => {
    expect(browseTopic(sg, { servicesEnabled: false, filterCat: 'All', filterSub: null })).toBe('sg_ridesharing');
  });
  it('is the area alone when the category filter is All', () => {
    expect(browseTopic(sg, { servicesEnabled: true, filterCat: 'All', filterSub: null })).toBe('sg');
  });
  it('narrows to category, then to subcategory', () => {
    expect(browseTopic(sg, { servicesEnabled: true, filterCat: 'Home services', filterSub: null })).toBe('sg_homeservices');
    expect(browseTopic(sg, { servicesEnabled: true, filterCat: 'Home services', filterSub: 'Plumbing' })).toBe('sg_homeservices_plumbing');
  });
});
