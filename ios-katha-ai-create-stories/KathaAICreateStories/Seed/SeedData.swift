//
//  SeedData.swift
//  KathaAICreateStories
//

import SwiftUI

enum SeedData {
    // MARK: - Authors (10)

    static let authors: [Author] = [
        Author(id: "kathaai", username: "kathaai", displayName: "Katha AI",
               bio: "The house account. Curated tales spun with care. Follow us for the best of Katha, weekly.",
               followers: 48200, storyCount: 30, isVerified: true, avatarPaletteIndex: 0, followingCount: 0),
        Author(id: "aarav", username: "aarav", displayName: "Aarav Menon",
               bio: "Writing stories about the small moments that shape a life. Based in Mumbai.",
               followers: 12, storyCount: 4, isVerified: false, avatarPaletteIndex: 0, followingCount: 4),
        Author(id: "zoeok", username: "zoeok", displayName: "Zoe Okonkwo",
               bio: "Afrofuturism, thrillers, and everything in between. Lagos \u{2192} London \u{2192} wherever the story goes.",
               followers: 15000, storyCount: 5, isVerified: false, avatarPaletteIndex: 1, followingCount: 200),
        Author(id: "priyanair", username: "priyanair", displayName: "Priya Nair",
               bio: "Mythology-tinted fantasy from Kerala. New chapter every Sunday morning.",
               followers: 8900, storyCount: 3, isVerified: false, avatarPaletteIndex: 2, followingCount: 120),
        Author(id: "mayak", username: "mayak", displayName: "Maya Kapoor",
               bio: "Contemporary romance and second-chance stories. Weekend baker, weekday storyteller.",
               followers: 3400, storyCount: 6, isVerified: false, avatarPaletteIndex: 4, followingCount: 89),
        Author(id: "rentakahashi", username: "rentakahashi", displayName: "Ren Takahashi",
               bio: "Slow-burn sci-fi. Occasional horror. Tokyo native, night-shift writer.",
               followers: 1200, storyCount: 5, isVerified: false, avatarPaletteIndex: 2, followingCount: 45),
        Author(id: "diegoa", username: "diegoa", displayName: "Diego Alvarez",
               bio: "Buenos Aires. Magical realism, mostly in Spanish. Coffee-fueled at 3 AM.",
               followers: 620, storyCount: 4, isVerified: false, avatarPaletteIndex: 5, followingCount: 22),
        Author(id: "rahuls", username: "rahuls", displayName: "Rahul Sharma",
               bio: "Motivational shorts. Grand ambitions, small steps. Write your own tomorrow.",
               followers: 340, storyCount: 3, isVerified: false, avatarPaletteIndex: 3, followingCount: 30),
        Author(id: "elenar", username: "elenar", displayName: "Elena Rossi",
               bio: "Historical fiction with a mystery twist. Living in Florence, dreaming in the 1600s.",
               followers: 5200, storyCount: 4, isVerified: false, avatarPaletteIndex: 4, followingCount: 78),
        Author(id: "kainak", username: "kainak", displayName: "Kai Nakamura",
               bio: "Poetry, mostly. Sometimes prose. Always short. Sometimes very short.",
               followers: 890, storyCount: 3, isVerified: false, avatarPaletteIndex: 1, followingCount: 50)
    ]

    // MARK: - Follow Graph (who follows whom among seed authors)

    /// authorId -> list of author ids that author follows (3-6 named authors each)
    static let mockFollowing: [String: [String]] = [
        "kathaai": [],
        "aarav": ["mayak", "priyanair", "zoeok", "kathaai"],
        "mayak": ["kathaai", "aarav", "elenar", "kainak", "zoeok"],
        "rentakahashi": ["kathaai", "diegoa", "zoeok", "mayak"],
        "priyanair": ["kathaai", "mayak", "elenar", "aarav", "kainak", "rahuls"],
        "diegoa": ["rentakahashi", "zoeok", "kathaai"],
        "zoeok": ["kathaai", "mayak", "elenar", "priyanair", "diegoa"],
        "rahuls": ["kathaai", "priyanair", "aarav"],
        "elenar": ["kathaai", "kainak", "mayak", "zoeok"],
        "kainak": ["elenar", "kathaai", "priyanair"]
    ]

    // MARK: - Ghost Seed Followers (40 display-only mock users)

    static let ghostFollowers: [ProfileUserItem] = [
        ("noorwrites", "Noor Haddad"), ("sofiapage", "Sofia Marino"), ("jinwoo_k", "Jin-woo Kim"),
        ("amara.reads", "Amara Diallo"), ("leotales", "Leo Fernandez"), ("tashastories", "Tasha Ivanova"),
        ("omarink", "Omar Farouk"), ("lucia_verse", "Lucia Mendes"), ("kenjipen", "Kenji Watanabe"),
        ("freyafables", "Freya Lindqvist"), ("dev_reads", "Dev Patel"), ("chloequill", "Chloe Martin"),
        ("santiagos", "Santiago Reyes"), ("yukireader", "Yuki Mori"), ("nia_writes", "Nia Mensah"),
        ("gabrielink", "Gabriel Costa"), ("astridtales", "Astrid Berg"), ("tariqpage", "Tariq Aziz"),
        ("elif_story", "Elif Yilmaz"), ("marcoverse", "Marco Bianchi"), ("sanaa_reads", "Sanaa Khan"),
        ("felixfables", "Felix Wagner"), ("imanwrites", "Iman Cisse"), ("hana_pen", "Hana Sato"),
        ("rafaelink", "Rafael Torres"), ("ingridtales", "Ingrid Olsen"), ("kwametells", "Kwame Boateng"),
        ("mira_verse", "Mira Novak"), ("stefanpage", "Stefan Petrov"), ("aishastories", "Aisha Bello"),
        ("tomasink", "Tomas Dvorak"), ("lenaquill", "Lena Fischer"), ("arjun_reads", "Arjun Rao"),
        ("clarafables", "Clara Dubois"), ("yusufwrites", "Yusuf Demir"), ("emiliatales", "Emilia Rossi"),
        ("nathanpage", "Nathan Brooks"), ("zaravers", "Zara Ahmed"), ("otisreads", "Otis Coleman"),
        ("paulastory", "Paula Vega")
    ].enumerated().map { index, pair in
        ProfileUserItem(
            id: "ghost-\(index)",
            username: pair.0,
            displayName: pair.1,
            bio: "",
            isVerified: false,
            isGhost: true
        )
    }

    /// Deterministic ghost distribution: each ghost follows one seed author.
    static func ghostFollowers(of authorId: String) -> [ProfileUserItem] {
        guard let authorIndex = authors.firstIndex(where: { $0.id == authorId }) else { return [] }
        return ghostFollowers.enumerated()
            .filter { $0.offset % authors.count == authorIndex }
            .map { $0.element }
    }

    /// Full followers list for a seed author: seed authors who follow them + assigned ghosts (5-8 rows).
    static func followersList(of authorId: String) -> [ProfileUserItem] {
        let authorFollowers = authors
            .filter { mockFollowing[$0.id]?.contains(authorId) ?? false }
            .map { ProfileUserItem(id: $0.id, username: $0.username, displayName: $0.displayName, bio: $0.bio, isVerified: $0.isVerified, isGhost: false) }
        return authorFollowers + ghostFollowers(of: authorId)
    }

    /// Following list (writers) for a seed author.
    static func followingList(of authorId: String) -> [ProfileUserItem] {
        (mockFollowing[authorId] ?? []).compactMap { id in
            guard let author = author(id: id) else { return nil }
            return ProfileUserItem(id: author.id, username: author.username, displayName: author.displayName, bio: author.bio, isVerified: author.isVerified, isGhost: false)
        }
    }

    // MARK: - Stories (12 with real prose)

