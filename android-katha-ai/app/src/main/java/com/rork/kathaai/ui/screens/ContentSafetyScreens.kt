package com.rork.kathaai.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.LibraryBooks
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.MenuBook
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.model.PinEntryContext
import com.rork.kathaai.model.PinSetupMode
import com.rork.kathaai.model.ReadingLevel
import com.rork.kathaai.ui.components.DestructiveCTA
import com.rork.kathaai.ui.components.PrimaryCTA
import com.rork.kathaai.ui.components.SafeBottomSpacer
import com.rork.kathaai.ui.components.SecondaryCTA
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.ui.theme.KathaTypography
import com.rork.kathaai.viewmodel.AppViewModel
import com.rork.kathaai.viewmodel.KathaUiState
import kotlinx.coroutines.delay

@Composable
private fun SafetyHeader(title: String, onClose: () -> Unit, modifier: Modifier = Modifier) {
    Row(modifier = modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, color = KathaTheme.textPrimary, fontSize = 23.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        IconButton(onClick = onClose) { Icon(Icons.Outlined.Close, contentDescription = "Close", tint = KathaTheme.textSecondary) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReadingLevelSheet(state: KathaUiState, viewModel: AppViewModel) {
    ModalBottomSheet(onDismissRequest = viewModel::dismissReadingLevelSheet, containerColor = KathaTheme.surface) {
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = KathaTheme.Spacing.xl).padding(bottom = KathaTheme.Spacing.xl)) {
            SafetyHeader("Reading level", viewModel::dismissReadingLevelSheet)
            Text("Choose how the AI writes for you. This applies to all new stories you generate.", color = KathaTheme.textSecondary, fontSize = 14.sp, modifier = Modifier.padding(bottom = KathaTheme.Spacing.m))
            ReadingLevel.values().filterNot { state.readingLevelSheetForCap && it == ReadingLevel.ADVANCED }.forEach { level ->
                ReadingLevelCard(level, state, viewModel)
                Spacer(Modifier.height(KathaTheme.Spacing.m))
            }
        }
    }
}

@Composable
private fun ReadingLevelCard(level: ReadingLevel, state: KathaUiState, viewModel: AppViewModel) {
    val selected = when {
        state.readingLevelSheetForWizard -> state.wizardReadingLevel == level
        state.readingLevelSheetForCap -> state.kidsReadingLevelCap == level
        else -> state.defaultReadingLevel == level
    }
    Row(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(if (selected) KathaTheme.accentSoft.copy(alpha = 0.6f) else KathaTheme.surface).border(if (selected) 1.5.dp else 1.dp, if (selected) KathaTheme.accent else KathaTheme.border, RoundedCornerShape(16.dp)).clickable { viewModel.selectReadingLevel(level); viewModel.dismissReadingLevelSheet() }.padding(KathaTheme.Spacing.l), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
        Icon(if (level == ReadingLevel.ADVANCED) Icons.Outlined.LibraryBooks else Icons.Outlined.MenuBook, null, tint = KathaTheme.accent, modifier = Modifier.size(22.dp))
        Column(modifier = Modifier.weight(1f)) { Text(level.title, color = KathaTheme.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold); Text(level.subtitle, color = KathaTheme.textSecondary, fontSize = 13.sp) }
        Text(if (selected) "●" else "○", color = if (selected) KathaTheme.accent else KathaTheme.borderStrong, fontSize = 24.sp)
    }
}

@Composable
fun ParentalControlsScreen(state: KathaUiState, viewModel: AppViewModel) {
    Column(modifier = Modifier.fillMaxSize().background(KathaTheme.canvas)) {
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.s), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = viewModel::closeParentalControls) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, null, tint = KathaTheme.textPrimary) }
            Text("Parental controls", color = KathaTheme.textPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        }
        LazyColumn(contentPadding = PaddingValues(KathaTheme.Spacing.l), verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xl)) {
            item { SafetySection("KIDS MODE") { ToggleSetting("Kids mode", "Hides adult content, disables comments, and restricts genres. A PIN is required to turn off.", state.kidsMode) { if (state.kidsMode) viewModel.beginKidsModeDisable() else viewModel.beginKidsModeEnable() } } }
            if (state.kidsMode) {
                item { SafetySection("ALLOWED CONTENT") { SafetyRow("Genres", "Safe genres") { viewModel.showToast("Genre whitelist coming soon") }; HorizontalDivider(color = KathaTheme.border); SafetyRow("Reading level cap", state.kidsReadingLevelCap.title) { viewModel.showReadingLevelSheet(forCap = true) } } }
                item { SafetySection("FEATURES") { SwitchRow("Comments", state.kidsCommentsEnabled, viewModel::setKidsCommentsEnabled); HorizontalDivider(color = KathaTheme.border); SwitchRow("Share to social", state.kidsShareEnabled, viewModel::setKidsShareEnabled); HorizontalDivider(color = KathaTheme.border); SwitchRow("Search suggestions", state.kidsSearchSuggestionsEnabled, viewModel::setKidsSearchSuggestionsEnabled) } }
                item { SafetySection("PIN") { SafetyRow("Change PIN", null, viewModel::beginPinChange); HorizontalDivider(color = KathaTheme.border); SafetyRow("Forgot your PIN?", null) { viewModel.showToast("Contact support at feedback@katha.ai") } } }
                item { SafetySection("DANGER ZONE") { DestructiveCTA("Turn off kids mode", icon = Icons.Outlined.Lock) { viewModel.beginKidsModeDisable() } } }
            }
            item { SafeBottomSpacer() }
        }
    }
}

