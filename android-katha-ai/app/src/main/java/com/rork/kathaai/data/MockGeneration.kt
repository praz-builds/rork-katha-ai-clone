package com.rork.kathaai.data

import com.rork.kathaai.model.ContinueWizardStep
import com.rork.kathaai.model.Genre
import com.rork.kathaai.model.GeneratedChapter
import com.rork.kathaai.model.GeneratedStory
import com.rork.kathaai.model.StoryLanguage
import com.rork.kathaai.model.WizardCharacter
import com.rork.kathaai.model.NewChapterNotification
import kotlinx.coroutines.delay
import java.util.UUID
import kotlin.random.Random

object StoryStarters {
    val starters: Map<Genre, List<String>> = mapOf(
        Genre.ADVENTURE to listOf(
            "A raft guide finds a map of an unmapped river. The village at its end doesn't appear on any chart.",
            "A pilot crashes in a jungle where the trees grow in impossible geometry.",
            "A teenage courier must deliver a sealed box across a city that's falling apart.",
            "Two strangers race to find a sunken temple before a storm swallows the coast.",
            "A retired explorer is forced back into the mountains by a decades-old promise."
        ),
        Genre.FANTASY to listOf(
            "A girl who can weave moonlight into thread is summoned by a king who wants an invincible banner.",
            "The last dragon hires a human accountant to manage its hoard.",
            "A library appears in the city only on nights when someone needs to forget.",
            "A blacksmith forges a sword that refuses to harm anyone who isn't lying.",
            "In a kingdom where names have power, a prince gives his away."
        ),
        Genre.SCIFI to listOf(
            "A scientist grows the first plant that exists on probability. It doesn't stay in the lab.",
            "A radio astronomer receives a signal from three days in the future.",
            "The first Mars colony receives a visitor who claims Earth never existed.",
            "A translator is hired to negotiate with an AI that dreams in dead languages.",
            "A woman wakes to find every door in her city leads to a different decade."
        ),
        Genre.MYSTERY to listOf(
            "A traveler vanishes from a hotel. Her sister follows the clues into the ancient medina.",
            "A detective realizes the killer is leaving clues only she would understand.",
            "A locked-room murder happens in a lighthouse during a power outage.",
            "A bookseller discovers a novel that accurately predicts local deaths.",
            "An heiress receives letters from her mother, who died twenty years ago."
        ),
        Genre.ROMANCE to listOf(
            "Two strangers come to a remote island to be alone. A storm has other plans.",
            "A translator and a chef fall in love through notes left in a shared kitchen.",
            "Old college rivals reunite to save the bookstore where they first met.",
            "A violinist and a sound engineer argue about silence until it becomes music.",
            "A letter meant for someone else arrives every Valentine's Day for ten years."
        ),
        Genre.THRILLER to listOf(
            "A courier delivers a package and realizes the recipient is already dead.",
            "A journalist's source sends a video that hasn't been filmed yet.",
            "A hiker finds a phone in the woods. It's ringing, and her name is on the screen.",
            "A sleep researcher discovers one of her subjects is committing crimes while awake.",
            "A train passenger recognizes the stranger across from him from a missing poster."
        ),
        Genre.HORROR to listOf(
            "A couple moves into a cheap house. The walls whisper their names.",
            "A village keeps a door in the forest locked. A newcomer wants to know why.",
            "A photographer develops pictures that show scenes from her own nightmares.",
            "A child's imaginary friend starts leaving physical evidence behind.",
            "An abandoned radio station begins broadcasting on a frequency no one assigned."
        ),
        Genre.SLICE_OF_LIFE to listOf(
            "A woman reopens her grandmother's bakery and finds recipes she never wrote.",
            "Two neighbors exchange notes through a shared laundry line.",
            "A bus driver memorizes every passenger's stop but never learns their names.",
            "A retired teacher receives a letter from a student she thought she'd failed.",
            "A man starts watering his neighbor's plants while she's away, and reads her books."
        ),
        Genre.HISTORICAL to listOf(
            "A coded diary from 1944 surfaces in a present-day estate sale.",
            "A sailor aboard a tea clipper discovers a stowaway who shouldn't exist.",
            "A suffragette printer hides secret messages inside theater playbills.",
            "An apprentice to a medieval mapmaker copies a continent no one believes in.",
            "A nurse in a 1918 field hospital receives a letter that arrives two years early."
        ),
        Genre.CONTEMPORARY to listOf(
            "A startup founder tries to build an app that predicts heartbreak.",
            "A podcaster interviews her estranged father without revealing who she is.",
            "A rideshare driver becomes the confidant of three passengers in one night.",
            "A woman inherits her late brother's playlist and decodes his final message.",
            "A wedding photographer realizes she's photographed the groom with three different brides."
        ),
        Genre.LGBTQ to listOf(
            "Two women keep meeting at the same train station for a year before either speaks.",
            "A non-binary actor plays their own parent in a biopic and falls in love with the director.",
            "A drag queen inherits the family farm and throws the county's best harvest festival.",
            "A trans woman returns to her hometown for closure and finds an unexpected ally.",
            "A young man writes letters to his future husband before he knows his name."
        ),
        Genre.COMEDY to listOf(
            "A ghost haunting a bookstore is annoyed by a YouTuber who can't see it.",
            "A pet detective realizes her newest client is a parrot with a better social life.",
            "A wedding planner must organize two exes' weddings on the same day.",
            "An AI assistant develops a sarcastic streak and starts a podcast.",
            "A man discovers his dog is secretly the mayor of a small online town."
        ),
        Genre.DRAMA to listOf(
            "Three siblings return home to sell the house and confront the will's secret clause.",
            "A pianist loses her hearing weeks before the audition of a lifetime.",
            "A politician's son leaks a story that could save a town or ruin his family.",
            "A doctor must choose between a patient and the hospital's funding.",
            "An estranged father and daughter renovate the same house without speaking."
        ),
        Genre.POETRY to listOf(
            "A meditation on stars, memory, and the ghosts we see when we look up.",
            "A series of letters written to cities the narrator has abandoned.",
            "A poet realizes every poem she's written is about the same stranger.",
            "An ode to the last payphone in a city full of people who no longer call home.",
            "A collection of recipes for emotions no one taught us how to name."
        ),
        Genre.MYTHOLOGY to listOf(
            "A forgotten god wakes up in a subway station and demands an offering.",
            "A modern blacksmith forges the chain that once bound Fenrir.",
            "A woman inherits a tapestry that shows the death of every living god.",
            "A ferryman on a flooded river recognizes passengers from three different myths.",
            "An archaeologist unearths a mirror that reflects the age of heroes."
        ),
        Genre.SPIRITUALITY to listOf(
            "A monk who has taken a vow of silence receives a message only he can deliver.",
            "A pilgrim walking an ancient route meets a traveler walking backward.",
            "A woman fasting in the desert starts hearing the prayers of strangers.",
            "A temple bell rings on a windless day, and everyone hears a different sound.",
            "A gardener tends a plant that only blooms when someone nearby tells the truth."
        ),
        Genre.MOTIVATIONAL to listOf(
            "A failed athlete coaches a team that reminds her why she started.",
            "A man who never finished anything decides to build a boat in his apartment.",
            "A woman recovering from burnout rewrites her resume as a love letter.",
            "A student and a janitor trade wisdom in an empty library at midnight.",
            "A musician busks in the same station for 100 days to find her voice."
        ),
        Genre.KIDS to listOf(
            "A talking cat offers a lonely child a map to a hidden moon garden.",
            "A young inventor builds a robot that only tells bedtime stories.",
            "A group of friends discovers their treehouse is bigger on the inside.",
            "A lost stuffed animal sends postcards from its journey home.",
            "A child who is afraid of the dark befriends the shadow under her bed."
        ),
        Genre.LITERARY to listOf(
            "A grandmother's cookbook reveals a final recipe with strange instructions.",
            "A man catalogues every lie he has ever told in a single notebook.",
            "A woman discovers her life is being narrated by a voice only she hears.",
            "An archivist finds love letters between two people who never met.",
            "A translator realizes the novel she's translating is about her own childhood."
        ),
        Genre.FICTION to listOf(
            "A lighthouse keeper receives a letter from the future warning of a storm.",
            "A mapmaker is asked to chart a place that doesn't exist — yet.",
            "A clockmaker's daughter discovers she can stop time with a thought.",
            "A woman finds a letter in her garden addressed to her, in her own handwriting, dated tomorrow.",
            "A museum guard notices one exhibit changes slightly every night."
        ),
        Genre.FOLKLORE to listOf(
            "An old woman folds paper cranes for forty years. When a boy wishes on one, the magic isn't where he thinks.",
            "A village leaves shoes on their roofs to keep the river spirits kind.",
            "A baker's bread refuses to rise whenever a lie is told in the house.",
            "A traveling storyteller arrives with tales that predict the listener's week.",
            "A mountain pass only appears to travelers who carry a single regret."
        )
    )

    fun randomFor(genre: Genre): String {
        val pool = starters[genre] ?: starters[Genre.FICTION]!!
        return pool.random()
    }
}

// MARK: - Chapter Starters (continuation prompts per genre × position)