    private static let baseStories: [Story] = [
        Story(id: "story-1", title: "The Last Lighthouse Keeper", authorId: "aarav",
              genre: .adventure,
              synopsis: "A lighthouse keeper receives a letter from the future warning of a storm that hasn't happened yet.",
              chapters: [
                  Chapter(id: "s1c1", title: "The Letter", paragraphs: [
                      "The bottle washed ashore on a Tuesday, green glass worn smooth by decades of salt and current. Tom Hardy had kept the lighthouse at Pemaquid Point for thirty-one years, and in that time he'd found many things on the beach. But never a bottle with a letter inside.",
                      "The paper was thick, hand-pressed, and the handwriting was precise, almost mechanical. 'Dear Keeper,' it began. 'By the time you read this, the light will have failed. I am writing from the future. The lighthouse fell in the storm of '78. I am asking you to prevent it.'",
                      "Tom read it three times, then set it on the kitchen table and watched it curl in the lamplight. The storm of '78 was twenty-six years away. The light hadn't failed. It still turned every night, sweeping its beam across the dark water like a slow, patient hand."
                  ]),
                  Chapter(id: "s1c2", title: "The Storm", paragraphs: [
                      "The storm came three weeks after the letter. Tom had weathered a hundred storms, but this one was different. The wind didn't howl; it whispered, and in the whispering he heard words he couldn't quite make out.",
                      "At midnight, the light failed. Not flickered — failed, as if someone had cut the power. Tom grabbed the backup lamp and climbed the spiral stairs, his knees protesting every step. At the top, the lens was dark.",
                      "He replaced the bulb. The new one lit, turned, swept the sea. And in the beam's arc, far out on the water, he saw a ship — wooden masts, canvas sails, the lighthouse tender from the 1950s. It was sinking. And on its deck, waving a lantern, stood a man who looked exactly like Tom."
                  ])
              ],
              likes: 1840, bookmarks: 620, views: 12400,
              tags: ["atmospheric", "time", "coastal"], publishedOffset: 2, isFeatured: true),

        Story(id: "story-2", title: "Midnight in Marrakech", authorId: "zoeok",
              genre: .mystery,
              synopsis: "A traveler vanishes from a Marrakech hotel. Her sister follows the clues into the ancient medina.",
              chapters: [
                  Chapter(id: "s2c1", title: "The Disappearance", paragraphs: [
                      "Claire Forrest checked into the Riad el Fenn at four in the afternoon. By midnight, she was gone. The receptionist insisted she had never arrived. But her suitcase sat in Room 7, zipped shut, the bed still made.",
                      "The police came and went. They took notes, shrugged, suggested Claire might have wandered into the medina and gotten lost. People did, sometimes. The medina was a labyrinth — nine thousand alleys, most of them unlit.",
                      "But Claire's sister Maya knew better. Claire spoke Arabic. Claire had been to Marrakech before. Claire did not get lost."
                  ]),
                  Chapter(id: "s2c2", title: "The Night Market", paragraphs: [
                      "Maya found the spice merchant in the souk, a bent old man who sold saffron and storytelling in equal measure. He recognized the necklace Maya showed him — amber beads on a silver thread, handmade, unmistakable.",
                      "'The woman who wore this came two nights ago,' he said. 'She was looking for the door.' 'What door?' 'The old door. In the medina wall. It opens only at midnight, only for those who are meant to find it.'",
                      "Maya felt the hair rise on her arms. 'Where is this door?' The merchant smiled, showing teeth like old ivory. 'You are already looking for it,' he said. 'That means you are meant to find it too.'"
                  ])
              ],
              likes: 2610, bookmarks: 890, views: 18900,
              tags: ["travel", "noir", "atmospheric"], publishedOffset: 5, isFeatured: true),

        Story(id: "story-3", title: "Letters to the Sea", authorId: "priyanair",
              genre: .drama,
              synopsis: "For eleven years, a mother writes letters to the ocean. One day, the ocean writes back.",
              chapters: [
                  Chapter(id: "s3c1", title: "The First Letter", paragraphs: [
                      "Every morning, Amma walked to the pier with a letter folded in her sari. She had been doing this for eleven years, since the day her son's ship failed to return. The letters were always the same: his name, a question, a promise to keep waiting.",
                      "She folded the paper into a bottle and let the tide take it. The fishermen watched from their boats but said nothing. Everyone in the village knew Amma. Everyone knew her story. No one knew what she wrote.",
                      "One morning, the bottle came back. Not the same bottle — this one was dark glass, sealed with wax. Inside was a letter in handwriting she didn't recognize. 'Dear Mother,' it said. 'The sea kept your letters. It asked me to answer them.'"
                  ]),
                  Chapter(id: "s3c2", title: "The Reply", paragraphs: [
                      "Amma sat on the pier for three hours, reading the letter in every kind of light — morning, shadow, sun, cloud. The handwriting was neat but strange, as if the writer was unused to holding a pen.",
                      "The letter spoke of currents and depths, of a place where the water was warm and the light came from below. It spoke of a ship that had not sunk but had been carried, gently, to a shore that existed on no map.",
                      "It ended: 'I am well. I am not alone. The sea says you should stop waiting, but I know you won't, and I love you for it.' Amma folded the letter into her sari and began walking home. Tomorrow, she would write back."
                  ])
              ],
              likes: 160, bookmarks: 80, views: 1300,
              tags: ["grief", "ocean", "letters"], publishedOffset: 8, isFeatured: false),

        Story(id: "story-4", title: "The Quantum Garden", authorId: "rentakahashi",
              genre: .scifi,
              synopsis: "A scientist grows the first plant that exists on probability. It doesn't stay in the lab.",
              chapters: [
                  Chapter(id: "s4c1", title: "The First Bloom", paragraphs: [
                      "Dr. Yuki Tanaka grew the first impossible plant in a basement lab at Kyoto University. It was a rose, but not quite — the petals shimmered between colors that shouldn't exist together, and when you looked away and looked back, it had rearranged itself.",
                      "The rose grew without soil, without water, without light. It grew on probability. Yuki had spent seven years building a quantum field generator, and the rose was its first fruit. She didn't tell anyone. Not yet.",
                      "By the third day, the rose had produced a seed. By the fifth, the seed had fallen from its stalk and landed in a crack in the concrete floor. By the seventh, a vine was growing through the crack, reaching for the ceiling with alarming speed."
                  ]),
                  Chapter(id: "s4c2", title: "The Garden Grows", paragraphs: [
                      "Yuki came to the lab on Monday morning and found a forest. The vine had become a tree, the tree had become a canopy, and under the canopy were flowers she had never designed — flowers that pulsed with their own light.",
                      "She stood in the doorway, her key card still in her hand, and listened. The garden was breathing. Not metaphorically — the air moved in and out, warm and green, as if the plants had invented their own respiration.",
                      "Something moved in the canopy. Something small, quick, alive. Yuki stepped back. The garden had made something she hadn't planted. It had made something that could move on its own. She reached for her phone, then stopped. Part of her wanted to see what came next."
                  ])
              ],
              likes: 1980, bookmarks: 730, views: 14600,
              tags: ["science", "first-contact", "wonder"], publishedOffset: 1, isFeatured: true),

        Story(id: "story-5", title: "The Weaver's Daughter", authorId: "mayak",
              genre: .fantasy,
              synopsis: "A girl who can weave moonlight into thread is summoned by a king who wants an invincible banner.",
              chapters: [
                  Chapter(id: "s5c1", title: "Moonlight Thread", paragraphs: [
                      "In the village of Thimphu, there lived a weaver who could spin moonlight into thread. Her name was Pema, and she was the seventh daughter of a seventh daughter, which in the old stories meant she could do things that other people couldn't.",
                      "Every full moon, Pema sat at her loom in the courtyard and wove. The moonlight came to her fingers like silk, and she drew it out, strand by strand, until she had enough to weave. What she wove was always different — a cloak, a blanket, a banner.",
                      "What people didn't know was that each weaving was a promise. The cloak kept its wearer warm in any cold. The blanket healed sickness. The banner, which she wove only once, would protect an entire kingdom from harm — but only if the kingdom deserved it."
                  ]),
                  Chapter(id: "s5c2", title: "The Tapestry", paragraphs: [
                      "The king heard about Pema and sent for her. He wanted a banner for his army, a banner that would make his soldiers invincible. Pema came to the palace and looked at the king — his gold, his soldiers, his hungry eyes — and sat at the loom.",
                      "She wove for three nights. On the first night, she wove the moonlight into the shape of a mountain. On the second, she wove a river. On the third, she wove a face — her own. The banner was beautiful, but when the king unfurled it, his soldiers turned and walked away.",
                      "The banner didn't make them invincible. It made them honest. They saw what the king was, and what the kingdom had become, and they could not fight for it anymore. Pema smiled, packed her loom, and walked home. The moon, she knew, always tells the truth."
                  ])
              ],
              likes: 2800, bookmarks: 1100, views: 22100,
              tags: ["folk-tale", "magic", "moonlight"], publishedOffset: 3, isFeatured: true),

        Story(id: "story-6", title: "Whispers in the Old House", authorId: "diegoa",
              genre: .horror,
              synopsis: "A couple moves into a cheap house. The walls whisper their names. The cellar door won't stay locked.",
              chapters: [
                  Chapter(id: "s6c1", title: "The First Night", paragraphs: [
                      "The house was cheap. That should have been a warning. Maria and Carlos moved in on a Friday, and by Friday night, the whispers had started. They came from the walls, from the floor, from somewhere just below the edge of hearing.",
                      "Carlos said it was pipes. Maria said it was wind. They told each other this in bed, the lamp on, not sleeping. The whispers didn't sound like pipes or wind. They sounded like names. They sounded like their names.",
                      "In the morning, the whispers stopped. Sunlight filled the kitchen, and Maria laughed at herself. Old house, she said. Settling. Carlos nodded. Neither of them mentioned that the cellar door, which they had locked the night before, was open."
                  ]),
                  Chapter(id: "s6c2", title: "The Cellar", paragraphs: [
                      "Carlos went down first, holding a flashlight like a weapon. The stairs creaked under his weight. The cellar was cold — not the cold of stone, but the cold of something that had been waiting a long time.",
                      "The walls were covered in scratches. Not random — organized, deliberate, rows and rows of marks that looked like counting. Carlos counted. There were three hundred and twelve. Three hundred and twelve of something.",
                      "Behind him, the cellar door closed. He spun around, ran to it, tried the handle. Locked. The whispers started again, louder now, and this time he could hear the words. 'Three hundred and thirteen,' they said. 'Three hundred and thirteen.'"
                  ])
              ],
              likes: 120, bookmarks: 60, views: 950,
              tags: ["supernatural", "suspense", "dark"], publishedOffset: 4, isFeatured: false),

        Story(id: "story-7", title: "River Bound", authorId: "rahuls",
              genre: .adventure,
              synopsis: "A raft guide finds a map of an unmapped river in Nepal. The village at its end doesn't appear on any chart.",
              chapters: [
                  Chapter(id: "s7c1", title: "The Map", paragraphs: [
                      "Jared found the map in a used bookstore in Kathmandu. It was folded inside a copy of 'The River of Doubt,' and it showed a river that appeared on no other map. It ran through a valley in eastern Nepal that was marked with one word: 'unmappable.'",
                      "Jared had been a raft guide for twelve years. He'd run rivers in six countries. He knew every major tributary in the Himalayas. He had never heard of this one. The map was old — 1950s maybe — and hand-drawn with meticulous care.",
                      "He bought the book for two hundred rupees. That night, in his guesthouse room, he spread the map on the bed and traced the river's path with his finger. It wound through a valley so narrow the river filled it edge to edge. At the end of the valley, the map showed a village. The village had no name."
                  ]),
                  Chapter(id: "s7c2", title: "The Village", paragraphs: [
                      "The river was everything the map promised — fast, narrow, walled in by cliffs that rose three hundred feet on either side. Jared paddled for two days, sleeping on a gravel bar, eating cold rice, talking to no one.",
                      "On the third morning, the canyon opened. The river widened into a pool, and on the far shore was the village. It was small — twelve houses, a temple, a garden. The people who lived there looked up as Jared drifted in, and they didn't seem surprised.",
                      "An old woman walked to the water's edge. 'You found us,' she said. 'Not many do.' She looked at Jared's raft, at his maps, at his GPS. 'You can stay,' she said. 'But you should know — the river only flows one way. You came in. You cannot go back the way you came.'"
                  ])
              ],
              likes: 15, bookmarks: 5, views: 120,
              tags: ["travel", "discovery", "himalaya"], publishedOffset: 7, isFeatured: false),

        Story(id: "story-8", title: "Stargazer", authorId: "elenar",
              genre: .poetry,
              synopsis: "A meditation on stars, memory, and the ghosts we see when we look up.",
              chapters: [
                  Chapter(id: "s8c1", title: "Visible Light", paragraphs: [
                      "I learned the names of stars before I learned the names of flowers. My father said: flowers change, stars remain. He was wrong on both counts, but I didn't know that then.",
                      "Orion in winter. Scorpius in summer. The North Star, which isn't north at all, not really — it's just the one that doesn't move. My father said: find the one that doesn't move, and you'll know where you are. He was wrong about that too.",
                      "The stars I learned first are not the same stars. Betelgeuse is dimmer now. Sirius hasn't changed, but my eyes have. My father is gone. The sky is still there, rearranging itself, slow and patient, waiting for no one."
                  ]),
                  Chapter(id: "s8c2", title: "Invisible Light", paragraphs: [
                      "There are stars we can't see — not because they're too far, but because their light is the wrong kind. Radio, X-ray, infrared. They sing in frequencies we'll never hear.",
                      "I think about this when I can't sleep. Somewhere, a star is broadcasting its death in a language no human instrument will ever translate. It has been doing this for a thousand years. The signal is still traveling.",
                      "My father used to say: the light we see is old. Everything in the sky is a ghost. I think he was trying to tell me something about time, or about loss, or about the way we look backward without meaning to. I think he was right about that."
                  ])
              ],
              likes: 80, bookmarks: 40, views: 700,
              tags: ["stars", "memory", "elegy"], publishedOffset: 6, isFeatured: true),

        Story(id: "story-9", title: "The Forgotten Recipe", authorId: "kainak",
              genre: .drama,
              synopsis: "A grandmother's cookbook reveals a final recipe with strange instructions: say the name of someone you've lost.",
              chapters: [
                  Chapter(id: "s9c1", title: "The Cookbook", paragraphs: [
                      "When Obachan died, she left me three things: her knife, her apron, and her cookbook. The knife was a santoku, worn thin by sixty years of use. The apron was blue cotton, stained with a thousand meals. The cookbook was handwritten, in Japanese and English.",
                      "Most of the recipes I knew — miso soup, tamagoyaki, the curry she made every Sunday. But on the last page, in a hand shakier than the rest, was a recipe I'd never seen. 'Grandmother's Soup,' it said. The ingredients were ordinary: dashi, daikon, ginger. But the instructions were strange.",
                      "Step one: cook the dashi until the kitchen smells like the ocean. Step two: add the daikon and wait until it turns transparent, like glass. Step three: stir in the ginger and say the name of someone you've lost. Step four: serve only to family."
                  ]),
                  Chapter(id: "s9c2", title: "The Meal", paragraphs: [
                      "I made the soup on a Wednesday. The dashi took an hour to smell like the ocean — deep, salt, cold. The daikon took longer. I watched it turn from white to glass, and when I stirred in the ginger, I said my grandmother's name.",
                      "The soup was simple. It was the best thing I'd ever tasted. I sat at my kitchen table and ate it slowly, and with each bite, I remembered something new — not the big things, but the small ones. The way she hummed while cooking. The way she tasted with her eyes closed.",
                      "When the bowl was empty, I called my mother. 'I found the recipe,' I said. There was a long pause. 'The soup?' she said. 'Obachan made it for me when my father died. She said it doesn't bring people back. It just helps you remember them clearly.' I looked at the empty bowl. She was right."
                  ])
              ],
              likes: 12, bookmarks: 4, views: 95,
              tags: ["family", "food", "memory"], publishedOffset: 9, isFeatured: false),

        Story(id: "story-10", title: "Echoes of Tomorrow", authorId: "mayak",
              genre: .scifi,
              synopsis: "A radio astronomer receives a signal from three days in the future. The message is a warning.",
              chapters: [
                  Chapter(id: "s10c1", title: "The Signal", paragraphs: [
                      "The radio picked up the signal at 3:47 AM. Dr. Priya Shah was alone in the observatory, running a routine scan of the hydrogen line, when the frequency spiked. She checked the equipment, rechecked it, then sat very still.",
                      "The signal was structured. Not random noise, not interference — structured, like language. And it was coming from Earth. Specifically, from three days in the future. Priya knew this because the signal contained a timestamp, and the timestamp was future-dated.",
                      "She recorded everything. Then she did what any scientist would do: she waited. Three days. She went about her life — taught her classes, ate her meals, pretended to sleep. And every night, she checked the radio. The signal was getting stronger."
                  ]),
                  Chapter(id: "s10c2", title: "The Message", paragraphs: [
                      "On the third day, the signal peaked. Priya sat in the observatory with her headphones on, listening. The structure resolved into words — not English, not any language she knew, but something she could feel meaning in.",
                      "The message was a warning. She understood it not through translation but through something deeper, something the radio wasn't supposed to be able to do. 'Do not build the machine,' the message said. 'The machine you are about to build will work. That is the problem.'",
                      "Priya looked at her notes. For six months, she'd been designing a quantum computer. A machine that would, theoretically, be able to receive messages from the future. She looked at the radio. She looked at her notes. She deleted them."
                  ])
              ],
              likes: 2890, bookmarks: 1020, views: 19700,
              tags: ["time", "first-contact", "warning"], publishedOffset: 1, isFeatured: true),

        Story(id: "story-11", title: "Solitude", authorId: "aarav",
              genre: .romance,
              synopsis: "Two strangers come to a remote island to be alone. A storm has other plans.",
              chapters: [
                  Chapter(id: "s11c1", title: "The Island", paragraphs: [
                      "He came to the island to be alone. She came for the same reason. They met on the ferry, recognized something in each other's faces — the particular exhaustion of someone who has had enough of people — and said nothing.",
                      "The island was small. One village, one beach, one path that wound through pine forest to a lighthouse. He took the lighthouse. She took the village. They nodded at each other on the path and kept walking.",
                      "On the third day, it rained. He was at the lighthouse, she was in the village, and the rain came down so hard the path became a river. They were both stuck. He looked out the lighthouse window. She looked down the village street. They were a mile apart, and the rain was between them."
                  ]),
                  Chapter(id: "s11c2", title: "The Storm", paragraphs: [
                      "The storm lasted two days. He ran out of food. She ran out of firewood. On the second morning, he saw her on the beach, collecting driftwood. He walked down from the lighthouse, rain soaking through his coat.",
                      "They worked together without speaking. She gathered wood. He carried it. When the pile was big enough, they stood in the rain and looked at each other. 'I have food,' he said. 'I have a fireplace,' she said.",
                      "They ate dinner by the fire. They talked until the rain stopped. When the path was passable again, neither of them mentioned leaving. The ferry came on Friday. They didn't take it. They took the next one, two weeks later, together."
                  ])
              ],
              likes: 170, bookmarks: 90, views: 1500,
              tags: ["quiet", "island", "connection"], publishedOffset: 3, isFeatured: false),

        Story(id: "story-12", title: "The Paper Crane", authorId: "zoeok",
              genre: .mythology,
              synopsis: "An old woman folds paper cranes for forty years. When a boy wishes on one, the magic isn't where he thinks.",
              chapters: [
                  Chapter(id: "s12c1", title: "The Village", paragraphs: [
                      "In the village of Fukushima, there lived an old woman who folded paper cranes. She had been folding them for forty years, since her daughter was born. Her daughter was gone now, but the folding continued.",
                      "Every crane was different. Some were red, some were gold, some were white. The old woman hung them from the ceiling of her small house, and when the wind blew through the window, they turned slowly, casting shadows like birds in flight.",
                      "The children of the village believed the cranes were magic. They believed that if you wished on one, the wish would come true — but only if you wished for someone else, never for yourself. The old woman never confirmed this. She just kept folding."
                  ]),
                  Chapter(id: "s12c2", title: "The Wish", paragraphs: [
                      "A boy came to the old woman's house on a winter morning. He was thin, cold, and alone. His parents had gone to the city and hadn't come back. He wished, not for himself, but for his dog, who was sick.",
                      "The old woman gave him a crane — white, the smallest one, the one that hung closest to the window. 'Fold it again,' she said. 'Unfold it and fold it once more, and the wish will carry.' The boy took the crane home and did as she said.",
                      "The dog got better. The boy came back to thank the old woman, but the house was empty. The cranes were gone. All that was left was a single piece of paper, unfolded, with a handwritten note: 'The magic was never in the crane. It was in the folding. Thank you for folding.' The boy kept the paper. He learned to fold cranes. He taught others. The village never forgot."
                  ])
              ],
              likes: 18, bookmarks: 6, views: 140,
              tags: ["folk-tale", "kindness", "tradition"], publishedOffset: 5, isFeatured: true)
    ]

