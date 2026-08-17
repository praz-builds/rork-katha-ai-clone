package com.rork.kathaai.ui.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.R
import com.rork.kathaai.model.Genre

/** Literata is reserved for reading content, recap text, wordmarks, and avatar initials. */
val LiterataFamily = FontFamily(
    Font(R.font.literata, FontWeight.Normal),
    Font(R.font.literata, FontWeight.SemiBold),
    Font(R.font.literata, FontWeight.Bold),
    Font(R.font.literata_italic, FontWeight.Normal, FontStyle.Italic)
)

/** Named typography tokens shared by every Compose screen. */
object KathaTypography {
    val Display: TextStyle = TextStyle(fontSize = 32.sp, lineHeight = 40.sp, fontWeight = FontWeight.SemiBold)
    val Title1: TextStyle = TextStyle(fontSize = 24.sp, lineHeight = 32.sp, fontWeight = FontWeight.SemiBold)
    val Title2: TextStyle = TextStyle(fontSize = 18.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold)
    val Body: TextStyle = TextStyle(fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.Normal)
    val BodyStrong: TextStyle = TextStyle(fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium)
    val Caption: TextStyle = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Normal)
    val Meta: TextStyle = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium)

    val ReaderStoryTitle: TextStyle = TextStyle(fontFamily = LiterataFamily, fontSize = 34.sp, lineHeight = 40.sp, fontWeight = FontWeight.Bold)
    val ReaderChapterTitle: TextStyle = TextStyle(fontFamily = LiterataFamily, fontSize = 28.sp, lineHeight = 36.sp, fontWeight = FontWeight.SemiBold)
    val ReaderChapterNumber: TextStyle = TextStyle(fontFamily = LiterataFamily, fontSize = 14.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium, fontStyle = FontStyle.Italic)
    val ReaderBody: TextStyle get() = readerBody(18)
    val ReaderBodyItalic: TextStyle get() = TextStyle(fontFamily = LiterataFamily, fontSize = 18.sp, lineHeight = 28.sp, fontStyle = FontStyle.Italic)
    val ReaderBodyBold: TextStyle get() = TextStyle(fontFamily = LiterataFamily, fontSize = 18.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold)
    val Recap: TextStyle = TextStyle(fontFamily = LiterataFamily, fontSize = 15.sp, lineHeight = 22.sp, fontStyle = FontStyle.Italic)
    val Wordmark: TextStyle = TextStyle(fontFamily = LiterataFamily, fontSize = 40.sp, lineHeight = 48.sp, fontWeight = FontWeight.Bold)
    val PremiumWordmark: TextStyle = TextStyle(fontFamily = LiterataFamily, fontSize = 32.sp, lineHeight = 40.sp, fontWeight = FontWeight.Bold)
    val AvatarInitial: TextStyle = TextStyle(fontFamily = LiterataFamily, fontSize = 18.sp, lineHeight = 22.sp, fontWeight = FontWeight.Bold)

    fun readerBody(size: Int): TextStyle {
        val lineHeight: Int = when (size) {
            15 -> 24
            17 -> 27
            20 -> 30
            22 -> 32
            else -> 28
        }
        return TextStyle(fontFamily = LiterataFamily, fontSize = size.sp, lineHeight = lineHeight.sp, fontWeight = FontWeight.Normal)
    }
}

/** Compatibility helpers retained while screens migrate to named tokens. */
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

/** A cross-platform shadow token. Shadows are replaced by a border in dark mode. */
data class ShadowToken(
    val elevation: Dp,
    val color: Color
)

object KathaTheme {
    val bg: Color @Composable get() = pick(0xFFFAF7F2, 0xFF0B0908)
    val canvas: Color @Composable get() = bg
    val surface: Color @Composable get() = pick(0xFFFFFFFF, 0xFF17130F)
    val surfaceElevated: Color @Composable get() = pick(0xFFFFFFFF, 0xFF211B15)
    val border: Color @Composable get() = pick(0xFFEFE9E0, 0xFF2A2320)
    val borderStrong: Color @Composable get() = pick(0xFFDED5C7, 0xFF3A312B)

