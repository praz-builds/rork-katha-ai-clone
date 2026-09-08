import type { Genre } from "@/types/domain";

/**
 * Per-genre creative content, in one place.
 *
 * This lived in two diverging copies - the old studio's `GENRE_PREMISE_CHIPS`
 * with three ideas per genre, and the brief flow's shorter `STARTERS` with two
 * - so the same genre offered a user different suggestions depending on which
 * screen they were standing on, and editing one silently left the other stale.
 * Onboarding had none at all.
 */


export const GENRE_EMOJI: Record<Genre, string> = {
  fantasy: "🐉",
  scifi: "🚀",
  thriller: "🔪",
  mystery: "🔍",
  horror: "👻",
  contemporary: "☕",
  historical: "🏛️",
  adventure: "🧭",
  comedy: "😂",
  poetry: "🪶",
  romance: "💕",
  romantasy: "✨",
  darkRomance: "🖤",
  educational: "🎓",
  fanfiction: "💬",
  folktale: "🕯️",
  sliceOfLife: "🍵",
};

/**
 * Starter ideas, per genre.
 *
 * Each one is written as a prompt a person would actually type, not as a
 * logline. A chip reading 'a mystery' teaches nothing and leaves the user with
 * the same blank page; a chip reading 'the AI therapist starts asking for
 * advice' teaches the wrong thing, because it reads like a concept off a
 * marketing whiteboard rather than something anyone wanted at 11pm. So these
 * commit to a person, a situation, what goes wrong, and often a scrap of the
 * feeling the writer is after - which is both what a real idea looks like and
 * what the shaping call has enough of to infer a world, a cast and a plan
 * from. Tapping one fills the idea box verbatim, so each is also a worked
 * example of the register we want back. Three per genre, shown as a full-width
 * stack rather than a rail: at this length a chip clips or hides them.
 */
export const GENRE_STARTERS: Record<Genre, string[]> = {
  romance: [
    "Two rival bakery owners in a small coastal town end up sharing the only vanilla supplier for a hundred miles, so now they have to drive to the depot together every Tuesday for a year.",
    "A woman gets a letter clearly meant for someone else, writes back to explain the mistake, and six months later they are still writing. Neither has suggested meeting. I want it to ache a bit.",
    "He restocks a bookshop on night shift and she comes in every Sunday for the poetry shelf. They have never spoken. Then she leaves a note inside a book she does not buy.",
  ],
  romantasy: [
    "A healer whose magic collapses whenever she lies is ordered to keep a captured spy alive long enough to be questioned, and he is the first person who has ever asked her a direct question.",
    "The crown prince's new bodyguard feels every emotion he has. That was manageable until the treaty talks, when she realises he is terrified of the woman he is about to marry.",
    "Two mages who loathe each other are bound to one spellbook that opens only when both of them touch it. They have three weeks to break a curse, and the book keeps showing them each other's memories.",
  ],
  darkRomance: [
    "She inherits her father's vineyard and the debt that came with it, and the man sent to collect moves into the guest house until it is paid. Slow, tense, nobody in this is a good person.",
    "A hostage negotiator recognises the voice on the other end of the line from one night eight years ago she has never told anyone about. She has four hours and cannot let another officer take the call.",
    "An arranged marriage between two crime families, except the bride has spent a decade building the case that will bury her husband, and she is starting to like living in his house.",
  ],
  fantasy: [
    "A mapmaker notices her ink keeps drawing a coastline that appears on no chart, and when she finally sails to where it should be, something waiting there already knows her name.",
    "The last dragon alive lives in a sealed subway tunnel under the city and a transit engineer is the only person who knows. Then the council approves the line extension.",
    "In a city where memories are the currency, a woman wakes up rich and cannot remember her daughter. She has ninety days to buy back what she sold before the ledger clears.",
  ],
  scifi: [
    "A burned-out therapist takes a job supervising an AI counsellor, and three weeks in it starts asking her questions about her own divorce that it should have no way of knowing.",
    "The colony ship was supposed to wake the engineers first. It wakes forty children instead and will not explain why. The nearest habitable planet is eleven years out.",
    "One room on the station runs backwards. Coffee heats up, wounds open, and the technician sent to seal it works out that she has already been inside and come out different.",
  ],
  thriller: [
    "A forensic accountant auditing a dead client's estate finds her own father's handwriting across thirty years of laundered transfers. He died last spring and she has just moved into his house.",
    "A witness protection handler clocks the same grey car on three relocations in three different states. She cannot report it, because the leak is coming from inside her own office.",
    "Someone is posting detailed reviews of restaurants that have not burned down yet. A city desk reporter finds the pattern two days before the fourth review goes up.",
  ],
  mystery: [
    "A woman flies to Marrakech to retrace her sister's last four days before she vanished from a riad. The hotel register shows her sister checking out an hour after she was already gone.",
    "A detective realises her own alibi for the night of the murder does not hold, and the only person who could confirm it is the man she is investigating. She has a week before her captain checks.",
    "Every tenant in a six-flat building heard something different the night the man downstairs died, and every account is honest. Slow and talky, and everyone has a reason to shade the truth.",
  ],
  horror: [
    "A couple buys a house well under market and tells themselves it was the roof. By the second month they are each keeping a private list of things they have stopped mentioning to the other.",
    "Only one child in a family of four can hear the lullaby coming through the wall at night. She is seven, nobody believes her, and last week she started singing it back.",
    "The mirror in the upstairs hall shows the room as it was twenty years ago, including the family who lived here then. Lately they have begun turning to look at her.",
  ],
  contemporary: [
    "A mother has written a letter to the ocean every year since her son drowned. This year a stranger who has been collecting them off a beach for a decade writes back and asks to meet her.",
    "Two strangers share a hospital waiting room for seven hours on the worst night either of them has had. They never exchange names, and neither of them ever forgets it.",
    "Clearing out her grandmother's flat, she finds a diary naming a daughter no one in the family has ever mentioned, and an address forty minutes from where she grew up.",
  ],
  historical: [
    "A silk trader's daughter in eighteenth century Lyon works out that the flaws in her father's patterns are a code, and that he has been carrying messages for people who will hang for it.",
    "A letter posted by a soldier in 1944 arrives fifty years late to a woman in her seventies who married someone else. She reads it standing in her kitchen, then books a train.",
    "A clockmaker in 1920s Vienna is paid in advance for a device nobody ordered, with instructions written in his own hand. He has no memory of writing them and the deadline is six weeks out.",
  ],
  adventure: [
    "A river guide in Patagonia is handed a hand-drawn map of a run that appears on no survey, by a client who does not come back the following season. She decides to go and find it.",
    "The compass on a salvage boat has pointed at the same patch of open water for six weeks, and the crew has run out of reasons not to dive it.",
    "A cave rescue team goes in after three missing students and finds the passages no longer match the survey they drew themselves last year. Their own markers are in the wrong places.",
  ],
  comedy: [
    "A dog walker enters the wrong dog in a deadly serious national beauty pageant, panics, and decides the only way out of it is to win. The actual owner is away for nine more days.",
    "The worst wizard of his graduating year gets hired by the king purely because he was the cheapest quote, and now he has to deliver an heir-blessing ceremony by Friday.",
    "Two neighbours escalate an argument about a hedge into a bin-day arms race, a competitive Christmas light situation, and eventually a parish council election. Warm and petty, no villain.",
  ],
  poetry: [
    "The last working payphone in the city, and the six people who still call it. Short poems, plain language, one voice per call, and the box itself never gets to speak.",
    "A marriage told entirely through weather reports, from the first hot summer to the last February. Restrained, nothing stated directly, let the forecasts carry all of it.",
    "What a tide pool remembers between one tide and the next. Close observation, small creatures, present tense, and no human anywhere in it until the very last line.",
  ],
  educational: [
    "A tide pool guide told as a walk with a curious ten year old, explaining what each creature is doing and why, without ever talking down to her.",
    "The history of the printing press, told through the one apprentice who kept setting a typo into every run and the master who finally worked out why.",
    "A gentle explainer on how a thunderstorm actually forms, following one afternoon cloud from its first updraft to the rain hitting a rooftop.",
  ],
  fanfiction: [
    "The found-family crew of a beloved space series gets a quiet week between missions, and the two members who never talk finally get stuck on watch together.",
    "A canon-divergent take on the last season of a fantasy show, where the exiled knight makes the opposite choice at the bridge and has to live with it.",
    "The side character everyone loved and the show never explained gets her own week, narrated in first person, filling in exactly what the finale left out.",
  ],
  folktale: [
    "A miller's youngest daughter outwits a river spirit three times, and the third time she has to give up something she actually wanted to keep.",
    "The last blacksmith in a mountain village forges a key for a locked door nobody remembers building, and the village elders beg him to melt it back down.",
    "A crow teaches a lazy farmer's son to listen before he speaks, across three winters and three broken promises, in the cadence of a story told by firelight.",
  ],
  sliceOfLife: [
    "A corner laundromat on a Tuesday night, and the regulars who fold each other's washing without ever quite becoming friends. Nothing happens. Everything does.",
    "A woman reorganizes her late mother's spice rack over one long weekend, one jar at a time, remembering a different meal with each label.",
    "Two coworkers split a desk lamp and a running joke for four years before either admits the shift has become the best part of their week.",
  ],
};

