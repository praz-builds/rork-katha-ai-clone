package com.rork.kathaai.data

import android.content.Context
import com.rork.kathaai.model.*
import kotlinx.serialization.json.Json
import java.util.Calendar
import java.util.UUID

object AnalyticsService {
    private const val KEY_ANALYTICS = "katha.storyAnalytics"
    private const val KEY_UNSEEN = "katha.unseenMilestones"
    private const val KEY_AUTHOR_MILESTONES = "katha.authorMilestonesCrossed"
    private const val KEY_TIME_RANGE = "katha.analyticsTimeRange"

    private val json = Json { ignoreUnknownKeys = true }

    private var storyAnalytics: MutableMap<String, StoryAnalytics> = mutableMapOf()
    private var unseenMilestones: MutableList<UnseenMilestone> = mutableListOf()
    private var authorMilestonesCrossed: MutableSet<String> = mutableSetOf()
    private var seeded = false
    private var prefs: android.content.SharedPreferences? = null

    fun init(context: Context) {
        if (prefs != null) return
        prefs = context.getSharedPreferences("katha", Context.MODE_PRIVATE)
        load()
    }

    private fun load() {
        val p = prefs ?: return
        p.getString(KEY_ANALYTICS, null)?.let { raw ->
            runCatching {
                val map = json.decodeFromString<Map<String, StoryAnalytics>>(raw)
                storyAnalytics = map.toMutableMap()
                seeded = true
            }
        }
        p.getString(KEY_UNSEEN, null)?.let { raw ->
            runCatching { unseenMilestones = json.decodeFromString(raw) }
        }
        authorMilestonesCrossed = (p.getStringSet(KEY_AUTHOR_MILESTONES, emptySet()) ?: emptySet()).toMutableSet()
    }

    private fun saveAnalytics() {
        val p = prefs ?: return
        p.edit().putString(KEY_ANALYTICS, json.encodeToString(storyAnalytics)).apply()
    }

    private fun saveUnseen() {
        val p = prefs ?: return
        p.edit().putString(KEY_UNSEEN, json.encodeToString(unseenMilestones)).apply()
    }

    private fun saveAuthorMilestones() {
        val p = prefs ?: return
        p.edit().putStringSet(KEY_AUTHOR_MILESTONES, authorMilestonesCrossed).apply()
    }

    // MARK: - Time Range

    fun getTimeRange(): AnalyticsTimeRange {
        val ordinal = prefs?.getInt(KEY_TIME_RANGE, 1) ?: 1
        return AnalyticsTimeRange.entries.getOrElse(ordinal) { AnalyticsTimeRange.THIRTY_DAYS }
    }

    fun setTimeRange(range: AnalyticsTimeRange) {
        prefs?.edit()?.putInt(KEY_TIME_RANGE, range.ordinal)?.apply()
    }

    // MARK: - Seed

    fun ensureSeeded(stories: List<Story>) {
        if (seeded) return
        seeded = true

        for (story in stories) {
            if (storyAnalytics[story.id] == null) {
                storyAnalytics[story.id] = generateMockAnalytics(story)
            }
        }

        // Aarav's story: 47 reads, 4 credits
        stories.firstOrNull { it.authorId == "aarav" }?.let { aaravStory ->
            storyAnalytics[aaravStory.id] = generateAaravAnalytics(aaravStory)
        }

        saveAnalytics()
    }

    private fun generateMockAnalytics(story: Story): StoryAnalytics {
        val totalReads = story.views
        val dailyReads = generateDailyReads(totalReads, story.publishedOffset)
        val chapterReads = generateChapterReads(story, totalReads)
        val creditsEarned = totalReads / 12
        val storyFollowers = story.followerCount
        val authorFollowers = SeedData.author(story.authorId)?.followers ?: 0

        val crossed = computeMilestones(totalReads, storyFollowers, creditsEarned, true, authorFollowers)

        return StoryAnalytics(
            dailyReads = dailyReads,
            chapterReads = chapterReads,
            milestonesCrossed = crossed,
            creditsEarnedFromReads = creditsEarned,
            followersGainedFromStory = storyFollowers,
            authorFollowersGainedViaStory = maxOf(0, storyFollowers / 3)
        )
    }

