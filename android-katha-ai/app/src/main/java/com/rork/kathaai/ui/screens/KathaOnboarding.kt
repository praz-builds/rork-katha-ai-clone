/*
 * KathaOnboarding.kt
 * Katha — animated 3-screen onboarding intro (Create → Publish/Community → Read).
 *
 * Drop-in Jetpack Compose. Reference frame 390×844 dp. Implements ONBOARDING SPEC §1–§10.
 * Requires: the three font families in res/font (Bricolage Grotesque, Hanken Grotesk,
 * Baloo 2) and cover/avatar JPGs in res/drawable. See README.md.
 *
 * Usage:  KathaOnboarding(onFinish = { /* user tapped Continue */ })
 */

package com.rork.kathaai.ui.screens

import com.rork.kathaai.R
import com.rork.kathaai.ui.theme.BalooFamily
import com.rork.kathaai.ui.theme.BricolageFamily
import com.rork.kathaai.ui.theme.HankenFamily
import com.rork.kathaai.ui.theme.KathaIntroTheme

import androidx.compose.animation.core.*
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.roundToInt
import kotlin.math.sin

// ── Color tokens (SPEC §2) ─────────────────────────────────────────────────
private object KC {
    val orange get() = KathaIntroTheme.orange
    val orangePress get() = KathaIntroTheme.orangePress
    val orangeDeep get() = KathaIntroTheme.orangeDeep
    val orangeEdit get() = KathaIntroTheme.orangeEdit
    val ink get() = KathaIntroTheme.ink
    val inkSoft get() = KathaIntroTheme.inkSoft
    val inkBody2 get() = KathaIntroTheme.inkBody2
    val muted get() = KathaIntroTheme.muted
    val muted2 get() = KathaIntroTheme.muted2
    val muted3 get() = KathaIntroTheme.muted3
    val sheet get() = KathaIntroTheme.sheet
    val card get() = KathaIntroTheme.card
    val dotIdle get() = KathaIntroTheme.dotIdle
    val hairline get() = KathaIntroTheme.hairline
    val chipPeach get() = KathaIntroTheme.chipPeach
    val coverInk get() = KathaIntroTheme.coverInk
    val phoneBg get() = KathaIntroTheme.phoneBackground
    val heroA get() = KathaIntroTheme.heroStart
    val heroB get() = KathaIntroTheme.heroEnd
    val shadowWarm get() = KathaIntroTheme.shadowWarm
    val bookTealStart get() = KathaIntroTheme.bookTealStart
    val bookTealEnd get() = KathaIntroTheme.bookTealEnd
    val bookTitle get() = KathaIntroTheme.bookTitle
    val notificationSub get() = KathaIntroTheme.notificationSub
    val coverScrimTransparent get() = KathaIntroTheme.coverScrimTransparent
    val coverScrimMid get() = KathaIntroTheme.coverScrimMid
    val coverScrimStrong get() = KathaIntroTheme.coverScrimStrong
}

// ── Fonts (SPEC §3) — map res/font ids to your bundled TTFs ─────────────────
// Provide these FontFamily definitions once (e.g. in a Type.kt). Placeholder ids:
//   val Bricolage = FontFamily(Font(R.font.bricolage_semibold, FontWeight.SemiBold), ...)
//   val Hanken    = FontFamily(Font(R.font.hanken_regular), ...)
//   val Baloo     = FontFamily(Font(R.font.baloo2_extrabold, FontWeight.ExtraBold))
// Replace the three below with references to those families.
private val Bricolage: FontFamily get() = BricolageFamily
private val Hanken: FontFamily get() = HankenFamily
private val Baloo: FontFamily get() = BalooFamily

// ── Timeline math (SPEC §5) ─────────────────────────────────────────────────
private fun clamp01(x: Float) = x.coerceIn(0f, 1f)
private fun win(p: Float, a: Float, b: Float) = clamp01((p - a) / (b - a))
private fun smooth(x: Float): Float { val c = clamp01(x); return c * c * (3 - 2 * c) }

// ── Cover data (SPEC §8). image = drawable name ─────────────────────────────
data class Cover(val title: String, val author: String, val image: Int)

