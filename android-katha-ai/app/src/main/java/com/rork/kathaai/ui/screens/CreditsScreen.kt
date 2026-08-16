package com.rork.kathaai.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Message
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Book
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.Fireplace
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.VideoLibrary
import androidx.compose.material.icons.outlined.WorkspacePremium
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rork.kathaai.model.CreditLedgerEntry
import com.rork.kathaai.model.CreditPack
import com.rork.kathaai.model.CreditReason
import com.rork.kathaai.model.PremiumFeature
import com.rork.kathaai.model.AdWatchState
import com.rork.kathaai.ui.components.PrimaryCTA
import com.rork.kathaai.ui.components.SecondaryCTA
import com.rork.kathaai.ui.components.TextLink
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.viewmodel.AppViewModel
import com.rork.kathaai.viewmodel.KathaUiState
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun CreditsScreen(
    state: KathaUiState,
    viewModel: AppViewModel,
    onBack: () -> Unit,
    onOpenPaywall: () -> Unit,
    onOpenPackSheet: (String?) -> Unit,
    onOpenManagement: () -> Unit,
    onOpenHistory: () -> Unit
) {
    val context = LocalContext.current
    var isLoading by remember { mutableIntStateOf(1) }
    var cooldownTick by remember { mutableIntStateOf(0) }

    LaunchedEffect(Unit) {
        delay(500)
        isLoading = 0
    }
    LaunchedEffect(cooldownTick) {
        if (state.adWatchState == AdWatchState.ON_COOLDOWN) {
            delay(60000)
            cooldownTick++
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(KathaTheme.canvas)
    ) {
        if (isLoading == 1) {
            CreditsLoadingContent()
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 120.dp)
            ) {
                item { CreditsBackButton(onBack = onBack) }
                item { BalanceCard(state, viewModel, onOpenManagement) }
                item { EarnCreditsSection(state, viewModel, context, onOpenPaywall) }
                item { BuyCreditsSection(state, onOpenPaywall, onOpenPackSheet) }
                item { RecentActivitySection(state, onOpenHistory) }
                item { CreditsFooter(state, viewModel) }
            }
        }
    }
}

@Composable
private fun CreditsBackButton(onBack: () -> Unit) {
    Box(
        modifier = Modifier
            .padding(start = KathaTheme.Spacing.l, top = KathaTheme.Spacing.s)
            .size(36.dp)
            .clip(CircleShape)
            .background(KathaTheme.surface)
            .clickable { onBack() },
        contentAlignment = Alignment.Center
    ) {
        Icon(Icons.Outlined.ChevronRight, "Back", tint = KathaTheme.textPrimary, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun BalanceCard(state: KathaUiState, viewModel: AppViewModel, onOpenManagement: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.xxxl)
            .clip(RoundedCornerShape(KathaTheme.Radius.xl))
            .background(KathaTheme.surface)
            .shadow(8.dp, RoundedCornerShape(KathaTheme.Radius.xl))
            .padding(vertical = KathaTheme.Spacing.xxxl),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.size(100.dp)) {
            Box(
                modifier = Modifier
                    .size(100.dp)
                    .clip(CircleShape)
                    .background(KathaTheme.accentSoft.copy(alpha = 0.6f))
                    .blur(20.dp)
            )
            Icon(Icons.Outlined.AutoAwesome, null, tint = KathaTheme.accent, modifier = Modifier.size(40.dp))
        }
        Spacer(Modifier.height(KathaTheme.Spacing.s))
        Text(
            "${state.currentUser?.credits ?: 0}",
            fontSize = 48.sp,
            fontWeight = FontWeight.Bold,
            color = KathaTheme.textPrimary
        )
        Text(
            "AVAILABLE CREDITS",
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
            color = KathaTheme.textTertiary
        )
        if (state.isPremium) {
            Spacer(Modifier.height(KathaTheme.Spacing.s))
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(KathaTheme.premiumSoft)
                    .clickable { onOpenManagement() }
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Outlined.AutoAwesome, null, tint = KathaTheme.premium, modifier = Modifier.size(10.dp))
                Text("KATHA PREMIUM", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = KathaTheme.premium)
            }
        }
    }
}

