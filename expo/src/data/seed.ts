import type { Author, CreditLedgerEntry, Genre, Story } from "@/types/domain";

export const genres: Genre[] = [
  "romance",
  "fantasy",
  "romantasy",
  "mystery",
  "thriller",
  "horror",
  "scifi",
  "adventure",
  "historical",
  "darkAcademia",
  "drama",
  "sliceOfLife",
  "mythology",
  "poetry",
  "comedy",
  "bedtime"
];

export const authors: Author[] = [
  {
    id: "kathaai",
    username: "kathaai",
    displayName: "Katha AI",
    bio: "The house account. Curated tales spun with care. Follow us for the best of Katha, weekly.",
    followers: 48200,
    followingCount: 0,
    storyCount: 30,
    isVerified: true,
    avatarPaletteIndex: 0
  },
  {
    id: "aarav",
    username: "aarav",
    displayName: "Aarav Menon",
    bio: "Writing stories about the small moments that shape a life. Based in Mumbai.",
    followers: 12,
    followingCount: 4,
    storyCount: 4,
    isVerified: false,
    avatarPaletteIndex: 1
  },
  {
    id: "zoeok",
    username: "zoeok",
    displayName: "Zoe Okonkwo",
    bio: "Afrofuturism, thrillers, and everything in between.",
    followers: 15000,
    followingCount: 200,
    storyCount: 5,
    isVerified: false,
    avatarPaletteIndex: 2
  },
  {
    id: "priyanair",
    username: "priyanair",
    displayName: "Priya Nair",
    bio: "Mythology-tinted fantasy from Kerala. New chapter every Sunday morning.",
    followers: 8900,
    followingCount: 120,
    storyCount: 3,
    isVerified: false,
    avatarPaletteIndex: 3
  },
  {
    id: "mayak",
    username: "mayak",
    displayName: "Maya Kapoor",
    bio: "Contemporary romance and second-chance stories.",
    followers: 3400,
    followingCount: 89,
    storyCount: 6,
    isVerified: false,
    avatarPaletteIndex: 4
  },
  {
    id: "rentakahashi",
    username: "rentakahashi",
    displayName: "Ren Takahashi",
    bio: "Slow-burn sci-fi. Occasional horror. Tokyo native, night-shift writer.",
    followers: 1200,
    followingCount: 45,
    storyCount: 5,
    isVerified: false,
    avatarPaletteIndex: 5
  }
];