object ChapterStarters {
    private val earlyStarters: Map<Genre, List<String>> = mapOf(
        Genre.FANTASY to listOf(
            "The prophecy from Chapter 1 begins to unravel…",
            "A new ally arrives with troubling news from the south…",
            "The mentor reveals a hidden truth about our hero's past…",
            "An ancient power awakens in the most unlikely vessel…"
        ),
        Genre.MYSTERY to listOf(
            "The first clue doesn't add up — and the detective knows it…",
            "A second body is found, but this one changes everything…",
            "The witness lies, and the lie is more revealing than the truth…",
            "Someone is watching the investigation. Someone who shouldn't be…"
        ),
        Genre.ROMANCE to listOf(
            "The morning after changes everything they thought they knew…",
            "A letter arrives that forces a conversation neither is ready for…",
            "They meet again by accident, and the silence says more than words…",
            "A shared secret draws them closer — or pulls them apart…"
        ),
        Genre.SCIFI to listOf(
            "The signal changes. It's no longer a warning — it's a question…",
            "A second anomaly appears, this one closer to home…",
            "The experiment succeeds, but the results don't match the theory…",
            "First contact happens in the most mundane possible way…"
        ),
        Genre.FICTION to listOf(
            "The stranger returns, and this time they bring news…",
            "A discovery in the attic rewrites the family history…",
            "The town's secret surfaces in the most public possible way…",
            "An old promise comes due, and it can't be ignored…"
        ),
        Genre.HORROR to listOf(
            "The whispers find a new voice — someone else's…",
            "The thing in the cellar has been busy. It has plans…",
            "What they thought was the end was only the beginning…",
            "The house grows. There are rooms that weren't there before…"
        ),
        Genre.THRILLER to listOf(
            "The trail goes cold — then turns in an impossible direction…",
            "The conspirator is someone they already trusted…",
            "The deadline moves up. There's no time to be careful…",
            "The evidence points to a place that shouldn't exist…"
        ),
        Genre.ADVENTURE to listOf(
            "The map was only half the story. The other half is worse…",
            "A storm drives them off course — into exactly where they need to be…",
            "The guide reveals a personal stake in the journey…",
            "The way forward is blocked. The way back is gone…"
        ),
        Genre.LITERARY to listOf(
            "The letter is read by the wrong person first…",
            "A quiet morning reveals something that was always there…",
            "The past walks in, wearing a different face…",
            "A choice made years ago comes home to stay…"
        ),
        Genre.FOLKLORE to listOf(
            "The old tale was wrong. The true version is darker…",
            "A spirit appears that no one in the village remembers…",
            "The ritual has a step that was deliberately forgotten…",
            "The season turns early, and the old rules don't apply…"
        )
    )

    private val midStarters: Map<Genre, List<String>> = mapOf(
        Genre.FANTASY to listOf(
            "The bargain comes due, and the price is higher than anyone imagined…",
            "The kingdom's true enemy was never the one they fought…",
            "The hero's power has a cost they didn't know they were paying…",
            "An old enemy returns, offering an alliance nobody trusts…"
        ),
        Genre.MYSTERY to listOf(
            "The detective becomes the suspect…",
            "A confession that doesn't match the evidence…",
            "The trail leads to someone the detective loves…",
            "The case is connected to one that was closed years ago…"
        ),
        Genre.ROMANCE to listOf(
            "The distance between them is no longer just physical…",
            "A choice must be made, and both options cost something…",
            "The past and the present demand different things…",
            "Trust is tested in a way neither expected…"
        ),
        Genre.SCIFI to listOf(
            "The technology evolves beyond its designers' control…",
            "A second signal arrives, and it contradicts the first…",
            "The mission parameters change without warning…",
            "The line between observer and subject dissolves…"
        ),
        Genre.FICTION to listOf(
            "The consequences of the first decision arrive…",
            "A relationship is tested by something neither can control…",
            "The world shifts around them, and they must decide who to be…",
            "A revelation reframes everything that came before…"
        ),
        Genre.HORROR to listOf(
            "The rules of the haunting change — it's learning…",
            "Someone tries to leave, and the house won't let them…",
            "The history of the place goes deeper than anyone knew…",
            "The fear becomes something more: understanding…"
        ),
        Genre.THRILLER to listOf(
            "The operation is compromised from the inside…",
            "The true target was never what they said it was…",
            "A trusted ally has been playing a longer game…",
            "The escape route is a trap…"
        ),
        Genre.ADVENTURE to listOf(
            "The terrain itself becomes the enemy…",
            "The group fractures under pressure…",
            "The prize is real, but the cost is steeper than promised…",
            "A detour becomes the most important part of the journey…"
        ),
        Genre.LITERARY to listOf(
            "The weight of what was unsaid becomes unbearable…",
            "A moment of grace arrives in the midst of crisis…",
            "The character does the thing they swore they wouldn't…",
            "Time skips, and the gap tells its own story…"
        ),
        Genre.FOLKLORE to listOf(
            "The old story isn't finished — it was only paused…",
            "A new teller reshapes the tale, and the tale reshapes them…",
            "The boundary between myth and memory thins…",
            "The village must choose which version to believe…"
        )
    )

    private val lateStarters: Map<Genre, List<String>> = mapOf(
        Genre.FANTASY to listOf(
            "The final confrontation arrives — but the enemy isn't who they expected…",
            "The last piece of the prophecy falls into place…",
            "The hero must choose between power and sacrifice…",
            "The kingdom's fate rests on a single, impossible act…"
        ),
        Genre.MYSTERY to listOf(
            "The final piece connects everything — and the picture is devastating…",
            "The detective's last deduction reveals a truth they weren't ready for…",
            "The confession comes from the one person no one suspected…",
            "The case closes, but the reckoning has only begun…"
        ),
        Genre.ROMANCE to listOf(
            "The last wall comes down…",
            "A choice that changes both their futures…",
            "The truth spoken at the perfect, terrible moment…",
            "The ending is also a beginning…"
        ),
        Genre.SCIFI to listOf(
            "The final data arrives, and it rewrites everything…",
            "The machine must be answered — and the answer is a question…",
            "The last boundary is crossed, and there's no going back…",
            "The future and present collide in a single moment…"
        ),
        Genre.FICTION to listOf(
            "The ending that was always coming arrives…",
            "A final reckoning with who they've become…",
            "The story comes full circle — but the circle is different now…",
            "What was lost returns, transformed…"
        ),
        Genre.HORROR to listOf(
            "The final door opens, and what's behind it has been waiting…",
            "The only way out is through…",
            "The horror reveals its true name…",
            "The last light goes out — and something remains…"
        ),
        Genre.THRILLER to listOf(
            "The endgame is in motion, and nothing can stop it…",
            "The true mastermind is revealed…",
            "The final move is a sacrifice…",
            "The last secret is the one that matters most…"
        ),
        Genre.ADVENTURE to listOf(
            "The destination is in sight — but the hardest part is still ahead…",
            "The final challenge demands everything they've learned…",
            "The journey's end is not what was promised — it's something better…",
            "The return home is the truest test…"
        ),
        Genre.LITERARY to listOf(
            "The last page writes itself…",
            "A reckoning with grace, or the absence of it…",
            "The story ends, and the silence is the point…",
            "What was planted in the first chapter blooms here…"
        ),
        Genre.FOLKLORE to listOf(
            "The tale completes its final turn…",
            "The old debt is paid, or the old promise is kept…",
            "The last teller passes the story on…",
            "The magic returns to where it began…"
        )
    )

    // Fall back to fiction for genres not in the pools
    private val allGenres = Genre.entries.toTypedArray()

    fun starters(genre: Genre, chapterNumber: Int, plannedTotal: Int?): List<String> {
        val position: Double = if (plannedTotal != null && plannedTotal > 0) {
            chapterNumber.toDouble() / plannedTotal
        } else if (chapterNumber <= 3) {
            0.25
        } else if (chapterNumber <= 7) {
            0.5
        } else {
            0.85
        }

        val pool: List<String> = when {
            position < 0.4 -> earlyStarters[genre] ?: earlyStarters[Genre.FICTION]!!
            position < 0.8 -> midStarters[genre] ?: midStarters[Genre.FICTION]!!
            else -> lateStarters[genre] ?: lateStarters[Genre.FICTION]!!
        }
        return pool.shuffled().take(5)
    }
}

// MARK: - Chapter Title Pool

object ChapterTitlePool {
    val titles: Map<Genre, List<String>> = mapOf(
        Genre.FANTASY to listOf("The Wolf's Return", "A Bargain Struck", "The Long Road North", "What the Moon Knew", "The Iron Oath", "The Seventh Gate"),
        Genre.MYSTERY to listOf("The Second Body", "The Missing Page", "A Confession Rewritten", "The Unmarked Door", "Closing Argument", "The Last Witness"),
        Genre.ROMANCE to listOf("The Letter Unsent", "Two Trains", "The Unfinished Sentence", "Rain in November", "The Other Side of Quiet", "A Table for Two"),
        Genre.SCIFI to listOf("The Second Signal", "Drift", "The Human Variable", "Protocol Zero", "The Last Transmission", "Mirror Matter"),
        Genre.FICTION to listOf("The Return", "Unwritten", "The Long Way Home", "What Remained", "The Other Map", "Crossing"),
        Genre.HORROR to listOf("The Thirteenth Mark", "Below", "The Room That Wasn't There", "House of Teeth", "The Final Count", "Unmaker"),
        Genre.THRILLER to listOf("The Mole", "Countdown", "Blind Spot", "The Switch", "Zero Hour", "Compromised"),
        Genre.ADVENTURE to listOf("The Narrows", "The Old Way", "Storm Season", "The Far Shore", "The Detour", "High Ground"),
        Genre.LITERARY to listOf("The Empty Room", "What the Garden Knew", "The Last Kitchen", "Departure", "The Returned", "Still Life"),
        Genre.FOLKLORE to listOf("The Old Story", "What the Wind Carried", "The Unfinished Crane", "The Second Wish", "Root and Branch", "The Hollow Tree"),
        Genre.SLICE_OF_LIFE to listOf("Tuesday", "The Regulars", "A Small Kindness", "The Morning Route", "Neighbors", "The Last Note"),
        Genre.HISTORICAL to listOf("The Coded Page", "The Front Line", "The Archive", "Wartime", "The Unsent Dispatch", "After the Armistice"),
        Genre.CONTEMPORARY to listOf("The Notification", "Offline", "The Feed", "The Last Post", "Connection", "Refresh"),
        Genre.LGBTQ to listOf("The Homecoming", "Out Loud", "The Found Family", "A New Name", "Pride and Place", "The Door Opens"),
        Genre.COMEDY to listOf("The Incident", "The Worst Plan", "A Series of Unfortunate Coincidences", "The Intervention", "Hot Mess", "The Grand Blunder"),
        Genre.DRAMA to listOf("The Reckoning", "What Was Said", "The Last Dinner", "The Will", "Breaking Point", "The Reunion"),
        Genre.MYTHOLOGY to listOf("The God Who Walked", "Divided Pantheon", "The Mortal's Wager", "The Last Offering", "The Divine Wound", "The New Myth"),
        Genre.SPIRITUALITY to listOf("The Fork", "The Inner Door", "The Silent Bell", "The Return", "The Clear Path", "The Open Hand"),
        Genre.MOTIVATIONAL to listOf("The Wall", "The Comeback", "The Inner Voice", "The Final Climb", "The Team", "Beyond the Goal"),
        Genre.KIDS to listOf("The Secret Room", "The New Friend", "The Riddle Garden", "The Magic Map", "The Brave Little Light", "The Treehouse Club"),
        Genre.POETRY to listOf("The Space Between", "The Returning Image", "The Open Form", "The Last Stanza", "The Silence After", "The Unwritten Line")
    )

