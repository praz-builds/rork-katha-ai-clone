package com.rork.kathaai.data

import com.rork.kathaai.model.Author
import com.rork.kathaai.model.Chapter
import com.rork.kathaai.model.Genre
import com.rork.kathaai.model.ProfileUserItem
import com.rork.kathaai.model.Story
import com.rork.kathaai.model.StoryComment

object SeedData {

    val authors: List<Author> = listOf(
        Author("kathaai", "kathaai", "Katha AI", "The house account. Curated tales spun with care. Follow us for the best of Katha, weekly.", 12400, 30, true, 0),
        Author("aarav", "aarav", "Aarav Menon", "Writing stories about the small moments that shape a life. Based in Mumbai.", 3200, 4, false, 4),
        Author("zoeok", "zoeok", "Zoe Okonkwo", "Afrofuturism, thrillers, and everything in between. Lagos \u2192 London \u2192 wherever the story goes.", 5100, 5, true, 200),
        Author("priyanair", "priyanair", "Priya Nair", "Mythology-tinted fantasy from Kerala. New chapter every Sunday morning.", 2800, 3, false, 120),
        Author("mayak", "mayak", "Maya Kapoor", "Contemporary romance and second-chance stories. Weekend baker, weekday storyteller.", 6700, 6, true, 89),
        Author("rentakahashi", "rentakahashi", "Ren Takahashi", "Slow-burn sci-fi. Occasional horror. Tokyo native, night-shift writer.", 4400, 5, false, 45),
        Author("diegoa", "diegoa", "Diego Alvarez", "Buenos Aires. Magical realism, mostly in Spanish. Coffee-fueled at 3 AM.", 3900, 4, false, 22),
        Author("rahuls", "rahuls", "Rahul Sharma", "Motivational shorts. Grand ambitions, small steps. Write your own tomorrow.", 2600, 3, false, 30),
        Author("elenar", "elenar", "Elena Ross", "Historical fiction with a mystery twist. Living in Florence, dreaming in the 1600s.", 5200, 4, true, 78),
        Author("kainak", "kainak", "Kai Nakamura", "Poetry, mostly. Sometimes prose. Always short. Sometimes very short.", 3100, 3, false, 50)
    )

    /** Follow graph: authorId -> author ids that author follows (3-6 named authors each). */
    val mockFollowing: Map<String, List<String>> = mapOf(
        "kathaai" to emptyList(),
        "aarav" to listOf("mayak", "priyanair", "zoeok", "kathaai"),
        "mayak" to listOf("kathaai", "aarav", "elenar", "kainak", "zoeok"),
        "rentakahashi" to listOf("kathaai", "diegoa", "zoeok", "mayak"),
        "priyanair" to listOf("kathaai", "mayak", "elenar", "aarav", "kainak", "rahuls"),
        "diegoa" to listOf("rentakahashi", "zoeok", "kathaai"),
        "zoeok" to listOf("kathaai", "mayak", "elenar", "priyanair", "diegoa"),
        "rahuls" to listOf("kathaai", "priyanair", "aarav"),
        "elenar" to listOf("kathaai", "kainak", "mayak", "zoeok"),
        "kainak" to listOf("elenar", "kathaai", "priyanair")
    )

    /** 40 display-only ghost followers used to fill out Followers lists. */
    val ghostFollowers: List<ProfileUserItem> = listOf(
        "noorwrites" to "Noor Haddad", "sofiapage" to "Sofia Marino", "jinwoo_k" to "Jin-woo Kim",
        "amara.reads" to "Amara Diallo", "leotales" to "Leo Fernandez", "tashastories" to "Tasha Ivanova",
        "omarink" to "Omar Farouk", "lucia_verse" to "Lucia Mendes", "kenjipen" to "Kenji Watanabe",
        "freyafables" to "Freya Lindqvist", "dev_reads" to "Dev Patel", "chloequill" to "Chloe Martin",
        "santiagos" to "Santiago Reyes", "yukireader" to "Yuki Mori", "nia_writes" to "Nia Mensah",
        "gabrielink" to "Gabriel Costa", "astridtales" to "Astrid Berg", "tariqpage" to "Tariq Aziz",
        "elif_story" to "Elif Yilmaz", "marcoverse" to "Marco Bianchi", "sanaa_reads" to "Sanaa Khan",
        "felixfables" to "Felix Wagner", "imanwrites" to "Iman Cisse", "hana_pen" to "Hana Sato",
        "rafaelink" to "Rafael Torres", "ingridtales" to "Ingrid Olsen", "kwametells" to "Kwame Boateng",
        "mira_verse" to "Mira Novak", "stefanpage" to "Stefan Petrov", "aishastories" to "Aisha Bello",
        "tomasink" to "Tomas Dvorak", "lenaquill" to "Lena Fischer", "arjun_reads" to "Arjun Rao",
        "clarafables" to "Clara Dubois", "yusufwrites" to "Yusuf Demir", "emiliatales" to "Emilia Rossi",
        "nathanpage" to "Nathan Brooks", "zaravers" to "Zara Ahmed", "otisreads" to "Otis Coleman",
        "paulastory" to "Paula Vega"
    ).mapIndexed { index, (username, name) ->
        ProfileUserItem(
            id = "ghost-$index",
            username = username,
            displayName = name,
            bio = "",
            isVerified = false,
            isGhost = true
        )
    }

