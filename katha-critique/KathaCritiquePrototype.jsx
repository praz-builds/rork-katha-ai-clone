import React, { useMemo, useState } from "react";

/**
 * Katha visual critique prototype.
 *
 * Import into any React surface:
 *   import KathaCritiquePrototype from "./KathaCritiquePrototype";
 *   <KathaCritiquePrototype />
 *
 * This artifact is intentionally local-only. It is a visual review surface,
 * not a replacement for the native Katha apps.
 */

const stories = [
  {
    id: "lighthouse",
    title: "The Last Lighthouse Keeper",
    author: "Aarav Mehta",
    handle: "@aaravwrites",
    genre: "Adventure",
    tag: "Atmospheric",
    description: "Every night, one light still turns toward the sea.",
    initials: "AM",
    cover: "cover-sunset",
    likes: "12.4k",
    reads: "22k",
    progress: 40,
  },
  {
    id: "quantum",
    title: "The Quantum Garden",
    author: "Ren Takahashi",
    handle: "@rent",
    genre: "Sci-Fi",
    tag: "Trending",
    description: "A garden that grows a different future every morning.",
    initials: "RT",
    cover: "cover-night",
    likes: "9.8k",
    reads: "18k",
  },
  {
    id: "weaver",
    title: "The Weaver's Daughter",
    author: "Maya Kapoor",
    handle: "@mayak",
    genre: "Fantasy",
    tag: "New chapter",
    description: "The loom remembers what the village chose to forget.",
    initials: "MK",
    cover: "cover-forest",
    likes: "7.1k",
    reads: "14k",
    progress: 15,
  },
  {
    id: "marrakech",
    title: "Midnight in Marrakech",
    author: "Zoe Okafor",
    handle: "@zoeok",
    genre: "Mystery",
    tag: "Editors' pick",
    description: "A blue door appears only for people with a secret.",
    initials: "ZO",
    cover: "cover-terracotta",
    likes: "6.4k",
    reads: "11k",
  },
];

const tabs = [
  { id: "home", label: "Home", icon: "home" },
  { id: "discover", label: "Discover", icon: "compass" },
  { id: "create", label: "Create", icon: "plus" },
  { id: "library", label: "Library", icon: "book" },
  { id: "settings", label: "Settings", icon: "settings" },
];

const genres = ["For you", "Adventure", "Fantasy", "Romance", "Mystery", "Sci-Fi", "Drama"];
const libraryTabs = ["Saved", "History", "Downloads", "My stories"];

function Icon({ name, size = 18, strokeWidth = 1.8 }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9.5V20h14V9.5" /><path d="M9 20v-6h6v6" /></>,
    compass: <><circle cx="12" cy="12" r="8.5" /><path d="m14.8 9.2-2 3.6-3.6 2 2-3.6 3.6-2Z" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z" /><path d="M4 19V5.5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.42 1.42-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20h-2v-.08a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-1.42-1.42.06-.06A1.7 1.7 0 0 0 9.4 15a1.7 1.7 0 0 0-1.56-1.03H7v-2h.84A1.7 1.7 0 0 0 9.4 11a1.7 1.7 0 0 0-.34-1.88L9 9.06l1.42-1.42.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 13.4 6.5V6h2v.5a1.7 1.7 0 0 0 1.03 1.54 1.7 1.7 0 0 0 1.88-.34l.06-.06 1.42 1.42-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03H21v2h-.06A1.7 1.7 0 0 0 19.4 15Z" /></>,
    bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
    bookmark: <path d="M6 4.5A2.5 2.5 0 0 1 8.5 2h7A2.5 2.5 0 0 1 18 4.5V21l-6-3.5L6 21V4.5Z" />,
    heart: <path d="M20.8 8.8c0 5.2-8.8 10-8.8 10s-8.8-4.8-8.8-10A4.8 4.8 0 0 1 12 6.3a4.8 4.8 0 0 1 8.8 2.5Z" />,
    sparkles: <><path d="m12 3 1.2 4.8L18 9l-4.8 1.2L12 15l-1.2-4.8L6 9l4.8-1.2L12 3Z" /><path d="m19 15 .6 2.4L22 18l-2.4.6L19 21l-.6-2.4L16 18l2.4-.6L19 15Z" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    moon: <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    wand: <><path d="m15 4 5 5" /><path d="m13 6 5 5-9 9H4v-5l9-9Z" /><path d="M5 3v3M3 5h4" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.sparkles}</svg>;
}

function Avatar({ initials, tone = "amber", size = "md" }) {
  return <div className={`avatar avatar-${tone} avatar-${size}`} aria-label={`${initials} avatar`}>{initials}</div>;
}

function Cover({ story, compact = false }) {
  return <div className={`cover ${story.cover} ${compact ? "cover-compact" : ""}`}><span>{story.genre}</span><strong>{story.title.split(" ").slice(0, 2).join(" ")}</strong><i /></div>;
}