@Composable
private fun SectionLabel(title: String) {
    Text(
        title,
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        color = KathaTheme.textTertiary,
        modifier = Modifier.padding(start = KathaTheme.Spacing.l, top = KathaTheme.Spacing.xxxl, bottom = KathaTheme.Spacing.s)
    )
}

@Composable
private fun EarnCreditsSection(
    state: KathaUiState,
    viewModel: AppViewModel,
    context: android.content.Context,
    onOpenPaywall: () -> Unit
) {
    SectionLabel("EARN CREDITS")

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = KathaTheme.Spacing.l)
            .clip(RoundedCornerShape(KathaTheme.Radius.l))
            .background(KathaTheme.surface)
    ) {
        // Watch an ad
        EarnMethodRow(
            icon = Icons.Outlined.VideoLibrary,
            title = "Watch an ad",
            subtitle = if (state.isPremium) "1 credit · Once every 24 hours · Bonus for Premium"
                       else "1 credit · Once every 24 hours",
            trailing = {
                when (state.adWatchState) {
                    AdWatchState.AVAILABLE -> PrimaryCTA(title = "Watch", modifier = Modifier.width(100.dp)) { viewModel.startAdWatch() }
                    AdWatchState.LOADING_AD -> CircularProgressIndicator(modifier = Modifier.size(20.dp), color = KathaTheme.accent, strokeWidth = 2.dp)
                    AdWatchState.PLAYING_AD -> {}
                    AdWatchState.ON_COOLDOWN -> Text(viewModel.adCooldownLabel, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = KathaTheme.textSecondary)
                    AdWatchState.JUST_REWARDED -> Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.AutoAwesome, null, tint = KathaTheme.success, modifier = Modifier.size(14.dp))
                        Text("+1 credit", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = KathaTheme.success)
                    }
                    AdWatchState.ERROR -> Icon(Icons.Outlined.CreditCard, null, tint = KathaTheme.error, modifier = Modifier.size(20.dp))
                }
            }
        )
        DividerLine()
        // Reading streak
        val streak = state.currentStreak
        val streakSub = if (streak == 0) "Start a streak · Read a story today to begin"
                        else if (streak % 3 == 0) "${streak}-day streak · Streak reward earned today ✨"
                        else "${streak}-day streak · Next credit in ${3 - streak % 3} days"
        EarnMethodRow(
            icon = Icons.Outlined.Fireplace,
            title = "Reading streak",
            subtitle = streakSub,
            trailing = { ChevronRightIcon { viewModel.showToast("Your journey coming in the next update ✨") } }
        )
        DividerLine()
        // Comment
        EarnMethodRow(
            icon = Icons.AutoMirrored.Outlined.Message,
            title = "Comment on a story",
            subtitle = "1 credit per story · Max 1 per day",
            trailing = { ChevronRightIcon { viewModel.showToast("Read a story and leave a comment ✨") } }
        )
        DividerLine()
        // Refer
        EarnMethodRow(
            icon = Icons.Outlined.PersonAdd,
            title = "Refer a friend",
            subtitle = "3 credits when they generate their first story",
            trailing = { SecondaryCTA(title = "Invite", modifier = Modifier.width(100.dp)) { viewModel.shareReferralLink() } }
        )
        DividerLine()
        // Social
        EarnMethodRow(
            icon = Icons.Outlined.Share,
            title = "Share on social",
            subtitle = "1 credit per verified post · Max 3/month",
            trailing = { ChevronRightIcon { viewModel.showToast("Social rewards coming in the next update ✨") } }
        )
    }
}