    /** Deterministic ghost distribution: each ghost follows one seed author. */
    fun ghostFollowersOf(authorId: String): List<ProfileUserItem> {
        val authorIndex = authors.indexOfFirst { it.id == authorId }
        if (authorIndex < 0) return emptyList()
        return ghostFollowers.filterIndexed { index, _ -> index % authors.size == authorIndex }
    }

    /** Full followers list for a seed author: seed authors who follow them + assigned ghosts (5-8 rows). */
    fun followersList(authorId: String): List<ProfileUserItem> {
        val authorFollowers = authors
            .filter { mockFollowing[it.id]?.contains(authorId) == true }
            .map { ProfileUserItem(it.id, it.username, it.displayName, it.bio, it.isVerified, isGhost = false) }
        return authorFollowers + ghostFollowersOf(authorId)
    }

    /** Following list (writers) for a seed author. */
    fun followingList(authorId: String): List<ProfileUserItem> {
        return (mockFollowing[authorId] ?: emptyList()).mapNotNull { id ->
            author(id)?.let { ProfileUserItem(it.id, it.username, it.displayName, it.bio, it.isVerified, isGhost = false) }
        }
    }

    fun storiesByAuthor(authorId: String): List<Story> =
        stories.filter { it.authorId == authorId }.sortedBy { it.publishedOffset }