    /// The remaining seed stories broaden language, genre, and engagement coverage.
    private static let expandedStories: [Story] = [
        expandedStory(id: "story-13", title: "The Bakery at Platform Nine", authorId: "mayak", genre: .romance, language: "en", synopsis: "Two commuters keep missing the same train and finding each other at the bakery beside the platform.", paragraphs: [
            "Every morning at 7:12, Mira bought one cardamom bun from the bakery beside Platform Nine. Every morning at 7:14, the train left without her. She told people the delay was deliberate, a small rebellion against the tyranny of timetables, but the truth was simpler: the baker's daughter had learned her order and saved the warmest bun for last.",
            "The man with the blue umbrella appeared on a rainy Tuesday. He stood beside the display case, reading the menu as if it were a difficult poem. When Mira reached for the last bun, his hand reached too. They laughed, apologized, and split it with a paper knife. The train arrived. Neither of them moved.",
            "By winter, the bakery knew them as a pair. They traded stories in the ten minutes before work, learning the shape of each other's silences. On the morning Mira finally boarded Platform Nine, the man with the blue umbrella was waiting inside the carriage, holding two buns and a ticket for the long way home."
        ], reads: 1200, likes: 140, comments: 18, tags: ["second-chance", "daily-life", "slow-burn"], offset: 4),
        expandedStory(id: "story-14", title: "The Orchard of Names", authorId: "priyanair", genre: .fantasy, language: "en", synopsis: "A child discovers an orchard where every fruit carries the name of someone the village has forgotten.", paragraphs: [
            "At the edge of the village stood an orchard no one entered. Its trees grew behind a wall of white stone, and its apples ripened in every season at once. Nila found the gate open on the day her grandmother forgot her name. She stepped through carrying a lantern, a red scarf, and the stubborn hope that memory could be harvested.",
            "Each fruit bore a name beneath its skin. Some belonged to dead kings, some to babies who had never drawn breath, and some to neighbors who still sat at the tea stall every evening. Nila picked one marked Devika. The orchard answered with a bell from somewhere underground, and the village dogs began to howl.",
            "She learned the orchard was not keeping the forgotten safe; it was waiting for someone brave enough to return them. Nila carried the names home one by one. Her grandmother remembered her own name last, and then whispered Nila's as if she had been holding it all along."
        ], reads: 950, likes: 110, comments: 15, tags: ["memory", "found-family", "magic"], offset: 6),
        expandedStory(id: "story-15", title: "The House That Counted", authorId: "zoeok", genre: .mystery, language: "en", synopsis: "A caretaker realizes the old house has been counting visitors, but one number has no owner.", paragraphs: [
            "The house had twelve windows, eleven rooms, and a brass counter beside the front door. Elias polished it every morning because the owner believed dust encouraged ghosts. The counter displayed 4,812. The number rose whenever someone entered and never fell when they left.",
            "On Thursday, a woman arrived carrying a red suitcase and asked for Room Twelve. Elias told her there was no Room Twelve. She smiled as though he had confirmed something, then walked upstairs while the counter clicked once, twice, three times. By dusk it read 4,816.",
            "Elias searched the blueprints beneath the kitchen floor and found a room drawn in ink that had faded almost to gray. Its door opened behind the mirror in the hallway. Inside were hundreds of shoes, all paired neatly, and a notebook listing every visitor except the person who had built the house."
        ], reads: 700, likes: 80, comments: 11, tags: ["hidden-rooms", "quiet-dread", "unreliable-narrator"], offset: 7),
        expandedStory(id: "story-16", title: "Signal Orchard", authorId: "rentakahashi", genre: .scifi, language: "en", synopsis: "A radio engineer finds a pattern in the static between trees and discovers the forest is listening.", paragraphs: [
            "The orchard was planted around the radio telescope because fruit trees made the grounds look less like a warning. Hana worked the night shift, when the dishes turned toward the cold dark and the only sound was the soft click of machinery. On the first night of spring, the static changed whenever the wind moved through the branches.",
            "She recorded the pattern and played it back beneath the trees. The leaves answered. Not with sound, but with a synchronized shimmer that crossed the orchard from west to east. Hana tested the effect with music, numbers, and her own voice. The trees responded only to questions.",
            "Her final question was whether anyone was there. The telescope moved by itself. Across the sky, a line of stars blinked in the same rhythm as the leaves. Hana understood then that the orchard was not receiving a signal. It was the signal, patiently growing roots while the universe waited for her to notice."
        ], reads: 1800, likes: 190, comments: 24, tags: ["first-contact", "nature", "listening"], offset: 2),
        expandedStory(id: "story-17", title: "The Quiet Witness", authorId: "zoeok", genre: .thriller, language: "en", synopsis: "A court stenographer hears one sentence that was never spoken and risks everything to prove it.", paragraphs: [
            "The stenographer's room overlooked the courtroom through a narrow pane of glass. Lena had transcribed six years of confessions, denials, and the careful grammar of people who believed truth could be negotiated. She trusted the machines more than the witnesses. Machines did not tremble when they lied.",
            "During the Vale hearing, the recording captured a sentence no one remembered hearing: You have three days. Lena replayed it until the waveform blurred. The judge denied it. The lawyers called it interference. That evening, an envelope appeared on her desk containing a photograph of the courtroom taken from above.",
            "In the photograph, every person faced the witness stand except Lena. She was looking directly at the camera. The next morning the sentence appeared again, this time at the end of a recording made two years earlier. Lena copied every file to a hidden drive and began counting backward from three."
        ], reads: 1300, likes: 150, comments: 20, tags: ["conspiracy", "countdown", "truth"], offset: 3),
        expandedStory(id: "story-18", title: "Tuesday at the Laundromat", authorId: "aarav", genre: .sliceOfLife, language: "en", synopsis: "A broken washing machine turns a neighborhood errand into an unexpected evening of care.", paragraphs: [
            "The washing machine on the left had been broken since Tuesday, though it was Tuesday again before anyone admitted it. Sam arrived with two bags of uniforms and found the laundromat full of people waiting for the same three working machines. The television showed a cooking competition with the sound turned off.",
            "Someone offered him a chair. Someone else offered detergent. A little girl drew a blue house on the fogged glass while her father folded towels with the concentration of a surgeon. Sam learned the names of the people beside him because the machines took exactly thirty-seven minutes to finish.",
            "When the power went out, nobody complained. They opened the doors, carried damp clothes into the evening, and stood beneath the streetlight sorting socks by color. Sam went home with clean uniforms, three new phone numbers, and the strange feeling that the neighborhood had been waiting for a small inconvenience to introduce itself."
        ], reads: 650, likes: 60, comments: 7, tags: ["community", "small-joys", "belonging"], offset: 9),
        expandedStory(id: "story-19", title: "The Cartographer's Daughter", authorId: "elenar", genre: .historical, language: "en", synopsis: "In 17th-century Florence, a mapmaker's daughter finds a coastline her father was ordered to erase.", paragraphs: [
            "Isabella learned geography from the backs of letters because her father would not let her touch his maps. He said the world was a man's profession, then spent every night drawing coastlines by candlelight. One evening she found a strip of blue paper hidden beneath his desk, marked with a shore that did not exist on any official chart.",
            "The next day soldiers came for the mapmaker. The duke wanted the coastline erased, not because it was false, but because ships had begun returning with stories of a city beyond it. Isabella hid the blue paper inside her bodice and followed the soldiers to the archive.",
            "She discovered her father had been mapping a community of women who sheltered escaped servants and taught them to read. The erased coast was not a place; it was a promise. Isabella finished the map, signed it with her own name, and placed it where the duke's men would be forced to see it."
        ], reads: 140, likes: 20, comments: 3, tags: ["hidden-history", "courage", "maps"], offset: 12),
        expandedStory(id: "story-20", title: "Borrowed Weather", authorId: "mayak", genre: .contemporary, language: "en", synopsis: "A weather app begins sending forecasts for the emotions its users are trying to hide.", paragraphs: [
            "The app promised ordinary weather in beautiful colors. Rain meant carry an umbrella; sun meant leave early. Then it sent Noor a forecast that said: heavy regret after 6 PM, clearing by morning. She deleted it, reinstalled it, and received the same message with a chance of apology.",
            "Soon everyone in the office had a forecast. The manager's week contained scattered thunderstorms. The intern's skies were bright but unfamiliar. Noor stopped checking the temperature and began calling the people named in the small print beneath each warning.",
            "On Friday, the app forecast a storm over the entire city. Noor walked outside and found clear skies. Across the street, strangers were hugging in the sunlight, having finally said what their phones had predicted. She opened the app one last time. It asked for her location. She chose nowhere."
        ], reads: 120, likes: 18, comments: 2, tags: ["digital-life", "honesty", "connection"], offset: 13),
        expandedStory(id: "story-21", title: "Constellations in the Kitchen", authorId: "kainak", genre: .lgbtq, language: "en", synopsis: "Two women renovate a kitchen and uncover a constellation scratched beneath generations of paint.", paragraphs: [
            "The first thing Jo and Lila did in the new apartment was remove the yellow cabinets. Beneath them, on the plaster, someone had drawn stars in charcoal. The pattern was not any constellation they knew. Jo photographed it before Lila painted the wall white.",
            "They argued about the color for three days, then laughed because the argument was really about whether the apartment belonged to them yet. At night they cooked noodles on a camping stove and traced the hidden stars from memory. Each mark seemed to move when they looked away.",
            "When the kitchen was finished, they left one corner unpainted. The constellation had become a map of their first year together: the broken kettle, the missed train, the letter from Lila's mother. Under the final star they wrote their names, not as an answer, but as proof they had arrived."
        ], reads: 90, likes: 12, comments: 1, tags: ["queer-joy", "home", "chosen-family"], offset: 14),
        expandedStory(id: "story-22", title: "A Very Serious Goose", authorId: "rahuls", genre: .comedy, language: "en", synopsis: "A village council must negotiate with a goose that has decided the park belongs to it.", paragraphs: [
            "The goose arrived on a Monday and immediately took the mayor's chair. Nobody knew where it came from, but it possessed the confidence of an elected official and the appetite of a small storm. When the mayor attempted to move it, the goose honked once. The council postponed the meeting.",
            "By Wednesday, the goose had a name, a schedule, and three formal complaints. Children left it crackers. Adults crossed the road. The mayor hired a consultant who advised treating the animal as a stakeholder. The goose accepted the proposal by eating the consultant's report.",
            "On Friday, the council voted unanimously to recognize the goose as guardian of the park. It celebrated by chasing a bicycle into the fountain. The mayor called it a success. The goose took the chair again, and for the first time in years every council member arrived early."
        ], reads: 75, likes: 10, comments: 2, tags: ["absurdity", "community", "found-family"], offset: 15),
        expandedStory(id: "story-23", title: "दीये की लौ", authorId: "priyanair", genre: .spirituality, language: "hi", synopsis: "एक छोटी लौ एक थके हुए यात्री को अपने भीतर का रास्ता दिखाती है।", paragraphs: [
            "गाँव के बाहर एक पुराना मंदिर था जहाँ हर शाम एक दीया जलता था। उसकी देखभाल करने वाली अम्मा कहती थीं कि लौ रास्ता नहीं दिखाती, वह बस इतना उजाला करती है कि अगला कदम दिखाई दे। एक रात नील बहुत थका हुआ वहाँ पहुँचा और बोला कि उसे अपनी दिशा खो गई है।",
            "अम्मा ने उसे दीया नहीं दिया। उन्होंने उसके पास बैठकर पूछा कि आखिरी बार वह कब बिना डर के चला था। नील ने देर तक चुप रहकर अपने पिता की आवाज़, सूखे खेत और शहर की भीड़ के बारे में बताया। लौ हवा में काँपी, मगर बुझी नहीं।",
            "सुबह नील ने देखा कि मंदिर से उसके घर तक मिट्टी पर छोटे-छोटे पैरों के निशान थे। वे किसी चमत्कार के नहीं, उसके अपने थे। उसने समझा कि रास्ता रात में नहीं बना था; वह हर बार बनता है जब कोई व्यक्ति अँधेरे में एक कदम रखता है।"
        ], reads: 80, likes: 9, comments: 1, tags: ["inner-peace", "faith", "homecoming"], offset: 16),
        expandedStory(id: "story-24", title: "पहली सीढ़ी", authorId: "rahuls", genre: .motivational, language: "hi", synopsis: "एक असफल धावक सीखता है कि छोटी शुरुआत भी आगे बढ़ने की शुरुआत होती है।", paragraphs: [
            "राघव ने दौड़ने की शुरुआत बड़े सपने से की थी। पहले दिन उसने पाँच किलोमीटर का लक्ष्य रखा और चार सौ मीटर बाद घर लौट आया। जूते कोने में पड़े रहे। हर सुबह वह उन्हें देखता और अपने आप से कहता कि कल से सब बदल जाएगा। कल हमेशा बहुत दूर था।",
            "एक बूढ़े चौकीदार ने उसे सीढ़ियों पर बैठे देखा और कहा, ‘आज बस पहली सीढ़ी चढ़ो।’ राघव ने हँसकर पूछा कि उससे क्या होगा। चौकीदार ने कहा कि दूसरी सीढ़ी को पहली की चिंता नहीं होती; वह बस अपने ऊपर टिके पैर को संभालती है।",
            "राघव ने अगले दिन एक सीढ़ी चढ़ी, फिर दो, फिर पाँच। महीनों बाद वह दौड़ने लगा, मगर उसने अपनी पहली सीढ़ी नहीं छोड़ी। उसने उसे कागज़ पर बनाया और मेज़ के पास रख दिया, ताकि जीत के दिनों में भी उसे याद रहे कि प्रगति अक्सर बहुत छोटी आवाज़ में दरवाज़ा खटखटाती है।"
        ], reads: 110, likes: 14, comments: 2, tags: ["small-steps", "discipline", "resilience"], offset: 17),
        expandedStory(id: "story-25", title: "चाँद का डिब्बा", authorId: "kathaai", genre: .kids, language: "hi", synopsis: "एक बच्ची चाँद की रोशनी को डिब्बे में भरकर अपने बीमार पेड़ को बचाना चाहती है।", paragraphs: [
            "मीरा को लगता था कि चाँद की रोशनी दूध जैसी होती है। वह हर रात खिड़की के पास एक खाली डिब्बा रखती और सुबह उसे खोलकर देखती। डिब्बा खाली होता, मगर मीरा फिर भी मुस्कुराती क्योंकि चाँद ने उसे भरोसा दिया था कि वह कोशिश देख रहा है।",
            "एक दिन स्कूल से लौटकर उसने देखा कि आँगन का नींबू का पेड़ झुक गया है। दादी ने कहा कि पेड़ को पानी, धूप और धैर्य चाहिए। मीरा ने अपना डिब्बा पेड़ के पास रख दिया और उसमें अपनी सबसे अच्छी बातें भरने लगी—एक गीत, दो हँसी और एक छोटा सा धन्यवाद।",
            "कुछ दिनों बाद नई पत्तियाँ निकलीं। दादी ने कहा कि जादू पानी और देखभाल में था। मीरा ने डिब्बे को चाँद की ओर उठाया। उसे पता था कि दादी सही हैं, फिर भी उसने ढक्कन बंद कर दिया, ताकि थोड़ी सी रोशनी अगली मुश्किल रात के लिए बची रहे।"
        ], reads: 60, likes: 8, comments: 1, tags: ["wonder", "kindness", "nature"], offset: 18),
        expandedStory(id: "story-26", title: "नदी की रानी", authorId: "mayak", genre: .fantasy, language: "hi", synopsis: "एक नाविक की बेटी नदी से अपने गाँव की भूली हुई कहानी सुनती है।", paragraphs: [
            "जब सावन की पहली बारिश आई, कावेरी की नदी अपने किनारों से बाहर आ गई। गाँव के लोग नावें बाँधने लगे, लेकिन छोटी अनया पानी के बीच एक नीली रोशनी देखती रही। उसकी माँ ने कहा कि वह नदी की रानी का दीपक है और उसे छूना मना है। अनया ने पूछा कि रानी कौन है; किसी के पास उत्तर नहीं था।",
            "रात में नदी ने उसका नाम पुकारा। अनया चुपचाप घाट तक गई और पानी में उतरे बिना अपना कान लहरों के पास ले आई। नदी ने उसे उन लोगों की बातें सुनाईं जिन्होंने गाँव बसाया था, उन खेतों की जिन्हें बाढ़ ने निगल लिया, और उस वचन की जिसे हर पीढ़ी भूलती गई।",
            "सुबह अनया ने बुज़ुर्गों को सारी कहानी सुनाई। उन्होंने पुराने गीत पहचाने और पहली बार नदी के लिए उत्सव रखा। नीली रोशनी दूर चली गई। अनया समझ गई कि रानी कहीं बाहर नहीं थी; वह हर आवाज़ में थी जिसे गाँव ने बचाकर रखा।"
        ], reads: 160, likes: 21, comments: 3, tags: ["river", "ancestry", "courage"], offset: 19),
        expandedStory(id: "story-27", title: "पीपल का देवता", authorId: "zoeok", genre: .mythology, language: "hi", synopsis: "एक गाँव का पीपल का पेड़ अपने नीचे बैठने वालों की सच्ची इच्छा सुनता है।", paragraphs: [
            "गाँव के बीच पीपल का पेड़ था, इतना पुराना कि उसकी जड़ों ने पत्थर की चौकी को गले लगा लिया था। लोग उसे देवता कहते, पर पेड़ कभी बोलता नहीं था। बच्चे उसकी छाँव में खेलते, किसान दोपहर में सोते और यात्री चुपचाप पानी पीकर आगे बढ़ जाते।",
            "एक वर्ष बारिश नहीं हुई। मंदिर में घंटियाँ बजीं, कुएँ सूखे, और लोग आसमान को देखते रहे। तभी छोटी गौरी पेड़ के नीचे बैठी और बोली कि उसे बारिश नहीं, पड़ोसी गाँव के साथ बाँटा हुआ कुआँ चाहिए। उसकी इच्छा सुनकर लोग पहले हँसे, फिर शर्मिंदा हुए।",
            "दोनों गाँवों ने मिलकर पुरानी नहर खोदी। पानी लौट आया, मगर किसी ने नहीं कहा कि पेड़ ने चमत्कार किया। गौरी ने उसकी छाल पर हाथ रखा। हवा चली और पत्तियाँ बज उठीं—जैसे कोई देवता नहीं, पूरा गाँव एक साथ धन्यवाद कह रहा हो।"
        ], reads: 130, likes: 16, comments: 2, tags: ["community", "shared-future", "tradition"], offset: 20),
        expandedStory(id: "story-28", title: "La casa de los domingos", authorId: "diegoa", genre: .drama, language: "es", synopsis: "Una familia se reúne cada domingo en una casa que guarda las voces de quienes ya no están.", paragraphs: [
            "Cada domingo, Clara abría la casa de su abuela aunque llevaba tres años vacía. Primero llegaban las sillas, luego el olor del café y finalmente los primos, cada uno con una excusa distinta para no hablar de la venta. La casa crujía cuando alguien decía la palabra despedida.",
            "Una tarde encontraron una caja de casetes detrás del armario. En cada cinta había una receta, una canción o una discusión familiar grabada por accidente. Escucharon la voz de la abuela riéndose de todos ellos y, por un momento, nadie quiso ser el primero en llorar.",
            "Decidieron vender la casa, pero no ese día. Antes de irse pintaron la puerta de azul y copiaron las cintas. El domingo siguiente se reunieron en el piso nuevo de Clara. No era la misma casa, pero las voces habían aprendido a viajar."
        ], reads: 90, likes: 10, comments: 1, tags: ["family", "grief", "homecoming"], offset: 21),
        expandedStory(id: "story-29", title: "La ventana del sótano", authorId: "diegoa", genre: .horror, language: "es", synopsis: "Un hombre descubre una ventana en el sótano que muestra una habitación de su propia casa.", paragraphs: [
            "La ventana apareció después de la tormenta. Estaba en el sótano, pequeña y cubierta de barro, aunque la pared no daba al exterior. Tomás limpió el vidrio y vio su cocina al otro lado. La mesa estaba puesta para dos personas. En su cocina real, la mesa estaba vacía.",
            "Durante la noche, la otra cocina cambió. Una taza se rompió, una silla se movió y una mujer cruzó la imagen sin rostro. Tomás llamó a su hermana, pero cuando ella llegó la ventana solo reflejaba la pared. Antes de irse, ella le preguntó por qué había dos tazas en la mesa.",
            "A la mañana siguiente, Tomás bajó al sótano con un martillo. La ventana mostraba ahora el sótano, y él mismo estaba de pie detrás del vidrio. Cerró los ojos. Cuando volvió a abrirlos, escuchó un golpe suave desde el otro lado."
        ], reads: 70, likes: 8, comments: 0, tags: ["haunted-house", "isolation", "storm"], offset: 22),
        expandedStory(id: "story-30", title: "風の地図", authorId: "kainak", genre: .adventure, language: "ja", synopsis: "風の音だけを頼りに、少年が祖父の失われた山道を探す。", paragraphs: [
            "祖父の机の引き出しから、白い紙が一枚見つかった。地図のように見えたが、道も山も描かれていない。紙を窓辺に置くと、風が吹くたびに薄い線が現れた。少年の蓮は、それが祖父の歩いた道だとすぐに分かった。",
            "夏の朝、蓮は小さな水筒と赤い布を持って山へ入った。風は右から吹くときだけ、遠くの鐘の音を運んだ。彼は音を追い、苔の下に隠れた石段や、木の枝に結ばれた古い糸を見つけた。",
            "頂上には誰もいなかった。ただ、風が紙の地図を空へ持ち上げ、祖父の字を浮かび上がらせた。『帰る道は、見つけるものではなく、誰かに伝えるものだ。』蓮は赤い布を枝に結び、次の旅人のために道を残した。"
        ], reads: 150, likes: 22, comments: 4, tags: ["mountain", "legacy", "journey"], offset: 23)
    ]