    private fun generateAaravAnalytics(story: Story): StoryAnalytics {
        val totalReads = 47
        val dailyReads = generateDailyReads(totalReads, 30)
        val chapterReads = generateChapterReads(story, totalReads)

        val crossed = setOf(
            MilestoneKey.PUBLISH.key,
            MilestoneKey.FIRST_READ.key,
            MilestoneKey.READS_10.key,
            MilestoneKey.FIRST_CREDIT.key
        )

        return StoryAnalytics(
            dailyReads = dailyReads,
            chapterReads = chapterReads,
            milestonesCrossed = crossed,
            creditsEarnedFromReads = 4,
            followersGainedFromStory = 8,
            authorFollowersGainedViaStory = 12
        )
    }

    private fun generateDailyReads(totalReads: Int, publishedOffset: Int): List<DailyReads> {
        val cal = Calendar.getInstance()
        val now = System.currentTimeMillis()
        val days = minOf(maxOf(7, publishedOffset), 90)

        if (totalReads == 0) {
            return (0 until minOf(days, 7)).map { offset ->
                cal.timeInMillis = now - offset * 24L * 3600 * 1000
                DailyReads(dateISO = isoDate(cal), reads = 0, uniqueReads = 0)
            }.reversed()
        }

        val weights = DoubleArray(days) { i ->
            val recencyBias = 1.0 + i.toDouble() / days * 0.6
            cal.timeInMillis = now - (days - 1 - i) * 24L * 3600 * 1000
            val weekday = cal.get(Calendar.DAY_OF_WEEK)
            val weekendBoost = if (weekday == 1 || weekday == 7) 1.2 else 1.0
            val noise = 0.7 + Math.random() * 0.6
            recencyBias * weekendBoost * noise
        }
        val sum = weights.sum()
        val normalized = IntArray(days) { i ->
            maxOf(0, (weights[i] / sum * totalReads).toInt())
        }
        val diff = totalReads - normalized.sum()
        if (normalized.isNotEmpty()) normalized[normalized.size - 1] = maxOf(0, normalized[normalized.size - 1] + diff)

        return normalized.indices.map { i ->
            cal.timeInMillis = now - (days - 1 - i) * 24L * 3600 * 1000
            DailyReads(dateISO = isoDate(cal), reads = normalized[i], uniqueReads = (normalized[i] * 0.75).toInt())
        }
    }

    private fun generateChapterReads(story: Story, totalReads: Int): List<ChapterReads> {
        if (story.chapters.size <= 1) return emptyList()

        val chapterCount = story.chapters.size
        val weights = DoubleArray(chapterCount) { i -> Math.pow(0.72, i.toDouble()) }
        val sum = weights.sum()

        return story.chapters.mapIndexed { index, chapter ->
            val reads = maxOf(0, (totalReads * weights[index] / sum).toInt())
            ChapterReads(
                chapterId = chapter.id,
                reads = reads,
                uniqueReads = (reads * 0.75).toInt(),
                completionRate = maxOf(0.2, minOf(0.95, 1.0 - index * 0.15))
            )
        }
    }

    private fun computeMilestones(totalReads: Int, storyFollowers: Int, creditsEarned: Int, isPublished: Boolean, authorFollowers: Int): Set<String> {
        val crossed = mutableSetOf<String>()
        for (milestone in MilestoneKey.entries) {
            if (milestone.isCrossed(totalReads, storyFollowers, creditsEarned, isPublished, authorFollowers)) {
                crossed.add(milestone.key)
            }
        }
        return crossed
    }

    private fun isoDate(cal: Calendar): String {
        val y = cal.get(Calendar.YEAR)
        val m = cal.get(Calendar.MONTH) + 1
        val d = cal.get(Calendar.DAY_OF_MONTH)
        return "%04d-%02d-%02d".format(y, m, d)
    }

    // MARK: - Access

    fun analyticsFor(storyId: String): StoryAnalytics? = storyAnalytics[storyId]

    fun dailyReadsFor(storyId: String, range: AnalyticsTimeRange): List<DailyReads> {
        val analytics = storyAnalytics[storyId] ?: return emptyList()
        return when (range) {
            AnalyticsTimeRange.SEVEN_DAYS -> analytics.dailyReads.takeLast(7)
            AnalyticsTimeRange.THIRTY_DAYS -> analytics.dailyReads.takeLast(30)
            AnalyticsTimeRange.ALL_TIME -> analytics.dailyReads
        }
    }