    val textPrimary: Color @Composable get() = pick(0xFF0F0E0C, 0xFFF5F1EA)
    val textSecondary: Color @Composable get() = pick(0xFF6B6560, 0xFFA69E93)
    val textTertiary: Color @Composable get() = pick(0xFF9C9691, 0xFF6C655D)

    val accent: Color @Composable get() = pick(0xFFE89F3D, 0xFFE89F3D)
    val accentPressed: Color @Composable get() = pick(0xFFD18A2A, 0xFFF0B25C)
    val accentSoft: Color @Composable get() = pick(0xFFFCEFD9, 0xFF3D2F1F)

    val premium: Color @Composable get() = pick(0xFFC44536, 0xFFD95A4B)
    val premiumSoft: Color @Composable get() = pick(0xFFF5D9D3, 0xFF3D211D)
    val success: Color @Composable get() = pick(0xFF3D8F5A, 0xFF4FA870)
    val error: Color @Composable get() = pick(0xFFC0392B, 0xFFE05D4E)
    val info: Color @Composable get() = pick(0xFF4A78C2, 0xFF6B95D8)
    val heart: Color @Composable get() = pick(0xFFE85D5D, 0xFFF26B6B)
    val errorSoft: Color @Composable get() = premiumSoft

    // Reader-only sepia tokens.
    val sepiaBackground: Color = Color(0xFFF4E8D0)
    val sepiaText: Color = Color(0xFF4A3B2A)
    val sepiaTextSecondary: Color = Color(0xFF7A6849)
    val sepiaAccent: Color = Color(0xFFB58A3E)
    val sepiaCanvas: Color = sepiaBackground
    val sepiaSurface: Color = sepiaBackground
    val sepiaBorder: Color = sepiaAccent.copy(alpha = 0.3f)

    object Spacing {
        val xs = 4.dp
        val s = 8.dp
        val smMd = 12.dp
        val m = smMd
        val md = 16.dp
        val l = md
        val mdLg = 20.dp
        val xl = mdLg
        val lg = 24.dp
        val xxl = lg
        val xxxl = 32.dp
        val xxl48 = 48.dp
        val xxxl64 = 64.dp
        val huge = xxxl64
    }

    object Radius {
        val xs = 4.dp
        val s = 8.dp
        val m = 12.dp
        val mdLg = 14.dp
        val l = 16.dp
        val xl = 20.dp
        val xxl = 24.dp
        val full = 9999.dp
    }

    val shadowSoft: ShadowToken = ShadowToken(2.dp, Color(0x0A0F0E0C))
    val shadowMedium: ShadowToken = ShadowToken(4.dp, Color(0x0F0F0E0C))
    val shadowStrong: ShadowToken = ShadowToken(8.dp, Color(0x140F0E0C))

    @Composable
    private fun pick(light: Long, dark: Long): Color = if (isSystemInDarkTheme()) Color(dark) else Color(light)

