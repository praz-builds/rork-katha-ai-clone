package com.rork.kathaai.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.PhoneIphone
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.text.KeyboardOptions
import com.rork.kathaai.ui.components.PrimaryCTA
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.viewmodel.AuthSheetOrigin

/**
 * Bottom-anchored sign-in sheet. Rendered as a custom overlay rather than a
 * ModalBottomSheet so the mid-read wall can refuse backdrop dismissal.
 */
@Composable
fun AuthSheetOverlay(
    origin: AuthSheetOrigin,
    isAuthenticating: Boolean,
    authError: String?,
    modifier: Modifier = Modifier,
    onDismiss: () -> Unit,
    onGoogle: () -> Unit,
    onApple: () -> Unit,
    onEmail: (String) -> Unit
) {
    var emailMode by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }

    val subtitle = if (origin == AuthSheetOrigin.READER_WALL) {
        "Sign in to continue reading and save your progress."
    } else {
        "Sign in to like stories, save your reads, and follow your favorite authors."
    }

    Box(modifier = modifier.fillMaxSize()) {
        // Scrim — tapping it does nothing when the sheet came from the reader wall.
        Box(
            Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.5f))
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null
                ) { onDismiss() }
        )

        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp))
                .background(KathaTheme.surface)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null
                ) { /* swallow taps so they don't reach the scrim */ }
                .padding(horizontal = KathaTheme.Spacing.xl)
                .padding(top = KathaTheme.Spacing.s, bottom = KathaTheme.Spacing.xxl),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
        ) {
            Box(
                Modifier
                    .width(40.dp)
                    .height(4.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(KathaTheme.border)
            )

            Text(
                "Welcome to Katha",
                color = KathaTheme.textPrimary,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                subtitle,
                color = KathaTheme.textSecondary,
                fontSize = 14.sp,
                textAlign = TextAlign.Center
            )

            if (emailMode) {
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    placeholder = { Text("Email address") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = KathaTheme.accent,
                        unfocusedBorderColor = KathaTheme.border,
                        focusedContainerColor = KathaTheme.canvas,
                        unfocusedContainerColor = KathaTheme.canvas,
                        focusedTextColor = KathaTheme.textPrimary,
                        unfocusedTextColor = KathaTheme.textPrimary
                    ),
                    modifier = Modifier.fillMaxWidth()
                )

                PrimaryCTA(
                    title = "Continue",
                    isLoading = isAuthenticating,
                    enabled = email.isNotBlank()
                ) { onEmail(email) }

                authError?.let {
                    Text(it, color = KathaTheme.error, fontSize = 12.sp, textAlign = TextAlign.Center)
                }

                Text(
                    "Use a different method",
                    color = KathaTheme.textSecondary,
                    fontSize = 13.sp,
                    modifier = Modifier.clickable { emailMode = false }
                )
            } else {
                AuthProviderButton("Continue with Google", Icons.Outlined.Language, isAuthenticating, onGoogle)
                AuthProviderButton("Continue with Apple", Icons.Outlined.PhoneIphone, isAuthenticating, onApple)
                AuthProviderButton("Continue with Email", Icons.Outlined.Email, isAuthenticating) {
                    emailMode = true
                }
            }

            Spacer(Modifier.height(KathaTheme.Spacing.xs))

            Text(
                "By continuing, you agree to our Terms of Service and Privacy Policy.",
                color = KathaTheme.textTertiary,
                fontSize = 11.sp,
                textAlign = TextAlign.Center
            )
        }
    }
}

@Composable
private fun AuthProviderButton(
    title: String,
    icon: ImageVector,
    isBusy: Boolean,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(KathaTheme.canvas)
            .border(1.dp, KathaTheme.border, RoundedCornerShape(14.dp))
            .alpha(if (isBusy) 0.6f else 1f)
            .clickable(enabled = !isBusy) { onClick() }
            .padding(vertical = KathaTheme.Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center
    ) {
        Icon(icon, null, tint = KathaTheme.textPrimary, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(KathaTheme.Spacing.s))
        Text(title, color = KathaTheme.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
    }
}
