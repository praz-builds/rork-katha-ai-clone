/**
 * Guards the generate-story / continue-story request contract.
 *
 * story_mode is the current field; is_series is a legacy compatibility field
 * the backend still maps, but new callers must not depend on it.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const mockInvoke = jest.fn();

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

// jest.mock calls must be evaluated before these imports, so import/first
// cannot be satisfied here.
/* eslint-disable import/first */
import { generateStory, continueStory } from '@/lib/api';
import type { CreateDraft } from '@/types/domain';
/* eslint-enable import/first */

const draft: CreateDraft = {
  primaryGenre: 'fantasy',
  audienceMode: 'adult',
  spiceLevel: 'sweet',
  identityLenses: [],
  tropeModules: [],
  seed: 'Two rival cartographers map the same uncharted valley and find it moves',
  language: 'English',
  characters: [],
};

function bodyOf(call: unknown[]): Record<string, unknown> {
  return (call[1] as { body: Record<string, unknown> }).body;
}

function storyResponse(storyMode: 'standalone' | 'series') {
  return {
    data: {
      story: {
        id: 'story-1',
        title: 'The Moving Valley',
        author_id: 'author-1',
        primary_genre: 'fantasy',
        story_mode: storyMode,
        themes: ['maps'],
        word_count: 12,
        status: 'complete',
      },
      chapter: {
        id: 'chapter-1',
        chapter_number: 1,
        title: 'Chapter 1',
        content: 'The valley had moved again.',
        chapter_role: storyMode === 'series' ? 'series_opening' : 'standalone',
      },
    },
    error: null,
  };
}

beforeEach(() => mockInvoke.mockReset());

describe('generateStory request contract', () => {
  it('sends story_mode "series" when the draft is a series', async () => {
    mockInvoke.mockResolvedValue(storyResponse('series'));
    await generateStory({ ...draft, isSeries: true }, 'req-1');

    const body = bodyOf(mockInvoke.mock.calls[0]);
    expect(body.story_mode).toBe('series');
  });

  it('maps the server story_mode back onto the returned story', async () => {
    mockInvoke.mockResolvedValue(storyResponse('series'));
    const story = await generateStory({ ...draft, isSeries: true }, 'req-1b');

    expect(story.storyMode).toBe('series');
    expect(story.chapters[0].chapterRole).toBe('series_opening');
  });

  it('sends story_mode "standalone" when the draft is not a series', async () => {
    mockInvoke.mockResolvedValue(storyResponse('standalone'));
    await generateStory({ ...draft, isSeries: false }, 'req-2');

    expect(bodyOf(mockInvoke.mock.calls[0]).story_mode).toBe('standalone');
  });

  it('defaults to "standalone" when isSeries is omitted', async () => {
    mockInvoke.mockResolvedValue(storyResponse('standalone'));
    await generateStory(draft, 'req-3');

    expect(bodyOf(mockInvoke.mock.calls[0]).story_mode).toBe('standalone');
  });

  it('does not send the legacy is_series field', async () => {
    mockInvoke.mockResolvedValue(storyResponse('series'));
    await generateStory({ ...draft, isSeries: true }, 'req-4');

    expect(bodyOf(mockInvoke.mock.calls[0])).not.toHaveProperty('is_series');
  });

  it('passes through the request id for idempotent retries', async () => {
    mockInvoke.mockResolvedValue(storyResponse('standalone'));
    await generateStory(draft, 'req-5');

    expect(bodyOf(mockInvoke.mock.calls[0]).request_id).toBe('req-5');
  });
});

describe('continueStory request contract', () => {
  const chapterResponse = {
    data: { chapter: { id: 'c2', chapter_number: 2, content: 'Next.' }, model: 'test' },
    error: null,
  };

  it('sends is_finale true when a finale is requested', async () => {
    mockInvoke.mockResolvedValue(chapterResponse);
    await continueStory('story-1', 'req-6', true, 2);

    const body = bodyOf(mockInvoke.mock.calls[0]);
    expect(body.story_id).toBe('story-1');
    expect(body.is_finale).toBe(true);
  });

  it('sends is_finale false for a mid-series chapter', async () => {
    mockInvoke.mockResolvedValue(chapterResponse);
    await continueStory('story-1', 'req-7', false, 2);

    expect(bodyOf(mockInvoke.mock.calls[0]).is_finale).toBe(false);
  });
});

describe('character payload', () => {
  // The screen used to seed one blank character row and send it verbatim.
  // `validation.ts` rejects any supplied character without a name, so every
  // user who never opened the cast — the common case — got a 400 on the
  // primary path.
  it('drops characters with no name', async () => {
    mockInvoke.mockResolvedValueOnce(storyResponse('standalone'));
    await generateStory(
      {
        ...draft,
        characters: [
          { name: '', description: '', isHero: true },
          { name: '   ', description: 'ghost row', isHero: false },
          { name: 'Elena', description: 'a restorer', isHero: true },
        ],
      },
      'req-characters',
    );
    const characters = bodyOf(mockInvoke.mock.calls[0])
      .characters as { name: string }[];
    expect(characters).toHaveLength(1);
    expect(characters[0].name).toBe('Elena');
  });

  it('sends an empty array when the whole cast is blank', async () => {
    mockInvoke.mockResolvedValueOnce(storyResponse('standalone'));
    await generateStory(
      { ...draft, characters: [{ name: '', description: '', isHero: true }] },
      'req-blank-cast',
    );
    expect(bodyOf(mockInvoke.mock.calls[0]).characters).toEqual([]);
  });

  it('carries background and appearance through to the request', async () => {
    mockInvoke.mockResolvedValueOnce(storyResponse('standalone'));
    await generateStory(
      {
        ...draft,
        characters: [{
          name: 'Elena',
          description: 'a restorer',
          background: 'Has not spoken to her mother in six years.',
          appearance: 'Dark hair pinned up, paint on her hands.',
          isHero: true,
        }],
      },
      'req-rich-character',
    );
    const characters = bodyOf(mockInvoke.mock.calls[0])
      .characters as Record<string, unknown>[];
    expect(characters[0].background).toContain('six years');
    expect(characters[0].appearance).toContain('Dark hair');
  });
});

describe('world and beats fields', () => {
  it('sends where_and_when, moments and chapter_length when set', async () => {
    mockInvoke.mockResolvedValueOnce(storyResponse('standalone'));
    await generateStory(
      {
        ...draft,
        whereAndWhen: 'A hill town, off-season, present day',
        moments: ['She hears her own name through the wall'],
        chapterLength: 'long',
      },
      'req-world',
    );
    const body = bodyOf(mockInvoke.mock.calls[0]);
    expect(body.where_and_when).toBe('A hill town, off-season, present day');
    expect(body.moments).toEqual(['She hears her own name through the wall']);
    expect(body.chapter_length).toBe('long');
  });

  it('omits them as undefined when unset, rather than sending nulls', async () => {
    mockInvoke.mockResolvedValueOnce(storyResponse('standalone'));
    await generateStory(draft, 'req-no-world');
    const body = bodyOf(mockInvoke.mock.calls[0]);
    expect(body.where_and_when).toBeUndefined();
    expect(body.moments).toBeUndefined();
    expect(body.chapter_length).toBeUndefined();
  });
});
