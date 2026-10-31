/**
 * 1World Web — site configuration
 * ------------------------------------------------------------------
 * Everything a future page (search.html, watch.html, dashboard.html …)
 * needs lives here. Import this module instead of hard-coding keys.
 */

export const SITE = {
  name: "1World",
  suffix: "Web",
  tagline: "Films, series & live TV — curated in monochrome.",
  description:
    "1World is an independent streaming catalogue for films, series and IPTV channels — built by its members, for its members.",
  year: new Date().getFullYear(),
  language: "en",
};

/* ------------------------------------------------------------------ */
/* Supabase                                                           */
/* ------------------------------------------------------------------ */
export const SUPABASE = {
  url: "https://vtbqbhuywdhnvitbcsfy.supabase.co",
  publishableKey: "sb_publishable_KekOyPC4iVxpiqzvuWkKdA_mEsiWTrX",
  restUrl: "https://vtbqbhuywdhnvitbcsfy.supabase.co/rest/v1",
  functionsUrl: "https://vtbqbhuywdhnvitbcsfy.supabase.co/functions/v1",
  /** Public storage bucket that holds the UI sounds. */
  storageBucket: "source",
};

/** Public URL builder for a file inside the `source` bucket. */
export function storageUrl(path) {
  return `${SUPABASE.url}/storage/v1/object/public/${SUPABASE.storageBucket}/${path.replace(/^\/+/, "")}`;
}

/* ------------------------------------------------------------------ */
/* TMDB                                                               */
/* ------------------------------------------------------------------ */
export const TMDB = {
  apiKey: "dec98ec9b59a5938a5ee3ae4eda1e090",
  base: "https://api.themoviedb.org/3",
  image: "https://image.tmdb.org/t/p",
};

/* ------------------------------------------------------------------ */
/* Sounds                                                             */
/* ------------------------------------------------------------------ */
export const SOUNDS = {
  addPoint: storageUrl("sound/add-point.mp3"),
  success: storageUrl("sound/success.mp3"),
  error: storageUrl("sound/erorr.mp3"),
  uplevel: storageUrl("sound/uplevel.mp3"),
  purchase: storageUrl("sound/purchase.mp3"),
  notification: storageUrl("sound/notefcation.mp3"),
};

/* ------------------------------------------------------------------ */
/* Social platforms                                                   */
/* ------------------------------------------------------------------ */
export const PLATFORMS = [
  { key: "youtube", label: "YouTube", handle: "@CineauraV2", url: "https://www.youtube.com/@CineauraV2" },
  { key: "facebook", label: "Facebook", handle: "CineauraV2", url: "https://www.facebook.com/CineauraV2" },
  { key: "facebook", label: "FB Group", handle: "Cineaura Community", url: "https://web.facebook.com/groups/2011674376679254" },
  { key: "instagram", label: "Instagram", handle: "@cineaurav2", url: "https://www.instagram.com/cineaurav2/" },
  { key: "reddit", label: "Reddit", handle: "r/Cineaura2", url: "https://www.reddit.com/r/Cineaura2" },
  { key: "pinterest", label: "Pinterest", handle: "CineauraV2", url: "https://www.pinterest.com/CineauraV2" },
  { key: "quora", label: "Quora", handle: "Cineaura Arabic", url: "https://msaht-cineaurav2arabic.quora.com" },
  { key: "tumblr", label: "Tumblr", handle: "cineaura-officiel", url: "https://www.tumblr.com/cineaura-officiel-v2" },
  { key: "rumble", label: "Rumble", handle: "c-7972430", url: "https://rumble.com/c/c-7972430" },
  { key: "odysee", label: "Odysee", handle: "@CineauraV2", url: "https://odysee.com/@CineauraV2:c10d9b2863" },
  { key: "vimeo", label: "Vimeo", handle: "Channel 1972980", url: "https://vimeo.com/channels/1972980" },
  { key: "tiktok", label: "TikTok", handle: "@cineauraV2", url: "https://www.tiktok.com/@cineauraV2" },
  { key: "bilibili", label: "Bilibili", handle: "Cineaura", url: "https://www.bilibili.tv/en/space/1861102337" },
  { key: "telegram", label: "Telegram", handle: "@CineauraV2", url: "https://t.me/CineauraV2" },
];

/* ------------------------------------------------------------------ */
/* Membership plans                                                   */
/* ------------------------------------------------------------------ */
/** 1 USD = 100 points, everywhere on the site. */
export const POINTS_PER_USD = 100;