    fun totalReadsFor(storyId: String, range: AnalyticsTimeRange): Int =
        dailyReadsFor(storyId, range).sumOf { it.reads }

    fun previousPeriodReads(storyId: String, range: AnalyticsTimeRange): Int {
        val analytics = storyAnalytics[storyId] ?: return 0
        val all = analytics.dailyReads
        val dayCount = range.dayCount ?: all.size
        val endIdx = maxOf(0, all.size - dayCount)
        val startIdx = maxOf(0, endIdx - dayCount)
        return all.subList(startIdx, endIdx).sumOf { it.reads }
    }

    // MARK: - Milestones

    fun hasUnseenMilestones(): Boolean = unseenMilestones.isNotEmpty()
    fun currentUnseenMilestone(): UnseenMilestone? = unseenMilestones.firstOrNull()

    fun dismissCurrentMilestone() {
        if (unseenMilestones.isNotEmpty()) {
            unseenMilestones.removeAt(0)
            saveUnseen()
        }
    }

    // MARK: - Dev Tools

    fun triggerMilestoneCelebration(milestone: MilestoneKey, storyId: String, storyTitle: String) {
        unseenMilestones.add(UnseenMilestone(
            id = UUID.randomUUID().toString(),
            milestoneKey = milestone.key,
            storyId = storyId,
            storyTitle = storyTitle
        ))
        saveUnseen()
    }

    fun resetAllMilestones() {
        for (key in storyAnalytics.keys) {
            storyAnalytics[key] = storyAnalytics[key]!!.copy(milestonesCrossed = emptySet())
        }
        authorMilestonesCrossed.clear()
        unseenMilestones.clear()
        saveAnalytics()
        saveAuthorMilestones()
        saveUnseen()
    }

    fun resetAllAnalytics() {
        storyAnalytics.clear()
        unseenMilestones.clear()
        authorMilestonesCrossed.clear()
        seeded = false
        prefs?.edit()?.remove(KEY_ANALYTICS)?.remove(KEY_UNSEEN)?.remove(KEY_AUTHOR_MILESTONES)?.apply()
    }

    // MARK: - Aggregated

    fun aggregatedDailyReads(storyIds: List<String>, range: AnalyticsTimeRange): List<DailyReads> {
        val merged = mutableMapOf<String, Int>()
        val orderedDates = mutableListOf<String>()

        for (storyId in storyIds) {
            for (entry in dailyReadsFor(storyId, range)) {
                if (merged[entry.dateISO] == null) orderedDates.add(entry.dateISO)
                merged[entry.dateISO] = (merged[entry.dateISO] ?: 0) + entry.reads
            }
        }

        return orderedDates.map { iso ->
            DailyReads(dateISO = iso, reads = merged[iso] ?: 0, uniqueReads = ((merged[iso] ?: 0) * 0.75).toInt())
        }
    }

    fun totalReadsAcrossCatalog(storyIds: List<String>, range: AnalyticsTimeRange): Int =
        storyIds.sumOf { totalReadsFor(it, range) }

    fun totalCreditsAcrossCatalog(storyIds: List<String>): Int =
        storyIds.sumOf { storyAnalytics[it]?.creditsEarnedFromReads ?: 0 }

    fun recentMilestones(limit: Int = 5): List<Triple<MilestoneKey, String, String>> {
        val results = mutableListOf<Triple<MilestoneKey, String, String>>()
        for ((storyId, analytics) in storyAnalytics) {
            for (key in analytics.milestonesCrossed) {
                val milestone = MilestoneKey.fromKey(key) ?: continue
                val story = SeedData.stories.firstOrNull { it.id == storyId }
                results.add(Triple(milestone, storyId, story?.title ?: ""))
            }
        }
        return results.take(limit)
    }

    fun topStories(storyIds: List<String>, sortBy: MilestoneSortMetric, limit: Int = 5): List<String> {
        return when (sortBy) {
            MilestoneSortMetric.READS -> storyIds.sortedByDescending { totalReadsFor(it, AnalyticsTimeRange.ALL_TIME) }
            MilestoneSortMetric.CREDITS -> storyIds.sortedByDescending { storyAnalytics[it]?.creditsEarnedFromReads ?: 0 }
            MilestoneSortMetric.FOLLOWERS -> storyIds.sortedByDescending { storyAnalytics[it]?.followersGainedFromStory ?: 0 }
        }.take(limit)
    }
}