@Composable
private fun SafetySection(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) { Text(title, color = KathaTheme.textTertiary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold); Column(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(KathaTheme.Radius.l)).background(KathaTheme.surface).padding(horizontal = KathaTheme.Spacing.l)) { content() } }
}

@Composable
private fun ToggleSetting(title: String, subtitle: String, checked: Boolean, onClick: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = KathaTheme.Spacing.m), verticalAlignment = Alignment.CenterVertically) { Column(modifier = Modifier.weight(1f)) { Text(title, color = KathaTheme.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold); Text(subtitle, color = KathaTheme.textSecondary, fontSize = 12.sp) }; Switch(checked, onCheckedChange = { onClick() }, colors = SwitchDefaults.colors(checkedTrackColor = KathaTheme.accent)) }
}

@Composable
private fun SwitchRow(title: String, checked: Boolean, onChange: (Boolean) -> Unit) { Row(modifier = Modifier.fillMaxWidth().padding(vertical = KathaTheme.Spacing.m), verticalAlignment = Alignment.CenterVertically) { Text(title, color = KathaTheme.textPrimary, fontSize = 15.sp, modifier = Modifier.weight(1f)); Switch(checked, onCheckedChange = onChange, colors = SwitchDefaults.colors(checkedTrackColor = KathaTheme.accent)) } }

@Composable
private fun SafetyRow(title: String, value: String?, onClick: () -> Unit) { Row(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = KathaTheme.Spacing.m), verticalAlignment = Alignment.CenterVertically) { Text(title, color = KathaTheme.textPrimary, fontSize = 15.sp, modifier = Modifier.weight(1f)); value?.let { Text(it, color = KathaTheme.textSecondary, fontSize = 14.sp) }; Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = KathaTheme.textTertiary, modifier = Modifier.size(18.dp)) } }