    val stories: List<Story> = listOf(
        Story(
            id = "story-1", title = "The Last Lighthouse Keeper", authorId = "aarav", genre = Genre.FICTION,
            synopsis = "A lighthouse keeper receives a letter from the future warning of a storm that hasn't happened yet.",
            chapters = listOf(
                Chapter("s1c1", "The Letter", listOf(
                    "The bottle washed ashore on a Tuesday, green glass worn smooth by decades of salt and current. Tom Hardy had kept the lighthouse at Pemaquid Point for thirty-one years, and in that time he'd found many things on the beach. But never a bottle with a letter inside.",
                    "The paper was thick, hand-pressed, and the handwriting was precise, almost mechanical. 'Dear Keeper,' it began. 'By the time you read this, the light will have failed. I am writing from the future. The lighthouse fell in the storm of '78. I am asking you to prevent it.'",
                    "Tom read it three times, then set it on the kitchen table and watched it curl in the lamplight. The storm of '78 was twenty-six years away. The light hadn't failed. It still turned every night, sweeping its beam across the dark water like a slow, patient hand."
                )),
                Chapter("s1c2", "The Storm", listOf(
                    "The storm came three weeks after the letter. Tom had weathered a hundred storms, but this one was different. The wind didn't howl; it whispered, and in the whispering he heard words he couldn't quite make out.",
                    "At midnight, the light failed. Not flickered — failed, as if someone had cut the power. Tom grabbed the backup lamp and climbed the spiral stairs, his knees protesting every step. At the top, the lens was dark.",
                    "He replaced the bulb. The new one lit, turned, swept the sea. And in the beam's arc, far out on the water, he saw a ship — wooden masts, canvas sails, the lighthouse tender from the 1950s. It was sinking. And on its deck, waving a lantern, stood a man who looked exactly like Tom."
                ))
            ),
            likes = 1840, bookmarks = 620, views = 12400,
            tags = listOf("atmospheric", "time", "coastal"), publishedOffset = 2, isFeatured = true
        ),
        Story(
            id = "story-2", title = "Midnight in Marrakech", authorId = "zoeok", genre = Genre.MYSTERY,
            synopsis = "A traveler vanishes from a Marrakech hotel. Her sister follows the clues into the ancient medina.",
            chapters = listOf(
                Chapter("s2c1", "The Disappearance", listOf(
                    "Claire Forrest checked into the Riad el Fenn at four in the afternoon. By midnight, she was gone. The receptionist insisted she had never arrived. But her suitcase sat in Room 7, zipped shut, the bed still made.",
                    "The police came and went. They took notes, shrugged, suggested Claire might have wandered into the medina and gotten lost. People did, sometimes. The medina was a labyrinth — nine thousand alleys, most of them unlit.",
                    "But Claire's sister Maya knew better. Claire spoke Arabic. Claire had been to Marrakech before. Claire did not get lost."
                )),
                Chapter("s2c2", "The Night Market", listOf(
                    "Maya found the spice merchant in the souk, a bent old man who sold saffron and storytelling in equal measure. He recognized the necklace Maya showed him — amber beads on a silver thread, handmade, unmistakable.",
                    "'The woman who wore this came two nights ago,' he said. 'She was looking for the door.' 'What door?' 'The old door. In the medina wall. It opens only at midnight, only for those who are meant to find it.'",
                    "Maya felt the hair rise on her arms. 'Where is this door?' The merchant smiled, showing teeth like old ivory. 'You are already looking for it,' he said. 'That means you are meant to find it too.'"
                ))
            ),
            likes = 2610, bookmarks = 890, views = 18900,
            tags = listOf("travel", "noir", "atmospheric"), publishedOffset = 5, isFeatured = true
        ),
        Story(
            id = "story-3", title = "Letters to the Sea", authorId = "priyanair", genre = Genre.LITERARY,
            synopsis = "For eleven years, a mother writes letters to the ocean. One day, the ocean writes back.",
            chapters = listOf(
                Chapter("s3c1", "The First Letter", listOf(
                    "Every morning, Amma walked to the pier with a letter folded in her sari. She had been doing this for eleven years, since the day her son's ship failed to return. The letters were always the same: his name, a question, a promise to keep waiting.",
                    "She folded the paper into a bottle and let the tide take it. The fishermen watched from their boats but said nothing. Everyone in the village knew Amma. Everyone knew her story. No one knew what she wrote.",
                    "One morning, the bottle came back. Not the same bottle — this one was dark glass, sealed with wax. Inside was a letter in handwriting she didn't recognize. 'Dear Mother,' it said. 'The sea kept your letters. It asked me to answer them.'"
                )),
                Chapter("s3c2", "The Reply", listOf(
                    "Amma sat on the pier for three hours, reading the letter in every kind of light — morning, shadow, sun, cloud. The handwriting was neat but strange, as if the writer was unused to holding a pen.",
                    "The letter spoke of currents and depths, of a place where the water was warm and the light came from below. It spoke of a ship that had not sunk but had been carried, gently, to a shore that existed on no map.",
                    "It ended: 'I am well. I am not alone. The sea says you should stop waiting, but I know you won't, and I love you for it.' Amma folded the letter into her sari and began walking home. Tomorrow, she would write back."
                ))
            ),
            likes = 1430, bookmarks = 510, views = 9200,
            tags = listOf("grief", "ocean", "letters"), publishedOffset = 8, isFeatured = false
        ),
        Story(
            id = "story-4", title = "The Quantum Garden", authorId = "rentakahashi", genre = Genre.SCIFI,
            synopsis = "A scientist grows the first plant that exists on probability. It doesn't stay in the lab.",
            chapters = listOf(
                Chapter("s4c1", "The First Bloom", listOf(
                    "Dr. Yuki Tanaka grew the first impossible plant in a basement lab at Kyoto University. It was a rose, but not quite — the petals shimmered between colors that shouldn't exist together, and when you looked away and looked back, it had rearranged itself.",
                    "The rose grew without soil, without water, without light. It grew on probability. Yuki had spent seven years building a quantum field generator, and the rose was its first fruit. She didn't tell anyone. Not yet.",
                    "By the third day, the rose had produced a seed. By the fifth, the seed had fallen from its stalk and landed in a crack in the concrete floor. By the seventh, a vine was growing through the crack, reaching for the ceiling with alarming speed."
                )),
                Chapter("s4c2", "The Garden Grows", listOf(
                    "Yuki came to the lab on Monday morning and found a forest. The vine had become a tree, the tree had become a canopy, and under the canopy were flowers she had never designed — flowers that pulsed with their own light.",
                    "She stood in the doorway, her key card still in her hand, and listened. The garden was breathing. Not metaphorically — the air moved in and out, warm and green, as if the plants had invented their own respiration.",
                    "Something moved in the canopy. Something small, quick, alive. Yuki stepped back. The garden had made something she hadn't planted. It had made something that could move on its own. She reached for her phone, then stopped. Part of her wanted to see what came next."
                ))
            ),
            likes = 1980, bookmarks = 730, views = 14600,
            tags = listOf("science", "first-contact", "wonder"), publishedOffset = 1, isFeatured = true
        ),
        Story(
            id = "story-5", title = "The Weaver's Daughter", authorId = "mayak", genre = Genre.FANTASY,
            synopsis = "A girl who can weave moonlight into thread is summoned by a king who wants an invincible banner.",
            chapters = listOf(
                Chapter("s5c1", "Moonlight Thread", listOf(
                    "In the village of Thimphu, there lived a weaver who could spin moonlight into thread. Her name was Pema, and she was the seventh daughter of a seventh daughter, which in the old stories meant she could do things that other people couldn't.",
                    "Every full moon, Pema sat at her loom in the courtyard and wove. The moonlight came to her fingers like silk, and she drew it out, strand by strand, until she had enough to weave. What she wove was always different — a cloak, a blanket, a banner.",
                    "What people didn't know was that each weaving was a promise. The cloak kept its wearer warm in any cold. The blanket healed sickness. The banner, which she wove only once, would protect an entire kingdom from harm — but only if the kingdom deserved it."
                )),
                Chapter("s5c2", "The Tapestry", listOf(
                    "The king heard about Pema and sent for her. He wanted a banner for his army, a banner that would make his soldiers invincible. Pema came to the palace and looked at the king — his gold, his soldiers, his hungry eyes — and sat at the loom.",
                    "She wove for three nights. On the first night, she wove the moonlight into the shape of a mountain. On the second, she wove a river. On the third, she wove a face — her own. The banner was beautiful, but when the king unfurled it, his soldiers turned and walked away.",
                    "The banner didn't make them invincible. It made them honest. They saw what the king was, and what the kingdom had become, and they could not fight for it anymore. Pema smiled, packed her loom, and walked home. The moon, she knew, always tells the truth."
                ))
            ),
            likes = 3120, bookmarks = 1240, views = 22100,
            tags = listOf("folk-tale", "magic", "moonlight"), publishedOffset = 3, isFeatured = true
        ),
        Story(
            id = "story-6", title = "Whispers in the Old House", authorId = "diegoa", genre = Genre.HORROR,
            synopsis = "A couple moves into a cheap house. The walls whisper their names. The cellar door won't stay locked.",
            chapters = listOf(
                Chapter("s6c1", "The First Night", listOf(
                    "The house was cheap. That should have been a warning. Maria and Carlos moved in on a Friday, and by Friday night, the whispers had started. They came from the walls, from the floor, from somewhere just below the edge of hearing.",
                    "Carlos said it was pipes. Maria said it was wind. They told each other this in bed, the lamp on, not sleeping. The whispers didn't sound like pipes or wind. They sounded like names. They sounded like their names.",
                    "In the morning, the whispers stopped. Sunlight filled the kitchen, and Maria laughed at herself. Old house, she said. Settling. Carlos nodded. Neither of them mentioned that the cellar door, which they had locked the night before, was open."
                )),
                Chapter("s6c2", "The Cellar", listOf(
                    "Carlos went down first, holding a flashlight like a weapon. The stairs creaked under his weight. The cellar was cold — not the cold of stone, but the cold of something that had been waiting a long time.",
                    "The walls were covered in scratches. Not random — organized, deliberate, rows and rows of marks that looked like counting. Carlos counted. There were three hundred and twelve. Three hundred and twelve of something.",
                    "Behind him, the cellar door closed. He spun around, ran to it, tried the handle. Locked. The whispers started again, louder now, and this time he could hear the words. 'Three hundred and thirteen,' they said. 'Three hundred and thirteen.'"
                ))
            ),
            likes = 1750, bookmarks = 680, views = 13800,
            tags = listOf("supernatural", "suspense", "dark"), publishedOffset = 4, isFeatured = false
        ),
        Story(
            id = "story-7", title = "River Bound", authorId = "rahuls", genre = Genre.ADVENTURE,
            synopsis = "A raft guide finds a map of an unmapped river in Nepal. The village at its end doesn't appear on any chart.",
            chapters = listOf(
                Chapter("s7c1", "The Map", listOf(
                    "Jared found the map in a used bookstore in Kathmandu. It was folded inside a copy of 'The River of Doubt,' and it showed a river that appeared on no other map. It ran through a valley in eastern Nepal that was marked with one word: 'unmappable.'",
                    "Jared had been a raft guide for twelve years. He'd run rivers in six countries. He knew every major tributary in the Himalayas. He had never heard of this one. The map was old — 1950s maybe — and hand-drawn with meticulous care.",
                    "He bought the book for two hundred rupees. That night, in his guesthouse room, he spread the map on the bed and traced the river's path with his finger. It wound through a valley so narrow the river filled it edge to edge. At the end of the valley, the map showed a village. The village had no name."
                )),
                Chapter("s7c2", "The Village", listOf(
                    "The river was everything the map promised — fast, narrow, walled in by cliffs that rose three hundred feet on either side. Jared paddled for two days, sleeping on a gravel bar, eating cold rice, talking to no one.",
                    "On the third morning, the canyon opened. The river widened into a pool, and on the far shore was the village. It was small — twelve houses, a temple, a garden. The people who lived there looked up as Jared drifted in, and they didn't seem surprised.",
                    "An old woman walked to the water's edge. 'You found us,' she said. 'Not many do.' She looked at Jared's raft, at his maps, at his GPS. 'You can stay,' she said. 'But you should know — the river only flows one way. You came in. You cannot go back the way you came.'"
                ))
            ),
            likes = 1290, bookmarks = 430, views = 7800,
            tags = listOf("travel", "discovery", "himalaya"), publishedOffset = 7, isFeatured = false
        ),
        Story(
            id = "story-8", title = "Stargazer", authorId = "elenar", genre = Genre.POETRY,
            synopsis = "A meditation on stars, memory, and the ghosts we see when we look up.",
            chapters = listOf(
                Chapter("s8c1", "Visible Light", listOf(
                    "I learned the names of stars before I learned the names of flowers. My father said: flowers change, stars remain. He was wrong on both counts, but I didn't know that then.",
                    "Orion in winter. Scorpius in summer. The North Star, which isn't north at all, not really — it's just the one that doesn't move. My father said: find the one that doesn't move, and you'll know where you are. He was wrong about that too.",
                    "The stars I learned first are not the same stars. Betelgeuse is dimmer now. Sirius hasn't changed, but my eyes have. My father is gone. The sky is still there, rearranging itself, slow and patient, waiting for no one."
                )),
                Chapter("s8c2", "Invisible Light", listOf(
                    "There are stars we can't see — not because they're too far, but because their light is the wrong kind. Radio, X-ray, infrared. They sing in frequencies we'll never hear.",
                    "I think about this when I can't sleep. Somewhere, a star is broadcasting its death in a language no human instrument will ever translate. It has been doing this for a thousand years. The signal is still traveling.",
                    "My father used to say: the light we see is old. Everything in the sky is a ghost. I think he was trying to tell me something about time, or about loss, or about the way we look backward without meaning to. I think he was right about that."
                ))
            ),
            likes = 2240, bookmarks = 910, views = 16400,
            tags = listOf("stars", "memory", "elegy"), publishedOffset = 6, isFeatured = true
        ),
        Story(
            id = "story-9", title = "The Forgotten Recipe", authorId = "kainak", genre = Genre.LITERARY,
            synopsis = "A grandmother's cookbook reveals a final recipe with strange instructions: say the name of someone you've lost.",
            chapters = listOf(
                Chapter("s9c1", "The Cookbook", listOf(
                    "When Obachan died, she left me three things: her knife, her apron, and her cookbook. The knife was a santoku, worn thin by sixty years of use. The apron was blue cotton, stained with a thousand meals. The cookbook was handwritten, in Japanese and English.",
                    "Most of the recipes I knew — miso soup, tamagoyaki, the curry she made every Sunday. But on the last page, in a hand shakier than the rest, was a recipe I'd never seen. 'Grandmother's Soup,' it said. The ingredients were ordinary: dashi, daikon, ginger. But the instructions were strange.",
                    "Step one: cook the dashi until the kitchen smells like the ocean. Step two: add the daikon and wait until it turns transparent, like glass. Step three: stir in the ginger and say the name of someone you've lost. Step four: serve only to family."
                )),
                Chapter("s9c2", "The Meal", listOf(
                    "I made the soup on a Wednesday. The dashi took an hour to smell like the ocean — deep, salt, cold. The daikon took longer. I watched it turn from white to glass, and when I stirred in the ginger, I said my grandmother's name.",
                    "The soup was simple. It was the best thing I'd ever tasted. I sat at my kitchen table and ate it slowly, and with each bite, I remembered something new — not the big things, but the small ones. The way she hummed while cooking. The way she tasted with her eyes closed.",
                    "When the bowl was empty, I called my mother. 'I found the recipe,' I said. There was a long pause. 'The soup?' she said. 'Obachan made it for me when my father died. She said it doesn't bring people back. It just helps you remember them clearly.' I looked at the empty bowl. She was right."
                ))
            ),
            likes = 1670, bookmarks = 620, views = 10900,
            tags = listOf("family", "food", "memory"), publishedOffset = 9, isFeatured = false
        ),
        Story(
            id = "story-10", title = "Echoes of Tomorrow", authorId = "mayak", genre = Genre.SCIFI,
            synopsis = "A radio astronomer receives a signal from three days in the future. The message is a warning.",
            chapters = listOf(
                Chapter("s10c1", "The Signal", listOf(
                    "The radio picked up the signal at 3:47 AM. Dr. Priya Shah was alone in the observatory, running a routine scan of the hydrogen line, when the frequency spiked. She checked the equipment, rechecked it, then sat very still.",
                    "The signal was structured. Not random noise, not interference — structured, like language. And it was coming from Earth. Specifically, from three days in the future. Priya knew this because the signal contained a timestamp, and the timestamp was future-dated.",
                    "She recorded everything. Then she did what any scientist would do: she waited. Three days. She went about her life — taught her classes, ate her meals, pretended to sleep. And every night, she checked the radio. The signal was getting stronger."
                )),
                Chapter("s10c2", "The Message", listOf(
                    "On the third day, the signal peaked. Priya sat in the observatory with her headphones on, listening. The structure resolved into words — not English, not any language she knew, but something she could feel meaning in.",
                    "The message was a warning. She understood it not through translation but through something deeper, something the radio wasn't supposed to be able to do. 'Do not build the machine,' the message said. 'The machine you are about to build will work. That is the problem.'",
                    "Priya looked at her notes. For six months, she'd been designing a quantum computer. A machine that would, theoretically, be able to receive messages from the future. She looked at the radio. She looked at her notes. She deleted them."
                ))
            ),
            likes = 2890, bookmarks = 1020, views = 19700,
            tags = listOf("time", "first-contact", "warning"), publishedOffset = 1, isFeatured = true
        ),
        Story(
            id = "story-11", title = "Solitude", authorId = "aarav", genre = Genre.ROMANCE,
            synopsis = "Two strangers come to a remote island to be alone. A storm has other plans.",
            chapters = listOf(
                Chapter("s11c1", "The Island", listOf(
                    "He came to the island to be alone. She came for the same reason. They met on the ferry, recognized something in each other's faces — the particular exhaustion of someone who has had enough of people — and said nothing.",
                    "The island was small. One village, one beach, one path that wound through pine forest to a lighthouse. He took the lighthouse. She took the village. They nodded at each other on the path and kept walking.",
                    "On the third day, it rained. He was at the lighthouse, she was in the village, and the rain came down so hard the path became a river. They were both stuck. He looked out the lighthouse window. She looked down the village street. They were a mile apart, and the rain was between them."
                )),
                Chapter("s11c2", "The Storm", listOf(
                    "The storm lasted two days. He ran out of food. She ran out of firewood. On the second morning, he saw her on the beach, collecting driftwood. He walked down from the lighthouse, rain soaking through his coat.",
                    "They worked together without speaking. She gathered wood. He carried it. When the pile was big enough, they stood in the rain and looked at each other. 'I have food,' he said. 'I have a fireplace,' she said.",
                    "They ate dinner by the fire. They talked until the rain stopped. When the path was passable again, neither of them mentioned leaving. The ferry came on Friday. They didn't take it. They took the next one, two weeks later, together."
                ))
            ),
            likes = 2010, bookmarks = 780, views = 14200,
            tags = listOf("quiet", "island", "connection"), publishedOffset = 3, isFeatured = false
        ),
        Story(
            id = "story-12", title = "The Paper Crane", authorId = "zoeok", genre = Genre.FOLKLORE,
            synopsis = "An old woman folds paper cranes for forty years. When a boy wishes on one, the magic isn't where he thinks.",
            chapters = listOf(
                Chapter("s12c1", "The Village", listOf(
                    "In the village of Fukushima, there lived an old woman who folded paper cranes. She had been folding them for forty years, since her daughter was born. Her daughter was gone now, but the folding continued.",
                    "Every crane was different. Some were red, some were gold, some were white. The old woman hung them from the ceiling of her small house, and when the wind blew through the window, they turned slowly, casting shadows like birds in flight.",
                    "The children of the village believed the cranes were magic. They believed that if you wished on one, the wish would come true — but only if you wished for someone else, never for yourself. The old woman never confirmed this. She just kept folding."
                )),
                Chapter("s12c2", "The Wish", listOf(
                    "A boy came to the old woman's house on a winter morning. He was thin, cold, and alone. His parents had gone to the city and hadn't come back. He wished, not for himself, but for his dog, who was sick.",
                    "The old woman gave him a crane — white, the smallest one, the one that hung closest to the window. 'Fold it again,' she said. 'Unfold it and fold it once more, and the wish will carry.' The boy took the crane home and did as she said.",
                    "The dog got better. The boy came back to thank the old woman, but the house was empty. The cranes were gone. All that was left was a single piece of paper, unfolded, with a handwritten note: 'The magic was never in the crane. It was in the folding. Thank you for folding.' The boy kept the paper. He learned to fold cranes. He taught others. The village never forgot."
                ))
            ),
            likes = 2580, bookmarks = 990, views = 18500,
            tags = listOf("folk-tale", "kindness", "tradition"), publishedOffset = 5, isFeatured = true
        )
    )