    private static func expandedStory(id: String, title: String, authorId: String, genre: Genre, language: String, synopsis: String, paragraphs: [String], reads: Int, likes: Int, comments: Int, tags: [String], offset: Int) -> Story {
        Story(id: id, title: title, authorId: authorId, genre: genre, synopsis: synopsis, chapters: [Chapter(id: "\(id)-c1", title: "Chapter 1", paragraphs: paragraphs)], likes: likes, bookmarks: max(1, likes / 2), views: reads, tags: tags, publishedOffset: offset, isFeatured: false, contentRating: genre == .kids ? .kids : (genre == .horror ? .mature : .teen), languageCode: language.uppercased(), language: language, commentCount: comments)
    }

    private static func singleChapter(_ story: Story) -> Story {
        guard ["story-1", "story-2", "story-4", "story-5"].contains(story.id) else {
            return Story(id: story.id, title: story.title, authorId: story.authorId, genre: story.genre, synopsis: story.synopsis, chapters: Array(story.chapters.prefix(1)), likes: story.likes, bookmarks: story.bookmarks, views: story.views, tags: story.tags, publishedOffset: story.publishedOffset, isFeatured: story.isFeatured, followerCount: story.followerCount, plannedChapterCount: nil, contentRating: story.contentRating, languageCode: story.languageCode, language: story.language, commentCount: story.commentCount)
        }
        return story
    }

