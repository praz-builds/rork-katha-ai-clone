package com.rork.kathaai.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Insights
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.MenuBook
import androidx.compose.material.icons.outlined.NoAccounts
import androidx.compose.material.icons.outlined.PersonOff
import androidx.compose.material.icons.outlined.WorkspacePremium
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.ui.components.DestructiveCTA
import com.rork.kathaai.ui.components.EmptyState
import com.rork.kathaai.ui.components.GeneratedAvatar
import com.rork.kathaai.ui.components.SafeBottomSpacer
import com.rork.kathaai.ui.components.TextLink
import com.rork.kathaai.ui.components.formatCount
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.viewmodel.KathaUiState

@Composable
fun SettingsScreen(
    state: KathaUiState,
    modifier: Modifier = Modifier,
    onSignIn: () -> Unit,
    onSignOut: () -> Unit,
    onDeleteAccount: () -> Unit,
    onToggleSepia: () -> Unit,
    onViewProfile: () -> Unit = {},
    onEditProfile: () -> Unit = {},
    onViewBlockedUsers: () -> Unit = {},
    onOpenCredits: () -> Unit = {},
    onOpenPaywall: () -> Unit = {},
    onOpenSubscriptionManagement: () -> Unit = {},
    onOpenDashboard: () -> Unit = {},
    onDevTap: () -> Unit = {},
    onOpenLanguage: () -> Unit = {},
    onOpenReadingLevel: () -> Unit = {},
    onOpenParentalControls: () -> Unit = {}
) {
    var showSignOutDialog by remember { mutableStateOf(false) }
    var showDeleteStep1 by remember { mutableStateOf(false) }
    var showDeleteStep2 by remember { mutableStateOf(false) }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(KathaTheme.canvas)
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(KathaTheme.Spacing.l),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xl)
        ) {
            item {
                Text(
                    "Settings",
                    color = KathaTheme.textPrimary,
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Bold
                )
            }

            if (state.isAuthenticated) {
                item {
                    val user = state.currentUser
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(KathaTheme.Radius.l))
                            .background(KathaTheme.surface)
                            .padding(KathaTheme.Spacing.l),
                        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                        ) {
                            GeneratedAvatar(
                                user?.username.orEmpty(),
                                user?.displayName.orEmpty(),
                                64.dp
                            )
                            Column {
                                Text(
                                    user?.displayName.orEmpty(),
                                    color = KathaTheme.textPrimary,
                                    fontSize = 18.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                                Text(
                                    "@${user?.username.orEmpty()}",
                                    color = KathaTheme.textSecondary,
                                    fontSize = 14.sp
                                )
                            }
                        }

                        if (!user?.bio.isNullOrEmpty()) {
                            Text(user.bio, color = KathaTheme.textSecondary, fontSize = 14.sp)
                        }

                        Row(horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xxl)) {
                            StatItem(user?.followers ?: 0, "Followers", accent = true)
                            StatItem(state.followedAuthorIds.size, "Following")
                            StatItem(user?.credits ?: 0, "Credits")
                        }

                        Row(horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xl)) {
                            TextLink("View your profile \u25b8") { onViewProfile() }
                            TextLink("Edit profile \u25b8") { onEditProfile() }
                        }
                    }
                }
            } else {
                item {
                    EmptyState(
                        icon = Icons.Outlined.NoAccounts,
                        title = "Not signed in",
                        message = "Sign in to personalize your experience, save stories, and start writing.",
                        ctaTitle = "Sign in",
                        onCta = onSignIn
                    )
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
                    SettingsSectionLabel("Preferences")
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(KathaTheme.Radius.l))
                            .background(KathaTheme.surface)
                            .padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.m),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                    ) {
                        Icon(
                            Icons.Outlined.MenuBook, null,
                            tint = KathaTheme.textSecondary,
                            modifier = Modifier.size(20.dp)
                        )
                        Text("Sepia reader", color = KathaTheme.textPrimary, fontSize = 15.sp)
                        Spacer(Modifier.weight(1f))
                        Switch(
                            checked = state.readerSepia,
                            onCheckedChange = { onToggleSepia() },
                            colors = SwitchDefaults.colors(
                                checkedThumbColor = Color.White,
                                checkedTrackColor = KathaTheme.accent
                            )
                        )
                    }
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
                    SettingsSectionLabel("Reading")
                    SettingsRow(title = "Reading level", value = state.defaultReadingLevel.title, icon = Icons.Outlined.MenuBook, onClick = onOpenReadingLevel)
                    SettingsRow(title = "Sepia reader", value = if (state.readerSepia) "On" else "Off", icon = Icons.Outlined.MenuBook, onClick = onToggleSepia)
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
                    SettingsSectionLabel("App")
                    SettingsRow(title = "Language", value = "English", icon = Icons.Outlined.Language, onClick = onOpenLanguage)
                    SettingsRow(title = "Parental controls", value = if (state.kidsMode) "On" else "Off", icon = Icons.Outlined.Security, onClick = onOpenParentalControls)
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
                    SettingsSectionLabel("Rewards")
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(KathaTheme.Radius.l))
                            .background(KathaTheme.surface)
                            .padding(horizontal = KathaTheme.Spacing.l)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onOpenDashboard() }
                                .padding(vertical = KathaTheme.Spacing.m),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                        ) {
                            Icon(Icons.Outlined.Insights, null, tint = KathaTheme.accent, modifier = Modifier.size(20.dp))
                            Text("Your dashboard", color = KathaTheme.textPrimary, fontSize = 15.sp, modifier = Modifier.weight(1f))
                            Icon(Icons.Outlined.ChevronRight, null, tint = KathaTheme.textTertiary, modifier = Modifier.size(12.dp))
                        }
                        HorizontalDivider(color = KathaTheme.border)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onOpenCredits() }
                                .padding(vertical = KathaTheme.Spacing.m),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                        ) {
                            Icon(Icons.Outlined.CreditCard, null, tint = KathaTheme.accent, modifier = Modifier.size(20.dp))
                            Text("Credits", color = KathaTheme.textPrimary, fontSize = 15.sp, modifier = Modifier.weight(1f))
                            Text("${state.currentUser?.credits ?: 0}", color = KathaTheme.accent, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                            Icon(Icons.Outlined.ChevronRight, null, tint = KathaTheme.textTertiary, modifier = Modifier.size(12.dp))
                        }
                        HorizontalDivider(color = KathaTheme.border)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { if (state.isPremium) onOpenSubscriptionManagement() else onOpenPaywall() }
                                .padding(vertical = KathaTheme.Spacing.m),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                        ) {
                            Icon(Icons.Outlined.WorkspacePremium, null, tint = if (state.isPremium) KathaTheme.premium else KathaTheme.textSecondary, modifier = Modifier.size(20.dp))
                            Text("Katha Premium", color = KathaTheme.textPrimary, fontSize = 15.sp, modifier = Modifier.weight(1f))
                            Text(if (state.isPremium) "Active" else "Upgrade", color = if (state.isPremium) KathaTheme.premium else KathaTheme.textTertiary, fontSize = 14.sp)
                            Icon(Icons.Outlined.ChevronRight, null, tint = KathaTheme.textTertiary, modifier = Modifier.size(12.dp))
                        }
                    }
                }
            }

            item {
                val context = LocalContext.current
                Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
                    SettingsSectionLabel("Support")
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(KathaTheme.Radius.l))
                            .background(KathaTheme.surface)
                            .clickable {
                                val username = state.currentUser?.username ?: "Guest"
                                launchFeedbackEmail(context, "1.0", username)
                            }
                            .padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.m),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                    ) {
                        Icon(Icons.Outlined.Email, null, tint = KathaTheme.textSecondary, modifier = Modifier.size(20.dp))
                        Text("Share feedback", color = KathaTheme.textPrimary, fontSize = 15.sp)
                        Spacer(Modifier.weight(1f))
                        Icon(Icons.Outlined.ChevronRight, null, tint = KathaTheme.textTertiary, modifier = Modifier.size(16.dp))
                    }
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
                    SettingsSectionLabel("About")
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(KathaTheme.Radius.l))
                            .background(KathaTheme.surface)
                            .padding(horizontal = KathaTheme.Spacing.l)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onDevTap() }
                                .padding(vertical = KathaTheme.Spacing.m),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                        ) {
                            Icon(Icons.Outlined.Info, null, tint = KathaTheme.textSecondary, modifier = Modifier.size(20.dp))
                            Text("Version", color = KathaTheme.textPrimary, fontSize = 15.sp, modifier = Modifier.weight(1f))
                            Text("1.0.0", color = KathaTheme.textTertiary, fontSize = 14.sp)
                        }
                        HorizontalDivider(color = KathaTheme.border)
                        AboutRow("Terms of Service", null)
                        HorizontalDivider(color = KathaTheme.border)
                        AboutRow("Privacy Policy", null)
                    }
                }
            }

            if (state.isAuthenticated) {
                if (state.blockedUserIds.isNotEmpty()) {
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
                            SettingsSectionLabel("Moderation")
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(KathaTheme.Radius.l))
                                    .background(KathaTheme.surface)
                                    .clickable { onViewBlockedUsers() }
                                    .padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.m),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                            ) {
                                Icon(Icons.Outlined.PersonOff, null, tint = KathaTheme.textSecondary, modifier = Modifier.size(20.dp))
                                Text("Blocked users", color = KathaTheme.textPrimary, fontSize = 15.sp)
                                Spacer(Modifier.weight(1f))
                                Text("${state.blockedUserIds.size}", color = KathaTheme.textTertiary, fontSize = 14.sp)
                                Icon(Icons.Outlined.ChevronRight, null, tint = KathaTheme.textTertiary, modifier = Modifier.size(16.dp))
                            }
                        }
                    }
                }

                item {
                    Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
                        DestructiveCTA("Sign Out", icon = Icons.Outlined.Logout) {
                            showSignOutDialog = true
                        }
                        DestructiveCTA("Delete Account", icon = Icons.Outlined.Delete) {
                            showDeleteStep1 = true
                        }
                    }
                }
            }

            item { SafeBottomSpacer() }
        }
    }

    if (showSignOutDialog) {
        AlertDialog(
            onDismissRequest = { showSignOutDialog = false },
            title = { Text("Sign Out") },
            text = { Text("Are you sure you want to sign out?") },
            confirmButton = {
                TextButton(onClick = {
                    showSignOutDialog = false
                    onSignOut()
                }) { Text("Sign Out", color = KathaTheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { showSignOutDialog = false }) { Text("Cancel") }
            }
        )
    }

    if (showDeleteStep1) {
        AlertDialog(
            onDismissRequest = { showDeleteStep1 = false },
            title = { Text("Delete Account") },
            text = {
                Text("This permanently deletes your account and all associated data. This cannot be undone.")
            },
            confirmButton = {
                TextButton(onClick = {
                    showDeleteStep1 = false
                    showDeleteStep2 = true
                }) { Text("Continue", color = KathaTheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteStep1 = false }) { Text("Cancel") }
            }
        )
    }

    if (showDeleteStep2) {
        AlertDialog(
            onDismissRequest = { showDeleteStep2 = false },
            title = { Text("Are you absolutely sure?") },
            text = {
                Text("All your saved stories, reading history, and credits will be lost forever.")
            },
            confirmButton = {
                TextButton(onClick = {
                    showDeleteStep2 = false
                    onDeleteAccount()
                }) { Text("Delete Forever", color = KathaTheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteStep2 = false }) { Text("Cancel") }
            }
        )
    }
}