@Composable
private fun EarnMethodRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    trailing: @Composable () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.m),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, null, tint = KathaTheme.accent, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(KathaTheme.Spacing.m))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = KathaTheme.textPrimary)
            Text(subtitle, fontSize = 12.sp, color = KathaTheme.textSecondary)
        }
        trailing()
    }
}

@Composable
private fun ChevronRightIcon(onClick: () -> Unit) {
    Icon(Icons.Outlined.ChevronRight, null, tint = KathaTheme.textTertiary, modifier = Modifier.size(16.dp).clickable { onClick() })
}

@Composable
private fun DividerLine() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(1.dp)
            .padding(start = KathaTheme.Spacing.l)
            .background(KathaTheme.border.copy(alpha = 0.5f))
    )
}

@Composable
private fun BuyCreditsSection(
    state: KathaUiState,
    onOpenPaywall: () -> Unit,
    onOpenPackSheet: (String?) -> Unit
) {
    SectionLabel("BUY CREDITS")

    // Premium card
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = KathaTheme.Spacing.l)
            .clip(RoundedCornerShape(KathaTheme.Radius.xl))
            .background(
                Brush.linearGradient(
                    listOf(KathaTheme.premium.copy(alpha = 0.9f), KathaTheme.accent.copy(alpha = 0.9f))
                )
            )
            .clickable { onOpenPaywall() }
            .padding(KathaTheme.Spacing.l)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Outlined.WorkspacePremium, null, tint = Color.White, modifier = Modifier.size(22.dp))
            Text("KATHA PREMIUM", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color.White)
        }
        Spacer(Modifier.height(KathaTheme.Spacing.m))
        Text("Unlock unlimited storytelling.", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Color.White)
        Spacer(Modifier.height(KathaTheme.Spacing.s))
        Text("20+ credits every month, ad-free reading, premium voices.", fontSize = 14.sp, color = Color.White.copy(alpha = 0.85f))
        Spacer(Modifier.height(KathaTheme.Spacing.l))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(KathaTheme.Radius.m))
                .background(Color.White)
                .padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.m),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Start Katha Premium ▸", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = KathaTheme.premium)
            Spacer(Modifier.weight(1f))
        }
    }

    Spacer(Modifier.height(KathaTheme.Spacing.m))

    // Pack tiles
    CreditPack.all.forEach { pack ->
        CreditPackTile(pack = pack, onClick = { onOpenPackSheet(pack.id) })
        Spacer(Modifier.height(KathaTheme.Spacing.m))
    }
}

@Composable
private fun CreditPackTile(pack: CreditPack, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = KathaTheme.Spacing.l)
            .clip(RoundedCornerShape(KathaTheme.Radius.l))
            .background(KathaTheme.surface)
            .clickable { onClick() }
            .padding(KathaTheme.Spacing.l),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(modifier = Modifier.size(50.dp), contentAlignment = Alignment.Center) {
            repeat(minOf(pack.coinCount, 3)) { i ->
                Icon(
                    Icons.Outlined.CreditCard, null,
                    tint = KathaTheme.accent,
                    modifier = Modifier.size((20 - i * 2).dp).offset(x = (i * 6).dp, y = (i * 4).dp)
                )
            }
        }
        Spacer(Modifier.width(KathaTheme.Spacing.l))
        Column(modifier = Modifier.weight(1f)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(pack.name, fontSize = 17.sp, fontWeight = FontWeight.Bold, color = KathaTheme.textPrimary)
                if (pack.isPopular) Ribbon("POPULAR", KathaTheme.accent)
                if (pack.isBestValue) Ribbon("BEST VALUE", KathaTheme.premium)
            }
            Text("${pack.credits} credits", fontSize = 13.sp, color = KathaTheme.textSecondary)
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(pack.price, fontSize = 17.sp, fontWeight = FontWeight.Bold, color = KathaTheme.textPrimary)
            Spacer(Modifier.height(4.dp))
            if (pack.isPopular) {
                PrimaryCTA(title = "Buy", modifier = Modifier.width(70.dp)) { onClick() }
            } else {
                SecondaryCTA(title = "Buy", modifier = Modifier.width(70.dp)) { onClick() }
            }
        }
    }
}