    val seedComments: List<StoryComment> = listOf(
        StoryComment("sc1", "story-1", "mayak", "mayak", "Maya Kapoor", "The atmosphere in this is incredible. I could smell the salt.", 24, 5, true),
        StoryComment("sc2", "story-1", "diegoa", "diegoa", "Diego Alvarez", "That ending! I need more chapters immediately.", 12, 12, false),
        StoryComment("sc3", "story-1", "priyanair", "priyanair", "Priya Nair", "Time travel without the cliches — just a quiet, patient dread. Beautiful.", 18, 8, false),
        StoryComment("sc4", "story-1", "ghost-0", "noorwrites", "Noor Haddad", "Read this in one sitting. The lighthouse felt like a character itself.", 7, 3, false),
        StoryComment("sc5", "story-1", "rentakahashi", "rentakahashi", "Ren Takahashi", "The prose is so precise. Every word earns its place.", 15, 20, false),
        StoryComment("sc6", "story-1", "ghost-5", "tashastories", "Tasha Ivanova", "The storm sequence gave me chills. Literal chills.", 5, 2, false),
        StoryComment("sc7", "story-1", "kainak", "kainak", "Kai Nakamura", "Agreed. Reminds me of Annie Proulx's economy.", 4, 18, false, "rentakahashi"),
        StoryComment("sc8", "story-1", "aarav", "aarav", "Aarav Menon", "Thank you! The lighthouse was the first thing I wrote.", 9, 1, false, "noorwrites"),
        StoryComment("sc9", "story-1", "elenar", "elenar", "Elena Ross", "'Quiet, patient dread' is the perfect description.", 6, 6, true, "priyanair"),
        StoryComment("sc10", "story-2", "priyanair", "priyanair", "Priya Nair", "The door in the medina wall — I've been looking for it ever since.", 31, 3, false),
        StoryComment("sc11", "story-2", "rentakahashi", "rentakahashi", "Ren Takahashi", "Zoe writes mystery like no one else. Every detail matters.", 18, 8, false),
        StoryComment("sc12", "story-2", "mayak", "mayak", "Maya Kapoor", "The spice merchant was my favorite character. I wanted more of him.", 22, 10, true),
        StoryComment("sc13", "story-2", "ghost-3", "amara.reads", "Amara Diallo", "I couldn't sleep after reading this. In the best way.", 9, 4, false),
        StoryComment("sc14", "story-2", "elenar", "elenar", "Elena Ross", "The sense of place is extraordinary. Marrakech came alive.", 14, 16, true),
        StoryComment("sc15", "story-2", "kainak", "kainak", "Kai Nakamura", "Maya is such a compelling protagonist. I need a sequel.", 11, 22, false),
        StoryComment("sc16", "story-2", "zoeok", "zoeok", "Zoe Okonkwo", "Thank you! The merchant was inspired by a real person I met.", 15, 7, true, "mayak"),
        StoryComment("sc17", "story-2", "aarav", "aarav", "Aarav Menon", "Zoe's world-building is unmatched.", 5, 12, false, "elenar"),
        StoryComment("sc18", "story-2", "ghost-10", "dev_reads", "Dev Patel", "Same! I went to Marrakech just to look for it.", 3, 1, false, "priyanair"),
        StoryComment("sc19", "story-5", "elenar", "elenar", "Elena Ross", "The banner that makes soldiers honest — what a concept. I'm in awe.", 35, 4, true),
        StoryComment("sc20", "story-5", "rahuls", "rahuls", "Rahul Sharma", "Fantasy with a moral spine. This is why I read.", 19, 6, false),
        StoryComment("sc21", "story-5", "aarav", "aarav", "Aarav Menon", "Pema is my new favorite character in all of fiction.", 27, 9, false),
        StoryComment("sc22", "story-5", "zoeok", "zoeok", "Zoe Okonkwo", "The moonlight weaving imagery was pure magic. Literally.", 21, 14, true),
        StoryComment("sc23", "story-5", "ghost-15", "santiagos", "Santiago Reyes", "My daughter and I read this together. She wants to learn to weave now.", 12, 5, false),
        StoryComment("sc24", "story-5", "diegoa", "diegoa", "Diego Alvarez", "The king got exactly what he deserved. Perfect ending.", 16, 18, false),
        StoryComment("sc25", "story-5", "mayak", "mayak", "Maya Kapoor", "Thank you! Pema came to me fully formed.", 8, 6, true, "aarav"),
        StoryComment("sc26", "story-5", "priyanair", "priyanair", "Priya Nair", "This is the sweetest comment I've read all week.", 5, 3, false, "santiagos"),
        StoryComment("sc27", "story-5", "kainak", "kainak", "Kai Nakamura", "The ending was absolutely perfect.", 3, 15, false, "diegoa"),
        StoryComment("sc28", "story-8", "zoeok", "zoeok", "Zoe Okonkwo", "Everything in the sky is a ghost. I keep rereading that line.", 44, 2, true),
        StoryComment("sc29", "story-8", "mayak", "mayak", "Maya Kapoor", "Elena writes poetry the way the sky arranges stars — slow, patient, inevitable.", 28, 5, true),
        StoryComment("sc30", "story-8", "rentakahashi", "rentakahashi", "Ren Takahashi", "The father-daughter thread through this destroyed me. Quietly.", 20, 8, false),
        StoryComment("sc31", "story-8", "ghost-20", "sanaa_reads", "Sanaa Khan", "I read this on a rooftop at 2am. Perfect setting.", 8, 3, false),
        StoryComment("sc32", "story-8", "kainak", "kainak", "Kai Nakamura", "Short, devastating, perfect. Elena is a national treasure.", 16, 12, false),
        StoryComment("sc33", "story-8", "priyanair", "priyanair", "Priya Nair", "Betelgeuse is dimmer now broke something in me and I'm grateful.", 12, 18, false),
        StoryComment("sc34", "story-8", "elenar", "elenar", "Elena Ross", "That's the kindest thing anyone has said about my work.", 10, 4, true, "mayak"),
        StoryComment("sc35", "story-8", "aarav", "aarav", "Aarav Menon", "'Quietly' is doing so much work in that sentence.", 6, 6, false, "rentakahashi"),
        StoryComment("sc36", "story-8", "zoeok", "zoeok", "Zoe Okonkwo", "This is the only correct way to read this poem.", 4, 1, true, "sanaa_reads"),
        StoryComment("sc37", "story-10", "rentakahashi", "rentakahashi", "Ren Takahashi", "A warning from the future that says 'don't build the machine' — chilling.", 38, 3, false),
        StoryComment("sc38", "story-10", "mayak", "mayak", "Maya Kapoor", "Priya deleting her notes at the end. What a moment.", 25, 7, true),
        StoryComment("sc39", "story-10", "kainak", "kainak", "Kai Nakamura", "Best hard sci-fi I've read this year. Maybe longer.", 19, 10, false),
        StoryComment("sc40", "story-10", "elenar", "elenar", "Elena Ross", "The restraint of the ending is masterful. She just deleted them.", 16, 14, true),
        StoryComment("sc41", "story-10", "ghost-25", "felixfables", "Felix Wagner", "I had to put my phone down and stare at the wall. In a good way.", 7, 4, false),
        StoryComment("sc42", "story-10", "aarav", "aarav", "Aarav Menon", "The fact that she built the machine that could receive the warning...", 14, 20, false),
        StoryComment("sc43", "story-10", "priyanair", "priyanair", "Priya Nair", "Exactly. The non-action was the action.", 8, 10, false, "elenar"),
        StoryComment("sc44", "story-10", "zoeok", "zoeok", "Zoe Okonkwo", "The paradox is so elegant it hurts.", 5, 5, true, "rentakahashi"),
        StoryComment("sc45", "story-10", "mayak", "mayak", "Maya Kapoor", "That's the highest compliment a story can get.", 4, 2, true, "felixfables")
    )