    static let stories: [Story] = baseStories.map(singleChapter) + expandedStories

    // MARK: - Seed Comments (~30 top-level + 15 replies across 5 stories)

    static let seedComments: [StoryComment] = [
        // Story 1 — The Last Lighthouse Keeper
        StoryComment(id: "sc1", storyId: "story-1", authorId: "mayak", username: "mayak", displayName: "Maya Kapoor", text: "The atmosphere in this is incredible. I could smell the salt.", likes: 24, postedOffsetHours: 5, isVerified: true),
        StoryComment(id: "sc2", storyId: "story-1", authorId: "diegoa", username: "diegoa", displayName: "Diego Alvarez", text: "That ending! I need more chapters immediately.", likes: 12, postedOffsetHours: 12, isVerified: false),
        StoryComment(id: "sc3", storyId: "story-1", authorId: "priyanair", username: "priyanair", displayName: "Priya Nair", text: "Time travel without the clichés — just a quiet, patient dread. Beautiful.", likes: 18, postedOffsetHours: 8, isVerified: false),
        StoryComment(id: "sc4", storyId: "story-1", authorId: "ghost-0", username: "noorwrites", displayName: "Noor Haddad", text: "Read this in one sitting. The lighthouse felt like a character itself.", likes: 7, postedOffsetHours: 3, isVerified: false),
        StoryComment(id: "sc5", storyId: "story-1", authorId: "rentakahashi", username: "rentakahashi", displayName: "Ren Takahashi", text: "The prose is so precise. Every word earns its place.", likes: 15, postedOffsetHours: 20, isVerified: false),
        StoryComment(id: "sc6", storyId: "story-1", authorId: "ghost-5", username: "tashastories", displayName: "Tasha Ivanova", text: "The storm sequence gave me chills. Literal chills.", likes: 5, postedOffsetHours: 2, isVerified: false),
        StoryComment(id: "sc7", storyId: "story-1", authorId: "kainak", username: "kainak", displayName: "Kai Nakamura", text: "Agreed. Reminds me of Annie Proulx's economy.", likes: 4, postedOffsetHours: 18, isVerified: false, replyToUsername: "rentakahashi"),
        StoryComment(id: "sc8", storyId: "story-1", authorId: "aarav", username: "aarav", displayName: "Aarav Menon", text: "Thank you! The lighthouse was the first thing I wrote.", likes: 9, postedOffsetHours: 1, isVerified: false, replyToUsername: "noorwrites"),
        StoryComment(id: "sc9", storyId: "story-1", authorId: "elenar", username: "elenar", displayName: "Elena Rossi", text: "'Quiet, patient dread' is the perfect description.", likes: 6, postedOffsetHours: 6, isVerified: true, replyToUsername: "priyanair"),

        // Story 2 — Midnight in Marrakech
        StoryComment(id: "sc10", storyId: "story-2", authorId: "priyanair", username: "priyanair", displayName: "Priya Nair", text: "The door in the medina wall — I've been looking for it ever since.", likes: 31, postedOffsetHours: 3, isVerified: false),
        StoryComment(id: "sc11", storyId: "story-2", authorId: "rentakahashi", username: "rentakahashi", displayName: "Ren Takahashi", text: "Zoe writes mystery like no one else. Every detail matters.", likes: 18, postedOffsetHours: 8, isVerified: false),
        StoryComment(id: "sc12", storyId: "story-2", authorId: "mayak", username: "mayak", displayName: "Maya Kapoor", text: "The spice merchant was my favorite character. I wanted more of him.", likes: 22, postedOffsetHours: 10, isVerified: true),
        StoryComment(id: "sc13", storyId: "story-2", authorId: "ghost-3", username: "amara.reads", displayName: "Amara Diallo", text: "I couldn't sleep after reading this. In the best way.", likes: 9, postedOffsetHours: 4, isVerified: false),
        StoryComment(id: "sc14", storyId: "story-2", authorId: "elenar", username: "elenar", displayName: "Elena Rossi", text: "The sense of place is extraordinary. Marrakech came alive.", likes: 14, postedOffsetHours: 16, isVerified: true),
        StoryComment(id: "sc15", storyId: "story-2", authorId: "kainak", username: "kainak", displayName: "Kai Nakamura", text: "Maya is such a compelling protagonist. I need a sequel.", likes: 11, postedOffsetHours: 22, isVerified: false),
        StoryComment(id: "sc16", storyId: "story-2", authorId: "zoeok", username: "zoeok", displayName: "Zoe Okonkwo", text: "Thank you! The merchant was inspired by a real person I met.", likes: 15, postedOffsetHours: 7, isVerified: true, replyToUsername: "mayak"),
        StoryComment(id: "sc17", storyId: "story-2", authorId: "aarav", username: "aarav", displayName: "Aarav Menon", text: "Zoe's world-building is unmatched.", likes: 5, postedOffsetHours: 12, isVerified: false, replyToUsername: "elenar"),
        StoryComment(id: "sc18", storyId: "story-2", authorId: "ghost-10", username: "dev_reads", displayName: "Dev Patel", text: "Same! I went to Marrakech just to look for it.", likes: 3, postedOffsetHours: 1, isVerified: false, replyToUsername: "priyanair"),

        // Story 5 — The Weaver's Daughter
        StoryComment(id: "sc19", storyId: "story-5", authorId: "elenar", username: "elenar", displayName: "Elena Rossi", text: "The banner that makes soldiers honest — what a concept. I'm in awe.", likes: 35, postedOffsetHours: 4, isVerified: true),
        StoryComment(id: "sc20", storyId: "story-5", authorId: "rahuls", username: "rahuls", displayName: "Rahul Sharma", text: "Fantasy with a moral spine. This is why I read.", likes: 19, postedOffsetHours: 6, isVerified: false),
        StoryComment(id: "sc21", storyId: "story-5", authorId: "aarav", username: "aarav", displayName: "Aarav Menon", text: "Pema is my new favorite character in all of fiction.", likes: 27, postedOffsetHours: 9, isVerified: false),
        StoryComment(id: "sc22", storyId: "story-5", authorId: "zoeok", username: "zoeok", displayName: "Zoe Okonkwo", text: "The moonlight weaving imagery was pure magic. Literally.", likes: 21, postedOffsetHours: 14, isVerified: true),
        StoryComment(id: "sc23", storyId: "story-5", authorId: "ghost-15", username: "santiagos", displayName: "Santiago Reyes", text: "My daughter and I read this together. She wants to learn to weave now.", likes: 12, postedOffsetHours: 5, isVerified: false),
        StoryComment(id: "sc24", storyId: "story-5", authorId: "diegoa", username: "diegoa", displayName: "Diego Alvarez", text: "The king got exactly what he deserved. Perfect ending.", likes: 16, postedOffsetHours: 18, isVerified: false),
        StoryComment(id: "sc25", storyId: "story-5", authorId: "mayak", username: "mayak", displayName: "Maya Kapoor", text: "Thank you! Pema came to me fully formed.", likes: 8, postedOffsetHours: 6, isVerified: true, replyToUsername: "aarav"),
        StoryComment(id: "sc26", storyId: "story-5", authorId: "priyanair", username: "priyanair", displayName: "Priya Nair", text: "This is the sweetest comment I've read all week.", likes: 5, postedOffsetHours: 3, isVerified: false, replyToUsername: "santiagos"),
        StoryComment(id: "sc27", storyId: "story-5", authorId: "kainak", username: "kainak", displayName: "Kai Nakamura", text: "The ending was absolutely perfect.", likes: 3, postedOffsetHours: 15, isVerified: false, replyToUsername: "diegoa"),

        // Story 8 — Stargazer
        StoryComment(id: "sc28", storyId: "story-8", authorId: "zoeok", username: "zoeok", displayName: "Zoe Okonkwo", text: "Everything in the sky is a ghost. I keep rereading that line.", likes: 44, postedOffsetHours: 2, isVerified: true),
        StoryComment(id: "sc29", storyId: "story-8", authorId: "mayak", username: "mayak", displayName: "Maya Kapoor", text: "Elena writes poetry the way the sky arranges stars — slow, patient, inevitable.", likes: 28, postedOffsetHours: 5, isVerified: true),
        StoryComment(id: "sc30", storyId: "story-8", authorId: "rentakahashi", username: "rentakahashi", displayName: "Ren Takahashi", text: "The father-daughter thread through this destroyed me. Quietly.", likes: 20, postedOffsetHours: 8, isVerified: false),
        StoryComment(id: "sc31", storyId: "story-8", authorId: "ghost-20", username: "sanaa_reads", displayName: "Sanaa Khan", text: "I read this on a rooftop at 2am. Perfect setting.", likes: 8, postedOffsetHours: 3, isVerified: false),
        StoryComment(id: "sc32", storyId: "story-8", authorId: "kainak", username: "kainak", displayName: "Kai Nakamura", text: "Short, devastating, perfect. Elena is a national treasure.", likes: 16, postedOffsetHours: 12, isVerified: false),
        StoryComment(id: "sc33", storyId: "story-8", authorId: "priyanair", username: "priyanair", displayName: "Priya Nair", text: "Betelgeuse is dimmer now broke something in me and I'm grateful.", likes: 12, postedOffsetHours: 18, isVerified: false),
        StoryComment(id: "sc34", storyId: "story-8", authorId: "elenar", username: "elenar", displayName: "Elena Rossi", text: "That's the kindest thing anyone has said about my work.", likes: 10, postedOffsetHours: 4, isVerified: true, replyToUsername: "mayak"),
        StoryComment(id: "sc35", storyId: "story-8", authorId: "aarav", username: "aarav", displayName: "Aarav Menon", text: "'Quietly' is doing so much work in that sentence.", likes: 6, postedOffsetHours: 6, isVerified: false, replyToUsername: "rentakahashi"),
        StoryComment(id: "sc36", storyId: "story-8", authorId: "zoeok", username: "zoeok", displayName: "Zoe Okonkwo", text: "This is the only correct way to read this poem.", likes: 4, postedOffsetHours: 1, isVerified: true, replyToUsername: "sanaa_reads"),

        // Story 10 — Echoes of Tomorrow
        StoryComment(id: "sc37", storyId: "story-10", authorId: "rentakahashi", username: "rentakahashi", displayName: "Ren Takahashi", text: "A warning from the future that says 'don't build the machine' — chilling.", likes: 38, postedOffsetHours: 3, isVerified: false),
        StoryComment(id: "sc38", storyId: "story-10", authorId: "mayak", username: "mayak", displayName: "Maya Kapoor", text: "Priya deleting her notes at the end. What a moment.", likes: 25, postedOffsetHours: 7, isVerified: true),
        StoryComment(id: "sc39", storyId: "story-10", authorId: "kainak", username: "kainak", displayName: "Kai Nakamura", text: "Best hard sci-fi I've read this year. Maybe longer.", likes: 19, postedOffsetHours: 10, isVerified: false),
        StoryComment(id: "sc40", storyId: "story-10", authorId: "elenar", username: "elenar", displayName: "Elena Rossi", text: "The restraint of the ending is masterful. She just deleted them.", likes: 16, postedOffsetHours: 14, isVerified: true),
        StoryComment(id: "sc41", storyId: "story-10", authorId: "ghost-25", username: "felixfables", displayName: "Felix Wagner", text: "I had to put my phone down and stare at the wall. In a good way.", likes: 7, postedOffsetHours: 4, isVerified: false),
        StoryComment(id: "sc42", storyId: "story-10", authorId: "aarav", username: "aarav", displayName: "Aarav Menon", text: "The fact that she built the machine that could receive the warning...", likes: 14, postedOffsetHours: 20, isVerified: false),
        StoryComment(id: "sc43", storyId: "story-10", authorId: "priyanair", username: "priyanair", displayName: "Priya Nair", text: "Exactly. The non-action was the action.", likes: 8, postedOffsetHours: 10, isVerified: false, replyToUsername: "elenar"),
        StoryComment(id: "sc44", storyId: "story-10", authorId: "zoeok", username: "zoeok", displayName: "Zoe Okonkwo", text: "The paradox is so elegant it hurts.", likes: 5, postedOffsetHours: 5, isVerified: true, replyToUsername: "rentakahashi"),
        StoryComment(id: "sc45", storyId: "story-10", authorId: "mayak", username: "mayak", displayName: "Maya Kapoor", text: "That's the highest compliment a story can get.", likes: 4, postedOffsetHours: 2, isVerified: true, replyToUsername: "felixfables")
    ]