// Fill with your R.drawable ids in this exact order:
fun covers(res: List<Int>) = listOf(
    Cover("The Door Above the Clouds", "Maya Brooks", res[0]),
    Cover("Ravenwick School for Wild Magic", "Ethan Parker", res[1]),
    Cover("The Maharani's Last Cipher", "Anika Rao", res[2]),
    Cover("The Dog Who Found Saturn", "Olivia Hart", res[3]),
    Cover("Midnight Chai Case Files", "Rumi Khan", res[4]),
    Cover("The Wolf on Campus", "Madison Blake", res[5]),
    Cover("Garden of Little Dragons", "Claire Whitman", res[6]),
    Cover("Camp Midnight", "Avery Collins", res[7]),
    Cover("The Girl Beneath the Sea", "Sana Mir", res[8]),
    Cover("The Bird at Dusk", "Noah Bennett", res[9]),
    Cover("Train to Moonlit Jaipur", "Tara Iyer", res[10]),
    Cover("The Library Under Rain", "Liam Carter", res[11]),
    Cover("The Museum Shadow", "Leela Varma", res[12]),
    Cover("The Red Boat", "Avery Collins", res[13]),
    Cover("Rooftop Summer", "Mira James", res[14]),
    Cover("Neon Jinn of Sector Nine", "Kabir Bose", res[15]),
)

// ── Copy (SPEC §4) ──────────────────────────────────────────────────────────
private val HEADLINES = listOf(
    "Write it with Katha, make it yours" to
        "Start from a single idea, let Katha draft it with you, and grow it from a short story to a novel, rewriting any line until it sounds like you.",
    "Publish it and watch it come alive" to
        "Share your story with Katha's readers, feel the reactions land, and see it continue in other hands.",
    "Read from an endless library" to
        "From late-night romance to bedtime tales, a new world waits every time you tap in.",
)

private val DUR_MS = intArrayOf(10_500, 9_600)   // phases 0,1; phase 2 holds

// ── Root ────────────────────────────────────────────────────────────────────
@Composable
fun KathaOnboarding(
    coverRes: List<Int>,                 // 16 drawable ids in SPEC §8 order
    avatarRes: Triple<Int, Int, Int>,    // black-woman, brown-man, white-woman
    onFinish: () -> Unit = {},
) {
    var phase by remember { mutableStateOf(0) }
    var p by remember { mutableStateOf(0f) }          // progress within phase
    val showCta = phase == 2

    // frame clock → drive p, auto-advance 0→1→2 (restarts whenever `phase` changes)
    LaunchedEffect(phase) {
        if (phase >= 2) { p = 1f; return@LaunchedEffect }
        val dur = DUR_MS[phase].toFloat()
        var startMs = 0L
        while (true) {
            val now = withFrameMillis { it }
            if (startMs == 0L) startMs = now
            val e = (now - startMs).toFloat()
            p = clamp01(e / dur)
            if (e >= dur) { phase += 1; break }
        }
    }

    val offsetFrac by animateFloatAsState(
        targetValue = phase.toFloat(),
        animationSpec = tween(600, easing = CubicBezierEasing(0.45f, 0f, 0.2f, 1f)),
        label = "carousel"
    )

    val cvs = covers(coverRes)

    Column(Modifier.fillMaxSize().statusBarsPadding().background(KC.phoneBg)) {
        // Hero (fixed 522dp), clipped carousel + floating wordmark
        Box(
            Modifier.fillMaxWidth().height(522.dp).clipToBounds()
                .background(Brush.radialGradient(listOf(KC.heroA, KC.heroB), radius = 900f))
        ) {
            BoxWithConstraints(Modifier.fillMaxSize()) {
                val w = maxWidth
                Row(Modifier.width(w * 3).offset(x = -w * offsetFrac)) {
                    Box(Modifier.width(w).fillMaxHeight()) { KathaCreateScreen(if (phase == 0) p else if (phase > 0) 1f else 0f) }
                    Box(Modifier.width(w).fillMaxHeight()) { KathaPublishScreen(if (phase == 1) p else if (phase > 1) 1f else 0f, avatarRes) }
                    Box(Modifier.width(w).fillMaxHeight()) { KathaReadScreen(cvs) }
                }
            }
            val brandAlpha by animateFloatAsState(if (phase == 2) 0f else 1f, tween(400), label = "brand")
            Wordmark(Modifier.align(Alignment.TopCenter).padding(top = 60.dp).alpha(brandAlpha))
        }
        BottomSheet(phase, showCta, onDot = { phase = it }, onFinish = onFinish, modifier = Modifier.weight(1f))
    }
}

