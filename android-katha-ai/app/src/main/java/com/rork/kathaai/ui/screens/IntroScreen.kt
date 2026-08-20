package com.rork.kathaai.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoStories
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.Favorite
import androidx.compose.material.icons.outlined.ModeComment
import androidx.compose.material.icons.outlined.Schema
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.R
import com.rork.kathaai.ui.components.PrimaryCTA
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.ui.theme.KathaTypography
import com.rork.kathaai.viewmodel.AppViewModel
import kotlinx.coroutines.delay

private data class IntroCover(val title: String, val author: String, val imageRes: Int)

private val introCovers = listOf(
    IntroCover("The Door Above the Clouds", "Maya Brooks", R.drawable.intro_door_above_clouds),
    IntroCover("Ravenwick School", "Ethan Parker", R.drawable.intro_ravenwick_owl),
    IntroCover("The Maharani's Last Cipher", "Anika Rao", R.drawable.intro_maharanis_last_cipher),
    IntroCover("The Dog Who Found Saturn", "Olivia Hart", R.drawable.intro_saturn_beach_dog),
    IntroCover("Midnight Chai Case Files", "Rumi Khan", R.drawable.intro_midnight_chai),
    IntroCover("The Wolf on Campus", "Madison Blake", R.drawable.intro_wolf_campus),
    IntroCover("Garden of Little Dragons", "Claire Whitman", R.drawable.intro_garden_little_dragons),
    IntroCover("Camp Midnight", "Avery Collins", R.drawable.intro_camp_midnight),
    IntroCover("The Girl Beneath the Sea", "Sana Mir", R.drawable.intro_girl_beneath_sea),
    IntroCover("The Bird at Dusk", "Noah Bennett", R.drawable.intro_mockingbird_sky),
    IntroCover("Train to Moonlit Jaipur", "Tara Iyer", R.drawable.intro_moonlit_train),
    IntroCover("The Library Under Rain", "Liam Carter", R.drawable.intro_library_under_rain),
    IntroCover("The Museum Shadow", "Leela Varma", R.drawable.intro_gallery_shadow),
    IntroCover("The Red Boat", "Avery Collins", R.drawable.intro_old_sea_boat),
    IntroCover("Rooftop Summer", "Mira James", R.drawable.intro_rooftop_student),
    IntroCover("Neon Jinn of Sector Nine", "Kabir Bose", R.drawable.intro_neon_jinn)
)

/** Animated offline-first product introduction shown before purpose selection. */
@Composable
fun IntroScreen(
    viewModel: AppViewModel,
    modifier: Modifier = Modifier
) {
    var page by remember { mutableIntStateOf(0) }
    var createPhase by remember { mutableIntStateOf(0) }
    var communityPhase by remember { mutableIntStateOf(0) }
    var typedPrompt by remember { mutableStateOf("") }
    val prompt = "Write a mystery-fantasy thriller about a teen who finds a hidden door in her family's old house."

    LaunchedEffect(page) {
        createPhase = 0
        communityPhase = 0
        typedPrompt = ""
        if (page == 0) {
            delay(380)
            createPhase = 1
            prompt.forEach { character ->
                typedPrompt += character
                delay(14)
            }
            createPhase = 2
            delay(900)
            createPhase = 3
            delay(520)
            createPhase = 4
            delay(750)
            createPhase = 5
            delay(1_650)
            page = 1
        } else if (page == 1) {
            delay(500)
            communityPhase = 1
            delay(520)
            communityPhase = 2
            delay(720)
            communityPhase = 3
            delay(980)
            communityPhase = 4
            delay(1_500)
            page = 2
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(KathaTheme.introBackground)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(top = KathaTheme.Spacing.s)
                .padding(bottom = 250.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            if (page < 2) IntroLogo()
            else Spacer(Modifier.height(56.dp))
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(horizontal = KathaTheme.Spacing.l),
                contentAlignment = Alignment.Center
            ) {
                when (page) {
                    0 -> CreateVisual(typedPrompt, createPhase)
                    1 -> CommunityVisual(communityPhase)
                    else -> LibraryVisual()
                }
            }
        }

        IntroBottomSheet(
            page = page,
            onPageSelected = { page = it },
            onContinue = viewModel::completeIntro,
            modifier = Modifier.align(Alignment.BottomCenter)
        )
    }
}