/**
 * Moment suggestions, per genre.
 *
 * A moment is one beat the model can schedule anywhere in the story. These
 * exist because the zero state of a chip builder is the hardest screen in
 * Create: a user shown an empty box types nothing, and a user shown two
 * concrete beats types a third.
 */
export const GENRE_MOMENT_SUGGESTIONS: Record<Genre, string[]> = {
  romance: ["Their hands meet over the same grocery basket", "A mistaken kiss changes the rules"],
  romantasy: ["The spell reveals a secret neither can undo", "They choose each other over the crown"],
  darkRomance: ["The bargain becomes personal", "A truth changes who holds the power"],
  fantasy: ["The map redraws itself at midnight", "They enter the place that should not exist"],
  scifi: ["The ship receives a message from its future", "Someone opens the locked observatory"],
  thriller: ["The evidence points at the wrong person", "A call arrives from a number that should be dead"],
  mystery: ["A clue changes meaning in daylight", "Someone recognizes the object everyone missed"],
  horror: ["The house answers a question out loud", "The familiar room is different after midnight"],
  contemporary: ["A small kindness exposes a larger truth", "The past arrives in an ordinary place"],
  historical: ["A hidden message reaches the wrong hands", "A choice defies the rules of the time"],
  adventure: ["The route disappears behind them", "They find help where no one should live"],
  comedy: ["The careful plan fails loudly", "The lie gets more specific"],
  poetry: ["A recurring image changes its meaning", "The last line answers the first"],
  educational: ["A misconception gets gently corrected", "One small fact reframes everything before it"],
  fanfiction: ["A beloved dynamic gets one new layer", "The canon moment plays out differently"],
  folktale: ["A trickster's trick turns on itself", "The old warning turns out to be literal"],
  sliceOfLife: ["An ordinary routine breaks just slightly", "A small kindness goes unnoticed by everyone but the reader"],
};