/** App-specific asset wiring for the pixel-accurate onboarding handoff. */
@Composable
fun KathaOnboardingIntro(onFinish: () -> Unit) {
    KathaOnboarding(
        coverRes = listOf(
            R.drawable.intro_door_above_clouds,
            R.drawable.intro_ravenwick_owl,
            R.drawable.intro_maharanis_last_cipher,
            R.drawable.intro_saturn_beach_dog,
            R.drawable.intro_midnight_chai,
            R.drawable.intro_wolf_campus,
            R.drawable.intro_garden_little_dragons,
            R.drawable.intro_camp_midnight,
            R.drawable.intro_girl_beneath_sea,
            R.drawable.intro_mockingbird_sky,
            R.drawable.intro_moonlit_train,
            R.drawable.intro_library_under_rain,
            R.drawable.intro_gallery_shadow,
            R.drawable.intro_old_sea_boat,
            R.drawable.intro_rooftop_student,
            R.drawable.intro_neon_jinn
        ),
        avatarRes = Triple(
            R.drawable.intro_reader_black,
            R.drawable.intro_reader_brown,
            R.drawable.intro_reader_white
        ),
        onFinish = onFinish
    )
}

// ── Wordmark (SPEC §3) ──────────────────────────────────────────────────────
@Composable
fun Wordmark(modifier: Modifier = Modifier) {
    androidx.compose.material3.Text(
        buildAnnotatedString {
            withStyle(SpanStyle(color = KC.orange)) { append("K") }
            withStyle(SpanStyle(color = KC.ink)) { append("atha") }
            withStyle(SpanStyle(color = KC.orange, fontSize = 11.5.sp)) { append(" AI") }
        },
        modifier = modifier,
        fontFamily = Baloo, fontWeight = FontWeight.ExtraBold, fontSize = 23.sp,
        letterSpacing = (-0.35).sp
    )
}

