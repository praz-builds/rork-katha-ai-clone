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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.model.CreditLedgerEntry
import com.rork.kathaai.model.CreditReason
import com.rork.kathaai.ui.components.EmptyState
import com.rork.kathaai.ui.components.FilterChip
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.viewmodel.AppViewModel
import com.rork.kathaai.viewmodel.KathaUiState
import java.util.Calendar

@Composable
fun CreditHistoryScreen(
    state: KathaUiState,
    viewModel: AppViewModel,
    onBack: () -> Unit
) {
    var filterIndex by remember { mutableIntStateOf(0) }
    val filters = listOf("All", "Earned", "Spent", "Purchased")

    val filtered = when (filterIndex) {
        1 -> state.creditLedger.reversed().filter { it.amount > 0 }
        2 -> state.creditLedger.reversed().filter { it.amount < 0 }
        3 -> state.creditLedger.reversed().filter { it.reason == "purchase" || it.reason == "subscription" }
        else -> state.creditLedger.reversed()
    }

    val cal = Calendar.getInstance()
    val now = System.currentTimeMillis()

    fun dayGroup(ts: Long): String {
        cal.timeInMillis = ts
        if (cal.get(Calendar.YEAR) == Calendar.getInstance().get(Calendar.YEAR) &&
            cal.get(Calendar.DAY_OF_YEAR) == Calendar.getInstance().get(Calendar.DAY_OF_YEAR)) return "TODAY"
        val yesterday = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -1) }
        if (cal.get(Calendar.YEAR) == yesterday.get(Calendar.YEAR) && cal.get(Calendar.DAY_OF_YEAR) == yesterday.get(Calendar.DAY_OF_YEAR)) return "YESTERDAY"
        val weekAgo = now - 7L * 24 * 3600 * 1000
        return if (ts > weekAgo) "THIS WEEK" else "EARLIER"
    }

    val grouped = filtered.groupBy { dayGroup(it.timestamp) }
    val groupOrder = listOf("TODAY", "YESTERDAY", "THIS WEEK", "EARLIER")
    val orderedGroups = groupOrder.mapNotNull { key -> grouped[key]?.let { key to it } }

    Box(modifier = Modifier.fillMaxSize().background(KathaTheme.canvas)) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Back + title
            Row(modifier = Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(modifier = Modifier.padding(start = 16.dp).size(36.dp).clip(CircleShape).background(KathaTheme.surface).clickable { onBack() }, contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.ChevronRight, "Back", tint = KathaTheme.textPrimary, modifier = Modifier.size(18.dp))
                }
                Text("Credit history", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = KathaTheme.textPrimary, modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                Spacer(Modifier.size(36.dp))
            }

            // Filter chips
            Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                filters.indices.forEach { i ->
                    FilterChip(title = filters[i], isSelected = filterIndex == i) { filterIndex = i }
                }
            }

            if (filtered.isEmpty()) {
                EmptyState(icon = Icons.Outlined.ChevronRight, title = "No entries", message = if (filterIndex == 3) "No purchases yet." else "No credit activity to show.")
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 120.dp)) {
                    orderedGroups.forEach { (group, entries) ->
                        item {
                            Text(group, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = KathaTheme.textSecondary, modifier = Modifier.padding(start = 16.dp, top = 20.dp, bottom = 8.dp))
                        }
                        item {
                            Column(
                                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(RoundedCornerShape(16.dp)).background(KathaTheme.surface)
                            ) {
                                entries.forEachIndexed { index, entry ->
                                    LedgerRowItem(entry)
                                    if (index < entries.lastIndex) {
                                        Box(modifier = Modifier.fillMaxWidth().height(1.dp).padding(start = 16.dp).background(KathaTheme.border.copy(alpha = 0.5f)))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LedgerRowItem(entry: CreditLedgerEntry) {
    val reason = CreditReason.fromKey(entry.reason)
    val timeLabel = formatRelativeTimeHistory(entry.timestamp)
    val amountColor = if (entry.amount > 0) KathaTheme.success else KathaTheme.error
    val amountText = if (entry.amount > 0) "+${entry.amount}" else "${entry.amount}"
    val iconColor = when (reason) {
        CreditReason.SUBSCRIPTION -> KathaTheme.premium
        CreditReason.GENERATION -> KathaTheme.textSecondary
        else -> KathaTheme.accent
    }

    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(reason.icon, null, tint = iconColor, modifier = Modifier.size(18.dp))
        Box(modifier = Modifier.size(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(reason.label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = KathaTheme.textPrimary)
            Text(timeLabel, fontSize = 12.sp, color = KathaTheme.textSecondary)
        }
        Text(amountText, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = amountColor)
    }
}

private fun formatRelativeTimeHistory(timestamp: Long): String {
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