    fun seedComments(storyId: String): List<StoryComment> =
        seedComments.filter { it.storyId == storyId }

    val allThemes: List<String>
        get() = stories.flatMap { it.tags }.distinct().sorted()

    fun author(id: String): Author? = authors.firstOrNull { it.id == id }

    fun story(id: String): Story? = stories.firstOrNull { it.id == id }

    val featured: List<Story> get() = stories.filter { it.isFeatured }

    val trending: List<Story> get() = stories.sortedByDescending { it.likes }

    val newest: List<Story> get() = stories.sortedBy { it.publishedOffset }

    fun comments(storyId: String): List<StoryComment> = seedComments.filter { it.storyId == storyId }

    fun search(query: String): List<Story> {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return stories
        return stories.filter { story ->
            story.title.lowercase().contains(q) ||
                story.synopsis.lowercase().contains(q) ||
                story.tags.any { it.lowercase().contains(q) } ||
                story.genre.displayName.lowercase().contains(q) ||
                (author(story.authorId)?.displayName?.lowercase()?.contains(q) ?: false)
        }
    }
}

object UsernameGenerator {
    private val firstWords = listOf(
        "quiet", "bright", "swift", "calm", "wild", "warm",
        "bold", "soft", "lone", "still", "pale", "dark", "fair", "vast", "deep"
    )
    private val secondWords = listOf(
        "writer", "story", "verse", "tale", "myth", "word", "page",
        "chapter", "novel", "poem", "sonnet", "parable", "fable", "ode", "lyric"
    )

    private val taken = setOf(
        "kathaai", "aarav", "mayak", "rentakahashi", "priyanair",
        "diegoa", "zoeok", "rahuls", "elenar", "kainak"
    )

    fun isAvailable(username: String): Boolean {
        val lowered = username.trim().lowercase()
        if (lowered.isEmpty()) return false
        return lowered !in taken
    }

    fun generate(): String {
        repeat(50) {
            val base = firstWords.random() + secondWords.random()
            if (isAvailable(base)) return base
            val numbered = base + (1..999).random()
            if (isAvailable(numbered)) return numbered
        }
        return "writer" + (1000..9999).random()
    }
}