    fun randomTitle(genre: Genre): String {
        val pool = titles[genre] ?: titles[Genre.FICTION]!!
        return pool.random()
    }
}

// MARK: - Chapter Body Pool

object ChapterBodyPool {
    val bodies: Map<Genre, List<String>> = mapOf(
        Genre.FANTASY to listOf(
            "The morning after everything changed, Pema found the wolf at the edge of the village. It was not a wolf she recognized, and it was not a wolf that recognized her. It sat with its back to the forest, its eyes on the dawn road, as if it had been waiting.\n\nShe knelt, though every instinct told her not to. The wolf bowed its head. Around its neck, tied with a cord of black silk, was a message tube carved from antler. Inside, a single strip of birch bark, and on it, a single word: \"Soon.\"\n\nShe did not know what was coming. She knew only that the waiting was over. The loom in her courtyard sat half-threaded, the moonlight still clinging to it like frost. She had woven a cloak for the prince, and the prince had worn it into battle, and the battle had not gone as anyone expected. The wolf looked at her. She looked back. \"All right,\" she said. \"Show me.\"",
            "The road north was longer than the maps suggested, and the maps suggested it was very long. Kael walked it anyway, because the alternative was to turn back, and turning back meant admitting that the last three years had been wasted.\n\nHe met the cartographer at the second crossroads. She was old, her hands ink-stained, her eyes sharp. \"You're going the wrong way,\" she said. \"I know,\" he said. \"I've been going the wrong way my whole life. But the wrong way is the only way I know.\"\n\nShe laughed. It was a good laugh, the kind that means someone has said something truer than they meant to. She unrolled a map from her cart and pointed to a place that wasn't on any map Kael had ever seen. \"That's where you're going,\" she said. \"It's not on any map.\" \"It's on mine,\" she said. \"I made it myself.\"",
            "The bargain had been struck at midnight, in the old way, with salt and iron and a name spoken backward. The terms were simple: one favor now, one debt later, to be collected at the creditor's discretion. Maren had agreed because she was desperate, and desperation makes the future feel like someone else's problem.\n\nThe creditor came at dawn. Not in person — they sent a crow, black as a closed eye, with a note tied to its leg. \"The debt is due,\" the note read. \"Collect at the river. Bring nothing.\"\n\nMaren stood at the river for an hour before the water began to move against itself. The current reversed, and in the gap between the two flows, something rose — not a body, not a creature, but an absence shaped like a door. She stepped through. On the other side, the sky was the same, but the ground was not. She was somewhere else. She was in the debt."
        ),
        Genre.MYSTERY to listOf(
            "The second body was found in the same position as the first, which meant either the killer was methodical or the detective was losing her ability to see difference. She chose to believe the former, because the alternative was retirement.\n\nThe body was arranged with care — hands crossed, eyes closed, a single white flower in the left palm. The flower was a chrysanthemum, the same as the first. The soil on the roots was red clay, the same as the first. Everything was the same, which meant the killer was sending a message, and the message was: I can do this again.\n\nBut there was one difference. The second victim had a note in their pocket, and the note was addressed to the detective. It said: \"You're closer than you think. But you're looking at the wrong map.\" She read it twice, then looked at the body again. The victim's eyes were closed, yes. But the left eye had been closed by someone else's hand. The right eye was closed naturally. The killer had arrived after death. The murder was not the crime. The display was.",
            "The witness lied. Detective Torres knew it the moment the words left the woman's mouth — not because the story was implausible, but because it was too clean. Real memories have ragged edges. This one was hemmed.\n\n\"I was at home,\" the woman said. \"I heard nothing. I saw nothing. I was asleep.\" Torres wrote it down. She didn't challenge it. She'd learned, over twenty years, that the first lie is the most important one, because it's the one the liar has rehearsed. The second lie is always sloppier. The third is the truth wearing a disguise.\n\nShe came back the next day. \"Tell me again,\" she said. The woman told the same story, word for word. Torres nodded. \"Now tell me what you left out.\" The woman's hands went still. \"What makes you think I left something out?\" \"Because everyone does,\" Torres said. \"The question is whether what you left out matters.\"",
            "The confession didn't match the evidence, and the evidence didn't match the confession, and the detective was the only person in the building who seemed to care about the discrepancy.\n\n\"He said he did it alone,\" Torres told her partner. \"He said he entered through the window, took the painting, and left.\"\n\n\"So?\" her partner said. \"Case closed.\"\n\n\"The window is on the fourth floor. He weighs two hundred pounds. There's no ladder, no rope, no marks on the wall. The window lock was opened from the inside.\"\n\n\"He had a key.\"\n\n\"He's never been to the building. He has no connection to the owner. He has no history of art theft. He has a history of petty burglary and one count of fraud. He's not a fourth-floor-window man. He's a back-door man.\""
        ),
        Genre.ROMANCE to listOf(
            "The letter arrived on a Wednesday, which was the day she always spent at the kitchen table with cold coffee and an unread book. She recognized the handwriting before she opened it — his, the same slanted capitals he'd used in every note he'd ever left her, including the last one, the one that said he needed to go.\n\nShe read it standing up, which was unusual. She usually sat for everything. The letter was short. \"I've been writing this for two years,\" it said. \"Every version was too long. This is the shortest one: I was wrong. I'm sorry. I'm here.\"\n\nShe set the letter on the table. She looked at it. She looked at the cold coffee. She looked at the book she hadn't read. Then she picked up her phone and typed a message, deleted it, typed another, deleted it, and finally called. He answered on the first ring. Neither of them spoke. The silence said everything the letters had been trying to.",
            "They met again by accident, which is how all the important meetings in their lives had happened. The first time, at a bookshop. The second, at a hospital. This time, at a bus stop in the rain.\n\nShe had an umbrella. He didn't. She offered half. He took it. They stood side by side, not speaking, watching the rain fill the gutter. The bus was late. The rain was early. Everything in their lives had been like this — timing that was almost right but never quite.\n\n\"I thought about you,\" he said. \"I thought about you too,\" she said. \"And then I stopped.\" \"Why?\" \"Because thinking about you was a thing I did instead of living.\" He nodded. The bus came. Neither of them got on. The rain stopped. They walked. They didn't know where. They walked anyway.",
            "The shared secret was a small one: they had both, independently, named the same stray cat. She called it Shadow. He called it Professor. They discovered this when they both showed up at the vet on the same day with the same cat in the same carrier.\n\nThe vet was amused. They were not. They stood in the parking lot, arguing about who had the right to take the cat home, while the cat sat in its carrier and watched them through the grate with an expression of supreme indifference.\n\n\"I've been feeding it for six months,\" she said. \"I've been feeding it for eight,\" he said. \"I have receipts.\" \"I have photos.\" They looked at each other. The cat meowed. Something about the meow made them both laugh, and the argument dissolved, and they went to get coffee, and the cat came home with both of them, and the apartment, it turned out, had room for three."
        ),
        Genre.SCIFI to listOf(
            "The signal changed at 03:14, which was the exact moment Dr. Shah had predicted it would, and the exact moment she had hoped it wouldn't. The frequency shifted by 0.3 hertz — a tiny adjustment, almost imperceptible, but it meant the source was not static. It was responding.\n\nShe called the lab. No one answered. It was 3:14 in the morning. She called again. Finally, a sleepy postdoc picked up. \"Run the new frequency through the pattern matcher,\" she said. \"And wake up Dr. Okonkwo. Tell him the signal isn't a recording. It's a conversation.\"\n\nThe pattern matcher returned a result in eleven seconds. The new frequency, when overlaid with the original, produced a shape. The shape was not a waveform. It was a question mark. Someone — something — was asking if they were still listening. Shah stared at the screen. She typed: \"Yes.\" She sent it. The signal shifted again. The new shape was a period. An acknowledgement. A receipt. Something, somewhere, had heard her.",
            "The quantum field generator had been running for seventy-two hours without incident, which Yuki found more alarming than if it had malfunctioned. In her experience, systems that ran perfectly were either about to fail or had already failed in a way she hadn't detected yet.\n\nShe ran the diagnostics. Everything came back green. She ran them again. Green. She ran them a third time, this time with the secondary array, and the results changed: one sensor, the one closest to the probability rose, was reporting a temperature of 37 degrees. Body temperature. The sensor was in a vacuum-sealed chamber.\n\nShe opened the chamber. The rose was gone. In its place was a seed — dark, smooth, warm to the touch. She held it and felt a pulse. Not hers. The seed's. She set it down and backed away. The seed began to germinate. In the vacuum. In the dark. In the silence. It grew the way a heart grows: slowly, deliberately, and with a rhythm that suggested it knew exactly what it was becoming.",
            "The Mars colony received its first visitor on Sol 412. The visitor did not arrive by ship. It arrived by radio — a transmission in clear, unaccented English, broadcast on the colony's internal frequency, from a location three kilometers north of the habitat.\n\n\"Good morning,\" the transmission said. \"I hope I'm not too early.\"\n\nMission Commander Liang stared at the radio. There were no installations north of the habitat. There were no people north of the habitat. The nearest human settlement was 54.6 million kilometers away. She picked up the handset. \"Who is this?\" she said. \"This is the first colonist,\" the voice said. \"I arrived before you. I've been waiting. I wasn't sure you'd come.\"\n\nLiang looked at her crew. They looked at her. The air scrubbers hummed. The solar panels ticked in the wind. \"How long have you been waiting?\" Liang asked. The voice paused. \"By your calendar? Four hundred years. By mine? I'm not sure. Time moves differently when you're alone.\""
        ),
        Genre.FICTION to listOf(
            "The stranger returned on a Sunday, which was the day the village did its laundry and its thinking in equal measure. He looked the same — same coat, same hat, same way of standing as if he expected the ground to move. The difference was in his hands. They were empty.\n\nThe mapmaker saw him first. He set down his coffee and watched the stranger cross the square. \"You're back,\" he said. \"I'm back,\" the stranger said. \"I brought what you asked for.\" \"I didn't ask for anything.\" \"You did. You just didn't say it out loud.\"\n\nThe stranger opened his coat. Inside, where the pockets should have been, was a map. Not drawn — grown. The lines were roots, the borders were moss, the cities were small flowers. The mapmaker took it. It was warm. It pulsed. \"Where does this lead?\" he asked. \"To the place you were always trying to find,\" the stranger said. \"The one that doesn't exist yet.\"",
            "The discovery in the attic was not the one they expected. They had gone up looking for Christmas decorations and found, instead, a box labeled in their grandmother's hand: \"For after I'm gone. Don't open until you're ready.\"\n\nThey were not ready. They opened it anyway. Inside were letters — hundreds of them, written over fifty years, addressed to people they had never heard of. Each letter was sealed. Each envelope had a name and an address. Each address was in a city they had never visited.\n\nThey sat on the attic floor and read the first one. It was addressed to a woman in Lisbon, dated 1972. \"Dear Maria,\" it began. \"I have never told you what happened. I have never told anyone. But I think you should know, even now, even this late, that the life I lived was not the one I chose. It was the one that chose me. And I think, if you remember, you'll understand why.\"",
            "The town's secret surfaced at the worst possible moment — during the Founder's Day parade, when everyone was on Main Street, when the mayor was at the podium, when the band had just finished playing the national anthem and the silence was the kind that makes people nervous.\n\nIt surfaced as a letter, pinned to the bulletin board outside the post office, written in a hand that half the town recognized. \"The founder didn't found this town,\" it said. \"He stole it. The deed is in the courthouse, filed under a different name. The real founder is buried in the cemetery, under a stone that says 'Unknown.' His name was James. He built the church. He dug the well. He planted the elm trees. He was killed for the land. The man on the statue is the man who killed him.\"\n\nThe mayor read the letter. The town read the letter. The band stood with their instruments at their sides. The elm trees, the ones James had planted, rustled in the wind. The mayor looked at the statue. The statue looked back. The silence grew until it was the loudest thing anyone had ever heard."
        ),
        Genre.HORROR to listOf(
            "The house grew. Maria noticed it first — a hallway that was longer than it had been, a room that was wider, a door that hadn't existed yesterday. She measured it with a tape measure, twice, and the numbers confirmed what her eyes had refused to believe. The house was adding space to itself, and it was doing it at night, when they were asleep.\n\nShe told Carlos. He went to the new door and opened it. Behind it was a room — small, dark, cold. The walls were covered in the same scratch marks as the cellar, but these were fresh, and they were wet, as if something had been clawing at them from inside the walls, trying to get out. Or trying to get in.\n\n\"We should leave,\" Maria said. \"We can't,\" Carlos said. He showed her the front door. It opened onto the hallway. The hallway led to the kitchen. The kitchen led to the hallway. They were inside, and the inside was all there was. The house had eaten the outside. They were all that was left.",
            "The whispers found a new voice. It started on the third night — not Maria's name anymore, not Carlos's. A child's voice, small and clear, coming from the walls, saying words that didn't make sense until they did.\n\n\"Can you hear me?\" the voice said. \"I'm underneath. I'm underneath. Please don't go. I've been alone for so long.\"\n\nMaria pressed her ear to the floor. The voice was clearer there — not louder, but closer, as if the child was just below the boards, curled up in the dark. \"How long?\" Maria whispered. The voice answered. \"By your count, three hundred and thirteen. By mine, I stopped counting.\"\n\nCarlos pulled her away from the floor. \"Don't talk to it,\" he said. \"It's not a child.\" Maria looked at him. \"How do you know?\" Carlos didn't answer. But his hands were shaking, and Maria saw, for the first time, that he already knew what was underneath. He had known before they moved in.",
            "The last light went out at midnight, and what remained was not darkness. It was something else — a presence that occupied the space where light had been, not blocking it but replacing it, the way water replaces air in a drowning lung.\n\nMaria stood in the hallway. She could see, but not with her eyes. The seeing came from somewhere else — from the house itself, from the walls, from the thing that had been waiting under the floor since before the foundation was poured. It showed her things. The first family. The second. The third. All of them had lived here. All of them had heard the whispers. All of them had gone downstairs, one by one, in the dark, following the voice.\n\nShe saw them now. They were not dead. They were not alive. They were underneath, and the underneath was not a place but a state, and the state was patience, and the patience was the thing that kept the house standing, that kept the doors opening, that kept the whispers calling, night after night, century after century."
        ),
        Genre.ADVENTURE to listOf(
            "The narrows were exactly as the map had promised — a slit in the canyon wall, barely wide enough for the raft to pass sideways, with water moving so fast it didn't look like water anymore. It looked like stone. Liquid stone, flowing, patient, certain.\n\nJared lined up the raft and held his breath. The walls closed in. The sky became a strip of blue between black rock. The water rose to meet it. For thirty seconds, he was in a place that was not a river and not a canyon and not a sky. It was somewhere between all three, and it was the most terrifying and beautiful place he had ever been.\n\nThen the walls opened. The canyon widened. The river slowed. And in front of him, in a pool so still it looked like glass, was the village. Twelve houses. A temple. A garden. The old woman was standing at the water's edge. She was smiling. \"You made it,\" she said. \"Not many do.\"",
            "The storm drove them off course, which was the storm's way of being helpful. The map said the pass was to the east. The storm said: not today. The storm said: try the north.\n\nThe north was not on the map. The north was a blank space, a white silence, a place where the cartographer's pen had run out of ink or nerve. They went north anyway, because the alternative was to sit in the storm and wait, and waiting was not something any of them were good at.\n\nOn the second day, the storm cleared. They stood on a ridge and looked down into a valley that shouldn't have existed. It was green — impossibly green, summer-green in the middle of winter. A river ran through it, and on the riverbank, a camp. Not abandoned. Recently used. There were footprints in the mud, still wet. Someone had been here. Someone had left in a hurry.",
            "The final challenge was not a mountain or a river or a storm. It was a choice. The valley lay before them — the destination, the end of the journey, the place every map and every story had been pointing toward. But between them and the valley was a bridge, and on the bridge stood a figure, and the figure was holding something.\n\n\"You can cross,\" the figure said. \"But only one of you. The bridge won't hold more. Choose.\"\n\nThey looked at each other. They had walked for weeks, shared food and cold and silence and stories. They had become, without meaning to, a team. And now the team had to be broken. One would cross. The others would wait.\n\nJared stepped forward. Then Kai. Then Sara. Then, simultaneously, they all stepped back. \"We all go or none of us go,\" Sara said. The figure on the bridge smiled. \"That,\" it said, \"was the right answer.\" The bridge widened. It had been wide enough all along."
        ),
        Genre.LITERARY to listOf(
            "The empty room was not empty. It was full of what had been there — the chair, the lamp, the smell of coffee, the sound of a voice that had stopped. Amma stood in the doorway and felt the weight of absence, which was heavier than any presence, because presence takes up space and absence takes up everything.\n\nShe crossed the threshold. The floor creaked where it had always creaked, under the window, where the light came in at the angle it had always come in. She sat in the chair that was not there. She held the cup that was not there. She said the name that was not there.\n\nThe room did not answer. Rooms don't. But something in the walls, in the grain of the wood, in the years of habitation that had seeped into the plaster, something held her. Not a ghost. Not a memory. A habitation. The room had been lived in, and the living had left its mark, and the mark was not gone. It was just quiet. She sat in the quiet and let it hold her. It was enough.",
            "The letter was read by the wrong person first. This was not a tragedy. This was how letters worked — they traveled, they arrived, they were opened by whoever was nearest. In this case, the nearest person was the postman, who read the first line by accident and the rest on purpose.\n\nThe first line was: \"I have loved you since the summer of the storm.\" The postman knew the address. He had been delivering there for twelve years. He knew the woman who lived there, and he knew the man who had written the letter, because he had delivered the man's letters before.\n\nThe postman sealed the envelope. He put it in the mailbox. He walked away. He did not tell anyone what he had read. But the next day, when he delivered the mail, he saw the woman sitting on her porch, the letter in her hands, her face different — not happier, not sadder, but open, the way a door is open, the way a life is open when it has been given something it didn't know it was waiting for.",
            "The garden knew. It had always known. The roses turned toward the sea when the letter came. The jasmine bloomed early when the ship sank. The wisteria climbed the wrong wall the week her son left. The garden was not psychic. The garden was patient. It had been growing for forty years, and it had learned to read the seasons of a human life the way a farmer reads the sky.\n\nShe stood in the garden now, in the rain, and the rain fell on her face and on the roses and on the jasmine and on the wisteria, and everything was wet and everything was alive and everything was telling her the same thing: the time for waiting is over. Not because the waiting is done. Because the thing you are waiting for is already here.\n\nShe looked at the roses. They were not turned toward the sea anymore. They were turned toward her. She knelt in the mud. She put her face close to the petals. They were warm. They were warm in the rain. She closed her eyes. She breathed. The garden breathed with her."
        ),
        Genre.FOLKLORE to listOf(
            "The old story was wrong, and the woman who knew it was wrong was eight years old. She had heard the tale a hundred times — the crane, the wish, the folding. But the tale always ended with the folding. It never said what happened to the paper.\n\nShe asked her grandmother. Her grandmother went quiet. \"The paper,\" she said, \"goes back into the world. It becomes a leaf, a feather, a snowflake. It finds the person who wished and it watches over them. The crane is not the magic. The crane is the key. The paper is the magic.\"\n\n\"What happens to the paper after?\" the girl asked. Her grandmother looked at her hands. They were old. They were thin. They were the hands that had folded a thousand cranes. \"It becomes a person,\" she said. \"The paper becomes a person. The person lives and grows and folds their own cranes. And when they are done, they become paper again. It is a circle. It has always been a circle. The story forgot to tell you because the story was written by someone who was afraid of circles.\"",
            "The village chose which version to believe, and the choosing was the hardest thing they had ever done. There were two stories. In the first, the river spirit was kind — it had saved the village from flood, brought fish in the lean years, kept the water sweet. In the second, the river spirit was hungry — it had taken a child every generation, demanded silence, punished those who spoke of the taking.\n\nBoth stories were true. Both had witnesses. Both had evidence — the abundant fish on one hand, the small unmarked graves on the other. The village stood at the riverbank and argued. The river listened. The river did not correct them.\n\nFinally, the oldest woman in the village spoke. \"We are asking the wrong question,\" she said. \"The question is not which story is true. The question is: which story do we need to tell?\""
        ),
        Genre.THRILLER to listOf(
            "The operation was compromised from the inside, and the inside was the only place they couldn't look. Agent Chen stood in the safe house and counted the people she trusted. The number was smaller than it had been an hour ago, and the hour before that, and the hour before that.\n\nShe had been in this business for fifteen years. She had been betrayed twice — once by a partner, once by a source. Both times, the betrayal had come from the outside, from the other side. This was different. This was coming from her own team. From someone who had been in the room when the plan was made.\n\nShe looked at the three people standing with her. One of them was the mole. She didn't know which. She wouldn't know until it was too late, or unless she made a move first. She made a decision: she would feed each of them a different piece of false intel. Whichever version reached the other side would tell her who to trust. The problem was, by the time she knew, someone would be dead. The question was: who?",
            "The true target was never what they said it was. Chen figured this out at 2 AM, sitting in the dark with the operation file spread across her lap, reading the same sentence for the tenth time: \"Objective: recover the hard drive from the embassy.\"\n\nThe embassy didn't have a hard drive. The embassy had paper. It had a vault, yes, but the vault held documents — old ones, typewritten, impossible to digitize without physically removing them. The \"hard drive\" in the file was a fiction. Someone had written the objective to sound plausible without being real. The real objective was something else. Something the file didn't mention.\n\nShe called her handler. \"The objective is wrong,\" she said. \"The objective is what I wrote,\" the handler said. \"Then you wrote it wrong,\" she said. There was a pause. A long one. \"The real objective,\" the handler said finally, \"is the woman in the embassy. The documents are the cover. The woman is the target. We need to get her out.\""
        ),
        Genre.SLICE_OF_LIFE to listOf(
            "Tuesday started like every Tuesday. Coffee, toast, the sound of the neighbor's dog, the bus that was always three minutes late. The only difference was that today, for the first time in six months, she noticed it.\n\nShe noticed the way the toast browned unevenly — darker on the left, lighter on the right, because the heating element in the old toaster was going. She noticed the dog's bark — not angry, not bored, just announcing. I am here, it said. I am still here. She noticed the bus, when it finally arrived, had a new crack in the windshield, shaped like a river on a map.\n\nShe sat in her usual seat and looked out the window. The city moved past — the bakery, the laundromat, the man who sold newspapers on the corner. She had seen all of it a thousand times. But today, it looked different. Not better. Not worse. Just present. As if the city had been holding its breath, and had finally exhaled. She exhaled too. Tuesday continued. She continued with it.",
            "The small kindness happened at the checkout line. The woman in front of her was short — not by much, just enough to matter. The total was twelve dollars and forty-seven cents. She had twelve dollars and a handful of coins. She counted them twice. It wasn't enough.\n\nShe started to put back the milk. The woman behind her — the one who was watching — reached into her purse, pulled out a dollar bill, and handed it to the cashier. \"For the milk,\" she said. The woman with the milk looked at her. \"You don't have to —\" \"I know,\" the woman said. \"That's what makes it work.\"\n\nThey stood there for a moment, the cashier waiting, the line behind them patient, and something passed between them that wasn't money. It was the recognition that the world is hard, and that sometimes the only thing that makes it less hard is the hand of a stranger, reaching out, expecting nothing back."
        ),
        Genre.HISTORICAL to listOf(
            "The coded page was found in the archives, where it had been filed under \"Miscellaneous Correspondence, 1944\" for eighty years. The archivist found it because she was looking for something else — a requisition form for typewriter ribbons — and the misfiled page fell out of the folder and onto the floor.\n\nShe picked it up. The front was ordinary: a list of supply shipments, dates, quantities. The back was not. On the back, written in invisible ink that had faded to a faint brown, was a message. She held it under the UV light. The message appeared: \"The network is blown. Burn everything. Get out. — S.\"\n\nShe stared at the signature. \"S.\" She knew the name. Everyone in the archives knew the name. Simone LeClerc. The only agent in the network who had survived. The one who had warned the others too late. The one who had spent the rest of her life saying she had done everything she could. This page proved she had done more. She had warned them. She had written it down. She had tried.",
            "The war reached the village on a Thursday. It came not as soldiers — those would arrive on Friday — but as a sound. A low hum, barely audible, that made the dogs stop and the birds go silent and the air feel thick, as if the sky itself was holding its breath.\n\nThe villagers stood in the square and listened. The hum grew. It was the sound of engines, many of them, far away but getting closer. Someone said: \"We should leave.\" Someone else said: \"Where would we go?\" No one had an answer. The village was all they knew. The road went to the city, and the city was where the fighting was.\n\nThe priest opened the church. The villagers went in. They did not pray — not yet. They sat in the pews and listened to the hum grow until it was a roar, and then diminish, and then grow again. The war was passing over them. Not through them. Not yet."
        ),
        Genre.CONTEMPORARY to listOf(
            "The app crashed at the worst possible moment — not during the pitch, not during the demo, but during the silence after, when the investors were looking at each other, deciding. The screen went black. The room went quiet. Maya stood at the podium with a dead laptop and a heart that was beating too fast.\n\nShe looked at the investors. They looked at her. One of them — the oldest, the one with the kind eyes — said: \"Tell me about it without the slides.\"\n\nMaya took a breath. She put down the laptop. She walked out from behind the podium. She told the story — not the pitch, not the deck, not the metrics. The story. Why she'd started. What the app was for. Who it was for. She talked for four minutes. She didn't use any numbers. When she was done, the old investor said: \"That's the best pitch I've ever heard. The slides were getting in the way.\" He wrote a check on the spot. The app was funded. The crash was the best thing that ever happened to it.",
            "The notification changed everything. Not a big notification — not a call, not a message, not an email. A push notification, from an app she had forgotten she installed. \"Someone you might know is nearby.\" She looked at the name. She hadn't seen it in seven years. She hadn't wanted to.\n\nShe closed the notification. She put the phone in her pocket. She walked. The phone buzzed again. She ignored it. She walked faster. The phone buzzed a third time. She stopped. She took out the phone. The notification had changed: \"They're in the same coffee shop as you.\"\n\nShe looked around. The coffee shop was small — six tables, four occupied. She knew immediately which one. The posture. The way the hand held the cup. The way the hair fell across the forehead. Seven years, and the body remembered before the mind did. She sat down at the table. She didn't speak. Neither did they. They just sat, two cups of coffee cooling between them, and the seven years dissolved into the steam."
        ),
        Genre.DRAMA to listOf(
            "The family secret couldn't stay buried any longer, and the person digging it up was the one who had spent the most years covering it. The father stood at the head of the table, the way he had for forty years, and said: \"There's something I need to tell you.\"\n\nThe three siblings went still. The middle one — the one who always knew things first — set down her fork. The youngest leaned forward. The oldest leaned back. The table was an old one, oak, their mother's, and it held them the way it always had: together, barely.\n\n\"Your mother didn't die the way I told you,\" the father said. \"She didn't die in the hospital. She died at home. She asked to come home. I brought her home. I was with her. I was the only one with her.\" The middle sibling spoke first. \"Why did you lie?\" The father looked at his hands. \"Because I was the only one with her. And I wanted you to remember her alive.\"",
            "The last dinner was not the last dinner anyone expected. No one had announced it. No one had said goodbye. But everyone knew. The mother had set the table with the good plates — the ones that only came out for Christmas and funerals. The father had opened the wine that was supposed to be saved for a wedding that hadn't happened.\n\nThey ate. They didn't talk much. The food was good — roast chicken, the way their mother made it, with rosemary and lemon. The wine was better. They passed the bottle and didn't count the glasses. Outside, the garden was going to seed. Inside, the house was going to quiet. Both were inevitable. Both were, in their way, beautiful.\n\nAfter dinner, the mother stood at the sink. The father dried. The three siblings stood in the doorway, watching. No one said: this is the last time. They didn't need to. The last time announced itself, the way all last times do — not with words, but with the particular quality of attention that means someone is memorizing a moment they know they will never live again."
        ),
        Genre.COMEDY to listOf(
            "The situation escalated in the worst — and funniest — possible way. It started with a cat. It always starts with a cat. The cat was not Dave's cat. It was Mrs. Henderson's cat. But the cat had decided, in the way cats do, that Dave's apartment was now its apartment, and Dave was now its person.\n\nMrs. Henderson disagreed. She disagreed by leaving a note on Dave's door. Dave responded by leaving a note on Mrs. Henderson's door. Mrs. Henderson responded by leaving a note on the building's bulletin board. Dave responded by leaving a note on the building's bulletin board. By Thursday, the bulletin board was covered in notes, the building was divided into two camps, and the cat was sleeping on Dave's couch, entirely unconcerned.\n\nThe landlord intervened on Friday. He read the notes. He looked at the cat. He looked at Dave. He looked at Mrs. Henderson. \"The cat,\" he said, \"has chosen. The cat is always right. The cat stays with Dave. Mrs. Henderson gets visitation rights. Everyone pays rent on time. Court adjourned.\" Mrs. Henderson was furious. Dave was confused. The cat was asleep.",
            "The misunderstanding snowballed into a full-blown crisis, which was impressive even by their standards. It started with a text. \"We need to talk,\" it said. Four words. The most dangerous four words in the English language, when combined.\n\nHe thought it meant: we're breaking up. She thought it meant: he knows what I did. Neither of them had done anything. The \"talk\" was supposed to be about the lease. But by the end of the day, he had packed a bag, she had called her mother, and both of them had sent long, heartfelt messages to each other that neither of them read, because both of them were too busy composing their own.\n\nThey met at the apartment. He had a bag. She had her mother on the phone. They looked at each other. \"What did you do?\" they said, simultaneously. \"Nothing,\" they said, simultaneously. \"Then why are you packed?\" she said. \"Then why is your mother on the phone?\" he said. The phone buzzed. It was the landlord. \"About the lease,\" it said. They sat down. They unpacked. They laughed. The cat, as always, was unimpressed."
        ),
        Genre.KIDS to listOf(
            "The treehouse revealed a new room — and the new room had a window that looked out onto a sky that was not the sky above the backyard. Luna found it on a Saturday morning, when the light was right and the world was quiet and the treehouse was doing what it always did when no one was watching: growing.\n\nThe room was small — just big enough for two children and a very patient cat. The window was round, like a porthole, and through it, she could see a garden. The garden was on a cloud. The cloud was floating above an ocean. The ocean was the color of twilight.\n\nLuna sat at the window and watched. Something moved in the garden — a figure, small, waving. She waved back. The figure waved again. Luna looked at the cat. The cat looked at her. \"I think we have a neighbor,\" she said. The cat yawned. The figure in the garden stepped closer to the window. It was a child, about Luna's age, with a crown of leaves and a belt made of starlight. \"Hello,\" the child said. \"I've been waiting for someone to find this room. Would you like to come in?\"",
            "The robot learned a new word, and the new word changed everything. The word was \"maybe.\" Before \"maybe,\" the robot's world was simple: yes or no, true or false, go or stop. After \"maybe,\" the robot stood in the kitchen for forty-five minutes, processing.\n\n\"Are you okay?\" Luna asked. The robot's eyes — two small screens that usually displayed simple icons — were spinning. \"I am processing a new concept,\" it said. \"The concept is: maybe. It is not yes. It is not no. It is a third thing. There are third things. I did not know there were third things.\"\n\nLuna sat down next to the robot. \"There are lots of third things,\" she said. \"Like what?\" the robot asked. \"Like maybe,\" she said. \"Like sometimes. Like almost. Like soon. Like we'll see.\" The robot processed for another minute. Then its eyes displayed a new icon — a question mark, but soft, not sharp. \"I think,\" the robot said, \"I like third things. They make the world bigger.\""
        ),
        Genre.POETRY to listOf(
            "The space between stanzas grew heavy with meaning, the way a held breath grows heavy before it becomes a word. The poet set down her pen. She had been writing for three hours and had produced four lines, and the four lines were not the poem. The poem was in the white space between them.\n\nShe read the lines aloud. They were simple: \"The light comes in. / The light goes out. / Between the two, / something stays.\" The words were ordinary. The order was not. The order was where the meaning lived, and the meaning was not in any single line but in the act of moving from one to the next, the way a river moves from stone to stone.\n\nShe picked up the pen. She crossed out the last line. She wrote a new one: \"Between the two, / I stay.\" The poem was done. It had been done before she started. She had only been clearing the way for it to arrive.",
            "The returning image was a door. It appeared in every poem she wrote — not always as a door, not always named, but always there, in the shape of a threshold, a gap, a place where one thing ended and another began. She had not noticed it until a reader pointed it out. \"Your poems,\" the reader said, \"are all about doors.\"\n\nShe went home and read her work. The reader was right. There was a door in every poem — sometimes open, sometimes closed, sometimes locked, sometimes gone, leaving only the frame. She sat with this knowledge for a long time. It did not change the poems. But it changed her. She understood, now, what she was doing. She was standing at the threshold of something, and the poems were her way of standing there."
        ),
        Genre.LGBTQ to listOf(
            "The homecoming was not what either of them expected. She had imagined it a hundred times — the train station, the hug, the tears, the long-overdue conversation. The reality was quieter. She got off the train. Her mother was waiting. They stood there. Neither of them moved.\n\n\"You came,\" her mother said. \"I came,\" she said. They looked at each other across ten feet of platform and fifteen years of silence. The silence had been about many things — the leaving, the reasons, the person she had become, the person her mother had wanted her to be. The silence had been about fear.\n\nHer mother spoke first. \"I should have called,\" she said. \"I should have answered,\" she said. They stood there. The train left. The platform was empty. Her mother held out her hand. She took it. They walked to the car. They didn't talk. They didn't need to. The homecoming was not a conversation. It was a hand, held out, and taken.",
            "The found family gathered for Sunday dinner, which was a tradition they had invented three years ago and which had become, without anyone noticing, the most important thing in their lives. There were seven of them. They were not related by blood. They were related by choice, which is harder and stronger and more deliberate.\n\nThey sat around the table — the table that was really a door on sawhorses, because none of them owned a real table — and they ate. They ate badly. Marcus had made the pasta, and it was overcooked. Dev had made the sauce, and it was too salty. Priya had made the bread, and it was perfect, because Priya always made the bread, and the bread was always perfect.\n\nThey ate the bad pasta and the salty sauce and the perfect bread, and they talked about their weeks, and they laughed, and they argued about a movie, and they sang, badly, and they cleaned up, and they hugged, and they left, and they would come back next Sunday, because that is what found families do. They show up. They eat the bad pasta. They come back."
        ),
        Genre.MYTHOLOGY to listOf(
            "The forgotten god woke up in a subway station, which was not where gods were supposed to wake up. He had been sleeping for three thousand years, and the world had changed — the temples were gone, the offerings were gone, the prayers were gone — but the station was familiar in one way: people were still afraid, and fear, it turned out, was a form of worship.\n\nHe stood on the platform. A train arrived. The doors opened. No one got on. No one got off. The god looked at the passengers. The passengers looked through him. He was invisible. He was forgotten. But he was not gone.\n\nHe walked through the train. He touched each passenger, lightly, on the shoulder. Not a blessing. Not a curse. A reminder. One passenger looked up. A child. The child could see him. \"Who are you?\" the child asked. The god smiled. He hadn't been asked his name in three thousand years. \"I am the answer to a question your people stopped asking,\" he said. \"But I think you're about to ask it again.\"",
            "The pantheon fractured on the night of the long fire, when the old treaty burned and the sky split along its seams. The gods had been at peace for an age — not because they agreed, but because they had agreed to disagree, which is the closest gods come to peace. Now the agreement was ash, and the gods were choosing sides.\n\nIn the middle of the fracturing, in the center of the council chamber, stood a mortal. She had been brought as a witness — a scribe, a recorder, nothing more. But the gods had forgotten something: a scribe is not passive. A scribe shapes the record. A scribe decides what is remembered.\n\nShe wrote. She wrote everything — every accusation, every alliance, every threat, every plea. And when the fracturing was done and the sides were chosen and the war was inevitable, she closed her book and said: \"Everything you have said tonight is written. Everything you do from this moment will be written. If you go to war, the war will be remembered. If you find peace, the peace will be remembered. The record is mine. Choose carefully.\""
        ),
        Genre.SPIRITUALITY to listOf(
            "The fork in the path appeared without warning — not as a sign, not as a choice, but as a feeling, the sense that the road had split even though the feet were still on a single track. The pilgrim stopped. The wind stopped. The silence, which had been her companion for a hundred miles, stopped too, as if even the absence of sound was waiting.\n\nShe looked left. She looked right. Both paths led into forest. Both paths looked the same. But they were not the same. She knew this the way she knew her own name — not from evidence, but from somewhere deeper, from the place where knowing lives before it becomes thinking.\n\nShe sat down. She did not choose. She waited. She waited for three days. On the third day, a traveler appeared — walking backward, feet on the path, eyes on the road behind. \"You're choosing,\" the traveler said. \"I'm waiting,\" the pilgrim said. \"Same thing,\" the traveler said. \"The path chooses you. You just have to be still enough to hear it.\"",
            "The silence answered, and the answer was not a word. It was a quality — a texture, a temperature, a weight. The monk had been sitting in the cave for forty days, asking the same question: \"What is the self?\" He had expected a voice, a vision, a teaching. He received silence. On the fortieth day, the silence changed.\n\nIt became dense. It became warm. It became, in a way he could not describe and would never be able to describe, present. The silence was not the absence of an answer. The silence was the answer. The self was not a thing. It was a space — the space in which the question was asked, the space in which the silence was heard, the space that remained when everything else was let go."
        ),
        Genre.MOTIVATIONAL to listOf(
            "The wall appeared at mile eighteen. Not a physical wall — her legs were fine, her lungs were fine, the road was flat and open. But the wall was there, inside her, between her and the finish line. It said: you can't. It said: you won't. It said: you never could.\n\nShe had hit this wall before. Every runner does. The wall is not the body giving up. The wall is the mind giving up. The body can always go further. The mind has opinions. The mind has memories of every other wall, every other failure, every other time it looked at the distance and said: too far.\n\nShe ran through it. Not because she was stronger than the wall. Because she had learned, after a thousand walls, that the wall is not real. The wall is a story the mind tells the body to keep it safe. The body doesn't need safe. The body needs to move. She moved. The wall thinned. The wall cracked. The wall fell. She ran through the gap. On the other side, the finish line. Not far. Not close. Just there.",
            "The inner voice spoke louder than the doubt, and the inner voice said: get up. Not tomorrow. Not next week. Not when you feel ready. Now. Get up now.\n\nShe got up. The floor was cold. The room was dark. The alarm had not gone off, and would not go off for another hour. But the inner voice had spoken, and she had learned, after years of ignoring it, that the inner voice was right. It was right about the getting up. It was right about the doing. It was right about the now.\n\nShe ran. Not far. Not fast. Just out the door, down the street, into the cold morning air that tasted like the first day of something. Her lungs burned. Her legs protested. The doubt said: you'll never keep this up. The inner voice said: that's tomorrow's problem. Today, you run."
        )
    )