@Composable
private fun IntroLogo(modifier: Modifier = Modifier) {
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
        Box(
            modifier = Modifier
                .size(32.dp)
                .clip(CircleShape)
                .background(KathaTheme.accent.copy(alpha = 0.14f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(Icons.Outlined.AutoStories, contentDescription = null, tint = KathaTheme.accent, modifier = Modifier.size(19.dp))
        }
        Text("KathaAI", color = KathaTheme.introInk, style = KathaTypography.Wordmark.copy(fontSize = 28.sp, lineHeight = 34.sp))
    }
}

@Composable
private fun CreateVisual(typedPrompt: String, phase: Int) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .shadow(18.dp, RoundedCornerShape(KathaTheme.Radius.xl), ambientColor = KathaTheme.accent.copy(alpha = 0.08f), spotColor = KathaTheme.accent.copy(alpha = 0.08f))
            .clip(RoundedCornerShape(KathaTheme.Radius.xl))
            .background(KathaTheme.introPanel)
            .border(1.dp, KathaTheme.introBorder, RoundedCornerShape(KathaTheme.Radius.xl))
            .padding(KathaTheme.Spacing.l),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(KathaTheme.accent))
            Text("NEW STORY", color = KathaTheme.introMuted, style = KathaTypography.Meta, letterSpacing = 1.2.sp)
        }
        Text(typedPrompt, color = KathaTheme.introInk, style = KathaTypography.Body)
        AnimatedVisibility(visible = phase >= 2, enter = fadeIn()) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
                Icon(Icons.Outlined.AutoAwesome, contentDescription = null, tint = KathaTheme.accent, modifier = Modifier.size(18.dp))
                Text(if (phase == 2) "Katha is writing…" else "Katha is shaping your draft", color = KathaTheme.introInk, style = KathaTypography.BodyStrong)
            }
        }
        AnimatedVisibility(visible = phase >= 3, enter = slideInVertically { it / 3 } + fadeIn()) {
            Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
                StoryLine("Tara pulled the old wallpaper back and found it:", true)
                StoryLine("a door her family swore had never been there,", phase >= 4)
                Text(
                    "warm to the touch, humming with ${if (phase >= 5) "a warning." else "a dream."}",
                    color = if (phase >= 5) KathaTheme.accent else KathaTheme.introInk,
                    style = KathaTypography.Body.copy(fontWeight = if (phase >= 5) FontWeight.SemiBold else FontWeight.Normal)
                )
                AnimatedVisibility(visible = phase >= 5, enter = scaleIn() + fadeIn()) {
                    Text("✎ You rewrote this line", color = KathaTheme.accent, style = KathaTypography.Meta, modifier = Modifier.background(KathaTheme.accentSoft, CircleShape).padding(horizontal = 8.dp, vertical = 4.dp))
                }
            }
        }
    }
}

@Composable
private fun StoryLine(text: String, visible: Boolean) {
    AnimatedVisibility(visible = visible, enter = fadeIn() + slideInVertically { it / 4 }) {
        Text(text, color = KathaTheme.introInk, style = KathaTypography.Body)
    }
}

@Composable
private fun CommunityVisual(phase: Int) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .shadow(18.dp, RoundedCornerShape(KathaTheme.Radius.xl), ambientColor = KathaTheme.accent.copy(alpha = 0.08f), spotColor = KathaTheme.accent.copy(alpha = 0.08f))
            .clip(RoundedCornerShape(KathaTheme.Radius.xl))
            .background(KathaTheme.introPanel)
            .border(1.dp, KathaTheme.introBorder, RoundedCornerShape(KathaTheme.Radius.xl))
            .padding(KathaTheme.Spacing.l),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m), verticalAlignment = Alignment.Top) {
            IntroImage(R.drawable.intro_door_above_clouds, "The Forgotten Door", Modifier.size(72.dp, 94.dp).clip(RoundedCornerShape(KathaTheme.Radius.m)))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xs)) {
                Text("The Forgotten Door", color = KathaTheme.introInk, style = KathaTypography.Title2)
                Text(if (phase >= 2) "by you · published" else "Draft · ready to share", color = KathaTheme.introMuted, style = KathaTypography.Caption)
                AnimatedVisibility(visible = phase >= 2, enter = fadeIn()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
                        LabelStat(Icons.Outlined.Favorite, if (phase >= 3) "142" else "128")
                        LabelStat(Icons.Outlined.ModeComment, "24")
                    }
                }
            }
        }
        if (phase < 2) {
            Row(
                modifier = Modifier
                    .clip(CircleShape)
                    .background(KathaTheme.accent)
                    .padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.m),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
            ) {
                Icon(Icons.Outlined.ArrowUpward, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
                Text("Publish story", color = Color.White, style = KathaTypography.BodyStrong)
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    listOf(R.drawable.intro_reader_black, R.drawable.intro_reader_brown, R.drawable.intro_reader_white).forEachIndexed { index, image ->
                        IntroImage(image, "Reader avatar", Modifier.offset(x = (-8 * index).dp).size(38.dp).clip(CircleShape).border(2.dp, KathaTheme.introPanel, CircleShape))
                    }
                    Text("new readers today", color = KathaTheme.introMuted, style = KathaTypography.Caption, modifier = Modifier.padding(start = 2.dp))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xs)) {
                    ReactionChip("the door")
                    ReactionChip("so good")
                    ReactionChip("more please")
                }
                AnimatedVisibility(visible = phase >= 4, enter = slideInVertically { it / 2 } + fadeIn()) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
                        Icon(Icons.Outlined.Schema, contentDescription = null, tint = KathaTheme.accent, modifier = Modifier.size(18.dp))
                        Text("A reader continued your story", color = KathaTheme.introInk, style = KathaTypography.BodyStrong)
                    }
                }
            }
        }
    }
}