@Composable
fun PinSetupScreen(state: KathaUiState, viewModel: AppViewModel) {
    var step by remember { mutableIntStateOf(1) }
    var pin by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var mismatch by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    Column(modifier = Modifier.fillMaxSize().background(KathaTheme.canvas).navigationBarsPadding()) {
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = KathaTheme.Spacing.l), verticalAlignment = Alignment.CenterVertically) { IconButton(onClick = { viewModel.cancelPinSetup() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, null, tint = KathaTheme.textPrimary) }; Text(if (step == 1) "Set a PIN" else "Confirm your PIN", color = KathaTheme.textPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold) }
        Spacer(Modifier.weight(1f))
        Icon(Icons.Outlined.Security, null, tint = KathaTheme.accent, modifier = Modifier.size(64.dp).align(Alignment.CenterHorizontally))
        Text(if (step == 1) "Create a 4-6 digit PIN" else "Confirm your PIN", color = KathaTheme.textPrimary, fontSize = 24.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = KathaTheme.Spacing.l))
        Text("You'll need this to change kids mode settings.", color = KathaTheme.textSecondary, fontSize = 14.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(horizontal = 40.dp, vertical = KathaTheme.Spacing.s))
        PinCircles(if (step == 1) pin.length else confirmation.length, false, Modifier.padding(vertical = KathaTheme.Spacing.xl))
        PinKeypad(onDigit = { digit -> haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove); if (step == 1) pin = (pin + digit).take(6) else confirmation = (confirmation + digit).take(6); mismatch = false }, onBackspace = { if (step == 1) pin = pin.dropLast(1) else confirmation = confirmation.dropLast(1) })
        if ((if (step == 1) pin.length else confirmation.length) >= 4) { TextButton(onClick = { if (step == 1) { step = 2; confirmation = "" } else if (confirmation == pin) { if (state.pinSetupMode == PinSetupMode.CHANGE_PIN) viewModel.completePinChange(pin) else viewModel.completeKidsModeEnable(pin) } else { mismatch = true; confirmation = ""; viewModel.showToast("PINs don't match. Try again.") } }, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("Continue", color = KathaTheme.accent, fontWeight = FontWeight.SemiBold) } }
        if (mismatch) { Text("PINs don't match. Try again.", color = KathaTheme.error, fontSize = 13.sp, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) }
        Spacer(Modifier.weight(1f))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PinEntrySheet(state: KathaUiState, viewModel: AppViewModel) {
    var pin by remember { mutableStateOf("") }
    var attempts by remember { mutableIntStateOf(0) }
    val haptics = LocalHapticFeedback.current
    ModalBottomSheet(onDismissRequest = {}, containerColor = KathaTheme.surface) {
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = KathaTheme.Spacing.xl).padding(bottom = KathaTheme.Spacing.xl), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { Text("Enter your PIN", color = KathaTheme.textPrimary, fontSize = 23.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f)); TextButton(onClick = { viewModel.dismissPinEntry() }) { Text("Cancel", color = KathaTheme.accent) } }
            Text(if (state.pinEntryContext == PinEntryContext.DISABLE_KIDS_MODE) "To turn off kids mode" else "To change your PIN", color = KathaTheme.textSecondary, fontSize = 14.sp)
            if (state.isPinCooldownActive) { Icon(Icons.Outlined.Lock, null, tint = KathaTheme.error, modifier = Modifier.size(48.dp).padding(top = 16.dp)); Text("Too many attempts. Try again in 5 minutes.", color = KathaTheme.error, textAlign = TextAlign.Center, modifier = Modifier.padding(24.dp)) }
            else { PinCircles(pin.length, false, Modifier.padding(vertical = KathaTheme.Spacing.xl)); PinKeypad(onDigit = { digit -> if (pin.length < 6) { pin += digit; val storedLength = state.kidsModePin?.length; if (storedLength != null && pin.length == storedLength) { if (viewModel.verifyPin(pin)) viewModel.completePinEntry() else { attempts++; pin = ""; if (attempts >= 3) { viewModel.recordPinFailure(); viewModel.dismissPinEntry(); viewModel.showToast("Too many attempts. Try again in 5 minutes.") } else viewModel.showToast("Incorrect PIN. ${3 - attempts} attempts remaining.") } } } }, onBackspace = { pin = pin.dropLast(1) }) }
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
private fun PinCircles(count: Int, success: Boolean, modifier: Modifier = Modifier) { Row(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(16.dp)) { repeat(6) { index -> Box(Modifier.size(12.dp).clip(CircleShape).background(if (index < count) if (success) KathaTheme.success else KathaTheme.accent else Color.Transparent).border(1.dp, if (index < count) Color.Transparent else KathaTheme.borderStrong, CircleShape)) } } }

