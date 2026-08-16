package com.rork.kathaai.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.R

/** Literata serif — reserved for reader body, the Katha wordmark, and avatar initials. */
val LiterataFamily = FontFamily(
    Font(R.font.literata, FontWeight.Normal),
    Font(R.font.literata_italic, FontWeight.Normal, FontStyle.Italic)
)

fun serif(size: Int, weight: FontWeight = FontWeight.Normal): TextStyle = TextStyle(
    fontFamily = LiterataFamily,
    fontSize = size.sp,
    fontWeight = weight
)

fun serifItalic(size: Int): TextStyle = TextStyle(
    fontFamily = LiterataFamily,
    fontSize = size.sp,
    fontStyle = FontStyle.Italic
)

/**
 * Single source of truth for Katha design tokens.
 * Colors resolve against the system light/dark setting.
 */
object KathaTheme {
    val canvas: Color @Composable get() = pick(0xFFFAF6F0, 0xFF14110E)
    val surface: Color @Composable get() = pick(0xFFFFFFFF, 0xFF241E18)
    val surfaceElevated: Color @Composable get() = pick(0xFFFFFDF8, 0xFF2E271F)

    val textPrimary: Color @Composable get() = pick(0xFF1A1612, 0xFFF5F0E8)
    val textSecondary: Color @Composable get() = pick(0xFF6B5D52, 0xFF9E9085)
    val textTertiary: Color @Composable get() = pick(0xFF948578, 0xFF7A6E63)

    val border: Color @Composable get() = pick(0xFFE8E0D5, 0xFF383027)
    val borderStrong: Color @Composable get() = pick(0xFFD4C8B8, 0xFF4A4035)

    /** Amber accent — primary CTAs, active tabs, liked counts, own follower counts, "Write yours". */
    val accent: Color @Composable get() = pick(0xFFE89F3D, 0xFFF1AC49)
    val accentPressed: Color @Composable get() = pick(0xFFC8842A, 0xFFCF8E33)
    val accentSoft: Color @Composable get() = pick(0xFFF5E6D0, 0xFF3A2E20)

    val error: Color @Composable get() = pick(0xFFC0392B, 0xFFE55A4A)
    val success: Color @Composable get() = pick(0xFF278657, 0xFF3CA76E)

    /** Premium red — subscription/upgrade CTAs and Premium badges only. */
    val premium: Color @Composable get() = pick(0xFFC44536, 0xFFD8554A)
    val premiumSoft: Color @Composable get() = pick(0xFFF5DDD9, 0xFF3A1E18)

    // Sepia — reader body only, identical in both modes
    val sepiaCanvas = Color(0xFFF4ECD8)
    val sepiaText = Color(0xFF3A2D1A)
    val sepiaTextSecondary = Color(0xFF614D38)
    val sepiaSurface = Color(0xFFF8F1E0)

    @Composable
    private fun pick(light: Long, dark: Long): Color =
        if (isSystemInDarkTheme()) Color(dark) else Color(light)

    object Spacing {
        val xs = 4.dp
        val s = 8.dp
        val m = 12.dp
        val l = 16.dp
        val xl = 20.dp
        val xxl = 24.dp
        val xxxl = 32.dp
    }

    object Radius {
        val s = 8.dp
        val m = 12.dp
        val l = 16.dp
        val xl = 20.dp
    }
}

/** Deterministic avatar gradient palettes, chosen by username hash. */
object AvatarPalettes {
    val all: List<List<Color>> = listOf(
        listOf(Color(0xFFE89F3D), Color(0xFFD4742A)), // Amber Warmth
        listOf(Color(0xFFC45B5B), Color(0xFF8B2D2D)), // Rose Dusk
        listOf(Color(0xFF4A8A99), Color(0xFF2D5A6B)), // Ocean Quiet
        listOf(Color(0xFF5B8A5B), Color(0xFF3A6B3A)), // Forest Calm
        listOf(Color(0xFF6B5B8E), Color(0xFF4A3A6B)), // Twilight
        listOf(Color(0xFFE87B4A), Color(0xFFC04A2D))  // Sunset
    )

    fun forUsername(username: String): List<Color> {
        var hash = 5381
        for (ch in username.lowercase()) {
            hash = (hash shl 5) + hash + ch.code
        }
        val index = if (hash < 0) -(hash % all.size) else hash % all.size
        return all[index % all.size]
    }
}

private val LightScheme = lightColorScheme(
    primary = Color(0xFFE89F3D),
    background = Color(0xFFFAF6F0),
    surface = Color(0xFFFFFFFF),
    onBackground = Color(0xFF1A1612),
    onSurface = Color(0xFF1A1612)
)

private val DarkScheme = darkColorScheme(
    primary = Color(0xFFF1AC49),
    background = Color(0xFF14110E),
    surface = Color(0xFF241E18),
    onBackground = Color(0xFFF5F0E8),
    onSurface = Color(0xFFF5F0E8)
)

@Composable
fun AppTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkScheme else LightScheme,
        typography = Typography(),
        content = content
    )
}
