package com.rork.kathaai.model

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Message
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Book
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.CardGiftcard
import androidx.compose.material.icons.outlined.CardGiftcard
import androidx.compose.material.icons.outlined.Fireplace
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.WorkspacePremium
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import kotlinx.serialization.Serializable

@Serializable
data class CreditLedgerEntry(
    val id: String,
    val amount: Int,
    val reason: String,
    val referenceId: String? = null,
    val timestamp: Long,
    val balanceAfter: Int
)

enum class CreditReason(val key: String, val label: String, val icon: ImageVector, val colorKey: String) {
    PURCHASE("purchase", "Purchased", Icons.Outlined.CreditCard, "accent"),
    SUBSCRIPTION("subscription", "Katha Premium credits", Icons.Outlined.WorkspacePremium, "premium"),
    AD_REWARD("ad_reward", "Watched an ad", Icons.Outlined.PlayCircle, "accent"),
    STREAK("streak", "3-day streak reward", Icons.Outlined.Fireplace, "accent"),
    FEEDBACK("feedback", "Comment reward", Icons.AutoMirrored.Outlined.Message, "accent"),
    REFERRAL("referral", "Friend joined via your invite", Icons.Outlined.PersonAdd, "accent"),
    REFERRAL_BONUS("referral_bonus", "Referral welcome bonus", Icons.Outlined.CardGiftcard, "accent"),
    SOCIAL("social", "Verified social post", Icons.Outlined.Share, "accent"),
    GENERATION("generation", "Generated story", Icons.Outlined.Book, "textSecondary"),
    WELCOME_BONUS("welcome_bonus", "Welcome to Katha ✨", Icons.Outlined.AutoAwesome, "accent"),
    READER_EARNING("reader_earning", "Reading reward", Icons.Outlined.Book, "accent");

    companion object {
        fun fromKey(key: String): CreditReason =
            entries.firstOrNull { it.key == key } ?: WELCOME_BONUS
    }
}

data class CreditPack(
    val id: String,
    val name: String,
    val credits: Int,
    val price: String,
    val productId: String,
    val isPopular: Boolean,
    val isBestValue: Boolean,
    val coinCount: Int
) {
    companion object {
        val starter = CreditPack("starter", "Starter Pack", 3, "$2.99", "ai.katha.credits.starter", false, false, 3)
        val value = CreditPack("value", "Value Pack", 10, "$7.99", "ai.katha.credits.value", true, false, 10)
        val power = CreditPack("power", "Power Pack", 25, "$14.99", "ai.katha.credits.power", false, true, 25)
        val all = listOf(starter, value, power)
    }
}

enum class SubscriptionPlan(val key: String, val displayName: String, val price: String, val perMonth: String, val creditsPerCycle: Int, val productId: String, val renewalLabel: String) {
    MONTHLY("monthly", "MONTHLY", "$6.99", "per month", 20, "ai.katha.subscription.monthly", "Monthly plan · $6.99/month"),
    YEARLY("yearly", "YEARLY", "$49.99", "per year · $4.17/month", 25, "ai.katha.subscription.yearly", "Yearly plan · $49.99/year");

    companion object {
        fun fromKey(key: String?): SubscriptionPlan? = entries.firstOrNull { it.key == key }
    }
}

data class PremiumFeature(val title: String, val subtitle: String) {
    companion object {
        val all = listOf(
            PremiumFeature("20+ credits every month", "Enough for 20 short stories or a full 20-chapter series."),
            PremiumFeature("Ad-free reading", "No interruptions between chapters, ever."),
            PremiumFeature("Premium audiobook voices", "Rich, expressive narration — perfect for long commutes and bedtime."),
            PremiumFeature("Priority story generation", "Your stories skip the queue. Faster on busy days."),
            PremiumFeature("Support Katha's writers", "A portion goes directly to the writers you follow.")
        )
    }
}

enum class AdWatchState {
    AVAILABLE, LOADING_AD, PLAYING_AD, ON_COOLDOWN, JUST_REWARDED, ERROR
}

object AdConfig {
    // TODO: Replace with real AdMob app ID and rewarded unit ID before launch
    const val androidAppId = "ca-app-pub-3940256099942544~3347511713"
    const val androidRewardedUnitId = "ca-app-pub-3940256099942544/5224354917"
    const val mockAds = true
    val cooldownMillis: Long = 24L * 3600 * 1000 // 24 hours
    const val mockAdDurationSec = 15
}

object PaymentConfig {
    // TODO: Replace with real Adapty public SDK key before launch
    const val adaptyPublicKey = "public_live_placeholder_key"
    const val mockPayments = true
}
