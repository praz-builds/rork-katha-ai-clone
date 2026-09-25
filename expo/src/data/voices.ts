export type VoiceId = 'aria' | 'luna' | 'zara' | 'kai' | 'ravi' | 'leo' | 'elvira' | 'alvaro';
export type VoiceGender = 'female' | 'male';

export type Voice = {
  id: VoiceId;
  name: string;
  gender: VoiceGender;
  description: string;
  personality: string;
  bestFor: string[];
  previewText: string;
};

export const voices: Voice[] = [
  // ── English voices ──────────────────────────────────────────────────────
  {
    id: 'aria',
    name: 'Aria',
    gender: 'female',
    description: 'Warm and gentle',
    personality: 'Like a storyteller by the fireplace',
    bestFor: ['Bedtime Stories', 'Drama', 'Romance', 'Slice of Life'],
    previewText: 'The rain fell softly on the old roof, and somewhere inside, a kettle began to whistle.',
  },
  {
    id: 'luna',
    name: 'Luna',
    gender: 'female',
    description: 'Clear and energetic',
    personality: 'Bright, crisp, pulls you into the action',
    bestFor: ['Adventure', 'Sci-Fi', 'Thriller', 'Mystery'],
    previewText: 'She vaulted the railing and hit the ground running, the city blurring past.',
  },
  {
    id: 'zara',
    name: 'Zara',
    gender: 'female',
    description: 'Rich and poetic',
    personality: 'Deep, contemplative, lingering on every word',
    bestFor: ['Poetry', 'Literary', 'Mythology', 'Spirituality'],
    previewText: 'Between the silence and the stars, she found the word she had been searching for.',
  },
  {
    id: 'kai',
    name: 'Kai',
    gender: 'male',
    description: 'Deep and calm',
    personality: 'Measured, reassuring, draws you in quietly',
    bestFor: ['Mystery', 'Horror', 'Historical', 'Drama'],
    previewText: 'The door had not been there yesterday. He was certain of that much.',
  },
  {
    id: 'ravi',
    name: 'Ravi',
    gender: 'male',
    description: 'Bright and animated',
    personality: 'Lively, expressive, full of character',
    bestFor: ['Comedy', 'All-ages', 'Fantasy', 'Adventure'],
    previewText: 'The dragon sneezed, and three hundred fireflies scattered into the night.',
  },
  {
    id: 'leo',
    name: 'Leo',
    gender: 'male',
    description: 'Smooth and confident',
    personality: 'Cool, steady, like a late-night radio host',
    bestFor: ['Romance', 'Contemporary', 'Motivational', 'Thriller'],
    previewText: 'He set the letter down and smiled. Some things were worth waiting for.',
  },

  // ── Spanish voices ──────────────────────────────────────────────────────
  {
    id: 'elvira',
    name: 'Elvira',
    gender: 'female',
    description: 'Clara y expresiva',
    personality: 'Warm Spanish narrator with clear diction',
    bestFor: ['Drama', 'Romance', 'Bedtime Stories'],
    previewText: 'La lluvia caia suavemente sobre el viejo tejado, y en alguna parte, una tetera comenzo a silbar.',
  },
  {
    id: 'alvaro',
    name: 'Alvaro',
    gender: 'male',
    description: 'Profundo y sereno',
    personality: 'Calm, measured Spanish narrator',
    bestFor: ['Mystery', 'Adventure', 'Historical'],
    previewText: 'La puerta no habia estado alli ayer. De eso estaba seguro.',
  },
];

export const defaultVoiceForGenre = (genre: string): VoiceId => {
  for (const voice of voices) {
    if (voice.bestFor.some(g => g.toLowerCase().replace(/\s+/g, '') === genre.toLowerCase().replace(/\s+/g, ''))) {
      return voice.id;
    }
  }
  return 'aria';
};

export const getVoice = (id: VoiceId): Voice => voices.find(v => v.id === id) ?? voices[0];

/** The two default voices every story gets narrated with at publish time. */
export const DEFAULT_FEMALE_VOICE: VoiceId = 'aria';
export const DEFAULT_MALE_VOICE: VoiceId = 'kai';

/** The two default voices as an array for iteration. */
export const DEFAULT_VOICES: VoiceId[] = [DEFAULT_FEMALE_VOICE, DEFAULT_MALE_VOICE];

/** Default voice pairs per language code (female, male). */
export const DEFAULT_VOICES_BY_LANGUAGE: Record<string, VoiceId[]> = {
  en: ['aria', 'kai'],
  es: ['elvira', 'alvaro'],
};

/** Returns the default voice pair for a given language code. Falls back to English. */
export const getDefaultVoices = (language: string): VoiceId[] =>
  DEFAULT_VOICES_BY_LANGUAGE[language] ?? DEFAULT_VOICES_BY_LANGUAGE['en'];
