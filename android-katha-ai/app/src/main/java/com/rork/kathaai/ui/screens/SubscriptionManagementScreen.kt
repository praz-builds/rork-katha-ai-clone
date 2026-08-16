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
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.WorkspacePremium
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.model.PremiumFeature
import com.rork.kathaai.model.SubscriptionPlan
import com.rork.kathaai.ui.components.SecondaryCTA
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.viewmodel.AppViewModel
import com.rork.kathaai.viewmodel.KathaUiState
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun SubscriptionManagementScreen(
    state: KathaUiState,
    viewModel: AppViewModel,
    onBack: () -> Unit
) {
    var showCancelConfirm by remember { mutableStateOf(false) }
    val plan = SubscriptionPlan.fromKey(state.subscriptionType)

    Box(modifier = Modifier.fillMaxSize().background(KathaTheme.canvas)) {
        Column(
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 120.dp)
        ) {
            // Back button
            Box(
                modifier = Modifier.padding(start = 16.dp, top = 8.dp).size(36.dp).clip(CircleShape).background(KathaTheme.surface).clickable { onBack() },
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Outlined.ChevronRight, "Back", tint = KathaTheme.textPrimary, modifier = Modifier.size(18.dp))
            }

            // Active plan card
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 24.dp).clip(RoundedCornerShape(20.dp)).background(KathaTheme.surface).shadow(8.dp, RoundedCornerShape(20.dp)).padding(vertical = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Icon(Icons.Outlined.WorkspacePremium, null, tint = KathaTheme.premium, modifier = Modifier.size(32.dp))
                Spacer(Modifier.height(8.dp))
                Text("You're Premium ✨", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = KathaTheme.textPrimary)
                Spacer(Modifier.height(4.dp))
                Text(plan?.renewalLabel ?: "Premium plan", fontSize = 14.sp, color = KathaTheme.textSecondary)
                state.subscriptionExpiresAt?.let { expires ->
                    val formatter = SimpleDateFormat("MMM d, yyyy", Locale.getDefault())
                    Text("Renews on ${formatter.format(Date(expires))}", fontSize = 12.sp, color = KathaTheme.textTertiary)
                }
                Spacer(Modifier.height(24.dp))
                SecondaryCTA(title = "Manage subscription") {
                    viewModel.showToast("Native subscription management coming in the next update ✨")
                }
            }

            // Benefits
            Text("YOUR BENEFITS", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = KathaTheme.textTertiary, modifier = Modifier.padding(start = 16.dp, top = 24.dp, bottom = 8.dp))
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(RoundedCornerShape(16.dp)).background(KathaTheme.surface)
            ) {
                PremiumFeature.all.forEachIndexed { index, feature ->
                    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(Icons.Outlined.Check, null, tint = KathaTheme.success, modifier = Modifier.size(20.dp))
                        Text(feature.title, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = KathaTheme.textPrimary)
                    }
                    if (index < PremiumFeature.all.lastIndex) {
                        Box(modifier = Modifier.fillMaxWidth().height(1.dp).padding(start = 16.dp).background(KathaTheme.border))
                    }
                }
            }

            // Danger zone
            Text("CANCEL PLAN", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = KathaTheme.textTertiary, modifier = Modifier.padding(start = 16.dp, top = 32.dp, bottom = 8.dp))
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(RoundedCornerShape(16.dp)).background(KathaTheme.surface).clickable { showCancelConfirm = true }.padding(horizontal = 16.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Cancel subscription", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = KathaTheme.error, modifier = Modifier.weight(1f))
                Icon(Icons.Outlined.ChevronRight, null, tint = KathaTheme.textTertiary, modifier = Modifier.size(12.dp))
            }
        }
    }

    if (showCancelConfirm) {
        AlertDialog(
            onDismissRequest = { showCancelConfirm = false },
            title = { Text("Cancel subscription?") },
            text = { Text("You'll keep your Premium benefits until your current period ends.") },
            confirmButton = { TextButton(onClick = { showCancelConfirm = false; viewModel.cancelSubscription() }) { Text("Cancel subscription", color = KathaTheme.error) } },
            dismissButton = { TextButton(onClick = { showCancelConfirm = false }) { Text("Keep Premium") } }
        )
    }
}
