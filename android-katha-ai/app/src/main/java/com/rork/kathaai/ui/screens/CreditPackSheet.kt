package com.rork.kathaai.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.CreditCard
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.model.CreditPack
import com.rork.kathaai.ui.components.PrimaryCTA
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.viewmodel.AppViewModel
import com.rork.kathaai.viewmodel.KathaUiState

@Composable
fun CreditPackSheet(
    state: KathaUiState,
    viewModel: AppViewModel,
    preselectedId: String?,
    onClose: () -> Unit
) {
    var selectedId by remember { mutableStateOf(preselectedId ?: CreditPack.value.id) }
    val selectedPack = CreditPack.all.firstOrNull { it.id == selectedId } ?: CreditPack.value

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp))
            .background(KathaTheme.surface)
            .padding(bottom = 32.dp)
    ) {
        // Drag handle
        Box(
            modifier = Modifier
                .padding(top = 12.dp)
                .size(width = 40.dp, height = 4.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(KathaTheme.border)
                .align(Alignment.CenterHorizontally)
        )

        // Header
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Buy credits", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = KathaTheme.textPrimary)
                Text("One-time purchase. Credits never expire.", fontSize = 13.sp, color = KathaTheme.textSecondary)
            }
            Box(
                modifier = Modifier.size(32.dp).clip(CircleShape).background(KathaTheme.border.copy(alpha = 0.3f)).clickable { onClose() },
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Outlined.Close, "Close", tint = KathaTheme.textSecondary, modifier = Modifier.size(14.dp))
            }
        }

        // Pack rows
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            CreditPack.all.forEach { pack ->
                PackRow(pack = pack, isSelected = pack.id == selectedId) {
                    selectedId = pack.id
                }
            }
        }

        Spacer(Modifier.height(16.dp))

        // Bottom CTA
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val ctaLabel = if (state.isPurchasingPack) "Processing…" else "Buy ${selectedPack.name} · ${selectedPack.price}"
            PrimaryCTA(title = ctaLabel) {
                viewModel.purchaseCreditPack(selectedPack)
            }
            Text("Payment charged to your Google account.", fontSize = 11.sp, color = KathaTheme.textTertiary, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun PackRow(pack: CreditPack, isSelected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (isSelected) KathaTheme.accentSoft.copy(alpha = 0.3f) else KathaTheme.surface)
            .border(if (isSelected) 1.5.dp else 1.dp, if (isSelected) KathaTheme.accent else KathaTheme.border, RoundedCornerShape(12.dp))
            .clickable { onClick() }
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(modifier = Modifier.size(40.dp), contentAlignment = Alignment.Center) {
            repeat(minOf(pack.coinCount, 3)) { i ->
                Icon(
                    androidx.compose.material.icons.Icons.Outlined.CreditCard, null,
                    tint = KathaTheme.accent,
                    modifier = Modifier.size((16 - i * 2).dp)
                )
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(pack.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = KathaTheme.textPrimary)
            Text("${pack.credits} credits", fontSize = 12.sp, color = KathaTheme.textSecondary)
        }
        Text(pack.price, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = KathaTheme.textPrimary)
        Spacer(Modifier.width(12.dp))
        Box(
            modifier = Modifier.size(22.dp).clip(CircleShape).border(2.dp, if (isSelected) KathaTheme.accent else KathaTheme.border, CircleShape),
            contentAlignment = Alignment.Center
        ) {
            if (isSelected) {
                Box(modifier = Modifier.size(12.dp).clip(CircleShape).background(KathaTheme.accent))
            }
        }
    }
}