// ── Bottom sheet (SPEC §4) ──────────────────────────────────────────────────
@Composable
fun BottomSheet(
    phase: Int,
    showCta: Boolean,
    onDot: (Int) -> Unit,
    onFinish: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier.fillMaxWidth()
            .background(KC.sheet)
            .padding(start = 28.dp, end = 28.dp, top = 24.dp, bottom = 40.dp),
        verticalArrangement = Arrangement.Bottom
    ) {
        Row(Modifier.padding(bottom = 18.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            repeat(3) { n ->
                val w by animateFloatAsState(if (n == phase) 22f else 6f, tween(400), label = "dot")
                Box(
                    Modifier.width(w.dp).height(6.dp)
                        .clip(RoundedCornerShape(3.dp))
                        .background(if (n == phase) KC.orange else KC.dotIdle)
                        .clickable { onDot(n) }
                )
            }
        }
        androidx.compose.material3.Text(
            HEADLINES[phase].first, fontFamily = Bricolage, fontWeight = FontWeight.Bold,
            fontSize = 27.sp, lineHeight = 31.3.sp, letterSpacing = (-0.27).sp, color = KC.ink,
            modifier = Modifier.heightIn(min = 64.dp)
        )
        Spacer(Modifier.height(12.dp))
        androidx.compose.material3.Text(
            HEADLINES[phase].second, fontFamily = Hanken, fontSize = 15.sp, lineHeight = 22.5.sp,
            color = KC.muted, modifier = Modifier.heightIn(min = 44.dp)
        )
        Spacer(Modifier.height(28.dp))
        Box(Modifier.heightIn(min = 56.dp)) {
            if (showCta) {
                androidx.compose.material3.Surface(
                    onClick = onFinish, shape = RoundedCornerShape(16.dp), color = KC.orange,
                    shadowElevation = 12.dp, modifier = Modifier.fillMaxWidth().height(56.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        androidx.compose.material3.Text("Continue", color = Color.White,
                            fontFamily = Hanken, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                    }
                }
            }
        }
    }
}

// ── Screen 0 : CREATE then EDIT (SPEC §5, §6) ───────────────────────────────
@Composable
private fun BoxScope.KathaCreateScreen(p: Float) {
    val typed = smooth(win(p, 0.05f, 0.22f))
    val genShow = smooth(win(p, 0.24f, 0.30f))
    val genScale = (0.9f + 0.1f * genShow) * (1 - 0.12f * sin(PI.toFloat() * win(p, 0.31f, 0.37f)))
    val writing = smooth(win(p, 0.37f, 0.43f)) * (1 - smooth(win(p, 0.56f, 0.62f)))
    val hi = smooth(win(p, 0.66f, 0.72f)) * (1 - smooth(win(p, 0.82f, 0.90f)))
    val editWord = if (p >= 0.74f) "a warning." else "a dream."
    val chip = smooth(win(p, 0.78f, 0.85f))

    Column(
        Modifier.align(Alignment.Center).width(306.dp)
            .warmShadow(30.dp, 0.40f, RoundedCornerShape(22.dp))
            .clip(RoundedCornerShape(22.dp)).background(KC.card)
            .padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 22.dp)
            .alpha(smooth(win(p, 0f, 0.04f)))
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Box(Modifier.size(7.dp).clip(CircleShape).background(KC.orange))
            androidx.compose.material3.Text("NEW STORY", fontFamily = Hanken, fontWeight = FontWeight.ExtraBold,
                fontSize = 10.sp, letterSpacing = 1.6.sp, color = KC.muted3)
        }
        // prompt with left→right reveal
        Box(Modifier.padding(top = 14.dp).heightIn(min = 44.dp)) {
            androidx.compose.material3.Text(
                "Write a mystery-fantasy thriller about a teen who finds a hidden door in her family's old house.",
                fontFamily = Hanken, fontStyle = FontStyle.Italic, fontSize = 15.sp, lineHeight = 21.75.sp,
                color = KC.inkBody2,
                modifier = Modifier.drawWithContent {
                    clipRect(right = size.width * typed) { this@drawWithContent.drawContent() }
                }
            )
        }
        Box(
            Modifier.padding(top = 16.dp).graphicsLayer { scaleX = genScale; scaleY = genScale; alpha = genShow }
                .warmShadow(10.dp, 0.6f, RoundedCornerShape(50), KC.orange)
                .clip(RoundedCornerShape(50)).background(KC.orange)
                .padding(horizontal = 15.dp, vertical = 9.dp)
        ) {
            androidx.compose.material3.Text("✦ Generate story", color = Color.White,
                fontFamily = Hanken, fontWeight = FontWeight.Bold, fontSize = 12.sp)
        }
        androidx.compose.material3.Text("✦ Katha is writing…", fontFamily = Hanken, fontWeight = FontWeight.SemiBold,
            fontSize = 11.sp, color = KC.orangeDeep, modifier = Modifier.padding(top = 16.dp).alpha(writing))

        Column(Modifier.padding(top = 14.dp).drawBehind {
            drawLine(KC.hairline, Offset(0f, 0f), Offset(size.width, 0f), 1f)
        }.padding(top = 14.dp)) {
            StoryLine("Tara pulled the old wallpaper back and found it:", 0, p)
            Spacer(Modifier.height(2.dp))
            StoryLine("a door her family swore had never been there,", 1, p)
            Spacer(Modifier.height(2.dp))
            androidx.compose.material3.Text(
                buildAnnotatedString {
                    append("warm to the touch, humming with ")
                    withStyle(SpanStyle(color = if (hi > 0.4f) KC.orangeEdit else KC.inkSoft,
                        background = KC.orange.copy(alpha = 0.20f * hi))) { append(editWord) }
                },
                fontFamily = Hanken, fontSize = 14.5.sp, lineHeight = 23.5.sp, color = KC.inkSoft,
                modifier = Modifier.alpha(smooth(win(p, 0.56f, 0.66f)))
            )
        }
        Box(
            Modifier.padding(top = 14.dp).alpha(chip)
                .offset(y = ((1 - chip) * 6).dp)
                .clip(RoundedCornerShape(50)).background(KC.chipPeach)
                .padding(horizontal = 11.dp, vertical = 6.dp)
        ) {
            androidx.compose.material3.Text("✎ You rewrote this line", fontFamily = Hanken,
                fontWeight = FontWeight.Bold, fontSize = 11.sp, color = KC.orangeDeep)
        }
    }
}

