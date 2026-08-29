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
