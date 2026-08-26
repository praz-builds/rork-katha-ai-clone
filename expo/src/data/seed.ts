import type { Author, CreditLedgerEntry, Genre, Story } from "@/types/domain";

export const genres: Genre[] = [
  "adventure",
  "mystery",
  "romance",
  "scifi",
  "fantasy",
  "horror",
  "poetry",
  "drama",
  "mythology",
  "thriller",
  "sliceOfLife",
  "historical",
  "contemporary",
  "lgbtq",
  "comedy",
  "spirituality",
  "motivational",
  "kids",
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
  },
  {
    id: "story-9",
    title: "The Vanilla Problem",
    authorId: "mayak",
    genre: "romance",
    synopsis: "Two rival bakery owners on the same Lisbon street keep ordering the same high-end vanilla extract. Their monthly delivery collisions become the only honest conversation either has.",
    likes: 3200,
    bookmarks: 1140,
    views: 24800,
    tags: ["rivalry", "Lisbon", "bakeries", "slow burn"],
    publishedOffset: 0,
    isFeatured: true,
    language: "English",
    coverImage: "vanilla-problem-lisbon.jpg",
    focalX: 0.5,
    focalY: 0.22,
    chapters: [
      {
        id: "s9c1",
        storyId: "story-9",
        title: "The Vanilla Problem",
        chapterNumber: 1,
        isPublished: true,
        audioUrl: "https://d8j0ntlcm91z4.cloudfront.net/user_34eFOjAqFRP4Jbum8NAyNeFScBP/hf_20260826_060309_28e11d6d-e3a4-4276-8635-f4e5a22fa8ec.wav",
        audioUrls: {
          female: "https://d8j0ntlcm91z4.cloudfront.net/user_34eFOjAqFRP4Jbum8NAyNeFScBP/hf_20260826_060309_28e11d6d-e3a4-4276-8635-f4e5a22fa8ec.wav",
        },
        paragraphs: [
          "The first time it happened, Catarina blamed the supplier.",
          "She had ordered high-end Tahitian vanilla extract, the same brand her grandmother had used, the same one her mother had used, the same one she crushed into the massa of every pastel de nata that left Pastelaria Soares. Twelve bottles. Monthly standing order. So when Jorge from the delivery service handed her six bottles instead of twelve and said the other six had gone across the street, she called M\u00e1rio at the distribution warehouse and used language her grandmother would not have approved of.",
          "\"There's been no mistake,\" M\u00e1rio said. \"He orders the same one. Has for eight months.\"",
          "She looked through her shop window at the awning across Rua da Madalena. Forno de Luca. The font was pretentious. The croissants were, unfortunately, perfect.",
          "Matteo de Luca had been a problem since he'd arrived in Alfama two years ago with his Roman accent and his laminated dough and his habit of propping his door open so the smell of butter crossed the street like an invasion. Catarina's regulars still came to her. Mostly. But she'd watched a few of them carry his paper bags alongside hers, and the betrayal was specific and small and constant, like a pebble in a shoe.",
          "She marched across the cobblestones with six bottles of vanilla in a paper sack. The bell above his door rang bright and stupid.",
          "\"These are mine,\" she said, putting the sack on his marble counter.",
          "He looked up from a tray of sfogliatelle. Flour on his forearms, a streak of egg wash near his left ear. \"Those are mine,\" he said. \"I ordered twelve. I received six. You have the other six.\"",
          "\"I have ordered this vanilla for eleven years.\"",
          "\"And I have ordered it for two.\" He wiped his hands on his apron. \"So we have a problem.\"",
          "They did.",
          "M\u00e1rio refused to prioritize either of them. The monthly delivery arrived in one shipment, twelve bottles for Soares, twelve for de Luca, and Jorge did not care about the rivalry on Rua da Madalena. He cared about parking.",
          "So on the first Tuesday of every month, Catarina and Matteo stood on the sidewalk between their shops while Jorge counted out bottles. October. November. December, when the rain came sideways off the Tagus and they sheltered under Jorge's delivery van awning while he sorted the crates.",
          "\"Your sfogliatelle are dry,\" she told him in December, because the rain made her honest.",
          "\"I know,\" he said. \"The filling sets too fast in this climate. The air here is different from Rome.\"",
          "She hadn't expected him to agree. She'd expected defensiveness, some Italian bluster about tradition. Instead he leaned against the van and watched the rain hit the cal\u00e7ada tiles and said, \"Your natas, the custard is better than any I've had. But you underbake the shells by forty seconds.\"",
          "Thirty seconds, actually. She knew. She'd been doing it since her mother got sick three years ago and Catarina started rushing through the mornings, and the habit had calcified into something she couldn't seem to fix. She said nothing.",
          "In January, he brought coffee to the delivery. Not from his shop. From the caf\u00e9 two blocks down, the one with the ancient Rancilio machine that made espresso so dense you could taste the minerals in the water. He handed her a cup without asking if she wanted it.",
          "\"Obrigada,\" she said.",
          "\"Your pronunciation corrects mine,\" he said. \"Every time you say that word I hear how badly I've been saying it.\"",
          "\"You say it fine.\"",
          "\"I say it like a tourist.\"",
          "\"You are a tourist,\" she said. But she was almost smiling, and the coffee was very good.",
          "February. March. The conversations on the sidewalk grew longer. Jorge started parking and going for his own coffee, leaving them with the crates. Matteo talked about Rome the way people talk about a limb they've lost. Not with sadness exactly, but with the phantom sensation of reaching for something no longer attached. His father's bakery on Via del Governo Vecchio. The argument that had ended everything. He didn't say what the argument was about.",
          "Catarina talked about the shop. Being the third generation, how every pastel carried a dead woman's recipe and a living woman's grief. She said this while counting vanilla bottles, not looking at him, her hands busy.",
          "\"You could change the recipes,\" he said.",
          "\"I could burn the place down too.\"",
          "April's delivery fell on a Tuesday after Easter. Catarina had worked twenty-hour days through Semana Santa, turning out hundreds of folar and am\u00eandoas and the special egg custard her mother used to make for the holiday. She was so tired her hands shook. Matteo noticed. He didn't mention it. He carried her crate across the street and set it inside her door.",
          "That week, she found herself looking at his shop more than usual. The way he moved behind his counter, quick and deliberate, folding dough with a patience that seemed impossible for someone who talked as fast as he did. The way he sang, badly, when he thought no one was close enough to hear. She caught fragments through her open window. Italian pop songs from the nineties, off-key and shameless.",
          "She was watching too much. She knew it.",
          "May. She skipped the delivery. Sent her assistant, Rui, to collect the bottles. She watched from behind the register as Matteo looked across the street at her window, and she stepped back so he wouldn't see her.",
          "On the first Tuesday of June, he came into her shop. Not during the delivery. After hours, when she was scrubbing the counters and the whole place smelled of bleach and lemon and old sugar. He knocked even though the door was open.",
          "\"You weren't there last month,\" he said.",
          "\"Rui was there.\"",
          "\"Rui doesn't know the difference between Tahitian and Mexican vanilla. I asked him.\"",
          "\"Rui doesn't need to know that.\"",
          "Matteo stepped inside. He looked at the walls, the framed photos of her grandmother and mother behind the counter, the cracked tile near the register that Catarina kept meaning to fix. He looked at these things carefully, the way he looked at dough.",
          "\"Catarina.\" The way he said her name sounded different from the way anyone else said it. The emphasis shifted, something Roman underneath the Portuguese syllables. \"Why did you stop coming?\"",
          "She wrung the cleaning cloth. Twisted it until water ran over her knuckles. \"Because you carry my crates. Because you bring me coffee. Because you told me about your father and I told you about my mother and none of that is supposed to happen between us.\"",
          "\"Why not?\"",
          "\"Because you opened a bakery across the street from mine. Because every customer you win is one I lose. Because my grandmother built this place with flour she carried on her back from Tr\u00e1s-os-Montes and you showed up with a lease and good croissants and you don't get to also be the person I...\"",
          "She stopped.",
          "The shop was quiet. The old refrigerator hummed its low, constant note. Outside, a motorbike passed on the cal\u00e7ada, its engine popping against the stone buildings.",
          "\"The person you what,\" he said.",
          "\"Don't.\"",
          "\"Catarina.\"",
          "\"I said don't.\" She threw the cloth into the sink. It hit the stainless steel with a wet slap. \"You want honesty? Here. I resent you. I resent that you're good at what you do and I resent that you're kind about it and I resent that the only person in Lisbon who understands what my days look like is the one person I'm supposed to want gone. That's the problem. That's the whole problem. And vanilla extract has nothing to do with it.\"",
          "He stood very still. Then he sat down on one of her caf\u00e9 chairs, the small iron ones her mother had picked out, and he put his hands flat on the table.",
          "\"My father said I left Rome because I was a coward,\" he said. \"He said I couldn't handle the competition in a real city. He said the bakery was his and I was a tenant in it and I would never make anything of my own.\" He paused. \"I came to Lisbon to prove him wrong. And the first thing I saw when I signed my lease was your shop. And your natas. And I thought, I will never be as good as whoever made these.\"",
          "Catarina leaned against the counter. The bleach smell was fading, replaced by the ghost of the day's baking, the deep caramel scent that never fully left the walls.",
          "\"Forty seconds,\" she said.",
          "\"What?\"",
          "\"The shells. You were right but the number was wrong. I underbake by thirty, not forty. I've been meaning to fix it for three years.\"",
          "Something shifted in his face. Not softening. Recognition.",
          "\"Tomorrow,\" he said. \"Time them properly tomorrow.\"",
          "She looked at him sitting in her mother's chair, his flour-dusted shoes on her cracked tile floor, and she felt how absurd and complete it was. Two bakers on the same street, same vanilla, same impossible hours, same aching hands, same fear that what they'd inherited or built wasn't enough.",
          "\"Jorge delivers again in four weeks,\" she said.",
          "\"I know.\"",
          "\"I'll be there.\"",
          "He stood. Walked to the door. Turned back.",
          "\"Your grandmother's natas,\" he said. \"They're the best thing I've ever tasted. I mean that as a baker. Not as anything else.\"",
          "After he left, Catarina stood in her empty shop for a long time. Then she set her timer for the morning. Thirty seconds longer than usual. She wrote it on a slip of paper and taped it to the oven, where she'd see it first thing.",
          "Outside, across the street, his lights were still on too."
        ]
      }
    ]
  },
  {
    id: "story-10",
    title: "The Decimal Point",
    authorId: "zoeok",
    genre: "mystery",
    synopsis: "A forensic accountant discovers that her dead father's small-town hardware store has been laundering money for 30 years. The books are perfect. Too perfect.",
    likes: 4100,
    bookmarks: 1580,
    views: 31200,
    tags: ["forensic accounting", "family secrets", "small town", "noir"],
    publishedOffset: 1,
    isFeatured: true,
    language: "English",
    coverImage: "decimal-point-hardware.jpg",
    focalX: 0.5,
    focalY: 0.4,
    chapters: [
      {
        id: "s10c1",
        storyId: "story-10",
        title: "The Decimal Point",
        chapterNumber: 1,
        isPublished: true,
        audioUrl: "https://d8j0ntlcm91z4.cloudfront.net/user_34eFOjAqFRP4Jbum8NAyNeFScBP/hf_20260826_060309_20aaad75-b45b-40b1-b4fd-994ce5d2769c.wav",
        audioUrls: {
          male: "https://d8j0ntlcm91z4.cloudfront.net/user_34eFOjAqFRP4Jbum8NAyNeFScBP/hf_20260826_060309_20aaad75-b45b-40b1-b4fd-994ce5d2769c.wav",
        },
        paragraphs: [
          "Naomi Achebe hadn't been inside her father's hardware store in nine years, and the first thing she noticed was that it still smelled wrong.",
          "Not wrong exactly. Too right. Pine-Sol and wood stain and the faint copper tang of cut keys, layered over something older, something sweet and dense that she'd never been able to name. As a child she'd thought it was the smell of her father himself, baked into the walls from thirty years of six-day weeks behind the counter. Now, standing in the doorway with a banker's box of his financial records under one arm, she recognized it for what it was: old paper. Decades of it, yellowing quietly in drawers and filing cabinets and the locked bottom shelf of his workbench that she'd never been allowed to open.",
          "\"You want coffee?\" Dale Weaver appeared from the back, wiping his hands on a rag that had been old when Naomi was in middle school. He was sixty-seven now, smaller than she remembered, his shoulders rounded into a permanent question mark from years of leaning over the table saw. \"Your mama brought some of that Nigerian stuff yesterday. Strong enough to wake the dead.\"",
          "He stopped. The word hung there.",
          "\"Sorry, Nomi.\"",
          "\"It's fine.\" She set the box on the counter. \"I need to go through the books.\"",
          "\"Your daddy kept everything clean. Cleaner than most.\"",
          "\"I know.\" She did know. That was the problem.",
          "Naomi worked for a Big Four firm. She had spent sixteen years reading the stories that numbers told when people thought no one was listening, and her father's books told a story that was, to her trained eye, impossible. Not suspicious. Impossible. The kind of clean that didn't happen in small-town retail, where cash transactions were king and inventory shrinkage was a fact of life as certain as property taxes.",
          "She pulled the first ledger from the box. 1994. Her father's handwriting, precise and small, each entry a model of double-entry bookkeeping. She'd inherited that handwriting, that precision. Her mother always said Naomi had her father's hands. Long fingers. Good for counting things that didn't want to be counted.",
          "Dale lingered. She could hear him straightening shelves behind her, the soft click of paint cans being rotated labels-out, the way he always had. He whistled through his teeth. An old habit.",
          "By the third ledger she found the pattern.",
          "It was elegant. She had to admire it even as her stomach went cold. The revenue figures matched the bank deposits to the penny. Every quarter, every year. No rounding. No estimates. No seasonal fluctuations that couldn't be explained by weather data she pulled up on her phone. January was always low. June spiked. December recovered. It made sense the way a well-constructed lie always makes sense: perfectly.",
          "Real businesses don't run in pennies. Real businesses have a $47.82 deposit that should have been $47.28 and a Tuesday in March where someone fat-fingered a decimal and nobody caught it until quarterly review. Errors are the fingerprints of honest commerce.",
          "Her father's books had no fingerprints at all.",
          "She closed the 2003 ledger and opened 2004. Same handwriting. Same perfection. She moved to 2011. Identical.",
          "\"Dale,\" she said.",
          "The whistling stopped.",
          "\"How much cash business does the store do?\"",
          "\"Oh, fair amount. Contractors pay cash sometimes. You know how it is.\"",
          "She didn't look up. \"What percentage, roughly?\"",
          "\"Couldn't say for sure. Maybe thirty percent?\"",
          "Thirty percent cash in a business that reported zero discrepancies across thirty years of operation. She let the silence do the talking.",
          "\"Your mama wants you home for dinner,\" Dale said. \"She's making jollof.\"",
          "Ruth Achebe made jollof rice when she was nervous. When Naomi's sister had her first baby. When the church roof leaked. When Naomi's father went into the hospital for the last time.",
          "\"I'll be there by seven.\"",
          "She worked until six forty-five, the fluorescent tubes buzzing above her, the smell of old paper thickening as she pulled box after box from the storage room. She was putting the last ledger away when her elbow caught the lip of her father's workbench and the top shifted. A quarter inch. Maybe less.",
          "A quarter inch was enough.",
          "The workbench had a false top. She'd leaned against it a thousand times as a girl, watching her father cut keys, and she had never known. The plywood lifted on small brass hinges, silent and well-oiled, and inside was a space just deep enough for a second set of ledgers. Four of them, bound in green cloth, unmarked.",
          "She opened the first one.",
          "Different handwriting. Not her father's.",
          "The numbers in these books were ugly, human, full of crossed-out entries and margin notes and the kind of honest mess that real money leaves behind. And the amounts were large. Much larger than a hardware store in a town of eight thousand people had any right to touch.",
          "Naomi closed the ledger. She placed it back in the hidden compartment. She lowered the false top until it clicked.",
          "Then she sat on her father's stool and looked at the handwriting she didn't recognize, already burned into her memory, and tried to think of a single reason it might belong to someone who wasn't still alive."
        ]
      },
      {
        id: "s10c2",
        storyId: "story-10",
        title: "What the Ledger Knew",
        chapterNumber: 2,
        isPublished: true,
        audioUrl: "https://d8j0ntlcm91z4.cloudfront.net/user_34eFOjAqFRP4Jbum8NAyNeFScBP/hf_20260826_060310_75cc8cd7-af61-4559-9ed6-50d5ddfca653.wav",
        audioUrls: {
          male: "https://d8j0ntlcm91z4.cloudfront.net/user_34eFOjAqFRP4Jbum8NAyNeFScBP/hf_20260826_060310_75cc8cd7-af61-4559-9ed6-50d5ddfca653.wav",
        },
        paragraphs: [
          "The green cloth ledger sat on Naomi's childhood desk, propped against a geometry trophy she'd won in tenth grade. She'd taken it from the workbench despite every professional instinct screaming chain of custody. This wasn't a client engagement. This was her father.",
          "She'd barely slept. The guest room still had the same quilt, the same lavender sachets her mother tucked into dresser drawers, and the smell had kept her twelve years old all night while her mind ran columns. The hidden books covered 2006 to 2019. Deposits ranging from twelve thousand to forty-one thousand dollars, irregular intervals, always cash. Someone had been feeding money through the store and her father had let them, or hadn't known, or had been the one doing the feeding.",
          "No. He'd known. The false top in the workbench was too deliberate for ignorance.",
          "She arrived at the store before Dale. Used the spare key from under the ceramic frog on the back step, a hiding spot so obvious it functioned as a kind of dare. The morning was humid, the air tasting of cut grass and hot asphalt, and a mockingbird was cycling through its stolen songs in the crepe myrtle by the loading dock.",
          "The green ledger's handwriting had a leftward slant. Her father was right-handed and wrote with a forward lean. She spread the ledger open beside the official books and photographed both, noting how the sums in the green ledger aligned with anomalous cash bumps she'd missed yesterday. Not in the total revenue. Those were perfect. In the inventory purchases.",
          "Someone had been buying stock that never arrived.",
          "Phantom inventory. An old trick. Order fifty gallons of exterior paint, receive thirty, pocket the difference in cash. It explained the impossibly clean books: you didn't need to hide the money if you'd already laundered it through the purchase side. The sales figures were real. The cost side was fiction.",
          "She heard the back door and the familiar jingle of keys. Then that smell. Wood stain and something like turpentine, layered into cotton and skin over decades.",
          "\"Morning, Nomi.\" Dale set a thermos on the counter. \"You're here early.\"",
          "\"I have questions about the inventory system.\"",
          "He poured coffee. Took his time. The thermos cap doubled as a cup and he filled it exactly to the line where the threads began, the way he always did. \"Your daddy had his system. Worked for him.\"",
          "\"The purchase orders from 2011 show fifty cases of quarter-inch lag bolts from a distributor called Millhaven Supply.\"",
          "Dale sipped. \"Sounds about right.\"",
          "\"Millhaven Supply doesn't exist. I searched the state business registry, the IRS EIN database, three commercial directories. There's no Millhaven Supply. There never was.\"",
          "\"Could be they went under.\"",
          "\"Companies that go under leave records. Tax filings. Dissolution paperwork.\" She watched his hands. Steady. Too steady for a man who'd just been told his dead partner's books were fiction. \"Dale, I'm not a prosecutor. I'm his daughter.\"",
          "\"Then maybe act like one instead of an auditor.\"",
          "It landed. She felt it land and she let it, because she'd learned in sixteen years of depositions that the things people said to hurt you were also the things they said to redirect you.",
          "\"Who wrote in the green ledgers?\"",
          "Nothing moved in his face. Not surprise, not confusion. Just a careful absence of reaction, the way a lake goes flat before weather.",
          "\"Don't know what you mean.\"",
          "\"The ones in the workbench.\"",
          "\"Your daddy's workbench is your daddy's business.\"",
          "She held his gaze. He picked up his rag. Started wiping down a display of drawer pulls, each one already spotless, and she understood that Dale Weaver was not going to break under questioning because Dale Weaver had been rehearsing this conversation for years. Maybe decades.",
          "She changed angles. \"The store's checking account has a co-signer. You.\"",
          "\"Been on that account since '96.\"",
          "\"The deposits match the green ledger. Every one.\"",
          "\"I make the deposits because I run the store. Have since your daddy got sick.\" He set a brass pull back on its hook. Precise. \"That doesn't make me a bookkeeper.\"",
          "\"Someone was protecting him.\"",
          "Dale looked at her then, and she saw something she couldn't catalog, something that ran deeper than guilt and wasn't quite grief. \"Everybody protected your daddy, Nomi. That's what you do in a town like this.\"",
          "She left at noon. Drove to the county recorder's office and pulled thirty years of property records, tax assessments, lien filings. Ate a gas station sandwich that tasted mostly of plastic wrap. Drove back.",
          "By four o'clock she had traced three of the phantom vendors to P.O. boxes registered under names she didn't recognize. By five she had cross-referenced those names against the church directory her mother kept in the kitchen drawer.",
          "None matched.",
          "But one of the names on the green ledger did match. Page forty-seven, a notation in the margin, in handwriting that was neither her father's nor the primary author's. A third hand, small and neat, with loops on the lowercase d's that Naomi recognized the way you recognize your own face in an old photograph.",
          "Ruth Achebe. Her mother's handwriting. A single line: \"Confirmed. 23K received.\"",
          "The store was unlocked when she went back. She'd left the ledger on the desk in the back office, and she crossed the sales floor quickly, past the pegboard walls of screwdrivers and the endcap of padlocks, the smell of Pine-Sol rising in the still heat.",
          "She turned the corner into the office.",
          "Her mother was standing in the doorway, one hand on the frame, still wearing her church shoes, the green ledger open on the desk between them."
        ]
      },
      {
        id: "s10c3",
        storyId: "story-10",
        title: "What the Money Built",
        chapterNumber: 3,
        isPublished: true,
        audioUrl: "https://d8j0ntlcm91z4.cloudfront.net/user_34eFOjAqFRP4Jbum8NAyNeFScBP/hf_20260826_060309_ddf20d38-19e7-4c10-82f6-87be05674587.wav",
        audioUrls: {
          male: "https://d8j0ntlcm91z4.cloudfront.net/user_34eFOjAqFRP4Jbum8NAyNeFScBP/hf_20260826_060309_ddf20d38-19e7-4c10-82f6-87be05674587.wav",
        },
        paragraphs: [
          "Ruth Achebe did not sit down. She stood the way she stood when she meant something, feet planted, chin raised, her church shoes making her two inches taller than Naomi remembered.",
          "\"Close the door,\" she said.",
          "Naomi closed it. The office was small, barely room for the desk and two chairs and a filing cabinet that smelled like rust. Through the wall she could hear the store's ancient compressor cycling on, the low hum she'd fallen asleep to on the cot her father kept in the stockroom for nights when inventory ran late.",
          "\"How long have you known I was looking?\" Naomi asked.",
          "\"Dale called me this morning.\"",
          "\"Of course he did.\"",
          "\"Don't say it like that. He called because he was afraid for you. The same reason he called when you were fourteen and broke into the school gym after hours. The same reason he coached your softball team when your father was too tired.\"",
          "Naomi looked at the ledger. \"Tell me about the money.\"",
          "Ruth pulled the second chair out and sat, finally, smoothing her skirt over her knees. She did not touch the ledger. \"Your father came to this country in 1978. I came in 1980. He opened the store in 1991 with money he borrowed from his cousin Emeka, who had a restaurant in Houston. You know this.\"",
          "\"I know this.\"",
          "\"What you don't know is that Emeka's money came from a man named Olusegun who ran an import business in Lagos. The import business was not entirely an import business. And the loan was not entirely a loan.\"",
          "The compressor cut off. In the silence Naomi could hear the mockingbird again, still going outside, running through its repertoire with idiot persistence.",
          "\"They needed a place to move American dollars back into the pipeline,\" Ruth said. \"Small amounts. Regular. Nothing that would trigger the reporting thresholds. A hardware store in a small town with a lot of cash transactions.\" She paused. \"Your father understood what was being asked.\"",
          "\"And he did it anyway.\"",
          "\"He owed a debt. In his understanding, a debt is not something you renegotiate.\"",
          "\"That's not a justification, Mom.\"",
          "\"I am not offering one.\"",
          "Naomi sat on the edge of the desk. The wood creaked. She could feel the false top of the workbench through the floor, a phantom sensation, the hidden space beneath the surface that had been there her entire life. \"The second set of books. The green ones. Who kept them?\"",
          "\"I did.\"",
          "It was the answer she'd expected and it still hit her like a door swung open in the dark.",
          "\"The primary entries are Dale's,\" Ruth continued. \"He tracked the deposits, the phantom inventory, the vendor shells. I verified the amounts against what Olusegun's people sent. Your father handled the bank, the face of the business. The three of us. No one else.\"",
          "\"For thirty years.\"",
          "\"For thirty years. It stopped when Olusegun died. 2019. The last entry in that ledger.\" Ruth folded her hands. \"After that it was simply a hardware store. A real one.\"",
          "\"A real one.\" Naomi heard her own voice go flat, the way it went flat in depositions when she needed to stop feeling things and start counting them. \"You laundered money through Dad's business for three decades and then you just stopped and it became real.\"",
          "\"Things can become what they are pretending to be. The okra soup that starts as a mistake can become the recipe the family remembers.\"",
          "\"This isn't okra soup.\"",
          "\"No.\" Ruth looked at her. \"It is not.\"",
          "Naomi stood up. Walked to the filing cabinet. Opened the top drawer and closed it again, needing the motion, the mechanical action of a hinge doing what it was designed to do. She thought about the 1994 ledger, her father's handwriting, each entry perfect. She'd thought the perfection was a sign of fraud. She'd been right. But she'd also been looking at a man who had elevated his lie to an art because the alternative was admitting that the foundation of everything he'd built, the store, the town, the life, was borrowed from a debt he couldn't name to his children.",
          "\"How much total?\" she asked.",
          "\"Over thirty years, approximately two point three million dollars.\"",
          "\"And where is it now?\"",
          "\"In Lagos. In Houston. In the concrete foundation of this building, which Olusegun's people paid to pour in 1991. In your college tuition, Naomi.\"",
          "The room contracted.",
          "\"Emeka's loan paid for my tuition.\"",
          "\"Emeka's loan paid for everything. The store. The house. Your school. Your sister's wedding. All of it from the same river.\"",
          "Naomi pressed her fingers against the filing cabinet. Cool metal. Real. \"Does Dale know you're telling me this?\"",
          "\"Dale wanted to tell you himself. I told him no. A mother tells her children the truth about their father. That is not a job you give to someone else.\"",
          "\"The truth.\" Naomi turned. \"You want me to call this the truth when you've been lying to me for forty-one years?\"",
          "Ruth stood. She was shorter without the authority of stillness, an old woman in church shoes with hands that smelled like palm oil and the particular brand of hand soap the store had carried since 1994. The same soap. Naomi had noticed it in the bathroom yesterday, a detail she'd filed away without knowing why.",
          "\"When your father was dying,\" Ruth said, \"he asked me to burn the green ledgers. I told him no. I told him the river that feeds the farm does not get to choose who sees it. He said you would find them. He said you were the only person he knew who read numbers the way other people read faces.\"",
          "\"He was right.\"",
          "\"He was proud of that. And afraid of it.\"",
          "They stood in the small office, the fluorescent light buzzing its single note, and Naomi understood that this was the shape of it. Not a crime to be prosecuted or a betrayal to be forgiven. A structure. Thirty years of careful architecture, built by three people who loved each other enough to share a secret and too much to share the guilt.",
          "She would not report it. The statute of limitations had run on most of the transactions and Olusegun was dead and the money had become what it was pretending to be: a hardware store, a house, a life.",
          "She would not forgive it either.",
          "\"I'm going back to the hotel,\" Naomi said.",
          "Ruth picked up the green ledger and held it out. \"This belongs to you now.\"",
          "Naomi took it. The cloth cover was soft from years of handling, warm from the office heat, and she tucked it under her arm the way she'd carried her father's banker's box two days ago, pressed against her ribs where she could feel its weight with every breath.",
          "She drove past the store's front window. Dale was inside, rotating paint cans, labels out. He didn't look up.",
          "The mockingbird was still singing when she pulled onto the county road, cycling through songs it had stolen from other birds, making them its own."
        ]
      }
    ]
  },
  {
    id: "story-11",
    title: "Las cien luces de Don Aurelio",
    authorId: "kathaai",
    genre: "bedtime",
    synopsis: "Un viejo farolero camina por un pueblo donde las farolas se encienden con recuerdos. Esta noche tiene que decidir cu\u00e1l apagar.",
    likes: 1890,
    bookmarks: 720,
    views: 15400,
    tags: ["farolero", "recuerdos", "pueblo", "magia suave"],
    publishedOffset: 0,
    isFeatured: true,
    language: "Spanish",
    coverImage: "cien-luces-farolero.jpg",
    focalX: 0.5,
    focalY: 0.35,
    chapters: [
      {
        id: "s11c1",
        storyId: "story-11",
        title: "Las cien luces de Don Aurelio",
        chapterNumber: 1,
        isPublished: true,
        audioUrl: "https://d8j0ntlcm91z4.cloudfront.net/user_34eFOjAqFRP4Jbum8NAyNeFScBP/hf_20260826_060309_d45cde97-8cbb-4559-a555-ffb3ff9bb0a3.wav",
        audioUrls: {
          female: "https://d8j0ntlcm91z4.cloudfront.net/user_34eFOjAqFRP4Jbum8NAyNeFScBP/hf_20260826_060309_d45cde97-8cbb-4559-a555-ffb3ff9bb0a3.wav",
        },
        paragraphs: [
          "Don Aurelio sali\u00f3 de su casa cuando el cielo todav\u00eda guardaba un resto de naranja entre las nubes. El port\u00f3n de madera cruji\u00f3 como siempre, con ese quejido largo que ya formaba parte de los sonidos del pueblo, igual que el campanario de las siete o el canto del gallo de do\u00f1a Marta.",
          "Llevaba su vara de encendedor al hombro. Cincuenta a\u00f1os con la misma vara, aunque le hab\u00edan cambiado el mango tres veces y la punta dos. Ol\u00eda a aceite de linaza y a las manos de todos los faroleros que la sostuvieron antes que \u00e9l.",
          "La gata Canela apareci\u00f3 desde debajo del banco de la plaza, como cada noche, estirando primero las patas delanteras y despu\u00e9s las traseras con una lentitud que parec\u00eda ensayada. Su pelo color canela brillaba bajo la \u00faltima luz del d\u00eda.",
          "\"Llegas tarde\", dijo Don Aurelio.",
          "Canela maull\u00f3 una vez, breve, y se puso a caminar a su lado.",
          "Las farolas de este pueblo no funcionaban con fuego. Nunca hab\u00edan funcionado con fuego. Dentro de cada farol viv\u00eda un recuerdo, y cuando Don Aurelio acercaba su vara al cristal, el recuerdo se encend\u00eda y daba luz. Una luz distinta en cada esquina. La farola de la calle del R\u00edo brillaba con el tono dorado de una tarde de agosto en la que dos hermanos aprendieron a nadar. La de la plaza del Mercado ten\u00eda la luz rosada de la primera vez que alguien dijo \"te quiero\" junto a la fuente. La del callej\u00f3n del Sastre era azul p\u00e1lido, como la ma\u00f1ana en que nev\u00f3 por primera y \u00fanica vez en el pueblo.",
          "Cien farolas. Cien recuerdos. Ni uno m\u00e1s.",
          "Don Aurelio lo sab\u00eda porque \u00e9l las hab\u00eda contado muchas veces, tocando cada poste con la mano al pasar, sintiendo la vibraci\u00f3n suave del cristal bajo sus dedos. Noventa y ocho, noventa y nueve, cien. Siempre cien.",
          "Y esa noche hab\u00eda un problema.",
          "\"Han puesto una nueva\", dijo, deteni\u00e9ndose frente a la esquina de la calle de los Almendros.",
          "Ah\u00ed estaba. Una farola que no exist\u00eda ayer. Su cristal conten\u00eda algo fresco, reciente, algo que ol\u00eda a pan reci\u00e9n hecho y a risa de ni\u00f1a. El recuerdo de una tarde de hoy. Alguien hab\u00eda plantado una farola nueva con un recuerdo nuevo, y eso significaba que ahora hab\u00eda ciento una luces.",
          "Y el pueblo solo ten\u00eda espacio para cien.",
          "Canela se sent\u00f3 junto a la farola nueva y la mir\u00f3 con esa atenci\u00f3n seria que los gatos reservan para las cosas que importan de verdad.",
          "Don Aurelio se rasc\u00f3 la nuca. El aire tra\u00eda olor a tierra mojada y a jazm\u00edn del jard\u00edn de la se\u00f1ora Puri. Apoy\u00f3 la espalda contra la pared, despacio, porque su espalda torcida le ped\u00eda pausas cada vez con m\u00e1s frecuencia.",
          "\"Tengo que apagar una\", dijo.",
          "No a Canela. A s\u00ed mismo. A la noche.",
          "Apagar una farola significaba apagar un recuerdo. No destruirlo, no borrarlo del todo, pero s\u00ed dejarlo dormir en la oscuridad hasta que alguien lo volviera a necesitar. Y mientras dorm\u00eda, la calle quedar\u00eda a oscuras. Las personas que pasaran por ah\u00ed no sentir\u00edan esa punzada suave de algo bueno que pas\u00f3 una vez en ese lugar.",
          "Don Aurelio camin\u00f3 por el pueblo con paso lento. Canela lo segu\u00eda. El sonido de sus zapatos sobre los adoquines marcaba un ritmo parejo, casi una canci\u00f3n, y \u00e9l tarareaba sin darse cuenta una melod\u00eda que su madre le cantaba de peque\u00f1o.",
          "Pas\u00f3 la farola del primer beso junto a la fuente. No.",
          "Pas\u00f3 la farola de la nevada. No.",
          "Pas\u00f3 la farola de la calle del Herrero, que guardaba el sonido de un martillo golpeando el hierro un martes cualquiera en que nada especial ocurri\u00f3, salvo que el herrero silbaba y un perro dorm\u00eda al sol, y eso bast\u00f3 para que el d\u00eda se quedara guardado. Don Aurelio apoy\u00f3 la mano en el cristal. Tibio. Constante. No.",
          "\"Ninguno merece apagarse\", dijo.",
          "Canela maull\u00f3.",
          "Sigui\u00f3 caminando. Las calles se iban quedando quietas. Las ventanas del pueblo se cerraban una por una. Alguien arrastraba una silla dentro de su casa. Un grifo goteaba en alg\u00fan patio.",
          "Entonces lleg\u00f3 a la \u00faltima farola del recorrido. La n\u00famero cien. La suya.",
          "La farola de Don Aurelio guardaba un recuerdo peque\u00f1o. \u00c9l con seis a\u00f1os, sentado en las rodillas de su abuelo, mirando c\u00f3mo el viejo farolero de entonces encend\u00eda las luces del pueblo por primera vez ante sus ojos. El olor del abrigo de lana de su abuelo. La sensaci\u00f3n de los botones contra su mejilla. La voz ronca diciendo: \"\u00bfVes? Cada luz es alguien que fue feliz aqu\u00ed.\"",
          "Don Aurelio se qued\u00f3 mirando su propia farola un rato largo.",
          "Canela se acerc\u00f3 y se frot\u00f3 contra su pierna. Su pelo era tibio. Ronroneaba.",
          "\"Esta\", dijo Don Aurelio, en voz baja.",
          "Acerc\u00f3 la vara al cristal. La luz dorada tembl\u00f3, se hizo peque\u00f1a, y se fue apagando como una vela a la que alguien le pone un vaso encima. Sin ruido. Sin prisa. La calle qued\u00f3 en sombra.",
          "Pero Don Aurelio no se qued\u00f3 a oscuras.",
          "Porque el recuerdo de su abuelo no necesitaba una farola. Lo llevaba en las manos, en la forma en que sosten\u00eda la vara. En la costumbre de tararear. En el paso lento y firme sobre los adoquines.",
          "Camin\u00f3 de vuelta a la calle de los Almendros. La farola nueva esperaba. Acerc\u00f3 la vara. El cristal se llen\u00f3 de esa luz fresca que ol\u00eda a pan y a risa, y la esquina se ilumin\u00f3 con el color tibio de una tarde buena.",
          "Cien farolas. Otra vez cien.",
          "Canela bostez\u00f3.",
          "Don Aurelio se guard\u00f3 la vara bajo el brazo y ech\u00f3 a andar hacia su casa. Las calles ya estaban calladas. Solo quedaba el rumor del agua en la fuente de la plaza.",
          "Abri\u00f3 su port\u00f3n. El mismo crujido de siempre.",
          "Canela entr\u00f3 primero y se subi\u00f3 al sill\u00f3n junto a la estufa. Se hizo un ovillo. Don Aurelio se quit\u00f3 los zapatos, se sent\u00f3 despacio, y se ech\u00f3 la manta de lana sobre las piernas. La manta ol\u00eda a le\u00f1a y a casa.",
          "Afuera, las cien luces del pueblo brillaban.",
          "Y Don Aurelio cerr\u00f3 los ojos, tranquilo, con el recuerdo de su abuelo guardado donde ninguna farola hace falta."
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