/** Prices are quoted per 3 months, exactly as published on the pricing table. */
export const PLANS = [
  {
    id: "free",
    name: "Free",
    tier: "Starter",
    pricePerQuarter: 0,
    levelCap: "LV3",
    durationOptions: [1],
    durationUnit: "month",
    blurb: "A month of access, renewed monthly. Ad-supported.",
    features: [
      "Watch films & series",
      "Member-only content",
      "Free IPTV channels (with ads)",
      "Up to 5 viewing codes (XXXXXX)",
      "Level cap LV3",
      "Renew every month",
    ],
    note: "Free forever — renews each month.",
  },
  {
    id: "silver",
    name: "Silver",
    tier: "Premium",
    pricePerQuarter: 5,
    levelCap: "LV5",
    durationOptions: [3, 6, 12, 24],
    durationUnit: "months",
    blurb: "Premium access at the entry price.",
    features: [
      "Films, series & private content",
      "Free + premium IPTV channels",
      "No advertising, ever",
      "Up to 10 viewing codes",
      "Level cap LV5",
      "Priority support",
    ],
    note: "Premium benefits unlock instantly at activation.",
  },
  {
    id: "gold",
    name: "Gold",
    tier: "Premium",
    pricePerQuarter: 10,
    levelCap: "LV7",
    durationOptions: [3, 6, 12, 24],
    durationUnit: "months",
    blurb: "The balance of value and reach.",
    features: [
      "Everything in Silver",
      "Higher bitrate streams",
      "Free + premium IPTV channels",
      "Up to 10 viewing codes",
      "Level cap LV7",
      "Early access to new releases",
    ],
    note: "Most chosen plan by members.",
    featured: true,
  },
  {
    id: "diamond",
    name: "Diamond",
    tier: "Premium",
    pricePerQuarter: 15,
    levelCap: "LV10",
    durationOptions: [3, 6, 12, 24],
    durationUnit: "months",
    blurb: "The full platform, without limits.",
    features: [
      "Everything in Gold",
      "Highest level cap LV10",
      "Free + premium IPTV channels",
      "Up to 10 viewing codes",
      "Auction & market priority",
      "Dedicated account manager",
    ],
    note: "Full access to every corner of 1World.",
  },
];

/* ------------------------------------------------------------------ */
/* Navigation                                                         */
/* ------------------------------------------------------------------ */
export const PRIMARY_NAV = [
  { label: "Features", href: "#features" },
  { label: "Search", href: "#search" },
  { label: "Movies", href: "#movies" },
  { label: "Series", href: "#series" },
  { label: "IPTV", href: "#iptv" },
  { label: "Membership", href: "#membership" },
  { label: "Apps", href: "#apps" },
  { label: "Support", href: "#support" },
];

export const SIDEBAR_NAV = [
  {
    title: null,
    items: [{ label: "Search", href: "search.html", icon: "search" }],
  },
  {
    title: "Watch",
    items: [
      { label: "Movies", href: "movies.html", icon: "film" },
      { label: "Series", href: "series.html", icon: "tv" },
      { label: "IPTV", href: "iptv.html", icon: "broadcast" },
    ],
  },
  {
    title: "Browse",
    items: [
      { label: "Videos", href: "videos.html", icon: "video" },
      { label: "Podcast", href: "podcast.html", icon: "mic" },
      { label: "Pictures", href: "pictures.html", icon: "image" },
      { label: "Documents", href: "documents.html", icon: "file" },
      { label: "Articles", href: "articles.html", icon: "article" },
      { label: "Answers", href: "answers.html", icon: "help" },
      { label: "Reviews", href: "reviews.html", icon: "star" },
    ],
  },
  {
    title: "Earn",
    items: [
      { label: "Market", href: "market.html", icon: "cart" },
      { label: "Auction", href: "auction.html", icon: "gavel" },
      { label: "Bank", href: "bank.html", icon: "bank" },
      { label: "Prizes", href: "prizes.html", icon: "gift" },
      { label: "Tasks", href: "tasks.html", icon: "tasks" },
    ],
  },
  {
    title: "Pages",
    items: [
      { label: "About", href: "about.html", icon: "info" },
      { label: "Privacy", href: "privacy.html", icon: "shield" },
      { label: "Terms", href: "terms.html", icon: "scale" },
      { label: "Contact", href: "contact.html", icon: "mail" },
      { label: "Help", href: "help.html", icon: "lifebuoy" },
    ],
  },
];

export const FOOTER_NAV = [
  {
    title: "Watch",
    links: [
      { label: "Movies", href: "movies.html" },
      { label: "Series", href: "series.html" },
      { label: "IPTV", href: "iptv.html" },
      { label: "Search", href: "search.html" },
    ],
  },
  {
    title: "Browse",
    links: [
      { label: "Videos", href: "videos.html" },
      { label: "Podcast", href: "podcast.html" },
      { label: "Pictures", href: "pictures.html" },
      { label: "Documents", href: "documents.html" },
      { label: "Articles", href: "articles.html" },
      { label: "Answers", href: "answers.html" },
      { label: "Reviews", href: "reviews.html" },
    ],
  },
  {
    title: "Earn",
    links: [
      { label: "Market", href: "market.html" },
      { label: "Auction", href: "auction.html" },
      { label: "Bank", href: "bank.html" },
      { label: "Prizes", href: "prizes.html" },
      { label: "Tasks", href: "tasks.html" },
    ],
  },
  {
    title: "Site",
    links: [
      { label: "About", href: "about.html" },
      { label: "Privacy", href: "privacy.html" },
      { label: "Terms", href: "terms.html" },
      { label: "Contact", href: "contact.html" },
      { label: "Help", href: "help.html" },
    ],
  },
];

export const APP_TARGETS = [
  { id: "windows", name: "Windows", meta: "Windows 10 / 11 · x64", icon: "windows" },
  { id: "macos", name: "macOS", meta: "Apple silicon & Intel", icon: "apple" },
  { id: "linux", name: "Linux", meta: "AppImage · deb · rpm", icon: "linux" },
  { id: "android", name: "Android", meta: "Android 9 and above", icon: "android" },
  { id: "ios", name: "iOS", meta: "iPhone & iPad", icon: "apple" },
  { id: "androidtv", name: "Android TV", meta: "TV, Fire TV, Chromecast", icon: "tv" },
  { id: "appletv", name: "Apple TV", meta: "tvOS 15 and above", icon: "appletv" },
];
