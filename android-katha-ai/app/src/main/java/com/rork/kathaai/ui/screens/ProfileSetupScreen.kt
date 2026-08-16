package com.rork.kathaai.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.CardGiftcard
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.data.UsernameGenerator
import com.rork.kathaai.ui.components.GeneratedAvatar
import com.rork.kathaai.ui.components.PrimaryCTA
import com.rork.kathaai.ui.components.SafeBottomSpacer
import com.rork.kathaai.ui.theme.KathaTheme

@Composable
fun ProfileSetupScreen(
    generatedUsername: String,
    modifier: Modifier = Modifier,
    onComplete: (username: String, displayName: String, bio: String) -> Unit
) {
    var username by remember(generatedUsername) { mutableStateOf(generatedUsername) }
    var displayName by remember { mutableStateOf("") }
    var bio by remember { mutableStateOf("") }

    val isAvailable = remember(username) { UsernameGenerator.isAvailable(username) }
    val canSubmit = isAvailable && displayName.isNotBlank()

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(KathaTheme.canvas)
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(KathaTheme.Spacing.xl),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
        ) {
            item {
                Column(
                    Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                ) {
                    GeneratedAvatar(username, displayName, 88.dp)
                    Text(
                        "Set up your profile",
                        color = KathaTheme.textPrimary,
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        "This is how you'll appear to other readers and writers.",
                        color = KathaTheme.textSecondary,
                        fontSize = 14.sp,
                        textAlign = TextAlign.Center
                    )
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
                    FieldLabel("Username")
                    OutlinedTextField(
                        value = username,
                        onValueChange = { username = it.trim() },
                        prefix = { Text("@", color = KathaTheme.textSecondary) },
                        singleLine = true,
                        shape = RoundedCornerShape(12.dp),
                        colors = kathaFieldColors(
                            border = when {
                                username.isEmpty() -> KathaTheme.border
                                isAvailable -> KathaTheme.success.copy(alpha = 0.5f)
                                else -> KathaTheme.error.copy(alpha = 0.5f)
                            }
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )
                    if (username.isNotEmpty()) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Icon(
                                if (isAvailable) Icons.Filled.CheckCircle else Icons.Outlined.Cancel,
                                contentDescription = null,
                                tint = if (isAvailable) KathaTheme.success else KathaTheme.error,
                                modifier = Modifier.size(12.dp)
                            )
                            Text(
                                if (isAvailable) "Available" else "This username is taken",
                                color = if (isAvailable) KathaTheme.success else KathaTheme.error,
                                fontSize = 11.sp
                            )
                        }
                    }
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
                    FieldLabel("Display name")
                    OutlinedTextField(
                        value = displayName,
                        onValueChange = { displayName = it },
                        placeholder = { Text("Your name") },
                        singleLine = true,
                        shape = RoundedCornerShape(12.dp),
                        colors = kathaFieldColors(KathaTheme.border),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
                    FieldLabel("Bio (optional)")
                    OutlinedTextField(
                        value = bio,
                        onValueChange = { bio = it },
                        placeholder = { Text("Tell readers about yourself") },
                        minLines = 3,
                        shape = RoundedCornerShape(12.dp),
                        colors = kathaFieldColors(KathaTheme.border),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }

            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(KathaTheme.Radius.m))
                        .background(KathaTheme.accentSoft.copy(alpha = 0.4f))
                        .padding(KathaTheme.Spacing.l),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
                ) {
                    Icon(
                        Icons.Outlined.CardGiftcard, null,
                        tint = KathaTheme.accent,
                        modifier = Modifier.size(18.dp)
                    )
                    Text(
                        "You have 3 welcome credits to start writing.",
                        color = KathaTheme.textSecondary,
                        fontSize = 13.sp
                    )
                }
            }

            item { SafeBottomSpacer(90.dp) }
        }

        Box(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .background(KathaTheme.surface)
                .padding(KathaTheme.Spacing.l)
        ) {
            PrimaryCTA("Start writing", enabled = canSubmit) {
                onComplete(username, displayName, bio)
            }
        }
    }
}

@Composable
private fun FieldLabel(text: String) {
    Text(text, color = KathaTheme.textSecondary, fontSize = 13.sp, fontWeight = FontWeight.Medium)
}

@Composable
private fun kathaFieldColors(border: androidx.compose.ui.graphics.Color) =
    OutlinedTextFieldDefaults.colors(
        focusedBorderColor = border,
        unfocusedBorderColor = border,
        focusedContainerColor = KathaTheme.canvas,
        unfocusedContainerColor = KathaTheme.canvas,
        focusedTextColor = KathaTheme.textPrimary,
        unfocusedTextColor = KathaTheme.textPrimary
    )