function StoryCard({ story, favorite, onFavorite, horizontal = false }) {
  return <article className={`story-card ${horizontal ? "story-card-horizontal" : ""}`}>
    <Cover story={story} compact={horizontal} />
    <div className="story-card-copy">
      <div className="story-card-topline"><span className="eyebrow">{story.tag}</span><button className={`icon-button ${favorite ? "is-favorite" : ""}`} aria-label={`${favorite ? "Remove" : "Save"} ${story.title}`} onClick={onFavorite}><Icon name="bookmark" size={17} /></button></div>
      <h3>{story.title}</h3>
      <p className="story-author">{story.author} <span>·</span> {story.genre}</p>
      <p className="story-description">{story.description}</p>
      <div className="engagement"><span><Icon name="heart" size={14} /> {story.likes}</span><span>{story.reads} reads</span>{story.progress ? <span className="progress-copy">{story.progress}% read</span> : null}</div>
      {story.progress ? <div className="progress-track"><span style={{ width: `${story.progress}%` }} /></div> : null}
    </div>
  </article>;
}

function SectionHeader({ title, action = "See all" }) {
  return <div className="section-header"><h2>{title}</h2><button className="text-link">{action} <Icon name="chevron" size={13} /></button></div>;
}

function HomeScreen({ onNavigate, favoriteIds, toggleFavorite }) {
  const continueStory = stories[0];
  return <div className="screen screen-home">
    <header className="screen-header home-header"><div><span className="micro-label">Tuesday, August 18</span><h1>Good morning, <em>Riya</em></h1></div><div className="header-actions"><button className="header-icon" aria-label="Notifications"><Icon name="bell" /></button><button className="sign-in-button" onClick={() => onNavigate("settings")}>Sign in</button></div></header>
    <div className="prototype-note"><Icon name="sparkles" size={14} /><span>Visual critique prototype · local sample data</span></div>
    <section className="continue-card" onClick={() => onNavigate("reader")} role="button" tabIndex={0}><div className="continue-art"><span>CONTINUE</span><strong>The Last<br />Lighthouse<br />Keeper</strong><div className="wave-line" /></div><div className="continue-copy"><span className="micro-label">Pick up where you left off</span><h2>The Last Lighthouse Keeper</h2><p>Chapter 2 · The light between storms</p><div className="continue-progress"><span style={{ width: "40%" }} /></div><span className="continue-meta">40% complete <b>→</b></span></div></section>
    <section><SectionHeader title="A story for your mood" action="Refresh" /><div className="featured-card"><div className="featured-content"><span className="eyebrow eyebrow-light">EDITOR'S PICK</span><h2>Midnight in Marrakech</h2><p>A blue door appears only for people with a secret.</p><div className="featured-by"><Avatar initials="ZO" tone="rose" size="sm" /><span>Zoe Okafor <small>· Mystery</small></span></div><button className="light-button" onClick={() => onNavigate("reader")}>Start reading <Icon name="arrow" size={14} /></button></div><div className="featured-orbit orbit-one" /><div className="featured-orbit orbit-two" /><div className="featured-lantern">✦</div></div></section>
    <section><SectionHeader title="Trending on Katha" /><div className="horizontal-scroll">{stories.slice(1, 4).map((story) => <StoryCard key={story.id} story={story} favorite={favoriteIds.has(story.id)} onFavorite={() => toggleFavorite(story.id)} horizontal />)}</div></section>
    <section className="writers-section"><SectionHeader title="Writers to follow" action="Discover writers" /><div className="writer-row"><div className="writer"><Avatar initials="AM" /><strong>Aarav Mehta</strong><span>48.2k followers</span><button>Follow</button></div><div className="writer"><Avatar initials="MK" tone="green" /><strong>Maya Kapoor</strong><span>3.4k followers</span><button>Follow</button></div><div className="writer"><Avatar initials="RT" tone="blue" /><strong>Ren Takahashi</strong><span>1.2k followers</span><button>Follow</button></div></div></section>
  </div>;
}

function DiscoverScreen({ favoriteIds, toggleFavorite }) {
  const [rank, setRank] = useState("For you");
  const [genre, setGenre] = useState("All stories");
  const filteredStories = useMemo(() => genre === "All stories" ? stories : stories.filter((story) => story.genre === genre), [genre]);
  return <div className="screen"><header className="screen-header"><div><span className="micro-label">Find your next world</span><h1>Discover</h1></div><button className="header-icon"><Icon name="search" /></button></header><div className="discover-chips">{["For you", "Trending", "Rising", "New"].map((chip) => <button key={chip} className={`filter-chip ${rank === chip ? "selected" : ""}`} onClick={() => setRank(chip)}>{chip}</button>)}</div><div className="genre-chips">{["All stories", ...genres.slice(1)].map((chip) => <button key={chip} className={`genre-chip ${genre === chip ? "selected" : ""}`} onClick={() => setGenre(chip)}>{chip}</button>)}</div><div className="safe-note"><Icon name="lock" size={15} /><span>Thoughtful stories, age-safe by default</span><Icon name="chevron" size={14} /></div><section><div className="feed-header"><span>{rank} · {genre}</span><button className="icon-button"><Icon name="settings" size={16} /></button></div><div className="discover-feed">{filteredStories.map((story) => <StoryCard key={story.id} story={story} favorite={favoriteIds.has(story.id)} onFavorite={() => toggleFavorite(story.id)} />)}</div></section></div>;
}