    static func seedComments(forStoryId id: String) -> [StoryComment] {
        seedComments.filter { $0.storyId == id }
    }

    /// All unique theme tags across stories (for Discover theme filter)
    static var allThemes: [String] {
        var seen = Set<String>()
        var result: [String] = []
        for story in stories {
            for tag in story.tags where !seen.contains(tag) {
                seen.insert(tag)
                result.append(tag)
            }
        }
        return result.sorted()
    }

    // MARK: - Helper Methods

    static func author(id: String) -> Author? {
        authors.first { $0.id == id }
    }

    static func stories(byAuthorId id: String) -> [Story] {
        stories.filter { $0.authorId == id }
    }

    static func stories(byGenre genre: Genre) -> [Story] {
        stories.filter { $0.genre == genre }
    }

    static var featuredStories: [Story] {
        stories.filter { $0.isFeatured }
    }

    static var trendingStories: [Story] {
        stories.sorted { $0.likes > $1.likes }
    }

    static var newStories: [Story] {
        stories.sorted { $0.publishedOffset < $1.publishedOffset }
    }

    static func search(query: String) -> [Story] {
        let q = query.lowercased()
        return stories.filter { story in
            story.title.lowercased().contains(q) ||
            story.synopsis.lowercased().contains(q) ||
            story.tags.contains { $0.lowercased().contains(q) } ||
            story.genre.displayName.lowercased().contains(q) ||
            (author(id: story.authorId)?.displayName.lowercased().contains(q) ?? false)
        }
    }


}
