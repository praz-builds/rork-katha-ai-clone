import { genres, stories, authors, authorFor, ledger } from '@/data/seed';
import { GENRES } from '@/types/domain';

describe('seed data', () => {
  it('genres list matches GENRES const', () => {
    for (const g of genres) {
      expect(GENRES).toContain(g);
    }
  });

  it('every story has required fields', () => {
    for (const story of stories) {
      expect(story.id).toBeTruthy();
      expect(story.title).toBeTruthy();
      expect(story.authorId).toBeTruthy();
      expect(GENRES).toContain(story.genre);
      expect(story.chapters.length).toBeGreaterThan(0);
    }
  });

  it('every story chapter has paragraphs', () => {
    for (const story of stories) {
      for (const ch of story.chapters) {
        expect(ch.paragraphs.length).toBeGreaterThan(0);
      }
    }
  });

  it('authorFor resolves all story authors', () => {
    for (const story of stories) {
      const author = authorFor(story.authorId);
      expect(author).toBeDefined();
      expect(author.id).toBe(story.authorId);
    }
  });

  it('authors have valid data', () => {
    for (const author of authors) {
      expect(author.id).toBeTruthy();
      expect(author.displayName).toBeTruthy();
      expect(typeof author.followers).toBe('number');
    }
  });

  it('ledger entries have valid structure', () => {
    for (const entry of ledger) {
      expect(entry.id).toBeTruthy();
      expect(typeof entry.amount).toBe('number');
      expect(entry.reason).toBeTruthy();
      expect(typeof entry.balanceAfter).toBe('number');
    }
  });
});