@Composable
private fun StatItem(value: Int, label: String, accent: Boolean = false) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            formatCount(value),
            // Own-profile follower counts are the one place the amber accent shows up in stats.
            color = if (accent) KathaTheme.accent else KathaTheme.textPrimary,
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold
        )
        Text(label, color = KathaTheme.textSecondary, fontSize = 12.sp)
    }
}

@Composable
private fun SettingsRow(title: String, value: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(KathaTheme.Radius.l)).background(KathaTheme.surface).clickable(onClick = onClick).padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.m), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
        Icon(icon, null, tint = KathaTheme.textSecondary, modifier = Modifier.size(20.dp))
        Text(title, color = KathaTheme.textPrimary, fontSize = 15.sp, modifier = Modifier.weight(1f))
        Text(value, color = if (value == "On") KathaTheme.accent else KathaTheme.textSecondary, fontSize = 14.sp)
        Icon(Icons.Outlined.ChevronRight, null, tint = KathaTheme.textTertiary, modifier = Modifier.size(16.dp))
    }
}

@Composable
private fun SettingsSectionLabel(text: String) {
    Text(text, color = KathaTheme.textSecondary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
}

@Composable
private fun AboutRow(title: String, value: String?) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = KathaTheme.Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
    ) {
        Icon(
            Icons.Outlined.Info, null,
            tint = KathaTheme.textSecondary,
            modifier = Modifier.size(20.dp)
        )
        Text(title, color = KathaTheme.textPrimary, fontSize = 15.sp)
        Spacer(Modifier.weight(1f))
        value?.let { Text(it, color = KathaTheme.textTertiary, fontSize = 14.sp) }
    }
}