@Composable
private fun Ribbon(text: String, color: Color) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(color)
            .padding(horizontal = 6.dp, vertical = 3.dp)
    ) {
        Text(text, fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Color.White)
    }
}

@Composable
private fun RecentActivitySection(state: KathaUiState, onOpenHistory: () -> Unit) {
    SectionLabel("RECENT ACTIVITY")

    if (state.creditLedger.isEmpty()) {
        Text("No activity yet.", fontSize = 14.sp, color = KathaTheme.textTertiary, modifier = Modifier.padding(KathaTheme.Spacing.l))
    } else {
        val recent = state.creditLedger.takeLast(8).reversed()
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = KathaTheme.Spacing.l)
                .clip(RoundedCornerShape(KathaTheme.Radius.l))
                .background(KathaTheme.surface)
        ) {
            recent.forEachIndexed { index, entry ->
                LedgerRow(entry)
                if (index < recent.lastIndex) DividerLine()
            }
        }
        Box(
            modifier = Modifier.fillMaxWidth().padding(top = KathaTheme.Spacing.m),
            contentAlignment = Alignment.Center
        ) {
            TextLink(title = "See full history →") { onOpenHistory() }
        }
    }
}

@Composable
private fun LedgerRow(entry: CreditLedgerEntry) {
    val reason = CreditReason.fromKey(entry.reason)
    val timeLabel = formatRelativeTime(entry.timestamp)
    val amountColor = if (entry.amount > 0) KathaTheme.success else KathaTheme.error
    val amountText = if (entry.amount > 0) "+${entry.amount}" else "${entry.amount}"
    val iconColor = when (reason) {
        CreditReason.SUBSCRIPTION -> KathaTheme.premium
        CreditReason.GENERATION -> KathaTheme.textSecondary
        else -> KathaTheme.accent
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.m),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(reason.icon, null, tint = iconColor, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(KathaTheme.Spacing.m))
        Column(modifier = Modifier.weight(1f)) {
            Text(reason.label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = KathaTheme.textPrimary)
            Text(timeLabel, fontSize = 12.sp, color = KathaTheme.textSecondary)
        }
        Text(amountText, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = amountColor)
    }
}

private fun formatRelativeTime(timestamp: Long): String {
    val diff = System.currentTimeMillis() - timestamp
    val mins = diff / 60000
    return when {
        mins < 1 -> "Just now"
        mins < 60 -> "${mins}m ago"
        mins < 1440 -> "${mins / 60}h ago"
        mins < 10080 -> "${mins / 1440}d ago"
        else -> "${mins / 10080}w ago"
    }
}

@Composable
private fun CreditsFooter(state: KathaUiState, viewModel: AppViewModel) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = KathaTheme.Spacing.xxxl + 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
    ) {
        Text("Credits never expire.", fontSize = 12.sp, color = KathaTheme.textTertiary)
        Text("Refunds within 14 days per Apple / Google policy.", fontSize = 12.sp, color = KathaTheme.textTertiary)
        if (state.isRestoringPurchases) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(modifier = Modifier.size(12.dp), color = KathaTheme.accent, strokeWidth = 1.5.dp)
                Text("Restoring…", fontSize = 13.sp, color = KathaTheme.accent)
            }
        } else {
            TextLink(title = "Restore purchases") { viewModel.restorePurchases() }
        }
    }
}

@Composable
private fun CreditsLoadingContent() {
    Column(
        modifier = Modifier.fillMaxSize().padding(top = 80.dp),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xxl)
    ) {
        repeat(3) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = KathaTheme.Spacing.l)
                    .height(56.dp)
                    .clip(RoundedCornerShape(KathaTheme.Radius.l))
                    .background(KathaTheme.border)
            )
        }
    }
}