@Composable
private fun StoryLine(text: String, k: Int, p: Float) {
    val a = 0.44f + k * 0.06f
    val r = smooth(win(p, a, a + 0.10f))
    androidx.compose.material3.Text(text, fontFamily = Hanken, fontSize = 14.5.sp, lineHeight = 23.5.sp,
        color = KC.inkSoft, modifier = Modifier.alpha(r).offset(y = ((1 - r) * 6).dp))
}

// ── Screen 1 : PUBLISH then COMMUNITY (SPEC §5, §7) ─────────────────────────
@Composable
private fun BoxScope.KathaPublishScreen(p: Float, avatars: Triple<Int, Int, Int>) {
    val pubOut = smooth(win(p, 0.22f, 0.30f))
    val pubScale = (1 - 0.12f * sin(PI.toFloat() * win(p, 0.16f, 0.22f))) * (1 - 0.06f * pubOut)
    val stats = smooth(win(p, 0.26f, 0.34f))
    val readers = smooth(win(p, 0.30f, 0.40f))
    val hearts = 128 + (smooth(win(p, 0.30f, 0.88f)) * 118).roundToInt()
    val note = smooth(win(p, 0.72f, 0.82f))
    fun chipR(a: Float) = smooth(win(p, a, a + 0.09f))

    // reaction chips (absolute — positions per SPEC §7)
    ReactionChip("the door gave me chills", false, Modifier.align(Alignment.TopStart)
        .offset(x = 60.dp, y = 120.dp).alpha(chipR(0.40f)).offset(y = ((1 - chipR(0.40f)) * 8).dp))
    ReactionChip("♥ liked", true, Modifier.align(Alignment.TopEnd)
        .offset(x = (-44).dp, y = 150.dp).alpha(chipR(0.52f)).offset(y = ((1 - chipR(0.52f)) * 8).dp))
    ReactionChip("read it twice ✦", false, Modifier.align(Alignment.TopStart)
        .offset(x = 48.dp, y = 196.dp).alpha(chipR(0.62f)).offset(y = ((1 - chipR(0.62f)) * 8).dp))

    // main card
    Column(
        Modifier.align(Alignment.Center).width(290.dp)
            .warmShadow(30.dp, 0.45f, RoundedCornerShape(20.dp))
            .clip(RoundedCornerShape(20.dp)).background(KC.card).padding(18.dp)
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            BookSpine()
            Column {
                androidx.compose.material3.Text("The Forgotten Door", fontFamily = Bricolage,
                    fontWeight = FontWeight.Bold, fontSize = 16.sp, color = KC.ink)
                androidx.compose.material3.Text(
                    if (p >= 0.26f) "by you · published" else "Draft · ready to share",
                    fontFamily = Hanken, fontSize = 11.sp, color = KC.muted2, modifier = Modifier.padding(top = 2.dp))
                Box(Modifier.padding(top = 12.dp).height(32.dp)) {
                    Box(
                        Modifier.graphicsLayer { scaleX = pubScale; scaleY = pubScale; alpha = 1 - pubOut }
                            .warmShadow(10.dp, 0.6f, RoundedCornerShape(50), KC.orange)
                            .clip(RoundedCornerShape(50)).background(KC.orange)
                            .padding(horizontal = 16.dp, vertical = 8.dp)
                    ) {
                        androidx.compose.material3.Text("Publish story", color = Color.White,
                            fontFamily = Hanken, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    }
                    Row(Modifier.padding(top = 6.dp).alpha(stats), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        androidx.compose.material3.Text("♥ $hearts", color = KC.orangeDeep,
                            fontFamily = Hanken, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                        androidx.compose.material3.Text("💬 24", color = KC.muted,
                            fontFamily = Hanken, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                    }
                }
            }
        }
        Box(Modifier.padding(top = 16.dp).fillMaxWidth().height(1.dp).background(KC.hairline))
        Row(Modifier.padding(top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box {
                Avatar(avatars.first,  0.34f, p, 0.dp)
                Avatar(avatars.second, 0.44f, p, 18.dp)
                Avatar(avatars.third,  0.54f, p, 36.dp)
            }
            androidx.compose.material3.Text("new readers today", fontFamily = Hanken,
                fontWeight = FontWeight.SemiBold, fontSize = 11.5.sp, color = KC.muted2,
                modifier = Modifier.padding(start = 10.dp).alpha(readers))
        }
    }

    // continuation notification, bottom 40
    NotificationCard(Modifier.align(Alignment.BottomCenter).padding(bottom = 40.dp).width(270.dp)
        .alpha(note).offset(y = ((1 - note) * 22).dp))
}

// avatar overlap: offset each by 18dp (26 − 8) using a start offset
@Composable
private fun Avatar(res: Int, a: Float, p: Float, startX: androidx.compose.ui.unit.Dp) {
    val r = smooth(win(p, a, a + 0.10f))
    Image(
        painterResource(res), contentDescription = null, contentScale = ContentScale.Crop,
        modifier = Modifier.offset(x = startX).size(26.dp).clip(CircleShape)
            .border(2.dp, Color.White, CircleShape)
            .graphicsLayer { scaleX = 0.5f + 0.5f * r; scaleY = 0.5f + 0.5f * r; alpha = r }
    )
}

@Composable
private fun ReactionChip(text: String, peach: Boolean, modifier: Modifier) {
    Box(
        modifier
            .warmShadow(12.dp, if (peach) 0.5f else 0.35f, RoundedCornerShape(14.dp), if (peach) KC.orange else KC.shadowWarm)
            .clip(RoundedCornerShape(14.dp)).background(if (peach) KC.orange else KC.card)
            .padding(horizontal = if (peach) 11.dp else 12.dp, vertical = 7.dp)
    ) {
        androidx.compose.material3.Text(text, fontFamily = Hanken,
            fontWeight = if (peach) FontWeight.Bold else FontWeight.SemiBold,
            fontSize = if (peach) 12.sp else 11.sp, color = if (peach) Color.White else KC.inkSoft)
    }
}

@Composable
private fun BookSpine() {
    Box(
        Modifier.size(58.dp, 78.dp).clip(RoundedCornerShape(6.dp))
            .background(Brush.linearGradient(listOf(KC.bookTealStart, KC.bookTealEnd)))
    ) {
        Box(Modifier.fillMaxHeight().width(4.dp).background(Color.Black.copy(alpha = 0.28f)))
        androidx.compose.material3.Text("The Forgotten Door", fontFamily = Bricolage, fontWeight = FontWeight.Bold,
            fontSize = 8.5.sp, lineHeight = 9.sp, color = KC.bookTitle,
            modifier = Modifier.align(Alignment.BottomStart).padding(7.dp))
    }
}

@Composable
private fun NotificationCard(modifier: Modifier) {
    Row(
        modifier.warmShadow(22.dp, 0.6f, RoundedCornerShape(16.dp), KC.ink)
            .clip(RoundedCornerShape(16.dp)).background(KC.ink).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)
    ) {
        Box(
            Modifier.size(34.dp).clip(RoundedCornerShape(9.dp))
                .background(Brush.linearGradient(listOf(KC.orange, KC.orangePress))),
            contentAlignment = Alignment.Center
        ) { androidx.compose.material3.Text("✦", color = Color.White, fontSize = 16.sp) }
        Column(Modifier.weight(1f)) {
            androidx.compose.material3.Text("Mira continued your story", fontFamily = Hanken,
                fontWeight = FontWeight.Bold, fontSize = 12.5.sp, color = KC.sheet)
            androidx.compose.material3.Text("\"She followed the light down…\"", fontFamily = Hanken,
                fontStyle = FontStyle.Italic, fontSize = 11.sp, color = KC.notificationSub)
        }
    }
}

// ── Screen 2 : READ marquee (SPEC §8) ───────────────────────────────────────
@Composable
private fun BoxScope.KathaReadScreen(cvs: List<Cover>) {
    data class Row(val reverse: Boolean, val durMs: Int, val start: Int)
    val rows = listOf(Row(false, 32_000, 0), Row(true, 26_000, 6), Row(false, 36_000, 11))
    Column(
        Modifier.align(Alignment.Center).fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        rows.forEach { row ->
            val strip = List(10) { cvs[(row.start + it) % cvs.size] }
            MarqueeRow(strip, row.reverse, row.durMs)
        }
    }
}

@Composable
private fun MarqueeRow(covers: List<Cover>, reverse: Boolean, durMs: Int) {
    val unitWidth = covers.size * (100 + 14)     // dp: 10 covers + gaps
    val transition = rememberInfiniteTransition(label = "marquee")
    val frac by transition.animateFloat(
        initialValue = 0f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(durMs, easing = LinearEasing)),
        label = "frac"
    )
    val shift = if (reverse) (frac - 1f) else -frac   // right: -50%→0 ; left: 0→-50%
    Row(
        Modifier.fillMaxWidth().height(140.dp)
            .fadeEdges()
            .offset(x = (shift * unitWidth).dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        (covers + covers).forEach { CoverCard(it) }   // duplicated for seamless loop
    }
}

@Composable
private fun CoverCard(c: Cover) {
    Box(
        Modifier.size(100.dp, 140.dp)
            .warmShadow(13.dp, 0.5f, RoundedCornerShape(12.dp))
            .clip(RoundedCornerShape(12.dp)).background(KC.coverInk)
    ) {
        Image(painterResource(c.image), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(
            0f to KC.coverScrimTransparent, 0.46f to KC.coverScrimMid, 1f to KC.coverScrimStrong)))
        Box(Modifier.fillMaxHeight().width(5.dp).background(
            Brush.horizontalGradient(listOf(Color.Black.copy(alpha = 0.16f), Color.Transparent))))
        Column(Modifier.align(Alignment.BottomStart).padding(start = 9.dp, end = 9.dp, bottom = 9.dp, top = 28.dp)) {
            androidx.compose.material3.Text(c.title, fontFamily = Bricolage, fontWeight = FontWeight.ExtraBold,
                fontSize = 9.5.sp, lineHeight = 10.sp, color = Color.White)
            androidx.compose.material3.Text(c.author.uppercase(), fontFamily = Hanken, fontWeight = FontWeight.ExtraBold,
                fontSize = 6.2.sp, letterSpacing = 0.37.sp, color = Color.White.copy(alpha = 0.82f))
        }
    }
}

// ── Modifiers: warm drop shadow + edge fade mask ────────────────────────────
private fun Modifier.warmShadow(
    radius: androidx.compose.ui.unit.Dp, alpha: Float, shape: Shape, color: Color = KC.shadowWarm
) = this.shadow(
    elevation = radius, shape = shape, clip = false,
    ambientColor = color.copy(alpha = alpha), spotColor = color.copy(alpha = alpha)
)

// horizontal edge fade: linear(transparent, #000 12%, #000 88%, transparent)
private fun Modifier.fadeEdges() = this.graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
    .drawWithContent {
        drawContent()
        val brush = Brush.horizontalGradient(
            0f to Color.Transparent, 0.12f to Color.Black,
            0.88f to Color.Black, 1f to Color.Transparent
        )
        drawRect(brush = brush, blendMode = BlendMode.DstIn)
    }

// note: import androidx.compose.foundation.border for Avatar's .border(...)