function CreateScreen({ onNavigate }) {
  const [selectedGenre, setSelectedGenre] = useState("Fantasy");
  const [language, setLanguage] = useState("English");
  const [prompt, setPrompt] = useState("");
  const [created, setCreated] = useState(false);
  return <div className="screen create-screen"><header className="screen-header"><div><span className="micro-label">Turn a spark into a story</span><h1>Create</h1></div><div className="credit-pill"><Icon name="sparkles" size={14} /> 12 credits</div></header><div className="create-hero"><div className="wand-mark"><Icon name="wand" size={24} /></div><h2>What story is waiting<br />inside you?</h2><p>Katha helps you shape the idea. You decide where it goes.</p></div><label className="field-label" htmlFor="story-prompt">Your story seed</label><textarea id="story-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="A lighthouse keeper discovers a letter from the future..." rows={4} /><div className="prompt-suggestions"><button onClick={() => setPrompt("A chef who can taste people's memories")}>Memory chef</button><button onClick={() => setPrompt("Two strangers meet on a train that never stops")}>Midnight train</button></div><div className="form-row"><div><span className="field-label">Genre</span><div className="select-chips">{["Fantasy", "Mystery", "Romance", "Sci-Fi"].map((item) => <button key={item} className={`select-chip ${selectedGenre === item ? "selected" : ""}`} onClick={() => setSelectedGenre(item)}>{item}</button>)}</div></div></div><div className="select-row"><button><span><span className="field-label">Language</span><strong>{language}</strong></span><Icon name="chevron" size={16} /></button><button><span><span className="field-label">Reading level</span><strong>Teen</strong></span><Icon name="chevron" size={16} /></button></div><div className="character-preview"><div className="character-icon">✦</div><div><strong>Build your cast</strong><span>Add characters after your first draft</span></div><Icon name="chevron" size={17} /></div><button className="primary-button" onClick={() => setCreated(true)} disabled={!prompt.trim()}><Icon name="wand" size={17} /> {created ? "Draft ready to shape" : "Create my story"}</button><p className="credit-footnote">Uses 1 credit · You can edit every detail</p></div>;
}

function LibraryScreen({ favoriteIds, onNavigate }) {
  const [segment, setSegment] = useState("Saved");
  const saved = stories.filter((story) => favoriteIds.has(story.id));
  const visible = segment === "Saved" ? (saved.length ? saved : [stories[1], stories[3]]) : segment === "History" ? [stories[0], stories[2]] : segment === "My stories" ? [stories[0]] : [];
  return <div className="screen"><header className="screen-header"><div><span className="micro-label">Your reading room</span><h1>Library</h1></div><button className="header-icon"><Icon name="search" /></button></header><div className="segment-control">{libraryTabs.map((item) => <button key={item} className={segment === item ? "selected" : ""} onClick={() => setSegment(item)}>{item}</button>)}</div>{segment === "Downloads" ? <div className="empty-library"><div className="empty-icon"><Icon name="book" size={25} /></div><h2>Stories for the road</h2><p>Downloaded stories will live here for offline reading.</p><button className="secondary-button" onClick={() => onNavigate("discover")}>Find a story</button></div> : <section className="library-list">{visible.map((story, index) => <article className="library-row" key={`${story.id}-${index}`} onClick={() => onNavigate("reader")}><Cover story={story} compact /><div><span className="eyebrow">{segment === "My stories" ? "YOUR DRAFT" : story.tag}</span><h3>{story.title}</h3><p>{story.author} · {story.genre}</p><div className="row-meta">{story.progress ? <><span>{story.progress}% read</span><div className="progress-track"><span style={{ width: `${story.progress}%` }} /></div></> : <span>{story.reads} reads</span>}<Icon name="chevron" size={15} /></div></div></article>)}</section>}</div>;
}