@Composable
private fun PinKeypad(onDigit: (String) -> Unit, onBackspace: () -> Unit) { val keys = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"); Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) { keys.chunked(3).forEach { row -> Row(horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) { row.forEach { key -> if (key.isEmpty()) Spacer(Modifier.size(64.dp)) else Box(modifier = Modifier.size(64.dp).clip(CircleShape).background(KathaTheme.surface).border(1.dp, KathaTheme.border, CircleShape).clickable { if (key == "back") onBackspace() else onDigit(key) }, contentAlignment = Alignment.Center) { if (key == "back") Icon(Icons.Outlined.Delete, null, tint = KathaTheme.textSecondary) else Text(key, color = KathaTheme.textPrimary, fontSize = 22.sp, fontWeight = FontWeight.SemiBold) } } } } } }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgeVerificationSheet(state: KathaUiState, viewModel: AppViewModel) { ModalBottomSheet(onDismissRequest = { viewModel.dismissAgeVerification() }, containerColor = KathaTheme.surface) { Column(modifier = Modifier.fillMaxWidth().padding(KathaTheme.Spacing.xl), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)) { SafetyHeader("18+ content", viewModel::dismissAgeVerification); Icon(Icons.Outlined.Warning, null, tint = KathaTheme.error, modifier = Modifier.size(48.dp)); Text("You must be 18 or older to access this genre", color = KathaTheme.textPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center); Text("By continuing, you confirm you are of legal age to view adult content.", color = KathaTheme.textSecondary, fontSize = 14.sp, textAlign = TextAlign.Center); PrimaryCTA("I am 18 or older — Continue") { viewModel.confirmAgeVerification() }; SecondaryCTA("Not now") { viewModel.dismissAgeVerification() }; Text("In some regions, additional age verification may be required.", color = KathaTheme.textTertiary, fontSize = 11.sp, textAlign = TextAlign.Center) } } }

@Composable
fun KidsModeIndicator(state: KathaUiState, viewModel: AppViewModel, modifier: Modifier = Modifier) { if (state.kidsMode) { Row(modifier = modifier.clip(RoundedCornerShape(50)).background(KathaTheme.accentSoft).clickable { viewModel.openParentalControls() }.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) { Icon(Icons.Outlined.Security, null, tint = KathaTheme.accent, modifier = Modifier.size(14.dp)); Text("Kids Mode ON", color = KathaTheme.accent, fontSize = 12.sp, fontWeight = FontWeight.SemiBold) } } }

@Composable
fun RestrictedStoryPlaceholder(viewModel: AppViewModel, modifier: Modifier = Modifier) { Column(modifier = modifier.fillMaxSize().background(KathaTheme.canvas).padding(KathaTheme.Spacing.l), horizontalAlignment = Alignment.CenterHorizontally) { Row(Modifier.fillMaxWidth()) { IconButton(onClick = { viewModel.requestTab(0) }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, null, tint = KathaTheme.textPrimary) } }; Spacer(Modifier.weight(1f)); Icon(Icons.Outlined.Security, null, tint = KathaTheme.textTertiary.copy(alpha = 0.4f), modifier = Modifier.size(96.dp)); Text("This story isn't available in Kids Mode", color = KathaTheme.textPrimary, fontSize = 24.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.padding(top = KathaTheme.Spacing.l)); Text("Ask a parent to turn off Kids Mode in Settings to read this story.", color = KathaTheme.textSecondary, fontSize = 15.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(28.dp)); SecondaryCTA("Back to Home") { viewModel.requestTab(0) }; Spacer(Modifier.weight(1f)) } }