    fun coverColors(genre: Genre): List<Color> = when (genre) {
        Genre.CONTEMPORARY -> listOf(Color(0xFF4A9A9A), Color(0xFF2D6B6B), Color(0xFF1A4A4A))
        Genre.MYSTERY -> listOf(Color(0xFF2C3E50), Color(0xFF1A2A36), Color(0xFF0D1620))
        Genre.ROMANCE -> listOf(Color(0xFFC45B7B), Color(0xFF8B2D4B), Color(0xFF5A1D33))
        Genre.SCIFI -> listOf(Color(0xFF4A3A8E), Color(0xFF2D1A5A), Color(0xFF1A0D3A))
        Genre.FANTASY -> listOf(Color(0xFF5B8A5B), Color(0xFF3A6B3A), Color(0xFF1A4A2A))
        Genre.HORROR -> listOf(Color(0xFF5A1D1D), Color(0xFF3A0D0D), Color(0xFF1A0505))
        Genre.POETRY -> listOf(Color(0xFF8E7A9E), Color(0xFF6B5B8E), Color(0xFF4A3A6B))
        Genre.DRAMA -> listOf(Color(0xFF6B4A6B), Color(0xFF4A2D4A), Color(0xFF2A1A2A))
        Genre.ADVENTURE -> listOf(Color(0xFFE87B4A), Color(0xFFC04A2D), Color(0xFF8B2A1A))
        Genre.MYTHOLOGY -> listOf(Color(0xFFB85A2D), Color(0xFF8B3A1A), Color(0xFF5A1D0D))
        Genre.THRILLER -> listOf(Color(0xFF3A3A3A), Color(0xFF1A1A1A), Color(0xFF0D0D0D))
        Genre.SLICE_OF_LIFE -> listOf(Color(0xFFD4A574), Color(0xFFA67B52), Color(0xFF6B4F35))
        Genre.HISTORICAL -> listOf(Color(0xFF8B7355), Color(0xFF6B5235), Color(0xFF3A2D1A))
        Genre.CONTEMPORARY -> listOf(Color(0xFF4A9A9A), Color(0xFF2D6B6B), Color(0xFF1A4A4A))
        Genre.LGBTQ -> listOf(Color(0xFFE84A7B), Color(0xFFC42D5B), Color(0xFF8B1D3D))
        Genre.COMEDY -> listOf(Color(0xFFF0C04A), Color(0xFFD4A02D), Color(0xFF8B7020))
        Genre.DRAMA -> listOf(Color(0xFF6B4A6B), Color(0xFF4A2D4A), Color(0xFF2A1A2A))
        Genre.MYTHOLOGY -> listOf(Color(0xFFB85A2D), Color(0xFF8B3A1A), Color(0xFF5A1D0D))
        Genre.SPIRITUALITY -> listOf(Color(0xFF6B8E6B), Color(0xFF4A6B4A), Color(0xFF2A4A2A))
        Genre.MOTIVATIONAL -> listOf(Color(0xFFE8B83D), Color(0xFFC8982A), Color(0xFF8B6B1A))
        Genre.KIDS -> listOf(Color(0xFFFFB347), Color(0xFFFF8C42), Color(0xFFCC6A2D))
        Genre.EROTICA -> listOf(Color(0xFF8B3A58), Color(0xFF5A1D38), Color(0xFF2A0D1D))
    }
}

/** Deterministic avatar gradient palettes, defined centrally with the rest of the color system. */
object AvatarPalettes {
    val all: List<List<Color>> = listOf(
        listOf(Color(0xFFE89F3D), Color(0xFFD4742A)),
        listOf(Color(0xFFC45B5B), Color(0xFF8B2D2D)),
        listOf(Color(0xFF4A8A99), Color(0xFF2D5A6B)),
        listOf(Color(0xFF5B8A5B), Color(0xFF3A6B3A)),
        listOf(Color(0xFF6B5B8E), Color(0xFF4A3A6B)),
        listOf(Color(0xFFE87B4A), Color(0xFFC04A2D))
    )

    fun forUsername(username: String): List<Color> {
        var hash = 5381
        for (ch in username.lowercase()) hash = (hash shl 5) + hash + ch.code
        val index = if (hash < 0) -(hash % all.size) else hash % all.size
        return all[index % all.size]
    }
}

/** Apply a soft warm shadow in light mode and a 1dp border in dark mode. */
@Composable
fun Modifier.kathaShadow(token: ShadowToken, shape: RoundedCornerShape): Modifier =
    if (isSystemInDarkTheme()) {
        border(BorderStroke(1.dp, KathaTheme.border), shape)
    } else {
        shadow(token.elevation, shape, ambientColor = token.color, spotColor = token.color)
    }

private val LightScheme = lightColorScheme(
    primary = Color(0xFFE89F3D),
    background = Color(0xFFFAF7F2),
    surface = Color(0xFFFFFFFF),
    onBackground = Color(0xFF0F0E0C),
    onSurface = Color(0xFF0F0E0C)
)

private val DarkScheme = darkColorScheme(
    primary = Color(0xFFE89F3D),
    background = Color(0xFF0B0908),
    surface = Color(0xFF17130F),
    onBackground = Color(0xFFF5F1EA),
    onSurface = Color(0xFFF5F1EA)
)

@Composable
fun AppTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkScheme else LightScheme,
        typography = Typography(
            displayLarge = KathaTypography.Display,
            headlineLarge = KathaTypography.Title1,
            headlineMedium = KathaTypography.Title2,
            bodyLarge = KathaTypography.Body,
            bodyMedium = KathaTypography.BodyStrong,
            bodySmall = KathaTypography.Caption,
            labelSmall = KathaTypography.Meta
        ),
        content = content
    )
}
