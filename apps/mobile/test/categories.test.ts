import { describe, it, expect } from 'vitest';
import { categoryOf, subcategoryOf, subcategoriesFor, RIDESHARE_CATEGORY } from '../src/categories';

// Backs the Category/Subcategory chips on My-posts and deal cards.
describe('categoryOf / subcategoryOf', () => {
  it('rideshare posts are the Ridesharing category with the vehicle as subcategory', () => {
    expect(categoryOf('rideshare', { category: 'Motorbike' })).toBe(RIDESHARE_CATEGORY);
    expect(subcategoryOf('rideshare', { category: 'Motorbike' })).toBe('Motorbike');
  });
  it('service posts read category/subcategory straight from the payload', () => {
    const p = { category: 'Home services', subcategory: 'Plumbing' };
    expect(categoryOf('service.v1', p)).toBe('Home services');
    expect(subcategoryOf('service.v1', p)).toBe('Plumbing');
  });
  it('falls back to "Other" when a service post has no category', () => {
    expect(categoryOf('service.v1', {})).toBe('Other');
  });
  it('subcategoriesFor lists the rideshare vehicle options', () => {
    expect(subcategoriesFor(RIDESHARE_CATEGORY).length).toBeGreaterThan(0);
  });
});