@Composable
private fun LabelStat(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Icon(icon, contentDescription = null, tint = KathaTheme.accent, modifier = Modifier.size(14.dp))
        Text(label, color = KathaTheme.accent, style = KathaTypography.Meta)
    }
}

@Composable
private fun ReactionChip(text: String) {
    Text(text, color = KathaTheme.introInk, style = KathaTypography.Meta, modifier = Modifier.background(KathaTheme.introBackground, CircleShape).border(1.dp, KathaTheme.introBorder, CircleShape).padding(horizontal = 8.dp, vertical = 4.dp))
}

@Composable
private fun LibraryVisual() {
    val transition = rememberInfiniteTransition(label = "introMarquee")
    val slow by transition.animateFloat(0f, 1f, infiniteRepeatable(tween(36_000, easing = LinearEasing), RepeatMode.Restart), label = "slowRow")
    val medium by transition.animateFloat(0f, 1f, infiniteRepeatable(tween(26_000, easing = LinearEasing), RepeatMode.Restart), label = "mediumRow")
    val fast by transition.animateFloat(0f, 1f, infiniteRepeatable(tween(32_000, easing = LinearEasing), RepeatMode.Restart), label = "fastRow")
    Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s), modifier = Modifier.fillMaxWidth()) {
        IntroCoverRow(introCovers.take(5), slow, -1f)
        IntroCoverRow(introCovers.drop(5).take(5), medium, 1f)
        IntroCoverRow(introCovers.drop(10), fast, -1f)
    }
}

@Composable
private fun IntroCoverRow(items: List<IntroCover>, progress: Float, direction: Float) {
    val repeated = items + items + items
    val distance = (items.size * 90).dp
    val x = if (direction < 0) -(distance * progress) else distance * progress - distance
    Row(modifier = Modifier.fillMaxWidth().offset(x = x), horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
        repeated.forEach { cover ->
            Box(Modifier.size(82.dp, 116.dp).clip(RoundedCornerShape(KathaTheme.Radius.m))) {
                IntroImage(cover.imageRes, cover.title, Modifier.fillMaxSize())
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.8f)))))
                Column(Modifier.align(Alignment.BottomStart).padding(6.dp), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Text(cover.title, color = Color.White, style = KathaTypography.Title2.copy(fontSize = 9.sp, lineHeight = 11.sp, fontWeight = FontWeight.ExtraBold), maxLines = 2)
                    Text(cover.author.uppercase(), color = Color.White.copy(alpha = 0.8f), style = KathaTypography.Meta.copy(fontSize = 7.sp, lineHeight = 9.sp))
                }
            }
        }
    }
}

@Composable
private fun IntroImage(resId: Int, description: String, modifier: Modifier = Modifier) {
    androidx.compose.foundation.Image(painterResource(resId), contentDescription = description, contentScale = ContentScale.Crop, modifier = modifier.background(KathaTheme.introBackground))
}

@Composable
private fun IntroBottomSheet(
    page: Int,
    onPageSelected: (Int) -> Unit,
    onContinue: () -> Unit,
    modifier: Modifier = Modifier
) {
    val titles = listOf("Write it with Katha, make it yours", "Publish it and watch it come alive", "Read from an endless library")
    val support = listOf(
        "Start from a single idea, let Katha draft it with you, and grow it from a short story to a novel, rewriting any line until it sounds like you.",
        "Share your story with Katha's readers, feel the reactions land, and see it continue in other hands.",
        "From late-night romance to bedtime tales, a new world waits every time you tap in."
    )
    Column(
        modifier = modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = KathaTheme.Spacing.s)
            .clip(RoundedCornerShape(KathaTheme.Radius.xl))
            .background(KathaTheme.introPanel)
            .border(1.dp, KathaTheme.introBorder, RoundedCornerShape(KathaTheme.Radius.xl))
            .padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.l),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            (0..2).forEach { index ->
                TextButton(onClick = { onPageSelected(index) }, modifier = Modifier.size(44.dp)) {
                    Box(Modifier.size(if (index == page) 22.dp else 7.dp, 7.dp).clip(CircleShape).background(if (index == page) KathaTheme.accent else KathaTheme.introInactiveDot))
                }
            }
        }
        Text(titles[page], color = KathaTheme.introInk, style = KathaTypography.Title1.copy(fontSize = 28.sp), textAlign = TextAlign.Center)
        Text(support[page], color = KathaTheme.introMuted, style = KathaTypography.Body, textAlign = TextAlign.Center)
        if (page == 2) {
            PrimaryCTA("Continue", onClick = onContinue)
        }
    }
}