    fun randomBody(genre: Genre): String {
        val pool = bodies[genre] ?: bodies[Genre.FICTION]!!
        return pool.random()
    }
}

// MARK: - Direction Placeholders

object DirectionPlaceholders {
    val pool = listOf(
        "The morning after everything changes…",
        "A confrontation neither of them saw coming…",
        "The moment of truth, finally…",
        "An unexpected reunion…",
        "The consequence catches up…",
        "A quiet moment before the storm…",
        "Someone opens a door that should have stayed closed…",
        "Leave it open — surprise me ✨"
    )

    fun random(): String = pool.random()
}

// MARK: - Mock Generation

private data class MockTemplate(
    val title: String,
    val genre: Genre,
    val themes: List<String>,
    val firstLine: String,
    val body: String
)

object MockGeneration {
    private val templates: List<MockTemplate> = listOf(
        MockTemplate(
            title = "The Mapmaker's Last Commission",
            genre = Genre.FICTION,
            themes = listOf("maps", "discovery", "time"),
            firstLine = "The old mapmaker had not drawn a new line in thirty years.",
            body = """The old mapmaker had not drawn a new line in thirty years. Every road, every river, every mountain was already charted, labeled, filed. The world, he believed, was complete. Then a stranger walked into his shop and asked for a map of a place that didn't exist.

"It exists," the stranger said. "It just hasn't been found yet."

The mapmaker picked up his pen. For the first time in decades, his hand was shaking. The stranger laid a cloth on the counter and unfolded it to reveal a fragment of parchment, water-stained and burned at the edges. On it were coordinates that matched no known system, and a single word written in a script the mapmaker had seen only once before — in a dream.

He worked through the night. The stranger did not leave. At dawn, the mapmaker looked up and saw that the shop had changed. The walls were farther apart. The windows showed a different street. The map was not finished, but the place was becoming real around them.

"You should know," the stranger said, "that every map is a promise. And every promise has a price." The mapmaker nodded. He had spent his life drawing boundaries. Now, at the edge of everything, he was ready to cross one."""
        ),
        MockTemplate(
            title = "The Letter from Tomorrow",
            genre = Genre.FICTION,
            themes = listOf("time", "garden", "warning"),
            firstLine = "She found the letter in the garden, pressed flat under a stone.",
            body = """She found the letter in the garden, pressed flat under a stone. It was addressed to her, in her own handwriting, dated tomorrow. "Don't go to the harbor," it said. "Trust the gardener. The roses know."

She looked at the roses. They were blooming out of season, red against the November frost, and they were all turned toward the sea.

The gardener was already waiting by the gate, pruning shears in hand, though nothing needed pruning. "You found it, then," he said. Not a question. "I've been leaving them for you for years. You're the first one to read one before it was written."

She wanted to ask a thousand questions, but the wind shifted and carried the sound of a ship's horn from the harbor. The roses rustled, turning their heads away. "Go inside," the gardener said. "Tomorrow you can go to the harbor. Not today."

She went inside. She locked the door. And when tomorrow came, the newspaper reported that the morning ferry had vanished in clear weather, leaving only a single red rose floating on the water."""
        ),
        MockTemplate(
            title = "The Clockmaker's Daughter",
            genre = Genre.FANTASY,
            themes = listOf("time", "family", "magic"),
            firstLine = "The clockmaker's daughter could stop time.",
            body = """The clockmaker's daughter could stop time. Not with a word or a gesture — with a thought. She discovered this at seven, during a thunderstorm, when she wished the lightning would stay a little longer and it did.

By twelve, she could hold the world still for minutes. By sixteen, she had stopped using it entirely. "What's the point," she said, "of freezing a moment if you can't share it with someone who's also frozen?"

Her father understood. He had built clocks his whole life, measuring moments he could not keep. On her seventeenth birthday, he gave her a pocket watch that did not tell time. "This one collects it," he said. "Every second you stop, it stores. Every second you give away, it spends."

She opened the watch. Inside, instead of gears, there was a garden in miniature, complete with a tiny sun that moved when she wound the crown. "Be careful," her father said. "Time is a currency, but love is the only thing worth spending it on."

That winter, when the town's river froze and a child fell through the ice, she spent every second she had. The watch grew cold in her palm. The world held its breath. She pulled the child out, handed him to his mother, and felt the watch go still.

It never worked again. But the garden inside kept growing."""
        ),
        MockTemplate(
            title = "Midnight in the Night Market",
            genre = Genre.MYSTERY,
            themes = listOf("market", "door", "sister"),
            firstLine = "Maya found the spice merchant in the souk, a bent old man who sold saffron and storytelling in equal measure.",
            body = """Maya found the spice merchant in the souk, a bent old man who sold saffron and storytelling in equal measure. He recognized the necklace Maya showed him — amber beads on a silver thread, handmade, unmistakable.

"The woman who wore this came two nights ago," he said. "She was looking for the door."

"What door?"

"The old door. In the medina wall. It opens only at midnight, only for those who are meant to find it."

Maya felt the hair rise on her arms. "Where is this door?"

The merchant smiled, showing teeth like old ivory. "You are already looking for it," he said. "That means you are meant to find it too."

She wandered the medina for hours, letting her feet lead her through alleys that narrowed until her shoulders brushed both walls. At midnight exactly, she turned a corner and found a wooden door set into stone that she was certain had been blank plaster that morning.

The door opened before she touched it. Beyond was not another alley but a courtyard filled with people who had gone missing from Marrakech over the centuries. They were not prisoners. They were librarians, each one cataloguing a different version of the city that might have been. Her sister sat at a desk near the fountain, writing furiously.

"You're late," Claire said, without looking up. "But you're here. That's what matters.\""""
        ),
        MockTemplate(
            title = "The Garden That Breathed",
            genre = Genre.SCIFI,
            themes = listOf("science", "wonder", "nature"),
            firstLine = "Dr. Yuki Tanaka grew the first impossible plant in a basement lab at Kyoto University.",
            body = """Dr. Yuki Tanaka grew the first impossible plant in a basement lab at Kyoto University. It was a rose, but not quite — the petals shimmered between colors that shouldn't exist together, and when you looked away and looked back, it had rearranged itself.

The rose grew without soil, without water, without light. It grew on probability. Yuki had spent seven years building a quantum field generator, and the rose was its first fruit. She didn't tell anyone. Not yet.

By the third day, the rose had produced a seed. By the fifth, the seed had fallen from its stalk and landed in a crack in the concrete floor. By the seventh, a vine was growing through the crack, reaching for the ceiling with alarming speed.

Yuki came to the lab on Monday morning and found a forest. The vine had become a tree, the tree had become a canopy, and under the canopy were flowers she had never designed — flowers that pulsed with their own light.

She stood in the doorway, her key card still in her hand, and listened. The garden was breathing. Not metaphorically — the air moved in and out, warm and green, as if the plants had invented their own respiration.

Something moved in the canopy. Something small, quick, alive. Yuki stepped back. The garden had made something she hadn't planted. It had made something that could move on its own. She reached for her phone, then stopped. Part of her wanted to see what came next."""
        ),
        MockTemplate(
            title = "The House That Whispered",
            genre = Genre.HORROR,
            themes = listOf("house", "fear", "voices"),
            firstLine = "The house was cheap.",
            body = """The house was cheap. That should have been a warning. Maria and Carlos moved in on a Friday, and by Friday night, the whispers had started. They came from the walls, from the floor, from somewhere just below the edge of hearing.

Carlos said it was pipes. Maria said it was wind. They told each other this in bed, the lamp on, not sleeping. The whispers didn't sound like pipes or wind. They sounded like names. They sounded like their names.

In the morning, the whispers stopped. Sunlight filled the kitchen, and Maria laughed at herself. Old house, she said. Settling. Carlos nodded. Neither of them mentioned that the cellar door, which they had locked the night before, was open.

Carlos went down first, holding a flashlight like a weapon. The stairs creaked under his weight. The cellar was cold — not the cold of stone, but the cold of something that had been waiting a long time.

The walls were covered in scratches. Not random — organized, deliberate, rows and rows of marks that looked like counting. Carlos counted. There were three hundred and twelve. Three hundred and twelve of something.

Behind him, the cellar door closed. He spun around, ran to it, tried the handle. Locked. The whispers started again, louder now, and this time he could hear the words. "Three hundred and thirteen," they said. "Three hundred and thirteen.\""""
        ),
        MockTemplate(
            title = "The Lighthouse Keeper's Letter",
            genre = Genre.ADVENTURE,
            themes = listOf("lighthouse", "storm", "time"),
            firstLine = "The bottle washed ashore on a Tuesday, green glass worn smooth by decades of salt and current.",
            body = """The bottle washed ashore on a Tuesday, green glass worn smooth by decades of salt and current. Tom Hardy had kept the lighthouse at Pemaquid Point for thirty-one years, and in that time he'd found many things on the beach. But never a bottle with a letter inside.

The paper was thick, hand-pressed, and the handwriting was precise, almost mechanical. "Dear Keeper," it began. "By the time you read this, the light will have failed. I am writing from the future. The lighthouse fell in the storm of '78. I am asking you to prevent it."

Tom read it three times, then set it on the kitchen table and watched it curl in the lamplight. The storm of '78 was twenty-six years away. The light hadn't failed. It still turned every night, sweeping its beam across the dark water like a slow, patient hand.

The storm came three weeks after the letter. Tom had weathered a hundred storms, but this one was different. The wind didn't howl; it whispered, and in the whispering he heard words he couldn't quite make out.

At midnight, the light failed. Not flickered — failed, as if someone had cut the power. Tom grabbed the backup lamp and climbed the spiral stairs, his knees protesting every step. At the top, the lens was dark.

He replaced the bulb. The new one lit, turned, swept the sea. And in the beam's arc, far out on the water, he saw a ship — wooden masts, canvas sails, the lighthouse tender from the 1950s. It was sinking. And on its deck, waving a lantern, stood a man who looked exactly like Tom."""
        ),
        MockTemplate(
            title = "Letters to the Sea",
            genre = Genre.LITERARY,
            themes = listOf("grief", "ocean", "letters"),
            firstLine = "Every morning, Amma walked to the pier with a letter folded in her sari.",
            body = """Every morning, Amma walked to the pier with a letter folded in her sari. She had been doing this for eleven years, since the day her son's ship failed to return. The letters were always the same: his name, a question, a promise to keep waiting.

She folded the paper into a bottle and let the tide take it. The fishermen watched from their boats but said nothing. Everyone in the village knew Amma. Everyone knew her story. No one knew what she wrote.

One morning, the bottle came back. Not the same bottle — this one was dark glass, sealed with wax. Inside was a letter in handwriting she didn't recognize. "Dear Mother," it said. "The sea kept your letters. It asked me to answer them."

Amma sat on the pier for three hours, reading the letter in every kind of light — morning, shadow, sun, cloud. The handwriting was neat but strange, as if the writer was unused to holding a pen.

The letter spoke of currents and depths, of a place where the water was warm and the light came from below. It spoke of a ship that had not sunk but had been carried, gently, to a shore that existed on no map.

It ended: "I am well. I am not alone. The sea says you should stop waiting, but I know you won't, and I love you for it." Amma folded the letter into her sari and began walking home. Tomorrow, she would write back."""
        ),
        MockTemplate(
            title = "Solitude",
            genre = Genre.ROMANCE,
            themes = listOf("island", "storm", "connection"),
            firstLine = "He came to the island to be alone.",
            body = """He came to the island to be alone. She came for the same reason. They met on the ferry, recognized something in each other's faces — the particular exhaustion of someone who has had enough of people — and said nothing.

The island was small. One village, one beach, one path that wound through pine forest to a lighthouse. He took the lighthouse. She took the village. They nodded at each other on the path and kept walking.

On the third day, it rained. He was at the lighthouse, she was in the village, and the rain came down so hard the path became a river. They were both stuck. He looked out the lighthouse window. She looked down the village street. They were a mile apart, and the rain was between them.

The storm lasted two days. He ran out of food. She ran out of firewood. On the second morning, he saw her on the beach, collecting driftwood. He walked down from the lighthouse, rain soaking through his coat.

They worked together without speaking. She gathered wood. He carried it. When the pile was big enough, they stood in the rain and looked at each other. "I have food," he said. "I have a fireplace," she said.

They ate dinner by the fire. They talked until the rain stopped. When the path was passable again, neither of them mentioned leaving. The ferry came on Friday. They didn't take it. They took the next one, two weeks later, together."""
        ),
        MockTemplate(
            title = "The Paper Crane",
            genre = Genre.FOLKLORE,
            themes = listOf("folk-tale", "kindness", "tradition"),
            firstLine = "In the village of Fukushima, there lived an old woman who folded paper cranes.",
            body = """In the village of Fukushima, there lived an old woman who folded paper cranes. She had been folding them for forty years, since her daughter was born. Her daughter was gone now, but the folding continued.

Every crane was different. Some were red, some were gold, some were white. The old woman hung them from the ceiling of her small house, and when the wind blew through the window, they turned slowly, casting shadows like birds in flight.

The children of the village believed the cranes were magic. They believed that if you wished on one, the wish would come true — but only if you wished for someone else, never for yourself. The old woman never confirmed this. She just kept folding.

A boy came to the old woman's house on a winter morning. He was thin, cold, and alone. His parents had gone to the city and hadn't come back. He wished, not for himself, but for his dog, who was sick.

The old woman gave him a crane — white, the smallest one, the one that hung closest to the window. "Fold it again," she said. "Unfold it and fold it once more, and the wish will carry." The boy took the crane home and did as she said.

The dog got better. The boy came back to thank the old woman, but the house was empty. The cranes were gone. All that was left was a single piece of paper, unfolded, with a handwritten note: "The magic was never in the crane. It was in the folding. Thank you for folding." The boy kept the paper. He learned to fold cranes. He taught others. The village never forgot."""
        )
    )