function SettingsScreen({ dark, setDark }) {
  const settingGroups = [
    { title: "Reading", rows: [["Aa", "Font size", "18 pt"], ["◐", "Reading level", "Teen"], ["◷", "Audiobook voice", "Katha voice"]] },
    { title: "App", rows: [["⌘", "Notifications", "On"], ["◐", "App theme", dark ? "Dark" : "Light"], ["▣", "Language", "English"]] },
    { title: "Support", rows: [["★", "Rate Katha", ""], ["?", "FAQ", ""]] },
  ];
  return <div className="screen settings-screen"><header className="screen-header"><div><span className="micro-label">Make Katha yours</span><h1>Settings</h1></div><button className="header-icon"><Icon name="more" /></button></header><section className="profile-card"><Avatar initials="RS" tone="amber" size="lg" /><div><h2>Riya Sharma</h2><p>@riya.reads</p></div><button className="icon-button"><Icon name="chevron" size={16} /></button></section><button className="premium-card"><div className="premium-icon"><Icon name="sparkles" size={19} /></div><span><strong>Unlock your full reading life</strong><small>Unlimited stories · premium voices · no ads</small></span><b>→</b></button><button className="credits-row"><span><span className="credits-symbol">✦</span><span><strong>12 credits</strong><small>Enough for 12 story ideas</small></span></span><span className="text-link">Get more</span></button>{settingGroups.map((group) => <section className="settings-group" key={group.title}><h2>{group.title}</h2><div className="settings-card">{group.rows.map(([icon, label, value]) => <button className="settings-row" key={label} onClick={() => label === "App theme" && setDark(!dark)}><span className="setting-icon">{icon}</span><strong>{label}</strong>{value ? <span className="setting-value">{value}</span> : null}<Icon name="chevron" size={15} /></button>)}</div></section>)}<button className="signout-link">Sign out</button><p className="settings-footer">Katha AI · Create stories that stay with you<br />Visual prototype for critique only</p></div>;
}

function ReaderPreview({ onClose }) {
  return <div className="reader-overlay"><div className="reader-top"><button className="header-icon" onClick={onClose}><Icon name="close" /></button><span>THE LAST LIGHTHOUSE KEEPER</span><button className="header-icon"><Icon name="more" /></button></div><div className="reader-page"><span className="reader-chapter">CHAPTER TWO</span><h1>The light between storms</h1><p className="drop-cap">T</p><p>he sea had a way of making every promise sound larger than it was. From the top room of the lighthouse, Aarav watched the horizon gather itself into a dark blue line.</p><p>He had kept the lamp for eleven years. Tonight, for the first time, a second light answered from beyond the reef.</p><div className="reader-rule" /><span className="reader-note">A quiet, atmospheric preview of the native reading experience.</span></div><div className="reader-bottom"><div className="reader-progress"><span style={{ width: "40%" }} /></div><div><span>40% complete</span><button className="reader-heart"><Icon name="heart" size={20} /></button></div></div></div>;
}

export default function KathaCritiquePrototype() {
  const [tab, setTab] = useState("home");
  const [dark, setDark] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState(new Set(["quantum", "marrakech"]));
  const [readerOpen, setReaderOpen] = useState(false);
  const toggleFavorite = (id) => setFavoriteIds((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const navigate = (nextTab) => nextTab === "reader" ? setReaderOpen(true) : setTab(nextTab);
  const content = tab === "home" ? <HomeScreen onNavigate={navigate} favoriteIds={favoriteIds} toggleFavorite={toggleFavorite} /> : tab === "discover" ? <DiscoverScreen favoriteIds={favoriteIds} toggleFavorite={toggleFavorite} /> : tab === "create" ? <CreateScreen onNavigate={navigate} /> : tab === "library" ? <LibraryScreen favoriteIds={favoriteIds} onNavigate={navigate} /> : <SettingsScreen dark={dark} setDark={setDark} />;
  return <div className={`katha-stage ${dark ? "theme-dark" : ""}`}>
    <style>{styles}</style>
    <div className="presentation-bar"><span><b>KATHA</b> visual critique</span><span>Tap through · annotate · compare</span></div>
    <main className="phone-shell" aria-label="Katha visual critique prototype">
      <div className="status-bar"><span>9:41</span><span className="status-right">▮▮▮　⌁　▰</span></div>
      <div className="phone-content">{content}</div>
      <nav className="bottom-nav" aria-label="Primary navigation">{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.id === "create" ? <span className="create-tab-icon"><Icon name="plus" size={22} strokeWidth={2.2} /></span> : <Icon name={item.icon} size={19} />}<span>{item.label}</span></button>)}</nav>
    </main>
    {readerOpen ? <ReaderPreview onClose={() => setReaderOpen(false)} /> : null}
  </div>;
}

