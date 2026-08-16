package com.rork.kathaai.ui.screens

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.WorkspacePremium
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.model.PremiumFeature
import com.rork.kathaai.model.SubscriptionPlan
import com.rork.kathaai.ui.components.PrimaryCTA
import com.rork.kathaai.ui.components.SafeBottomSpacer
import com.rork.kathaai.ui.components.TextLink
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.ui.theme.serif
import com.rork.kathaai.viewmodel.AppViewModel
import com.rork.kathaai.viewmodel.KathaUiState

@Composable
fun SubscriptionPaywall(
    state: KathaUiState,
    viewModel: AppViewModel,
    onClose: () -> Unit
) {
    var selectedPlan by remember { mutableStateOf(SubscriptionPlan.YEARLY) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(KathaTheme.canvas, KathaTheme.accentSoft.copy(alpha = 0.3f), KathaTheme.canvas)
                )
            )
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 120.dp)
        ) {
            // Close bar
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 20.dp, top = 20.dp),
                horizontalArrangement = Arrangement.Start
            ) {
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(KathaTheme.surface)
                        .clickable { onClose() },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Outlined.Close, "Close", tint = KathaTheme.textPrimary, modifier = Modifier.size(16.dp))
                }
            }

            // Hero
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text("Katha", style = serif(24, FontWeight.Bold), color = KathaTheme.accent)
                Text("PREMIUM", style = serif(32, FontWeight.Bold), color = KathaTheme.premium)
                Text("Unlock unlimited storytelling.", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = KathaTheme.textPrimary, textAlign = TextAlign.Center)
                Text("For readers, writers, and everyone in between.", fontSize = 15.sp, color = KathaTheme.textSecondary, textAlign = TextAlign.Center)
            }

            // Features
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp)
            ) {
                PremiumFeature.all.forEach { feature ->
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier.size(24.dp).clip(CircleShape).background(KathaTheme.accent),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Outlined.Check, null, tint = Color.White, modifier = Modifier.size(12.dp))
                        }
                        Column {
                            Text(feature.title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = KathaTheme.textPrimary)
                            Text(feature.subtitle, fontSize = 12.sp, color = KathaTheme.textSecondary)
                        }
                    }
                }
            }

            // Plan tiles
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 32.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                PlanTile(
                    plan = SubscriptionPlan.MONTHLY,
                    isSelected = selectedPlan == SubscriptionPlan.MONTHLY,
                    isFeatured = false,
                    modifier = Modifier.weight(0.42f),
                    onClick = { selectedPlan = SubscriptionPlan.MONTHLY }
                )
                PlanTile(
                    plan = SubscriptionPlan.YEARLY,
                    isSelected = selectedPlan == SubscriptionPlan.YEARLY,
                    isFeatured = true,
                    modifier = Modifier.weight(0.46f),
                    onClick = { selectedPlan = SubscriptionPlan.YEARLY }
                )
            }

            // CTA
            val ctaLabel = if (state.isPurchasingSubscription) "Processing…" else "Start Katha Premium · ${selectedPlan.price}${if (selectedPlan == SubscriptionPlan.YEARLY) "/year" else "/month"}"
            PrimaryCTA(title = ctaLabel) {
                viewModel.purchaseSubscription(selectedPlan)
            }

            // Fine print
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text("Cancel anytime in Settings. Renews automatically unless cancelled 24 hours before period end. Payment charged to your Google account.", fontSize = 11.sp, color = KathaTheme.textTertiary, textAlign = TextAlign.Center)
                if (state.isRestoringPurchases) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.size(12.dp), color = KathaTheme.accent, strokeWidth = 1.5.dp)
                        Text("Restoring…", fontSize = 13.sp, color = KathaTheme.accent)
                    }
                } else {
                    TextLink(title = "Restore purchases") { viewModel.restorePurchases() }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(0.dp)) {
                    TextLink(title = "Terms") { viewModel.showToast("Terms: katha.ai/terms") }
                    Text(" · ", fontSize = 13.sp, color = KathaTheme.textTertiary)
                    TextLink(title = "Privacy") { viewModel.showToast("Privacy: katha.ai/privacy") }
                }
            }
        }
    }
}

@Composable
private fun PlanTile(
    plan: SubscriptionPlan,
    isSelected: Boolean,
    isFeatured: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val borderColor = if (isSelected) { if (isFeatured) KathaTheme.premium else KathaTheme.accent } else KathaTheme.border
    val bg = if (isSelected) { if (isFeatured) KathaTheme.premiumSoft.copy(alpha = 0.3f) else KathaTheme.accentSoft.copy(alpha = 0.3f) } else KathaTheme.surface

    Box(
        modifier = modifier
            .height(if (isFeatured) 130.dp else 100.dp)
            .clip(RoundedCornerShape(KathaTheme.Radius.l))
            .background(bg)
            .clickable { onClick() }
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(plan.displayName, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = if (isFeatured && isSelected) KathaTheme.premium else KathaTheme.textSecondary)
            Text(plan.price, fontSize = 28.sp, fontWeight = FontWeight.Bold, color = KathaTheme.textPrimary)
            Text(plan.perMonth, fontSize = 11.sp, color = KathaTheme.textTertiary)
        }
        if (isFeatured) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(8.dp)
                    .clip(RoundedCornerShape(50))
                    .background(KathaTheme.premium)
                    .padding(horizontal = 6.dp, vertical = 3.dp)
            ) {
                Text("SAVE 40%", fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Color.White)
            }
        }
        if (isSelected) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(8.dp)
                    .size(20.dp)
                    .clip(CircleShape)
                    .background(if (isFeatured) KathaTheme.premium else KathaTheme.accent),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Outlined.Check, null, tint = Color.White, modifier = Modifier.size(10.dp))
            }
        }
    }
}