export const stories: Story[] = [
  {
    id: "story-1",
    title: "The Last Lighthouse Keeper",
    authorId: "aarav",
    genre: "adventure",
    synopsis: "A lighthouse keeper receives a letter from the future warning of a storm that has not happened yet.",
    likes: 1840,
    bookmarks: 620,
    views: 12400,
    tags: ["atmospheric", "time", "coastal"],
    publishedOffset: 2,
    isFeatured: true,
    language: "English",
    coverImage: "old-sea-boat.jpg",
    chapters: [
      {
        id: "s1c1",
        storyId: "story-1",
        title: "The Letter",
        chapterNumber: 1,
        isPublished: true,
        audioUrl: "https://d2h7xmz5gqybh9.cloudfront.net/predictions/4df808e2a4ce425caadd22b4af8c3784/1.mp3",
        audioUrls: {
          female: "https://d2h7xmz5gqybh9.cloudfront.net/predictions/4df808e2a4ce425caadd22b4af8c3784/1.mp3",
          male: "https://d2h7xmz5gqybh9.cloudfront.net/predictions/aea2a9072a1649588f4625d3e32491a8/1.mp3",
        },
        paragraphs: [
          "The bottle washed ashore on a Tuesday, green glass worn smooth by decades of salt and current. Tom Hardy had kept the lighthouse at Pemaquid Point for thirty-one years, and in that time he had found many things on the beach. But never a bottle with a letter inside.",
          "The paper was thick, hand-pressed, and the handwriting was precise, almost mechanical. Dear Keeper, it began. By the time you read this, the light will have failed. I am writing from the future. The lighthouse fell in the storm of seventy-eight. I am asking you to prevent it.",
          "Tom read it three times, then set it on the kitchen table and watched it curl in the lamplight. The storm was twenty-six years away. The light still turned every night, sweeping its beam across the dark water like a slow, patient hand."
        ]
      },
      {
        id: "s1c2",
        storyId: "story-1",
        title: "The Storm",
        chapterNumber: 2,
        isPublished: true,
        paragraphs: [
          "The storm came three weeks after the letter. Tom had weathered a hundred storms, but this one was different. The wind did not howl. It whispered, and in the whispering he heard words he could not quite make out.",
          "At midnight, the light failed. Tom grabbed the backup lamp and climbed the spiral stairs, his knees protesting every step. At the top, the lens was dark.",
          "He replaced the bulb. The new one lit, turned, swept the sea. Far out on the water, he saw a ship with wooden masts and canvas sails. On its deck, waving a lantern, stood a man who looked exactly like Tom."
        ]
      }
    ]
  },
  {
    id: "story-2",
    title: "Midnight in Marrakech",
    authorId: "zoeok",
    genre: "mystery",
    synopsis: "A traveler vanishes from a Marrakech hotel. Her sister follows clues into the ancient medina.",
    likes: 2610,
    bookmarks: 890,
    views: 18900,
    tags: ["travel", "noir", "atmospheric"],
    publishedOffset: 5,
    isFeatured: true,
    language: "English",
    coverImage: "midnight-chai-case-files.jpg",
    chapters: [
      {
        id: "s2c1",
        storyId: "story-2",
        title: "The Disappearance",
        chapterNumber: 1,
        isPublished: true,
        paragraphs: [
          "Claire Forrest checked into the Riad el Fenn at four in the afternoon. By midnight, she was gone. The receptionist insisted she had never arrived. But her suitcase sat in Room 7, zipped shut, the bed still made.",
          "The police took notes, shrugged, and suggested Claire might have wandered into the medina. People did, sometimes. The medina was a labyrinth: nine thousand alleys, most of them unlit.",
          "But Claire's sister Maya knew better. Claire spoke Arabic. Claire had been to Marrakech before. Claire did not get lost."
        ]
      }
    ]
  },
  {
    id: "story-3",
    title: "Letters to the Sea",
    authorId: "priyanair",
    genre: "drama",
    synopsis: "For eleven years, a mother writes letters to the ocean. One day, the ocean writes back.",
    likes: 160,
    bookmarks: 80,
    views: 1300,
    tags: ["grief", "ocean", "letters"],
    publishedOffset: 8,
    isFeatured: false,
    language: "English",
    coverImage: "girl-beneath-the-sea.jpg",
    chapters: [
      {
        id: "s3c1",
        storyId: "story-3",
        title: "The First Letter",
        chapterNumber: 1,
        isPublished: true,
        paragraphs: [
          "Every morning, Amma walked to the pier with a letter folded in her sari. She had been doing this for eleven years, since the day her son's ship failed to return.",
          "One morning, the bottle came back. Not the same bottle. This one was dark glass, sealed with wax. Inside was a letter in handwriting she did not recognize.",
          "Dear Mother, it said. The sea kept your letters. It asked me to answer them."
        ]
      }
    ]
  },
  {
    id: "story-4",
    title: "The Quantum Garden",
    authorId: "rentakahashi",
    genre: "scifi",
    synopsis: "A scientist grows the first plant that exists on probability. It does not stay in the lab.",
    likes: 1980,
    bookmarks: 730,
    views: 14600,
    tags: ["science", "first contact", "wonder"],
    publishedOffset: 1,
    isFeatured: true,
    language: "English",
    coverImage: "garden-of-little-dragons.jpg",
    chapters: [
      {
        id: "s4c1",
        storyId: "story-4",
        title: "The First Bloom",
        chapterNumber: 1,
        isPublished: true,
        paragraphs: [
          "Dr. Yuki Tanaka grew the first impossible plant in a basement lab at Kyoto University. It was a rose, but not quite. The petals shimmered between colors that should not exist together.",
          "The rose grew without soil, without water, without light. It grew on probability. By the fifth day, the seed had fallen from its stalk and landed in a crack in the concrete floor.",
          "By the seventh, a vine was growing through the crack, reaching for the ceiling with alarming speed."
        ]
      }
    ]
  },
  {
    id: "story-5",
    title: "The Weaver's Daughter",
    authorId: "mayak",
    genre: "fantasy",
    synopsis: "A girl who can weave moonlight into thread is summoned by a king who wants an invincible banner.",
    likes: 2800,
    bookmarks: 1100,
    views: 22100,
    tags: ["folk tale", "magic", "moonlight"],
    publishedOffset: 3,
    isFeatured: true,
    language: "English",
    coverImage: "maharanis-last-cipher.jpg",
    chapters: [
      {
        id: "s5c1",
        storyId: "story-5",
        title: "Moonlight Thread",
        chapterNumber: 1,
        isPublished: true,
        paragraphs: [
          "In the village of Thimphu, there lived a weaver who could spin moonlight into thread. Her name was Pema, and every full moon she sat at her loom in the courtyard and wove.",
          "The moonlight came to her fingers like silk, strand by strand. What she wove was always different: a cloak, a blanket, a banner.",
          "What people did not know was that each weaving was a promise. The banner would protect an entire kingdom from harm, but only if the kingdom deserved it."
        ]
      }
    ]
  },
  {
    id: "story-6",
    title: "Whispers in the Old House",
    authorId: "zoeok",
    genre: "horror",
    synopsis: "A couple moves into a cheap house. The walls whisper their names.",
    likes: 120,
    bookmarks: 60,
    views: 950,
    tags: ["supernatural", "suspense", "dark"],
    publishedOffset: 4,
    isFeatured: false,
    language: "English",
    coverImage: "ravenwick-owl-window.jpg",
    chapters: [
      {
        id: "s6c1",
        storyId: "story-6",
        title: "The First Night",
        chapterNumber: 1,
        isPublished: true,
        paragraphs: [
          "The house was cheap. That should have been a warning. Maria and Carlos moved in on a Friday, and by Friday night, the whispers had started.",
          "They came from the walls, from the floor, from somewhere just below the edge of hearing. The whispers did not sound like pipes or wind. They sounded like names.",
          "In the morning, sunlight filled the kitchen. Neither of them mentioned that the cellar door, which they had locked the night before, was open."
        ]
      }
    ]
  },
  {
    id: "story-7",
    title: "River Bound",
    authorId: "aarav",
    genre: "adventure",
    synopsis: "A raft guide finds a map of an unmapped river in Nepal.",
    likes: 415,
    bookmarks: 132,
    views: 3200,
    tags: ["travel", "discovery", "himalaya"],
    publishedOffset: 7,
    isFeatured: false,
    language: "English",
    coverImage: "door-above-the-clouds.jpg",
    chapters: [
      {
        id: "s7c1",
        storyId: "story-7",
        title: "The Map",
        chapterNumber: 1,
        isPublished: true,
        paragraphs: [
          "Jared found the map in a used bookstore in Kathmandu. It was folded inside an old travel book and showed a river that appeared on no other map.",
          "The river ran through a valley in eastern Nepal marked with one word: unmappable.",
          "At the end of the valley, the map showed a village. The village had no name."
        ]
      }
    ]
  },
  {
    id: "story-8",
    title: "Stargazer",
    authorId: "priyanair",
    genre: "poetry",
    synopsis: "A meditation on stars, memory, and the ghosts we see when we look up.",
    likes: 980,
    bookmarks: 440,
    views: 5700,
    tags: ["stars", "memory", "elegy"],
    publishedOffset: 6,
    isFeatured: true,
    language: "English",
    coverImage: "saturn-beach-dog.jpg",
    chapters: [
      {
        id: "s8c1",
        storyId: "story-8",
        title: "Visible Light",
        chapterNumber: 1,
        isPublished: true,
        paragraphs: [
          "I learned the names of stars before I learned the names of flowers. My father said flowers change, stars remain.",
          "He was wrong on both counts, but I did not know that then.",
          "The sky is still there, rearranging itself, slow and patient, waiting for no one."
        ]
      }
    ]
  }
];

export const ledger: CreditLedgerEntry[] = [
  { id: "c1", amount: 3, reason: "welcome", balanceAfter: 3, createdAt: "Today", label: "Welcome bonus" },
  { id: "c2", amount: -1, reason: "generation", balanceAfter: 2, createdAt: "Yesterday", label: "Generated a story" },
  { id: "c3", amount: 1, reason: "ad_reward", balanceAfter: 3, createdAt: "2 days ago", label: "Rewarded video" }
];

export const authorFor = (id: string) => authors.find((author) => author.id === id) ?? authors[0];

export const storyWordCount = (story: Story) =>
  story.chapters.reduce(
    (total, chapter) => total + chapter.paragraphs.join(" ").split(/\s+/).filter(Boolean).length,
    0
  );