const styles = `
:root{--bg:#f2eee8;--canvas:#faf7f2;--surface:#fff;--surface-2:#f5f0e9;--border:#eee7de;--border-strong:#ded5c7;--ink:#0f0e0c;--muted:#6b6560;--tertiary:#9c9691;--accent:#e89f3d;--accent-soft:#fcefd9;--premium:#c44536;--heart:#e85d5d;--shadow:0 10px 32px rgba(61,45,27,.11);--phone-shadow:0 28px 80px rgba(54,39,24,.18)}
*{box-sizing:border-box}button,textarea{font:inherit}button{border:0;background:none;color:inherit;cursor:pointer}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg)}.katha-stage{min-height:100vh;background:radial-gradient(circle at 50% 10%,#fffaf3 0,#f2eee8 45%,#e8e1d8 100%);padding:20px;display:flex;flex-direction:column;align-items:center;gap:10px}.theme-dark{--bg:#15110f;--canvas:#0b0908;--surface:#17130f;--surface-2:#211b15;--border:#2a2320;--border-strong:#3a312b;--ink:#f5f1ea;--muted:#a69e93;--tertiary:#6c655d;--accent-soft:#3d2f1f;--shadow:none;--phone-shadow:0 28px 80px rgba(0,0,0,.35)}.presentation-bar{width:min(100%,520px);display:flex;justify-content:space-between;color:var(--muted);font-size:11px;letter-spacing:.02em;padding:0 4px}.presentation-bar b{color:var(--ink);letter-spacing:.14em;margin-right:4px}.phone-shell{width:min(100%,430px);height:min(860px,calc(100vh - 66px));min-height:660px;background:var(--canvas);border:1px solid rgba(83,67,47,.14);border-radius:34px;overflow:hidden;box-shadow:var(--phone-shadow);position:relative;display:flex;flex-direction:column}.status-bar{height:30px;padding:10px 22px 0;font-size:11px;font-weight:650;display:flex;justify-content:space-between;flex:none;letter-spacing:.02em}.status-right{font-size:9px;letter-spacing:-.08em}.phone-content{overflow:auto;flex:1;scrollbar-width:none}.phone-content::-webkit-scrollbar{display:none}.screen{padding:13px 20px 28px}.screen-header{display:flex;align-items:center;justify-content:space-between;margin:0 0 18px}.screen-header h1{font-family:Georgia,"Times New Roman",serif;font-size:31px;line-height:1.04;letter-spacing:-.04em;margin:3px 0 0}.screen-header h1 em{color:var(--accent);font-style:normal}.micro-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;font-weight:700}.header-actions{display:flex;align-items:center;gap:8px}.header-icon,.icon-button{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:var(--muted);transition:background .18s,color .18s}.header-icon:hover,.icon-button:hover{background:var(--surface-2);color:var(--ink)}.sign-in-button{border:1px solid var(--border-strong);background:var(--surface);border-radius:999px;padding:8px 12px;font-size:12px;font-weight:700}.prototype-note{display:flex;align-items:center;gap:7px;color:var(--accent);background:var(--accent-soft);border-radius:10px;padding:9px 11px;font-size:10px;margin:0 0 16px}.continue-card{border-radius:18px;overflow:hidden;display:flex;background:var(--surface);box-shadow:var(--shadow);border:1px solid var(--border);margin-bottom:26px;cursor:pointer;min-height:172px}.continue-art{position:relative;width:43%;background:linear-gradient(155deg,#d9a258,#97502e 64%,#42281e);padding:15px;color:#fff;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between}.continue-art:before{content:"";position:absolute;inset:-25% -10%;border:1px solid rgba(255,255,255,.38);border-radius:50%;transform:rotate(-22deg)}.continue-art:after{content:"";position:absolute;width:110px;height:110px;border:1px solid rgba(255,255,255,.24);border-radius:50%;right:-65px;top:26px}.continue-art span{font-size:8px;letter-spacing:.15em;font-weight:800;z-index:1}.continue-art strong{font:700 23px/1.02 Georgia,serif;letter-spacing:-.04em;z-index:1}.wave-line{height:1px;background:rgba(255,255,255,.65);position:absolute;bottom:35px;left:15px;right:15px;transform:rotate(-7deg)}.continue-copy{padding:17px 15px;flex:1}.continue-copy h2{font:700 18px/1.08 Georgia,serif;letter-spacing:-.03em;margin:7px 0 6px}.continue-copy p{color:var(--muted);font-size:11px;line-height:1.4;margin:0 0 20px}.continue-progress,.progress-track{height:4px;border-radius:999px;background:var(--border);overflow:hidden}.continue-progress span,.progress-track span{display:block;height:100%;border-radius:inherit;background:var(--accent)}.continue-meta{display:flex;justify-content:space-between;color:var(--muted);font-size:10px;margin-top:8px}.continue-meta b{color:var(--accent);font-size:16px;line-height:8px}.section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.section-header h2{font:700 18px/1.15 Georgia,serif;letter-spacing:-.03em;margin:0}.text-link{display:flex;align-items:center;gap:3px;color:var(--accent);font-weight:700;font-size:11px}.featured-card{height:207px;border-radius:18px;background:linear-gradient(140deg,#632f28,#a85838 50%,#dd9a55);color:#fff;position:relative;overflow:hidden;padding:22px;margin-bottom:28px;box-shadow:var(--shadow)}.featured-content{position:relative;z-index:2;width:67%}.eyebrow{font-size:9px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;color:var(--accent)}.eyebrow-light{color:#ffcf8d}.featured-card h2{font:700 27px/1 Georgia,serif;letter-spacing:-.045em;margin:9px 0 8px}.featured-card p{font:13px/1.35 Georgia,serif;opacity:.83;margin:0 0 18px}.featured-by{display:flex;align-items:center;gap:8px;font-size:10px;margin-bottom:15px}.featured-by small{opacity:.7}.light-button{background:#fff;color:#4f2a23;border-radius:999px;padding:9px 13px;font-size:11px;font-weight:750;display:inline-flex;align-items:center;gap:7px}.featured-orbit{position:absolute;border:1px solid rgba(255,255,255,.24);border-radius:50%}.orbit-one{width:260px;height:260px;right:-78px;top:-28px}.orbit-two{width:170px;height:170px;right:-23px;top:17px}.featured-lantern{position:absolute;right:54px;top:70px;font-size:32px;color:#ffd18e;text-shadow:0 0 20px #ffdb92}.avatar{background:linear-gradient(145deg,#e89f3d,#b95832);color:#fff;display:grid;place-items:center;border-radius:50%;font:700 14px Georgia,serif;flex:none}.avatar-sm{width:25px;height:25px;font-size:9px}.avatar-md{width:42px;height:42px}.avatar-lg{width:58px;height:58px;font-size:20px}.avatar-rose{background:linear-gradient(145deg,#d27073,#8e384c)}.avatar-green{background:linear-gradient(145deg,#6d9a73,#3c6b57)}.avatar-blue{background:linear-gradient(145deg,#6e9bb2,#3b6174)}.horizontal-scroll{display:flex;gap:12px;overflow:auto;margin:0 -20px;padding:0 20px 8px;scrollbar-width:none}.horizontal-scroll::-webkit-scrollbar{display:none}.story-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden;box-shadow:var(--shadow);margin-bottom:12px}.story-card-horizontal{width:230px;min-width:230px;margin:0}.story-card-horizontal .story-card-copy{padding:11px}.story-card-horizontal .story-description{display:none}.story-card-horizontal h3{font-size:15px}.story-card-horizontal .engagement{font-size:9px}.cover{height:148px;position:relative;overflow:hidden;padding:12px;display:flex;flex-direction:column;justify-content:space-between;color:#fff}.cover-compact{height:86px;width:68px;min-width:68px;padding:8px}.cover span{font-size:8px;letter-spacing:.1em;text-transform:uppercase;opacity:.78;font-weight:800;z-index:1}.cover strong{font:700 21px/1 Georgia,serif;max-width:75%;letter-spacing:-.04em;z-index:1}.cover-compact strong{font-size:12px}.cover i{position:absolute;width:145px;height:145px;border:1px solid rgba(255,255,255,.28);border-radius:50%;right:-48px;bottom:-44px}.cover-sunset{background:linear-gradient(145deg,#e7ad54,#ad5631 62%,#3c2420)}.cover-night{background:linear-gradient(145deg,#435b94,#252b63 62%,#171832)}.cover-forest{background:linear-gradient(145deg,#7a9660,#385c4d 62%,#1d302d)}.cover-terracotta{background:linear-gradient(145deg,#c87750,#843d36 62%,#3b2328)}.story-card-copy{padding:14px}.story-card-topline{display:flex;justify-content:space-between;align-items:center}.story-card h3{font:700 19px/1.12 Georgia,serif;letter-spacing:-.035em;margin:7px 0 5px}.story-author{font-size:10px;color:var(--muted);margin:0 0 10px}.story-author span{color:var(--tertiary);padding:0 2px}.story-description{font:12px/1.42 Georgia,serif;color:var(--muted);margin:0 0 12px}.engagement{display:flex;gap:12px;color:var(--tertiary);font-size:10px;align-items:center}.engagement span{display:inline-flex;align-items:center;gap:4px}.engagement span:first-child svg{color:var(--heart)}.progress-copy{margin-left:auto;color:var(--accent)}.story-card .progress-track{margin-top:11px}.is-favorite{color:var(--accent);background:var(--accent-soft)}.writers-section{padding-bottom:15px}.writer-row{display:flex;gap:11px;overflow:auto;margin:0 -20px;padding:0 20px 5px}.writer{min-width:115px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:5px}.writer strong{font:700 12px Georgia,serif}.writer span{font-size:9px;color:var(--muted)}.writer button{border:1px solid var(--border-strong);border-radius:999px;padding:5px 11px;font-size:10px;font-weight:700;margin-top:2px}.discover-chips,.genre-chips{display:flex;gap:7px;overflow:auto;margin:0 -20px;padding:0 20px 5px;scrollbar-width:none}.discover-chips::-webkit-scrollbar,.genre-chips::-webkit-scrollbar{display:none}.filter-chip,.genre-chip,.prompt-suggestions button,.select-chip{white-space:nowrap;border:1px solid var(--border-strong);background:var(--surface);padding:8px 13px;border-radius:999px;font-size:11px;font-weight:700;color:var(--muted)}.filter-chip.selected,.genre-chip.selected,.select-chip.selected{background:var(--ink);border-color:var(--ink);color:var(--canvas)}.genre-chips{margin-top:10px}.genre-chip{padding:7px 11px;font-size:10px}.safe-note{display:flex;align-items:center;gap:7px;color:var(--info,#4a78c2);background:rgba(74,120,194,.08);padding:9px 11px;border-radius:10px;font-size:10px;margin:15px 0 20px}.safe-note svg:last-child{margin-left:auto}.feed-header{display:flex;justify-content:space-between;align-items:center;color:var(--muted);font-size:11px;margin-bottom:10px}.discover-feed .story-card{display:grid;grid-template-columns:120px 1fr}.discover-feed .cover{height:100%;min-height:170px}.discover-feed .story-card-copy{padding:12px}.discover-feed .story-card h3{font-size:17px}.discover-feed .story-description{font-size:11px}.create-screen{padding-bottom:36px}.credit-pill{display:flex;align-items:center;gap:5px;color:var(--accent);background:var(--accent-soft);border-radius:999px;padding:8px 10px;font-size:10px;font-weight:800}.create-hero{text-align:center;padding:18px 0 22px}.wand-mark{width:48px;height:48px;margin:0 auto 13px;border-radius:16px;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center}.create-hero h2{font:700 25px/1.04 Georgia,serif;letter-spacing:-.045em;margin:0 0 9px}.create-hero p{font:12px/1.4 Georgia,serif;color:var(--muted);max-width:240px;margin:auto}.field-label{display:block;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 8px}textarea{resize:none;width:100%;border:1px solid var(--border-strong);border-radius:14px;background:var(--surface);color:var(--ink);padding:14px;font:14px/1.45 Georgia,serif;outline:none;box-shadow:var(--shadow)}textarea:focus{border-color:var(--accent)}textarea::placeholder{color:var(--tertiary)}.prompt-suggestions{display:flex;gap:7px;overflow:auto;margin:9px 0 20px}.prompt-suggestions button{padding:7px 10px;font-size:10px}.select-chips{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:17px}.select-chip{padding:8px 12px}.select-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}.select-row button{border:1px solid var(--border);background:var(--surface);border-radius:12px;padding:10px 11px;text-align:left;display:flex;justify-content:space-between;align-items:center}.select-row .field-label{margin-bottom:4px}.select-row strong{display:block;font-size:12px}.select-row svg{color:var(--muted)}.character-preview,.credits-row{display:flex;align-items:center;gap:11px;border:1px solid var(--border);background:var(--surface);border-radius:14px;padding:12px;width:100%;text-align:left;margin-bottom:13px}.character-icon,.credits-symbol{width:31px;height:31px;border-radius:10px;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;font-size:16px;flex:none}.character-preview div:nth-child(2){display:flex;flex-direction:column;gap:3px;flex:1}.character-preview strong{font-size:12px}.character-preview span{font-size:10px;color:var(--muted)}.character-preview>svg{color:var(--muted)}.primary-button,.secondary-button{height:48px;width:100%;border-radius:14px;background:var(--accent);color:#24180c;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 6px 18px rgba(232,159,61,.22)}.primary-button:disabled{opacity:.48;cursor:not-allowed;box-shadow:none}.credit-footnote{text-align:center;color:var(--tertiary);font-size:10px;margin:10px 0}.segment-control{display:grid;grid-template-columns:repeat(4,1fr);padding:3px;background:var(--surface-2);border-radius:11px;margin-bottom:18px}.segment-control button{padding:8px 4px;border-radius:8px;font-size:9px;color:var(--muted);font-weight:750}.segment-control button.selected{background:var(--surface);color:var(--ink);box-shadow:0 2px 8px rgba(0,0,0,.06)}.library-row{display:flex;gap:12px;padding:11px 0;border-bottom:1px solid var(--border);cursor:pointer}.library-row>div:last-child{flex:1;min-width:0}.library-row h3{font:700 16px/1.12 Georgia,serif;letter-spacing:-.025em;margin:5px 0}.library-row p{font-size:10px;color:var(--muted);margin:0 0 11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.row-meta{display:flex;align-items:center;gap:7px;color:var(--tertiary);font-size:9px}.row-meta .progress-track{width:50px}.row-meta svg{margin-left:auto}.empty-library{text-align:center;padding:64px 25px}.empty-icon{width:54px;height:54px;border-radius:18px;margin:auto;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center}.empty-library h2{font:700 20px Georgia,serif;margin:16px 0 7px}.empty-library p{font:12px/1.45 Georgia,serif;color:var(--muted);margin:0 auto 20px}.secondary-button{background:var(--surface);border:1px solid var(--border-strong);box-shadow:none;width:auto;padding:0 18px;display:inline-flex}.profile-card{display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border);padding:0 0 19px;margin-bottom:14px}.profile-card>div:nth-child(2){flex:1}.profile-card h2{font:700 19px Georgia,serif;margin:0 0 4px}.profile-card p{font-size:11px;color:var(--muted);margin:0}.profile-card .icon-button{background:var(--surface)}.premium-card{display:flex;align-items:center;gap:10px;width:100%;padding:13px;background:var(--premium-soft,#f5d9d3);border-radius:14px;text-align:left;margin-bottom:10px;color:var(--premium)}.premium-icon{width:34px;height:34px;display:grid;place-items:center;background:rgba(196,69,54,.12);border-radius:11px}.premium-card span:nth-child(2){display:flex;flex-direction:column;gap:4px;flex:1}.premium-card strong{font-size:12px}.premium-card small{font-size:10px;opacity:.8}.premium-card>b{font-size:18px}.credits-row{justify-content:space-between}.credits-row>span:first-child{display:flex;align-items:center;gap:10px}.credits-symbol{font-size:17px}.credits-row strong,.credits-row small{display:block}.credits-row strong{font-size:12px}.credits-row small{font-size:10px;color:var(--muted);margin-top:3px}.settings-group{margin-top:20px}.settings-group h2{font:700 13px Georgia,serif;margin:0 0 8px;color:var(--muted)}.settings-card{border:1px solid var(--border);background:var(--surface);border-radius:14px;overflow:hidden}.settings-row{width:100%;display:flex;align-items:center;gap:10px;padding:13px 12px;border-bottom:1px solid var(--border);text-align:left}.settings-row:last-child{border-bottom:0}.setting-icon{color:var(--accent);width:22px;text-align:center;font-size:14px}.settings-row strong{font-size:12px;flex:1}.setting-value{font-size:10px;color:var(--muted)}.settings-row>svg{color:var(--tertiary)}.signout-link{color:var(--premium);font-size:12px;font-weight:800;margin:24px 0 14px}.settings-footer{text-align:center;color:var(--tertiary);font-size:9px;line-height:1.6;padding-bottom:12px}.bottom-nav{height:75px;border-top:1px solid var(--border);background:color-mix(in srgb,var(--surface) 92%,transparent);display:grid;grid-template-columns:repeat(5,1fr);align-items:end;padding:7px 8px 10px;flex:none;backdrop-filter:blur(18px)}.bottom-nav button{height:51px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:var(--tertiary);font-size:9px;font-weight:650}.bottom-nav button.active{color:var(--accent)}.bottom-nav button.active svg{stroke-width:2.3}.bottom-nav button:nth-child(3){position:relative;top:-13px}.create-tab-icon{width:49px;height:49px;border-radius:17px;background:var(--accent);color:#fff;display:grid;place-items:center;box-shadow:0 6px 16px rgba(232,159,61,.35);border:4px solid var(--canvas)}.reader-overlay{position:absolute;inset:0;z-index:10;background:#f4e8d0;color:#4a3b2a;display:flex;flex-direction:column}.reader-top{height:56px;display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(181,138,62,.25);font-size:9px;letter-spacing:.12em;font-weight:800}.reader-top .header-icon{color:#7a6849}.reader-page{padding:46px 29px;overflow:auto;flex:1}.reader-chapter{font:italic 13px Georgia,serif;color:#b58a3e;letter-spacing:.12em}.reader-page h1{font:700 34px/1.05 Georgia,serif;letter-spacing:-.05em;margin:12px 0 28px}.reader-page p:not(.drop-cap){font:18px/1.65 Georgia,serif;margin:0 0 20px}.drop-cap{float:left;font:700 62px/.82 Georgia,serif;color:#b58a3e;margin:7px 8px 0 0}.reader-rule{height:1px;background:rgba(181,138,62,.35);margin:32px 0 18px}.reader-note{font:italic 12px/1.5 Georgia,serif;color:#7a6849}.reader-bottom{padding:12px 20px 17px;border-top:1px solid rgba(181,138,62,.25)}.reader-progress{height:3px;background:rgba(181,138,62,.24);margin-bottom:12px}.reader-progress span{display:block;height:100%;background:#b58a3e}.reader-bottom>div:last-child{display:flex;justify-content:space-between;align-items:center;font:12px Georgia,serif;color:#7a6849}.reader-heart{color:#b58a3e}.theme-dark .premium-card{--premium-soft:#3d211d}.theme-dark .reader-overlay{filter:brightness(.88)}@media(max-height:740px){.phone-shell{min-height:620px;height:calc(100vh - 60px)}.katha-stage{padding-top:10px}.presentation-bar{display:none}}@media(min-width:700px){.phone-shell{height:860px}.katha-stage{padding-top:24px}}
`;