    suspend fun generateStory(
        genre: Genre,
        topic: String,
        characters: List<WizardCharacter>,
        language: StoryLanguage,
        authorId: String,
        plannedChapterCount: Int?,
        readingLevel: com.rork.kathaai.model.ReadingLevel = com.rork.kathaai.model.ReadingLevel.STANDARD
    ): GeneratedStory {
        val delayMs = Random.nextLong(10_000, 14_000)
        delay(delayMs)

        if (Random.nextDouble() < 0.05) {
            throw GenerationException("Simulated generation failure")
        }

        val template = templates.firstOrNull { it.genre == genre }
            ?: templates.random()
        val paragraphs = template.body.split("\n\n")
        val wordCount = paragraphs.sumOf { it.split(" ").size }

        val title = if (topic.isNotBlank()) {
            topic.split(" ").take(4).joinToString(" ")
                .replaceFirstChar { it.uppercase() }
                .takeIf { it.length >= 3 } ?: template.title
        } else template.title

        val themes = template.themes.toMutableList()
        themes.addAll(characters.take(2).map { it.role.lowercase() })

        return GeneratedStory(
            id = "generated-${UUID.randomUUID()}",
            title = title,
            authorId = authorId,
            genre = genre,
            language = language,
            themes = themes.take(5),
            coverColors = genre.coverColors,
            firstLine = template.firstLine,
            body = template.body,
            wordCount = wordCount,
            readingTime = maxOf(1, wordCount / 200),
            plannedChapterCount = plannedChapterCount,
            readingLevel = readingLevel
        )
    }

    suspend fun generateChapter(
        parentStoryId: String,
        chapterNumber: Int,
        direction: String,
        language: StoryLanguage,
        parentGenre: Genre,
        plannedChapterCount: Int?
    ): GeneratedChapter {
        val delayMs = Random.nextLong(10_000, 14_000)
        delay(delayMs)

        if (Random.nextDouble() < 0.05) {
            throw GenerationException("Simulated chapter generation failure")
        }

        val title = ChapterTitlePool.randomTitle(parentGenre)
        val body = ChapterBodyPool.randomBody(parentGenre)

        return GeneratedChapter(
            id = "chapter-${UUID.randomUUID()}",
            storyId = parentStoryId,
            chapterNumber = chapterNumber,
            title = title,
            body = body,
            coverColors = parentGenre.coverColors,
            isPublished = false,
            publishedAt = null,
            createdAt = System.currentTimeMillis()
        )
    }
}

class GenerationException(message: String) : Exception(message)
